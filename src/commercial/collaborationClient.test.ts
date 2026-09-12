import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import type { CollaborationPollResponse, CollaborationOperationResponse } from './contractsV8';
import {
  StudioCollaborationClient,
  type ScenarioEditorBridge,
} from "./collaborationClient";

function editorBridge(): ScenarioEditorBridge {
  return {
    read: () => ({ type: "doc", content: [] }),
    replaceDocument: vi.fn(),
    subscribe: () => () => undefined,
    setReadOnly: vi.fn(),
  };
}

function api() {
  const pollCollaboration = vi.fn(async (): Promise<CollaborationPollResponse> => ({
    contractVersion: '2026-09-v8', request_id: 'req-poll', nextCursor: 0,
    events: [],
    hasMore: false,
    syncLag: 0,
  }));
  const heartbeatCollaboration = vi.fn(async () => ({
    cursor: 0,
    presence: [],
  }));
  const value = {
    issueCollaborationTicket: vi.fn(async () => ({ ticket: "ticket" })),
    connectCollaboration: vi.fn(async () => ({
      connectionId: "connection-1",
      cursor: 0,
      role: "editor",
      presence: [],
      limits: { heartbeatIntervalSeconds: 10 },
    })),
    pollCollaboration,
    heartbeatCollaboration,
    disconnectCollaboration: vi.fn(async () => undefined),
    submitCollaborationOperation: vi.fn(async (): Promise<CollaborationOperationResponse> => ({
      contractVersion: '2026-09-v8', request_id: 'req-write', status: 'applied', nextCursor: 10,
    })),
  };
  return {
    value: value as unknown as AuthenticatedCommercialApi,
    mocks: value,
  };
}

describe("StudioCollaborationClient recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps idle polling below the distributed route limit", async () => {
    const service = api();
    const client = new StudioCollaborationClient(
      service.value,
      "studio-1",
      "scenario-1",
      "version-1",
      "profile-1",
      editorBridge(),
    );
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.mocks.pollCollaboration).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_999);
    expect(service.mocks.pollCollaboration).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(service.mocks.pollCollaboration).toHaveBeenCalledTimes(2);

    await client.disconnect();
  });

  it("reuses a live connection after a transient poll failure", async () => {
    const service = api();
    service.mocks.pollCollaboration.mockRejectedValueOnce(
      Object.assign(new Error("rate limited"), { code: "rate_limited" }),
    );
    const client = new StudioCollaborationClient(
      service.value,
      "studio-1",
      "scenario-1",
      "version-1",
      "profile-1",
      editorBridge(),
    );
    await client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(service.mocks.heartbeatCollaboration).toHaveBeenCalled();
    expect(service.mocks.issueCollaborationTicket).toHaveBeenCalledOnce();
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();

    await client.disconnect();
  });

  it('survives a replayed profile revocation from a previous session', async () => {
    const service = api();
    service.mocks.pollCollaboration.mockResolvedValueOnce({
      contractVersion: '2026-09-v8', request_id: 'req-history', nextCursor: 1,
      hasMore: false, syncLag: 0,
      events: [{ cursor: 1, type: 'connection.closed', profileId: 'profile-1', reason: 'revoked' }],
    });
    const bridge = editorBridge();
    const client = makeClient(service.value, bridge);
    const statuses: string[] = [];
    client.subscribe((state) => statuses.push(state.status));
    await client.connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(statuses[statuses.length - 1]).toBe('online');
    expect(statuses).not.toContain('reconnecting');
    expect(bridge.setReadOnly).toHaveBeenLastCalledWith(false);
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();
    expect(service.mocks.pollCollaboration.mock.calls.length).toBeLessThanOrEqual(31);
    await client.disconnect();
  });

  it('stops permanently when current membership is denied', async () => {
    const service = api();
    service.mocks.pollCollaboration.mockRejectedValueOnce(Object.assign(new Error(), { status: 403, code: 'studio_write_forbidden' }));
    const client = makeClient(service.value);
    const statuses: string[] = [];
    client.subscribe((state) => statuses.push(state.status));
    await client.connect();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(statuses[statuses.length - 1]).toBe('read_only');
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();
    expect(service.mocks.pollCollaboration).toHaveBeenCalledOnce();
    expect(service.mocks.disconnectCollaboration).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it('replaces only an expired channel without logging out', async () => {
    const service = api();
    service.mocks.pollCollaboration.mockRejectedValueOnce(Object.assign(new Error(), { status: 401, code: 'collaboration_connection_closed' }));
    const client = makeClient(service.value);
    await client.connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(service.mocks.connectCollaboration).toHaveBeenCalledTimes(2);
    await client.disconnect();
  });

  it('does not reset backoff just because heartbeats succeed', async () => {
    const service = api();
    service.mocks.pollCollaboration.mockRejectedValue(Object.assign(new Error(), { status: 503, code: 'channel_unavailable' }));
    const client = makeClient(service.value);
    await client.connect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.mocks.pollCollaboration.mock.calls.length).toBeLessThanOrEqual(7);
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it.each(['collaboration_cursor_too_old', 'collaboration_backpressure'])('requires recovery instead of looping on %s', async (code) => {
    const service = api();
    service.mocks.pollCollaboration.mockRejectedValueOnce(Object.assign(new Error(), { code }));
    const client = makeClient(service.value);
    let status = '';
    client.subscribe((state) => { status = state.status; });
    await client.connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(status).toBe('recovery_required');
    expect(service.mocks.pollCollaboration).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it('ignores a late poll and never restarts timers after logout', async () => {
    const service = api();
    const pending = deferred<CollaborationPollResponse>();
    service.mocks.pollCollaboration.mockImplementationOnce(() => pending.promise);
    const client = makeClient(service.value);
    let status = '';
    client.subscribe((state) => { status = state.status; });
    const connecting = client.connect();
    await vi.advanceTimersByTimeAsync(0);
    await client.disconnect();
    pending.resolve({ contractVersion: '2026-09-v8', request_id: 'late', nextCursor: 0, events: [], hasMore: false, syncLag: 0 });
    await connecting;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(status).toBe('disconnected');
    expect(service.mocks.pollCollaboration).toHaveBeenCalledOnce();
    expect(service.mocks.heartbeatCollaboration).not.toHaveBeenCalled();
  });

  it('single-flights simultaneous connect calls', async () => {
    const service = api();
    const client = makeClient(service.value);
    await Promise.all([client.connect(), client.connect(), client.connect()]);
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it('keeps the local document untouched until all initial pages have arrived', async () => {
    const service = api();
    service.mocks.pollCollaboration.mockResolvedValueOnce({
      contractVersion: '2026-09-v8', request_id: 'page-1', nextCursor: 1,
      events: [{ type: 'connection.closed', cursor: 1, profileId: 'other', reason: 'client' }], hasMore: true, syncLag: 1,
    });
    const bridge = editorBridge();
    const client = makeClient(service.value, bridge);
    await client.connect();
    expect(bridge.replaceDocument).not.toHaveBeenCalled();
    expect(bridge.setReadOnly).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(bridge.replaceDocument).toHaveBeenCalledOnce();
    expect(bridge.setReadOnly).toHaveBeenLastCalledWith(false);
    await client.disconnect();
  });

  it('stops with recovery instead of retrying an incompatible remote document', async () => {
    const service = api();
    const bridge = editorBridge();
    bridge.replaceDocument = () => { throw new Error('Unknown schema node'); };
    const client = makeClient(service.value, bridge);
    let code: string | null | undefined;
    client.subscribe((state) => { code = state.lastErrorCode; });
    await client.connect();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(code).toBe('collaboration_document_invalid');
    expect(service.mocks.pollCollaboration).toHaveBeenCalledOnce();
    await client.disconnect();
  });

  it('applies another instance of the same account once, in cursor order', async () => {
    const service = api();
    const bridge = editorBridge();
    const operation = {
      studioId: 'studio-1', scenarioId: 'scenario-1', baseVersionId: 'version-1',
      operationId: 'another-instance-operation', actorId: 'profile-1', request_id: 'req-op',
      clientSequence: 1, logicalClock: 1, checksum: 'a'.repeat(64), cursor: 1,
      receivedAt: new Date().toISOString(), mutation: { type: 'block.delete' as const, blockId: 'b1' },
    };
    const response: CollaborationPollResponse = {
      contractVersion: '2026-09-v8', request_id: 'req-poll', nextCursor: 1,
      events: [{ type: 'operation.applied', cursor: 1, operation }], hasMore: false, syncLag: 0,
    };
    service.mocks.pollCollaboration.mockResolvedValue(response);
    const client = makeClient(service.value, bridge);
    await client.connect();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bridge.replaceDocument).toHaveBeenCalledWith({ type: 'doc', content: [] }, true);
    await client.disconnect();
  });

  it('keeps heartbeats alive while reading is throttled', async () => {
    const service = api();
    service.mocks.pollCollaboration.mockRejectedValueOnce(Object.assign(new Error(), { status: 429, code: 'rate_limited', retryAfterMs: 90_000 }));
    const client = makeClient(service.value);
    await client.connect();
    await vi.advanceTimersByTimeAsync(89_000);
    expect(service.mocks.pollCollaboration).toHaveBeenCalledOnce();
    expect(service.mocks.heartbeatCollaboration.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(service.mocks.pollCollaboration).toHaveBeenCalledTimes(2);
    await client.disconnect();
  });

  it('retries the same uncertain operation without concurrent writes or cursor loss', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
    const service = api();
    const bridge = editorBridge();
    let change: (doc: ReturnType<ScenarioEditorBridge['read']>) => void = () => {};
    bridge.subscribe = (listener) => { change = listener; return () => {}; };
    const client = makeClient(service.value, bridge);
    await client.connect();
    service.mocks.submitCollaborationOperation.mockRejectedValueOnce(Object.assign(new Error(), { status: 504, code: 'request_timeout' }));
    change({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b1' }, content: [{ type: 'text', text: 'synthetic' }] }] });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(service.mocks.submitCollaborationOperation).toHaveBeenCalledTimes(2);
    const calls = service.mocks.submitCollaborationOperation.mock.calls as unknown as Array<[string, string, unknown]>;
    expect(calls[0][2]).toEqual(calls[1][2]);
    const polls = service.mocks.pollCollaboration.mock.calls as unknown as Array<[string, string, number]>;
    expect(polls.every((call) => call[2] === 0)).toBe(true);
    expect((await client.recoveryCopy()).operations).toHaveLength(0);
    await client.disconnect();
    digest.mockRestore();
  });
});

function makeClient(service: AuthenticatedCommercialApi, bridge = editorBridge()) {
  return new StudioCollaborationClient(service, 'studio-1', 'scenario-1', 'version-1', 'profile-1', bridge);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

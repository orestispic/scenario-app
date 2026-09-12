import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import {
  StudioCollaborationClient,
  type ScenarioEditorBridge,
} from "./collaborationClient";

function editorBridge(): ScenarioEditorBridge {
  return {
    read: () => ({ type: "doc", content: [] }),
    applyRemote: vi.fn(),
    subscribe: () => () => undefined,
    setReadOnly: vi.fn(),
  };
}

function api() {
  const pollCollaboration = vi.fn(async () => ({
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
    submitCollaborationOperation: vi.fn(),
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

    await vi.advanceTimersByTimeAsync(1_999);
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
    await vi.advanceTimersByTimeAsync(500);

    expect(service.mocks.heartbeatCollaboration).toHaveBeenCalledOnce();
    expect(service.mocks.issueCollaborationTicket).toHaveBeenCalledOnce();
    expect(service.mocks.connectCollaboration).toHaveBeenCalledOnce();

    await client.disconnect();
  });
});

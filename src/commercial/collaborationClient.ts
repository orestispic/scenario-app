import type { JSONContent } from '@tiptap/core';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type {
  CollaborationConflict,
  CollaborationPresence,
  CollaborationRecoveryCopy,
  CollaborativeMutation,
  CollaborativeOperationRequest,
} from './contractsV8';

export type CollaborationStatus =
  | 'disconnected'
  | 'connecting'
  | 'online'
  | 'reconnecting'
  | 'offline'
  | 'conflict'
  | 'read_only'
  | 'recovery_required';
export interface CollaborationViewState {
  status: CollaborationStatus;
  presence: CollaborationPresence[];
  syncLag: number;
  conflict: CollaborationConflict | null;
  lastErrorCode?: string | null;
  requestId?: string | null;
}
export interface ScenarioEditorBridge {
  read(): JSONContent;
  applyRemote(mutation: CollaborativeMutation): void;
  subscribe(listener: (document: JSONContent) => void): () => void;
  setReadOnly(value: boolean): void;
}

// Transport pacing, independent of commercial entitlements. Allows multiple
// tabs per profile and bounds catch-up bursts as well as idle polling.
const IDLE_POLL_DELAY_MS = 4_000;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`;
}
async function checksum(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function blockId(block: JSONContent): string | null {
  const value = block.attrs?.blockId;
  return typeof value === 'string' && value ? value : null;
}
export function diffScenarioBlocks(
  before: JSONContent,
  after: JSONContent,
): CollaborativeMutation[] {
  const oldBlocks = new Map(
    (before.content ?? []).flatMap((block) => {
      const id = blockId(block);
      return id ? [[id, block] as const] : [];
    }),
  );
  const next = after.content ?? [];
  const mutations: CollaborativeMutation[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const block = next[index];
    const id = blockId(block);
    if (!id) continue;
    const previous = oldBlocks.get(id);
    if (!previous || canonical(previous) !== canonical(block)) {
      const prior =
        next.slice(0, index).reverse().map(blockId).find(Boolean) ?? null;
      mutations.push({
        type: 'block.upsert',
        blockId: id,
        afterBlockId: prior,
        block: structuredClone(block) as Record<string, unknown>,
      });
    }
    oldBlocks.delete(id);
  }
  for (const id of oldBlocks.keys())
    mutations.push({ type: 'block.delete', blockId: id });
  return mutations;
}
export function applyScenarioMutation(
  document: JSONContent,
  mutation: CollaborativeMutation,
): JSONContent {
  const content = structuredClone(document.content ?? []);
  const current = content.findIndex(
    (block) => blockId(block) === mutation.blockId,
  );
  if (mutation.type === 'block.delete') {
    if (current >= 0) content.splice(current, 1);
    return { ...structuredClone(document), content };
  }
  const block = structuredClone(mutation.block) as JSONContent;
  if (current >= 0) content.splice(current, 1);
  const after =
    mutation.afterBlockId === null
      ? -1
      : content.findIndex((item) => blockId(item) === mutation.afterBlockId);
  content.splice(Math.max(0, after + 1), 0, block);
  return { ...structuredClone(document), content };
}

export class StudioCollaborationClient {
  private connectionId: string | null = null;
  private cursor = 0;
  private logicalClock = 0;
  private clientSequence = 0;
  private generation = 0;
  private disposed = false;
  private stopped = false;
  private state: CollaborationViewState = {
    status: 'disconnected', presence: [], syncLag: 0, conflict: null,
  };
  private pending = new Map<string, CollaborativeOperationRequest>();
  private attempted = new Set<string>();
  private locallyApplied = new Set<string>();
  private unsubscribeEditor: (() => void) | null = null;
  private previousDocument: JSONContent;
  private listeners = new Set<(state: CollaborationViewState) => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private applyingRemote = false;
  private readOnly = false;
  private heartbeatDelayMs = 10_000;
  private nextHeartbeat = 0;
  private nextPoll = 0;
  private nextWrite = 0;
  private retryAt = 0;
  private maximumOperationBytes = 65_536;
  private maximumPending = 256;
  private backoffMaximum = 30_000;

  constructor(
    private readonly api: AuthenticatedCommercialApi,
    private readonly studioId: string,
    private readonly scenarioId: string,
    private baseVersionId: string,
    _actorId: string,
    private readonly editor: ScenarioEditorBridge,
  ) {
    this.previousDocument = structuredClone(editor.read());
  }

  subscribe(listener: (state: CollaborationViewState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  // One scheduler and one in-flight task own all network activity.
  connect(): Promise<void> {
    if (this.disposed || this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    if (this.connectionId || this.timer) return Promise.resolve();
    this.update({ status: 'connecting' });
    return this.run();
  }

  async disconnect(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.api.cancelCollaborationRequests?.();
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    const connectionId = this.connectionId;
    this.connectionId = null;
    this.pending.clear();
    this.attempted.clear();
    this.locallyApplied.clear();
    this.previousDocument = { type: 'doc', content: [] };
    this.editor.setReadOnly(false);
    this.update({ status: 'disconnected', presence: [], syncLag: 0, conflict: null });
    if (connectionId) await this.closeConnection(connectionId);
  }

  async recoveryCopy(): Promise<CollaborationRecoveryCopy> {
    const operations = [...this.pending.values()].map((item) => structuredClone(item));
    for (const operation of operations) {
      if (operation.checksum) continue;
      const { checksum: unused, ...unsigned } = operation;
      void unused;
      operation.checksum = await checksum(unsigned);
    }
    return {
      format: 'scenario-collaboration-recovery-v1',
      studioId: this.studioId, scenarioId: this.scenarioId,
      baseVersionId: this.baseVersionId,
      operations,
      createdAt: new Date().toISOString(),
    };
  }

  private alive(generation: number) {
    return !this.disposed && !this.stopped && generation === this.generation;
  }

  private run(): Promise<void> {
    if (this.running) return this.running;
    const generation = this.generation;
    const task = this.tick(generation).catch((error) => {
      if (this.alive(generation)) this.fail(error);
    }).finally(() => {
      if (this.running !== task) return;
      this.running = null;
      if (this.alive(generation)) this.schedule();
    });
    this.running = task;
    return task;
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const next = this.retryAt > Date.now()
      ? Math.min(this.retryAt, this.connectionId ? this.nextHeartbeat : Infinity)
      : Math.min(this.nextHeartbeat, this.nextPoll,
          this.pending.size && !this.readOnly ? this.nextWrite : Infinity);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, Math.max(50, next - Date.now()));
  }

  private async tick(generation: number) {
    if (!this.alive(generation)) return;
    if (Date.now() < this.retryAt) {
      if (this.connectionId && Date.now() >= this.nextHeartbeat) {
        const heartbeat = await this.api.heartbeatCollaboration(this.studioId, this.connectionId);
        if (!this.alive(generation)) return;
        this.update({ presence: heartbeat.presence });
        this.nextHeartbeat = Date.now() + this.heartbeatDelayMs;
      }
      return;
    }
    if (!this.connectionId) {
      const { ticket } = await this.api.issueCollaborationTicket(this.studioId);
      if (!this.alive(generation)) return;
      const connection = await this.api.connectCollaboration(this.studioId, ticket, this.cursor);
      if (!this.alive(generation)) {
        await this.closeConnection(connection.connectionId);
        return;
      }
      this.connectionId = connection.connectionId;
      this.readOnly = connection.role === 'viewer';
      const limits = connection.limits;
      this.heartbeatDelayMs = limits.heartbeatIntervalSeconds * 1_000;
      if (!Number.isFinite(this.heartbeatDelayMs) || this.heartbeatDelayMs < 1_000)
        throw Object.assign(new Error('Invalid channel limits'), { code: 'invalid_channel_response' });
      this.maximumOperationBytes = limits.maximumOperationBytes ?? 65_536;
      this.maximumPending = Math.min(256, limits.maximumPendingEvents ?? 256);
      this.backoffMaximum = Math.min(60_000, (limits.reconnectBackoffMaximumSeconds ?? 30) * 1_000);
      this.editor.setReadOnly(this.readOnly);
      this.update({ presence: connection.presence });
      this.nextHeartbeat = Date.now() + this.heartbeatDelayMs;
      this.nextPoll = 0;
      this.unsubscribeEditor ??= this.editor.subscribe((document) => this.onLocalDocument(document));
    }

    if (Date.now() >= this.nextHeartbeat) {
      const heartbeat = await this.api.heartbeatCollaboration(this.studioId, this.connectionId!);
      if (!this.alive(generation)) return;
      this.update({ presence: heartbeat.presence });
      // Presence is display information only; writes are always authorized by the server.
      this.nextHeartbeat = Date.now() + this.heartbeatDelayMs;
    }

    if (Date.now() >= this.nextPoll) {
      const response = await this.api.pollCollaboration(this.studioId, this.connectionId!, this.cursor);
      if (!this.alive(generation)) return;
      for (const event of [...response.events].sort((a, b) => a.cursor - b.cursor)) {
        if (event.cursor <= this.cursor) continue;
        if (event.type === 'operation.applied') {
          const operation = event.operation;
          this.logicalClock = Math.max(this.logicalClock, operation.logicalClock);
          // Acknowledgements do not advance the read cursor: another actor's
          // operation can precede our acknowledgement and must still be applied.
          if (!this.locallyApplied.has(operation.operationId) && !this.pending.has(operation.operationId)) {
            if ([...this.pending.values()].some((item) => item.mutation.blockId === operation.mutation.blockId)) {
              this.halt('recovery_required', 'local_remote_overlap');
              return;
            }
            this.applyingRemote = true;
            try {
              this.editor.applyRemote(operation.mutation);
              this.previousDocument = structuredClone(this.editor.read());
            } finally {
              this.applyingRemote = false;
            }
          }
          this.locallyApplied.delete(operation.operationId);
        } else if (event.type === 'operation.conflict') {
          this.update({ conflict: event.conflict });
          this.cursor = event.cursor;
          this.halt('conflict', 'collaboration_conflict');
          return;
        }
        // v8 close events identify a profile, not a connection or session.
        // They are historical facts, never authority to close this new channel.
        // Every poll/heartbeat is authorized for the CURRENT connection server-side.
        this.cursor = event.cursor;
      }
      this.nextPoll = Date.now() + IDLE_POLL_DELAY_MS;
      this.reconnectAttempts = 0;
      this.retryAt = 0;
      this.update({
        status: this.readOnly ? 'read_only' : 'online',
        syncLag: Math.max(response.syncLag, this.pending.size),
        lastErrorCode: null, requestId: null,
      });
    }

    if (!this.readOnly && this.pending.size && Date.now() >= this.nextWrite) {
      const operation = this.pending.values().next().value!;
      this.attempted.add(operation.operationId);
      if (!operation.checksum) {
        const { checksum: unused, ...unsigned } = operation;
        void unused;
        operation.checksum = await checksum(unsigned);
      }
      if (!this.alive(generation)) return;
      const response = await this.api.submitCollaborationOperation(this.studioId, this.connectionId!, operation);
      if (!this.alive(generation)) return;
      if (response.status === 'conflict') {
        this.update({ conflict: response.conflict ?? null });
        this.halt('conflict', 'collaboration_conflict');
        return; // Retain the rejected operation for recovery.
      }
      this.pending.delete(operation.operationId);
      this.attempted.delete(operation.operationId);
      this.nextWrite = Date.now() + IDLE_POLL_DELAY_MS;
      this.update({ syncLag: this.pending.size });
    }
  }

  private onLocalDocument(document: JSONContent) {
    if (this.disposed || this.stopped || this.applyingRemote || this.readOnly) return;
    for (const mutation of diffScenarioBlocks(this.previousDocument, document)) {
      // Coalesce only requests that have NEVER been sent. An uncertain request
      // retains exactly the same id, sequence, body and checksum on every retry.
      const unsent = [...this.pending.values()].find((item) =>
        item.mutation.blockId === mutation.blockId && !this.attempted.has(item.operationId));
      if (unsent) {
        this.pending.delete(unsent.operationId);
        this.locallyApplied.delete(unsent.operationId);
      }
      const operation: CollaborativeOperationRequest = {
        studioId: this.studioId, scenarioId: this.scenarioId,
        baseVersionId: this.baseVersionId, operationId: crypto.randomUUID(),
        clientSequence: ++this.clientSequence, logicalClock: ++this.logicalClock,
        mutation, checksum: '',
      };
      this.pending.set(operation.operationId, operation);
      this.locallyApplied.add(operation.operationId);
      if (this.locallyApplied.size > 512) {
        this.halt('recovery_required', 'local_backpressure');
        return;
      }
      if (this.pending.size > this.maximumPending ||
          new TextEncoder().encode(JSON.stringify(operation)).byteLength > this.maximumOperationBytes - 64) {
        this.halt('recovery_required', 'local_backpressure');
        return; // The editor's full local document is preserved.
      }
    }
    this.previousDocument = structuredClone(document);
    this.update({ syncLag: this.pending.size });
    // Wake the single scheduler without starting a concurrent send.
    if (!this.running) this.schedule();
  }

  private fail(error: unknown) {
    const failure = error as { code?: string; status?: number; requestId?: string; retryAfterMs?: number; terminal?: boolean };
    const code = failure.terminal ? 'session_expired' : failure.code ?? 'channel_unavailable';
    this.update({ lastErrorCode: /^[a-z_]{1,80}$/.test(code) ? code : 'channel_unavailable',
      requestId: failure.requestId && /^[a-zA-Z0-9-]{1,80}$/.test(failure.requestId) ? failure.requestId : null });
    if (['collaboration_cursor_too_old', 'collaboration_backpressure'].includes(code) ||
        failure.status === 409 || failure.status === 413 || code === 'invalid_channel_response') {
      this.halt('recovery_required', code);
      return;
    }
    const channelExpired = ['collaboration_connection_closed', 'collaboration_ticket_invalid'].includes(code);
    if (!channelExpired && (failure.status === 401 || failure.status === 403 ||
        failure.status === 404 || failure.status === 426 ||
        ['studio_not_found', 'studio_write_forbidden', 'session_expired'].includes(code))) {
      this.halt('read_only', code);
      return;
    }
    if (failure.status && failure.status >= 400 && failure.status < 429 && !channelExpired) {
      this.halt('recovery_required', code);
      return;
    }
    if (channelExpired) this.connectionId = null;
    const limited = failure.status === 429 || code === 'rate_limited' || code === 'collaboration_capacity_reached';
    const delay = limited
      ? Math.max(60_000, Math.min(300_000, failure.retryAfterMs ?? 0))
      : Math.min(this.backoffMaximum, 1_000 * 2 ** Math.min(this.reconnectAttempts++, 6));
    // A timed-out handshake may have succeeded remotely. Let the orphan's idle
    // lease expire before allocating another ticket/connection.
    this.retryAt = Date.now() + (!this.connectionId && code === 'request_timeout' ? Math.max(30_000, delay) : delay);
    this.nextPoll = 0;
    this.nextHeartbeat = Date.now() + this.heartbeatDelayMs;
    this.update({ status: 'reconnecting' });
  }

  private halt(status: CollaborationStatus, code: string) {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.api.cancelCollaborationRequests?.();
    this.editor.setReadOnly(true);
    this.update({ status, lastErrorCode: code, presence: [] });
    const connection = this.connectionId;
    this.connectionId = null;
    if (connection) void this.closeConnection(connection);
  }

  private async closeConnection(connectionId: string) {
    try { await this.api.disconnectCollaboration(this.studioId, connectionId); }
    catch { /* The server's bounded idle lease is the fallback. */ }
  }

  private update(patch: Partial<CollaborationViewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private snapshot() {
    return { ...this.state, presence: structuredClone(this.state.presence),
      conflict: this.state.conflict ? structuredClone(this.state.conflict) : null };
  }
}

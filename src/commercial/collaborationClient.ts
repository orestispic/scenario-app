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
  | 'read_only';
export interface CollaborationViewState {
  status: CollaborationStatus;
  presence: CollaborationPresence[];
  syncLag: number;
  conflict: CollaborationConflict | null;
}
export interface ScenarioEditorBridge {
  read(): JSONContent;
  applyRemote(mutation: CollaborativeMutation): void;
  subscribe(listener: (document: JSONContent) => void): () => void;
  setReadOnly(value: boolean): void;
}

// The preproduction API limits each authenticated route to 60 requests/minute.
// Keep ordinary catch-up traffic comfortably below that ceiling so heartbeats,
// operations and user actions retain headroom.
const IDLE_POLL_DELAY_MS = 2_000;

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
  private disposed = false;
  private state: CollaborationViewState = {
    status: 'disconnected',
    presence: [],
    syncLag: 0,
    conflict: null,
  };
  private pending = new Map<string, CollaborativeOperationRequest>();
  private received = new Set<string>();
  private unsubscribeEditor: (() => void) | null = null;
  private previousDocument: JSONContent;
  private listeners = new Set<(state: CollaborationViewState) => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private applyingRemote = false;
  private readOnly = false;
  private heartbeatDelayMs = 10_000;

  constructor(
    private readonly api: AuthenticatedCommercialApi,
    private readonly studioId: string,
    private readonly scenarioId: string,
    private baseVersionId: string,
    private readonly actorId: string,
    private readonly editor: ScenarioEditorBridge,
  ) {
    this.previousDocument = structuredClone(editor.read());
  }
  subscribe(listener: (state: CollaborationViewState) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }
  async connect(): Promise<void> {
    this.disposed = false;
    this.update({
      status: this.reconnectAttempts ? 'reconnecting' : 'connecting',
    });
    try {
      const { ticket } = await this.api.issueCollaborationTicket(this.studioId);
      const connection = await this.api.connectCollaboration(
        this.studioId,
        ticket,
        this.cursor,
      );
      this.connectionId = connection.connectionId;
      this.cursor = connection.cursor;
      this.reconnectAttempts = 0;
      this.readOnly = connection.role === 'viewer';
      this.heartbeatDelayMs =
        connection.limits.heartbeatIntervalSeconds * 1_000;
      this.editor.setReadOnly(this.readOnly);
      this.update({
        status: this.readOnly ? 'read_only' : 'online',
        presence: connection.presence,
        syncLag: 0,
      });
      this.unsubscribeEditor ??= this.editor.subscribe(
        (document) => void this.onLocalDocument(document),
      );
      this.schedulePoll(0);
      this.scheduleHeartbeat(this.heartbeatDelayMs);
      await this.flush();
    } catch (error) {
      this.update({ status: 'offline' });
      this.scheduleReconnect();
      throw error;
    }
  }
  async disconnect(): Promise<void> {
    this.disposed = true;
    this.clearTimers();
    this.unsubscribeEditor?.();
    this.unsubscribeEditor = null;
    const connectionId = this.connectionId;
    this.connectionId = null;
    if (connectionId)
      try {
        await this.api.disconnectCollaboration(this.studioId, connectionId);
      } catch {
        /* best effort; server expiry closes it */
      }
    this.pending.clear();
    this.received.clear();
    this.editor.setReadOnly(false);
    this.update({
      status: 'disconnected',
      presence: [],
      syncLag: 0,
      conflict: null,
    });
  }
  recoveryCopy(): CollaborationRecoveryCopy {
    return {
      format: 'scenario-collaboration-recovery-v1',
      studioId: this.studioId,
      scenarioId: this.scenarioId,
      baseVersionId: this.baseVersionId,
      operations: [...this.pending.values()].map((item) =>
        structuredClone(item),
      ),
      createdAt: new Date().toISOString(),
    };
  }
  private async onLocalDocument(document: JSONContent) {
    if (this.applyingRemote || this.state.status === 'read_only') return;
    const mutations = diffScenarioBlocks(this.previousDocument, document);
    this.previousDocument = structuredClone(document);
    for (const mutation of mutations) {
      const unsigned = {
        studioId: this.studioId,
        scenarioId: this.scenarioId,
        baseVersionId: this.baseVersionId,
        operationId: crypto.randomUUID(),
        clientSequence: ++this.clientSequence,
        logicalClock: ++this.logicalClock,
        mutation,
      };
      const operation = { ...unsigned, checksum: await checksum(unsigned) };
      this.pending.set(operation.operationId, operation);
    }
    await this.flush();
  }
  private async flush() {
    if (
      !this.connectionId ||
      !['online', 'conflict'].includes(this.state.status)
    )
      return;
    for (const operation of this.pending.values()) {
      try {
        const response = await this.api.submitCollaborationOperation(
          this.studioId,
          this.connectionId,
          operation,
        );
        this.cursor = Math.max(this.cursor, response.nextCursor);
        if (response.status === 'conflict' && response.conflict)
          this.update({ status: 'conflict', conflict: response.conflict });
        this.pending.delete(operation.operationId);
      } catch {
        this.update({ status: 'offline' });
        this.scheduleReconnect();
        return;
      }
    }
  }
  private async poll() {
    if (!this.connectionId || this.disposed) return;
    try {
      const response = await this.api.pollCollaboration(
        this.studioId,
        this.connectionId,
        this.cursor,
      );
      for (const event of [...response.events].sort(
        (a, b) => a.cursor - b.cursor,
      )) {
        if (event.cursor <= this.cursor) continue;
        this.cursor = event.cursor;
        if (event.type === 'presence.changed')
          this.update({ presence: event.presence });
        if (event.type === 'operation.conflict')
          this.update({ status: 'conflict', conflict: event.conflict });
        if (
          event.type === 'operation.applied' &&
          !this.received.has(event.operation.operationId)
        ) {
          this.received.add(event.operation.operationId);
          this.logicalClock =
            Math.max(this.logicalClock, event.operation.logicalClock) + 1;
          if (
            event.operation.actorId !== this.actorId &&
            !this.pending.has(event.operation.operationId)
          ) {
            this.applyingRemote = true;
            try {
              this.editor.applyRemote(event.operation.mutation);
              this.previousDocument = structuredClone(this.editor.read());
            } finally {
              this.applyingRemote = false;
            }
          }
        }
        if (
          event.type === 'connection.closed' &&
          event.profileId === this.actorId &&
          event.reason === 'revoked'
        ) {
          this.connectionId = null;
          this.editor.setReadOnly(true);
          this.update({ status: 'read_only' });
          return;
        }
      }
      this.update({ syncLag: response.syncLag });
      if (this.state.status === 'offline' || this.state.status === 'reconnecting')
        this.update({
          status: this.state.conflict
            ? 'conflict'
            : this.readOnly
              ? 'read_only'
              : 'online',
        });
      this.schedulePoll(response.hasMore ? 0 : IDLE_POLL_DELAY_MS);
    } catch (error) {
      this.handleConnectionFailure(error);
    }
  }
  private schedulePoll(delay: number) {
    if (!this.disposed)
      this.pollTimer = setTimeout(() => void this.poll(), delay);
  }
  private scheduleHeartbeat(delay: number) {
    if (!this.disposed)
      this.heartbeatTimer = setTimeout(() => void this.heartbeat(delay), delay);
  }
  private async heartbeat(delay: number) {
    if (!this.connectionId || this.disposed) return;
    try {
      const response = await this.api.heartbeatCollaboration(
        this.studioId,
        this.connectionId,
      );
      this.update({
        presence: response.presence,
        status: this.state.conflict
          ? 'conflict'
          : this.readOnly
            ? 'read_only'
            : 'online',
      });
      this.scheduleHeartbeat(delay);
    } catch (error) {
      this.handleConnectionFailure(error);
    }
  }
  private scheduleReconnect() {
    if (this.disposed || this.state.status === 'read_only') return;
    this.clearTimers();
    const delay = Math.min(
      30_000,
      500 * 2 ** Math.min(this.reconnectAttempts++, 6),
    );
    this.pollTimer = setTimeout(
      () => void this.resume().catch(() => undefined),
      delay,
    );
  }
  private async resume() {
    if (this.disposed) return;
    this.update({ status: 'reconnecting' });
    if (!this.connectionId) {
      await this.connect();
      return;
    }
    try {
      const response = await this.api.heartbeatCollaboration(
        this.studioId,
        this.connectionId,
      );
      this.reconnectAttempts = 0;
      this.update({
        presence: response.presence,
        status: this.state.conflict
          ? 'conflict'
          : this.readOnly
            ? 'read_only'
            : 'online',
      });
      this.schedulePoll(IDLE_POLL_DELAY_MS);
      this.scheduleHeartbeat(this.heartbeatDelayMs);
      await this.flush();
    } catch (error) {
      this.handleConnectionFailure(error);
    }
  }
  private handleConnectionFailure(error: unknown) {
    const code = (error as { code?: string }).code;
    if (['studio_not_found', 'studio_write_forbidden'].includes(code ?? '')) {
      this.connectionId = null;
      this.readOnly = true;
      this.editor.setReadOnly(true);
      this.update({ status: 'read_only' });
      return;
    }
    if (code === 'collaboration_connection_closed') this.connectionId = null;
    this.update({ status: 'offline' });
    this.scheduleReconnect();
  }
  private clearTimers() {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.pollTimer = null;
    this.heartbeatTimer = null;
  }
  private update(patch: Partial<CollaborationViewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.snapshot());
  }
  private snapshot() {
    return {
      ...this.state,
      presence: structuredClone(this.state.presence),
      conflict: this.state.conflict
        ? structuredClone(this.state.conflict)
        : null,
    };
  }
}

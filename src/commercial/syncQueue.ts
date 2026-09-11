import type { AuthenticatedCommercialApi, CommercialHttpError } from "./authenticatedApi";
import type { CloudConflict, SyncQueueState } from "./contractsV6";

export const SYNC_QUEUE_STORAGE_KEY = "scenario-cloud-sync-queue-v1";
export interface SyncQueueEntry {
  id: string;
  scenarioId: string;
  localPath: string;
  title: string;
  parentVersionId: string | null;
  state: SyncQueueState;
  attempts: number;
  nextAttemptAt: number;
  checksum: string | null;
  remoteVersionId: string | null;
  conflict: CloudConflict | null;
  lastErrorCode: string | null;
}
interface QueueDocument {
  schemaVersion: 1;
  paused: boolean;
  ownerAccountId: string | null;
  entries: SyncQueueEntry[];
}
export interface SyncQueueStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

function empty(): QueueDocument {
  return { schemaVersion: 1, paused: false, ownerAccountId: null, entries: [] };
}
function parse(raw: string | null): QueueDocument {
  if (!raw) return empty();
  try {
    const value = JSON.parse(raw) as QueueDocument;
    if (
      value.schemaVersion !== 1 ||
      typeof value.paused !== "boolean" ||
      !Array.isArray(value.entries)
    )
      return empty();
    return {
      ...value,
      ownerAccountId: typeof value.ownerAccountId === "string" ? value.ownerAccountId : null,
    };
  } catch {
    return empty();
  }
}
async function sha256(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const bytes = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
  const result = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class CloudSyncQueue {
  private running: Promise<void> | null = null;
  private retryTimer: number | null = null;
  constructor(
    private readonly storage: SyncQueueStorage,
    private readonly api: () => AuthenticatedCommercialApi,
    private readonly readLocalFile: (path: string) => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<SyncQueueEntry[]> {
    return structuredClone(parse(await this.storage.read()).entries);
  }

  async bindAccount(accountId: string): Promise<void> {
    const queue = parse(await this.storage.read());
    if (queue.ownerAccountId && queue.ownerAccountId !== accountId) queue.entries = [];
    queue.ownerAccountId = accountId;
    queue.paused = false;
    for (const entry of queue.entries) if (entry.state === "pending") entry.nextAttemptAt = 0;
    await this.save(queue);
  }

  async enqueue(localPath: string, title: string, scenarioId?: string): Promise<SyncQueueEntry> {
    const queue = parse(await this.storage.read());
    const previous = queue.entries.find((entry) => entry.localPath === localPath);
    const entry: SyncQueueEntry = previous ?? {
      id: crypto.randomUUID(),
      scenarioId: scenarioId ?? crypto.randomUUID(),
      localPath,
      title,
      parentVersionId: null,
      state: "local",
      attempts: 0,
      nextAttemptAt: 0,
      checksum: null,
      remoteVersionId: null,
      conflict: null,
      lastErrorCode: null,
    };
    entry.title = title;
    entry.state = "pending";
    entry.nextAttemptAt = 0;
    entry.lastErrorCode = null;
    entry.conflict = null;
    if (!previous) queue.entries.push(entry);
    queue.paused = false;
    await this.save(queue);
    return structuredClone(entry);
  }

  async process(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.processOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async pauseAndForgetAccount(): Promise<void> {
    // The .scenario files are untouched. Queue paths, remote ids and account-derived state are removed.
    if (this.retryTimer !== null && typeof window !== "undefined")
      window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    await this.storage.clear();
  }

  async keepLocal(entryId: string): Promise<void> {
    await this.change(entryId, (entry) => {
      if (!entry.conflict) return;
      entry.parentVersionId = entry.conflict.remoteVersionId;
      entry.state = "pending";
      entry.conflict = null;
      entry.nextAttemptAt = 0;
    });
  }

  async createCopy(entryId: string): Promise<void> {
    await this.change(entryId, (entry) => {
      entry.scenarioId = crypto.randomUUID();
      entry.parentVersionId = null;
      entry.remoteVersionId = null;
      entry.state = "pending";
      entry.conflict = null;
      entry.nextAttemptAt = 0;
    });
  }

  async downloadRemote(entryId: string) {
    const entry = (await this.list()).find((candidate) => candidate.id === entryId);
    const remote = entry?.conflict?.remoteVersionId;
    if (!entry || !remote) throw new Error("Conflit distant indisponible.");
    return this.api().getCloudDownload(entry.scenarioId, remote);
  }

  private async processOnce(): Promise<void> {
    const queue = parse(await this.storage.read());
    if (queue.paused) return;
    for (const entry of queue.entries) {
      if (entry.state !== "pending" || entry.nextAttemptAt > this.now()) continue;
      try {
        const content = await this.readLocalFile(entry.localPath);
        const encoded = new TextEncoder().encode(content);
        const checksum = await sha256(content);
        const key = await sha256(
          `${entry.scenarioId}:${entry.parentVersionId ?? "root"}:${checksum}`,
        );
        const response = await this.api().syncCloudScenario(
          {
            scenarioId: entry.scenarioId,
            title: entry.title,
            parentVersionId: entry.parentVersionId,
            checksum,
            sizeBytes: encoded.byteLength,
            contentType: "application/vnd.scenario+json",
            format: "scenario-v1",
            // Origin is immutable across retries so the same idempotency key always
            // has the same request fingerprint, including uncertain responses.
            origin: "save",
            content,
          },
          key,
        );
        entry.parentVersionId = response.version.id;
        entry.remoteVersionId = response.version.id;
        entry.checksum = checksum;
        entry.state = "synced";
        entry.attempts = 0;
        entry.lastErrorCode = null;
      } catch (error) {
        const http = error as CommercialHttpError;
        const conflict = http.details?.conflict as CloudConflict | undefined;
        if (http.status === 409 && conflict?.code === "scenario_parent_conflict") {
          entry.state = "conflict";
          entry.conflict = conflict;
        } else {
          entry.attempts += 1;
          entry.lastErrorCode = typeof http.code === "string" ? http.code : "sync_unavailable";
          const retryable = !http.status || http.status >= 500 || http.status === 429;
          entry.state = retryable && entry.attempts < 5 ? "pending" : "failed";
          entry.nextAttemptAt = retryable
            ? this.now() + Math.min(60_000, 1_000 * 2 ** (entry.attempts - 1))
            : 0;
        }
      }
      await this.save(queue);
    }
    this.scheduleRetry(queue.entries);
  }

  private async change(id: string, mutate: (entry: SyncQueueEntry) => void): Promise<void> {
    const queue = parse(await this.storage.read());
    const entry = queue.entries.find((candidate) => candidate.id === id);
    if (entry) mutate(entry);
    await this.save(queue);
  }
  private save(queue: QueueDocument) {
    return this.storage.write(JSON.stringify(queue));
  }

  private scheduleRetry(entries: SyncQueueEntry[]): void {
    if (typeof window === "undefined") return;
    const next = entries
      .filter((entry) => entry.state === "pending")
      .map((entry) => entry.nextAttemptAt)
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(
      () => {
        this.retryTimer = null;
        void this.process();
      },
      Math.max(0, Math.min(60_000, next - this.now())),
    );
  }
}

export function createBrowserSyncQueueStorage(): SyncQueueStorage {
  return {
    read: async () => window.localStorage.getItem(SYNC_QUEUE_STORAGE_KEY),
    write: async (value) => window.localStorage.setItem(SYNC_QUEUE_STORAGE_KEY, value),
    clear: async () => window.localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY),
  };
}

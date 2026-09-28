import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import { CommercialHttpError } from "./authenticatedApi";
import { CloudSyncQueue, type SyncQueueStorage } from "./syncQueue";
import { createEmptyCoverPage } from '../document/scenarioFile';
import { technicalImageAssetFromBytes, technicalImageReference } from '../editor/technicalImageAssets';

function memoryStorage(): SyncQueueStorage & { value: string | null } {
  return {
    value: null,
    read: async function () {
      return this.value;
    },
    write: async function (value) {
      this.value = value;
    },
    clear: async function () {
      this.value = null;
    },
  };
}

function response(input: Parameters<AuthenticatedCommercialApi["syncCloudScenario"]>[0]) {
  const id = crypto.randomUUID();
  return {
    contractVersion: "2026-09-v6" as const,
    scenario: {
      id: input.scenarioId,
      title: input.title,
      role: "owner" as const,
      currentVersionId: id,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    version: {
      id,
      scenarioId: input.scenarioId,
      authorId: crypto.randomUUID(),
      parentVersionId: input.parentVersionId,
      versionNumber: 1,
      checksum: input.checksum,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      format: input.format,
      origin: input.origin,
      entitlementSnapshotId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    },
    replayed: false,
    download: {
      url: "https://storage.invalid/opaque",
      operation: "download" as const,
      expiresAt: new Date().toISOString(),
    },
    request_id: crypto.randomUUID(),
  };
}

describe("file de synchronisation v6", () => {
  it('envoie les images séparément et ne les duplique jamais dans la version cloud', async () => {
    const asset = await technicalImageAssetFromBytes(new Uint8Array([9, 8, 7]), 'image/webp', 320, 180);
    const reference = technicalImageReference(asset.id);
    const content = JSON.stringify({
      formatVersion: 1, title: 'Film image',
      content: { type: 'doc', content: [{ type: 'paragraph', attrs: {
        scenarioType: 'SCENE_HEADING',
        technicalBreakdownData: JSON.stringify({ version: 1, shots: [{ values: { image: reference, duplicate: reference } }] }),
      } }] },
      characters: [], locations: [], times: [], coverPage: createEmptyCoverPage(), coverPageHidden: false,
      comments: [], savedAt: new Date().toISOString(), technicalImageAssets: { [asset.id]: asset },
    });
    const storage = memoryStorage();
    const syncCloudScenario = vi.fn(async input => response(input));
    const ensureCloudImageAsset = vi.fn(async () => asset);
    const queue = new CloudSyncQueue(storage, () => ({
      syncCloudScenario,
      ensureCloudImageAsset,
    }) as unknown as AuthenticatedCommercialApi, async () => content);
    await queue.enqueue('film-image.scenario', 'Film image');
    await queue.process();
    expect(ensureCloudImageAsset).toHaveBeenCalledOnce();
    expect(syncCloudScenario.mock.calls[0][0].content).toContain(reference);
    expect(syncCloudScenario.mock.calls[0][0].content).not.toContain(asset.dataUrl);
  });

  it("persiste les états sans contenu ni jeton et déduplique le traitement concurrent", async () => {
    const storage = memoryStorage();
    const syncCloudScenario = vi.fn(async (input) => response(input));
    const api = { syncCloudScenario } as unknown as AuthenticatedCommercialApi;
    const content = JSON.stringify({
      formatVersion: 1,
      content: { type: "doc" },
      privateText: "NE_PAS_STOCKER",
    });
    const queue = new CloudSyncQueue(
      storage,
      () => api,
      async () => content,
    );
    await queue.enqueue("C:\\private\\film.scenario", "Film");
    expect(storage.value).not.toContain("NE_PAS_STOCKER");
    await Promise.all([queue.process(), queue.process(), queue.process()]);
    expect(syncCloudScenario).toHaveBeenCalledTimes(1);
    expect((await queue.list())[0].state).toBe("synced");
    expect(storage.value).not.toContain("https://storage.invalid");
  });

  it("reprend après panne avec backoff borné et conserve la clé liée au contenu", async () => {
    let now = 1_000;
    const storage = memoryStorage();
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new CommercialHttpError(503, "cloud_unavailable"))
      .mockImplementation(async (input) => response(input));
    const queue = new CloudSyncQueue(
      storage,
      () => ({ syncCloudScenario: sync }) as unknown as AuthenticatedCommercialApi,
      async () => JSON.stringify({ formatVersion: 1, content: { type: "doc" } }),
      () => now,
    );
    await queue.enqueue("film.scenario", "Film");
    await queue.process();
    expect((await queue.list())[0]).toMatchObject({
      state: "pending",
      attempts: 1,
      nextAttemptAt: 2_000,
    });
    now = 2_000;
    await queue.process();
    expect((await queue.list())[0]).toMatchObject({ state: "synced", attempts: 0 });
    expect(sync.mock.calls[0][1]).toBe(sync.mock.calls[1][1]);
  });

  it("expose les résolutions keep-local/copie et oublie les données de compte au logout", async () => {
    const storage = memoryStorage();
    const remote = crypto.randomUUID();
    const conflict = {
      code: "scenario_parent_conflict",
      scenarioId: crypto.randomUUID(),
      localParentVersionId: null,
      remoteVersionId: remote,
      options: ["keep_local", "download_remote", "create_copy"],
    };
    const api = {
      syncCloudScenario: vi.fn(async () => {
        throw new CommercialHttpError(409, "scenario_parent_conflict", "Conflit", "request", {
          conflict,
        });
      }),
    } as unknown as AuthenticatedCommercialApi;
    const queue = new CloudSyncQueue(
      storage,
      () => api,
      async () => JSON.stringify({ formatVersion: 1 }),
    );
    const entry = await queue.enqueue("film.scenario", "Film", conflict.scenarioId);
    await queue.process();
    expect((await queue.list())[0].state).toBe("conflict");
    await queue.keepLocal(entry.id);
    expect((await queue.list())[0]).toMatchObject({ state: "pending", parentVersionId: remote });
    await queue.createCopy(entry.id);
    expect((await queue.list())[0]).toMatchObject({ state: "pending", parentVersionId: null });
    await queue.pauseAndForgetAccount();
    expect(await queue.list()).toEqual([]);
  });

  it("ne réécrit jamais une ancienne file après logout ou changement de compte", async () => {
    const storage = memoryStorage();
    let finish!: (value: ReturnType<typeof response>) => void;
    const syncCloudScenario = vi.fn((_input: Parameters<AuthenticatedCommercialApi['syncCloudScenario']>[0]) =>
      new Promise<ReturnType<typeof response>>(resolve => {
        finish = resolve;
      }),
    );
    const queue = new CloudSyncQueue(
      storage,
      () => ({ syncCloudScenario }) as unknown as AuthenticatedCommercialApi,
      async () => JSON.stringify({ formatVersion: 1, content: { type: 'doc' } }),
    );
    await queue.bindAccount('account-a');
    await queue.enqueue('a.scenario', 'A');
    const processing = queue.process();
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await queue.pauseAndForgetAccount();
    await queue.bindAccount('account-b');
    finish(response(syncCloudScenario.mock.calls[0][0]));
    await processing;

    expect(await queue.list()).toEqual([]);
    expect(JSON.parse(storage.value ?? '{}').ownerAccountId).toBe('account-b');
  });
});

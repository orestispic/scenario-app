import { describe, expect, it, vi } from 'vitest';
import type { ScenarioFile } from '../document/scenarioFile';
import { technicalImageAssetFromBytes, technicalImageReference } from '../editor/technicalImageAssets';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import { cloudScenarioFile, downloadCloudImageAsset, hydrateCloudImageAssets, uploadCloudImageAssets } from './cloudImageAssets';

async function fixture() {
  const bytes = new Uint8Array([7, 8, 9, 10]);
  const asset = await technicalImageAssetFromBytes(bytes, 'image/webp', 320, 180);
  const reference = technicalImageReference(asset.id);
  const file: ScenarioFile = {
    formatVersion: 1,
    title: 'Images',
    content: { type: 'doc', content: [{ type: 'paragraph', attrs: {
      scenarioType: 'SCENE_HEADING', blockId: 'scene',
      technicalBreakdownData: JSON.stringify({ version: 1, shots: [{ values: { image: reference, duplicate: reference } }] }),
    } }] },
    characters: [], locations: [], times: [], coverPage: {} as ScenarioFile['coverPage'],
    coverPageHidden: false, comments: [], savedAt: '', technicalImageAssets: { [asset.id]: asset },
  };
  return { bytes, asset, file };
}

describe('cloud technical image assets', () => {
  it('rejects oversized metadata before fetching and cancels oversized streamed bodies', async () => {
    const { asset } = await fixture();
    const remote = { ...asset, assetId: asset.id, download: { url: 'https://fixture.supabase.co/image', expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    const api = { getCloudImageAsset: vi.fn(async () => ({ ...remote, sizeBytes: 300 * 1024 + 1 })) } as unknown as AuthenticatedCommercialApi;
    const fetcher = vi.fn<typeof fetch>();
    await expect(downloadCloudImageAsset(api, 'scenario', asset.id, undefined, fetcher)).rejects.toThrow('invalide');
    expect(fetcher).not.toHaveBeenCalled();
    vi.mocked(api.getCloudImageAsset).mockResolvedValue(remote as never);
    const cancel = vi.fn();
    fetcher.mockResolvedValue(new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(5)); }, cancel,
    })));
    await expect(downloadCloudImageAsset(api, 'scenario', asset.id, undefined, fetcher)).rejects.toThrow('volumineuse');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects truncated bodies, corrupted hashes and invalid expiration dates', async () => {
    const { asset } = await fixture();
    const remote = { ...asset, assetId: asset.id, download: { url: 'https://fixture.supabase.co/image', expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    const api = { getCloudImageAsset: vi.fn(async () => remote) } as unknown as AuthenticatedCommercialApi;
    await expect(downloadCloudImageAsset(api, 'scenario', asset.id, undefined, async () => new Response(new Uint8Array(3)))).rejects.toThrow('incomplète');
    await expect(downloadCloudImageAsset(api, 'scenario', asset.id, undefined, async () => new Response(new Uint8Array(4)))).rejects.toThrow('Intégrité');
    remote.download.expiresAt = 'invalid';
    const fetcher = vi.fn<typeof fetch>();
    await expect(downloadCloudImageAsset(api, 'scenario', asset.id, undefined, fetcher)).rejects.toThrow('invalide');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('hydrates distinct images sequentially and keeps all references', async () => {
    const { asset, bytes, file } = await fixture();
    const secondBytes = new Uint8Array([1, 2, 3, 4]);
    const second = await technicalImageAssetFromBytes(secondBytes, 'image/png', 2, 2);
    file.content.content!.push({ type: 'paragraph', attrs: { image: technicalImageReference(second.id) } });
    let active = 0, peak = 0;
    const api = { getCloudImageAsset: vi.fn(async (_scenario: string, id: string) => {
      active++; peak = Math.max(peak, active);
      const selected = id === asset.id ? asset : second;
      return { ...selected, assetId: id, download: { url: `https://fixture.supabase.co/${id}`, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
    }) } as unknown as AuthenticatedCommercialApi;
    const result = await hydrateCloudImageAssets(api, 'scenario', cloudScenarioFile(file), undefined, async input => {
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
      return new Response(String(input).endsWith(asset.id) ? bytes : secondBytes);
    });
    expect(peak).toBe(1);
    expect(Object.keys(result.technicalImageAssets!)).toEqual([asset.id, second.id]);
  });
  it('strips payloads from every scenario version and uploads each referenced hash once', async () => {
    const { asset, file } = await fixture();
    expect(cloudScenarioFile(file).technicalImageAssets).toBeUndefined();
    const ensureCloudImageAsset = vi.fn(async (_scenarioId: string, _input: unknown, _key: string) => asset);
    await uploadCloudImageAssets({ ensureCloudImageAsset } as unknown as AuthenticatedCommercialApi, file, crypto.randomUUID());
    expect(ensureCloudImageAsset).toHaveBeenCalledOnce();
    expect(ensureCloudImageAsset.mock.calls[0][1]).toMatchObject({ assetId: asset.id, sizeBytes: asset.sizeBytes });
  });

  it('hydrates references after a cloud download and verifies their content hash', async () => {
    const { bytes, asset, file } = await fixture();
    const stripped = cloudScenarioFile(file);
    const api = {
      getCloudImageAsset: vi.fn(async () => ({
        assetId: asset.id,
        contentType: asset.contentType,
        sizeBytes: asset.sizeBytes,
        width: asset.width,
        height: asset.height,
        download: { url: 'https://fixture.supabase.co/storage/v1/object/sign/private/image?token=test', operation: 'download', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      })),
    } as unknown as AuthenticatedCommercialApi;
    const hydrated = await hydrateCloudImageAssets(api, crypto.randomUUID(), stripped, undefined,
      async () => new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
        status: 200,
        headers: { 'Content-Type': 'image/webp' },
      }));
    expect(hydrated.technicalImageAssets?.[asset.id]).toEqual(asset);
  });
});

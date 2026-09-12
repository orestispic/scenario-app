import { expect, it, vi } from 'vitest';
import { loadStudioBase, selectStudioRoot, normalizeStudioDownloadUrl } from './studioBase';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudScenarioVersion } from './contractsV6';

async function fixture(file: unknown = { formatVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph' }] } }) {
  const bytes = new TextEncoder().encode(JSON.stringify(file));
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const version = { id: 'root', scenarioId: 'scenario', parentVersionId: null, versionNumber: 1, sizeBytes: bytes.length, checksum } as CloudScenarioVersion;
  const grant = { url: 'https://example.invalid/private-test', operation: 'download', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const api = { getCloudDownload: vi.fn(async () => grant) } as unknown as AuthenticatedCommercialApi;
  const fetcher = vi.fn(async () => new Response(bytes));
  return { version, api, fetcher, grant, signal: new AbortController().signal };
}
it('uses a shared root rather than a changing snapshot or unrelated scenario', async () => {
  const { version } = await fixture();
  expect(selectStudioRoot([{ ...version, id: 'latest', parentVersionId: 'root', versionNumber: 2 }, version], 'scenario')).toEqual(version);
  expect(() => selectStudioRoot([version], 'other')).toThrow();
});
it('verifies bytes and assigns deterministic IDs without credentials on the object request', async () => {
  const f = await fixture();
  const a = await loadStudioBase(f.api, f.version, f.signal, f.fetcher);
  const b = await loadStudioBase(f.api, f.version, f.signal, f.fetcher);
  expect(a).toEqual(b);
  expect(a.content?.[0].attrs?.blockId).toBe('studio-base-root-0');
  expect(f.fetcher).toHaveBeenCalledWith(f.grant.url, expect.objectContaining({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }));
});
it('rejects corrupt or truncated content before it reaches the editor', async () => {
  const f = await fixture();
  await expect(loadStudioBase(f.api, { ...f.version, checksum: '0'.repeat(64) }, f.signal, f.fetcher)).rejects.toMatchObject({ code: 'collaboration_base_invalid' });
  await expect(loadStudioBase(f.api, { ...f.version, sizeBytes: 2 }, f.signal, f.fetcher)).rejects.toMatchObject({ code: 'collaboration_base_invalid' });
});
it('supports isolated legacy blocks fixtures but rejects duplicate IDs', async () => {
  const f = await fixture({ formatVersion: 1, blocks: [] });
  expect(await loadStudioBase(f.api, f.version, f.signal, f.fetcher)).toEqual({ type: 'doc', content: [] });
  const bad = await fixture({ formatVersion: 1, blocks: [{ type: 'paragraph', attrs: { blockId: 'a' } }, { type: 'paragraph', attrs: { blockId: 'a' } }] });
  await expect(loadStudioBase(bad.api, bad.version, bad.signal, bad.fetcher)).rejects.toMatchObject({ code: 'collaboration_base_invalid' });
});
it('honours cancellation and does not fetch expired temporary URLs', async () => {
  const f = await fixture();
  await expect(loadStudioBase(f.api, f.version, AbortSignal.abort(), f.fetcher)).rejects.toThrow();
  expect(f.fetcher).not.toHaveBeenCalled();
  f.grant.expiresAt = 'invalid';
  await expect(loadStudioBase(f.api, f.version, f.signal, f.fetcher)).rejects.toMatchObject({ code: 'collaboration_base_invalid' });
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('supports the legacy Supabase signed path without changing origin, object or token', () => {
  const legacy = normalizeStudioDownloadUrl('https://testproject.supabase.co/object/sign/private/file?token=synthetic');
  expect(legacy.href).toBe('https://testproject.supabase.co/storage/v1/object/sign/private/file?token=synthetic');
  expect(normalizeStudioDownloadUrl(legacy.href).href).toBe(legacy.href);
  const other = 'https://example.invalid/object/sign/private/file?token=synthetic';
  expect(normalizeStudioDownloadUrl(other).href).toBe(other);
});

import type { JSONContent } from '@tiptap/core';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudScenarioVersion } from './contractsV6';
import { parseScenarioFile, type ScenarioFile } from '../document/scenarioFile';

const MAX_BASE_BYTES = 4 * 1024 * 1024; // Transport safety, not a commercial quota.
const invalid = (message: string) => Object.assign(new Error(message), { code: 'collaboration_base_invalid', status: 409 });

// Compatibility with the previously deployed v6 adapter, which omitted the
// Storage API prefix. Keep the same origin, signed object path and token.
// The downloaded bytes must still match the authenticated version's SHA-256.
export function normalizeStudioDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/.test(url.hostname) && url.pathname.startsWith('/object/sign/'))
    url.pathname = `/storage/v1${url.pathname}`;
  return url;
}

export function selectStudioRoot(versions: CloudScenarioVersion[], scenarioId: string) {
  const root = versions.find((item) => item.scenarioId === scenarioId && item.parentVersionId === null);
  if (!root) throw invalid('Base commune indisponible : récupération du scénario nécessaire.');
  return root;
}

export async function loadStudioBase(
  api: AuthenticatedCommercialApi, version: CloudScenarioVersion,
  signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<JSONContent> {
  return (await loadCloudProjectFile(api, version, signal, fetcher)).content;
}

export async function loadCloudProjectFile(
  api: AuthenticatedCommercialApi, version: CloudScenarioVersion,
  signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<ScenarioFile> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(8_000)]);
  if (version.sizeBytes < 2 || version.sizeBytes > MAX_BASE_BYTES) throw invalid('Base Studio trop volumineuse.');
  const grant = await api.getCloudDownload(version.scenarioId, version.id, signal);
  signal.throwIfAborted();
  const url = normalizeStudioDownloadUrl(grant.url);
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || grant.operation !== 'download' || !Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= Date.now())
    throw invalid('Accès temporaire Studio invalide.');
  const response = await fetcher(url.toString(), {
    credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    signal,
  });
  if (!response.ok || !response.body) throw Object.assign(new Error('Téléchargement de la base Studio impossible.'), { code: 'collaboration_base_download_failed', status: response.status >= 400 ? response.status : 502 });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > version.sizeBytes || total > MAX_BASE_BYTES) throw invalid('Taille de base Studio invalide.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  if (total !== version.sizeBytes) throw invalid('Base Studio incomplète.');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== version.checksum) throw invalid('Intégrité de la base Studio invalide.');
  let file;
  try { file = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw invalid('Format de base Studio invalide.'); }
  if (file?.formatVersion !== 1) throw invalid('Format de base Studio invalide.');
  // Legacy synthetic v6 fixtures used `blocks`; real .scenario files use content.
  const document: JSONContent = file.content?.type === 'doc' ? file.content : { type: 'doc', content: file.blocks };
  if (!Array.isArray(document.content)) throw invalid('Document Studio invalide.');
  const ids = new Set<string>();
  document.content.forEach((block, index) => {
    if (!block || typeof block.type !== 'string') throw invalid('Bloc Studio invalide.');
    const id = block.attrs?.blockId || `studio-base-${version.id}-${index}`;
    if (typeof id !== 'string' || ids.has(id)) throw invalid('Identité de bloc Studio invalide.');
    ids.add(id);
    block.attrs = { ...block.attrs, blockId: id };
  });
  signal.throwIfAborted();
  return parseScenarioFile(JSON.stringify({ ...file, content: document }));
}

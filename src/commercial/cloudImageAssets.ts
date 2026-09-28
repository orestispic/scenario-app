import type { ScenarioFile } from '../document/scenarioFile';
import { cacheNativeImage, portableImageUrl } from '../document/nativeImages';
import {
  collectTechnicalImageAssetIds,
  TECHNICAL_IMAGE_LEGACY_MAX_BYTES,
  technicalImageAssetBytes,
  technicalImageAssetFromBytes,
  type TechnicalImageAsset,
} from '../editor/technicalImageAssets';
import type { AuthenticatedCommercialApi } from './authenticatedApi';

export function cloudScenarioFile(file: ScenarioFile): ScenarioFile {
  const { technicalImageAssets: _assets, ...document } = file;
  return document;
}

export async function uploadCloudImageAssets(
  api: AuthenticatedCommercialApi,
  file: ScenarioFile,
  scenarioId: string,
): Promise<void> {
  const assets = file.technicalImageAssets ?? {};
  const ids = collectTechnicalImageAssetIds(file.content);
  for (const assetId of ids) {
    const asset = assets[assetId];
    if (!asset) throw new Error('Une image du découpage est absente de la copie locale. Aucune version incomplète n’a été envoyée.');
    const dataUrl = await portableImageUrl(asset.dataUrl);
    const separator = dataUrl.indexOf(',');
    if (separator < 0) throw new Error('Données d’image invalides.');
    await api.ensureCloudImageAsset(scenarioId, {
      assetId,
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      contentBase64: dataUrl.slice(separator + 1),
    }, `image-${scenarioId}-${assetId}`);
  }
}

function normalizeAssetDownloadUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol === 'https:' && /^[a-z0-9]+\.supabase\.co$/u.test(url.hostname)
    && url.pathname.startsWith('/object/sign/')) url.pathname = `/storage/v1${url.pathname}`;
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.hash) {
    throw new Error('Accès temporaire à l’image invalide.');
  }
  return url;
}

export async function downloadCloudImageAsset(
  api: AuthenticatedCommercialApi,
  scenarioId: string,
  assetId: string,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<TechnicalImageAsset> {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000);
  const remote = await api.getCloudImageAsset(scenarioId, assetId, requestSignal);
  if (remote.assetId !== assetId || !Number.isFinite(Date.parse(remote.download.expiresAt))
    || Date.parse(remote.download.expiresAt) <= Date.now()
    || !Number.isSafeInteger(remote.sizeBytes) || remote.sizeBytes < 1
    || remote.sizeBytes > TECHNICAL_IMAGE_LEGACY_MAX_BYTES) {
    throw new Error('Référence d’image cloud invalide.');
  }
  const response = await fetcher(normalizeAssetDownloadUrl(remote.download.url).toString(), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    signal: requestSignal,
  });
  if (!response.ok) throw new Error('Téléchargement de l’image impossible.');
  if (!response.body) throw new Error('Image cloud incomplète.');
  const reader = response.body.getReader();
  const bytes = new Uint8Array(remote.sizeBytes);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) throw new Error('Image cloud trop volumineuse.');
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (offset !== remote.sizeBytes) throw new Error('Image cloud incomplète.');
  if (Date.parse(remote.download.expiresAt) <= Date.now()) throw new Error('Accès temporaire à l’image expiré.');
  const asset = await technicalImageAssetFromBytes(
    bytes,
    remote.contentType,
    remote.width,
    remote.height,
    TECHNICAL_IMAGE_LEGACY_MAX_BYTES,
  );
  if (asset.id !== assetId) throw new Error('Intégrité de l’image cloud invalide.');
  return asset;
}

export async function hydrateCloudImageAssets(
  api: AuthenticatedCommercialApi,
  scenarioId: string,
  file: ScenarioFile,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ScenarioFile> {
  const ids = collectTechnicalImageAssetIds(file.content);
  if (!ids.length) return file;
  // Bound both simultaneous transfers and retained base64 payloads. Leave room
  // for the recovery wrapper and serialization under the native 32 MiB ceiling.
  let retainedBytes = new TextEncoder().encode(JSON.stringify(cloudScenarioFile(file))).byteLength;
  const loaded: TechnicalImageAsset[] = [];
  for (const assetId of ids) {
    if (retainedBytes > 30 * 1024 * 1024) throw new Error('Cette version dépasse 30 Mio. Utilisez la récupération Cloud pour conserver ses données.');
    const downloaded = await downloadCloudImageAsset(api, scenarioId, assetId, signal, fetcher);
    const asset = { ...downloaded, dataUrl: await cacheNativeImage(downloaded.dataUrl) };
    retainedBytes += new TextEncoder().encode(JSON.stringify(asset)).byteLength + assetId.length + 4;
    if (retainedBytes > 30 * 1024 * 1024) throw new Error('Cette version dépasse 30 Mio. Utilisez la récupération Cloud pour conserver ses données.');
    loaded.push(asset);
  }
  return {
    ...file,
    technicalImageAssets: Object.fromEntries(loaded.map(asset => [asset.id, asset])),
  };
}

export async function validateTechnicalImageAssetPayload(asset: TechnicalImageAsset): Promise<boolean> {
  return (await technicalImageAssetBytes(asset)).byteLength === asset.sizeBytes;
}

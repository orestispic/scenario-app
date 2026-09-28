import type { TemporaryObjectGrant } from './contractsV6';
import { TECHNICAL_IMAGE_LEGACY_MAX_BYTES, TECHNICAL_IMAGE_MAX_BYTES } from '../editor/technicalImageAssets';

export interface CloudImageAssetUpload {
  assetId: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  contentBase64: string;
}

export interface CloudImageAssetView {
  assetId: string;
  contentType: CloudImageAssetUpload['contentType'];
  sizeBytes: number;
  width: number;
  height: number;
}

export interface CloudImageAssetDownload extends CloudImageAssetView {
  download: TemporaryObjectGrant;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asset(value: unknown, maximumBytes: number): value is CloudImageAssetView {
  return record(value)
    && typeof value.assetId === 'string' && /^[0-9a-f]{64}$/u.test(value.assetId)
    && ['image/jpeg', 'image/png', 'image/webp'].includes(String(value.contentType))
    && Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) > 0 && Number(value.sizeBytes) <= maximumBytes
    && Number.isSafeInteger(value.width) && Number(value.width) > 0
    && Number.isSafeInteger(value.height) && Number(value.height) > 0;
}

export function parseCloudImageAssetView(value: unknown): CloudImageAssetView {
  if (!record(value) || value.contractVersion !== '2026-10-v19' || !asset(value.asset, TECHNICAL_IMAGE_MAX_BYTES)) {
    throw new Error('Réponse de stockage d’image invalide.');
  }
  return value.asset;
}

export function parseCloudImageAssetDownload(value: unknown): CloudImageAssetDownload {
  if (!record(value) || value.contractVersion !== '2026-10-v19' || !asset(value.asset, TECHNICAL_IMAGE_LEGACY_MAX_BYTES)
    || !record(value.download) || typeof value.download.url !== 'string'
    || value.download.operation !== 'download' || typeof value.download.expiresAt !== 'string') {
    throw new Error('Téléchargement d’image invalide.');
  }
  return {
    ...(value.asset as unknown as CloudImageAssetView),
    download: {
      url: value.download.url as string,
      operation: 'download',
      expiresAt: value.download.expiresAt as string,
    },
  };
}

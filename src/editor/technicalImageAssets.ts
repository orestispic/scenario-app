import { cacheNativeImage, isNativeImageUrl, portableImageUrl } from '../document/nativeImages';
export const TECHNICAL_IMAGE_MAX_BYTES = 70 * 1024;
export const TECHNICAL_IMAGE_LEGACY_MAX_BYTES = 300 * 1024;
export const TECHNICAL_IMAGE_REFERENCE_PREFIX = 'senario-image:';

const ASSET_ID = /^[0-9a-f]{64}$/u;
const ASSET_REFERENCE_IN_TEXT = /senario-image:([0-9a-f]{64})/gu;
const SUPPORTED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LEGACY_RASTER_CONTENT_TYPES = new Set([
  ...SUPPORTED_CONTENT_TYPES,
  'image/avif',
  'image/bmp',
  'image/gif',
]);

export interface TechnicalImageAsset {
  id: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  dataUrl: string;
}

export type TechnicalImageAssets = Record<string, TechnicalImageAsset>;

export interface TechnicalImageRaster {
  width: number;
  height: number;
  encode(width: number, height: number, quality: number): Promise<Blob>;
  close(): void;
}

export type TechnicalImageDecoder = (source: Blob) => Promise<TechnicalImageRaster>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function sha256ImageAssetId(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function technicalImageReference(assetId: string): string {
  if (!ASSET_ID.test(assetId)) throw new Error('Identifiant d’image invalide.');
  return `${TECHNICAL_IMAGE_REFERENCE_PREFIX}${assetId}`;
}

export function technicalImageAssetId(value: string): string | null {
  if (!value.startsWith(TECHNICAL_IMAGE_REFERENCE_PREFIX)) return null;
  const id = value.slice(TECHNICAL_IMAGE_REFERENCE_PREFIX.length);
  return ASSET_ID.test(id) ? id : null;
}

export function resolveTechnicalImageSource(value: string, assets: TechnicalImageAssets): string {
  const id = technicalImageAssetId(value);
  if (id) return assets[id]?.dataUrl ?? '';
  return /^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,/iu.test(value) ? value : '';
}

export function technicalImageDataUrlBlob(value: string): Blob | null {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\r\n]+)$/iu.exec(value);
  if (!match || !LEGACY_RASTER_CONTENT_TYPES.has(match[1].toLocaleLowerCase())) return null;
  try {
    return new Blob([base64ToBytes(match[2].replace(/[\r\n]/gu, ''))], {
      type: match[1].toLocaleLowerCase(),
    });
  } catch {
    return null;
  }
}

export function collectTechnicalImageAssetIds(value: unknown): string[] {
  const ids = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(ASSET_REFERENCE_IN_TEXT)) ids.add(match[1]);
      return;
    }
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object') Object.values(item as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return [...ids];
}

export function normalizeTechnicalImageAssets(value: unknown): TechnicalImageAssets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const assets: TechnicalImageAssets = {};
  for (const [id, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!ASSET_ID.test(id) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const asset = candidate as Record<string, unknown>;
    const contentType = String(asset.contentType ?? '');
    const sizeBytes = Number(asset.sizeBytes);
    const width = Number(asset.width);
    const height = Number(asset.height);
    const dataUrl = String(asset.dataUrl ?? '');
    if (!SUPPORTED_CONTENT_TYPES.has(contentType) || !Number.isSafeInteger(sizeBytes)
      || sizeBytes < 1 || sizeBytes > TECHNICAL_IMAGE_LEGACY_MAX_BYTES
      || !Number.isSafeInteger(width) || width < 1 || width > 16_384
      || !Number.isSafeInteger(height) || height < 1 || height > 16_384
      || (!dataUrl.startsWith(`data:${contentType};base64,`) && !isNativeImageUrl(dataUrl))
      || dataUrl.length > Math.ceil(TECHNICAL_IMAGE_LEGACY_MAX_BYTES * 4 / 3) + 128) continue;
    assets[id] = { id, contentType: contentType as TechnicalImageAsset['contentType'], sizeBytes, width, height, dataUrl };
  }
  return assets;
}

async function browserImageDecoder(source: Blob): Promise<TechnicalImageRaster> {
  const bitmap = await createImageBitmap(source);
  return {
    width: bitmap.width,
    height: bitmap.height,
    encode: (width, height, quality) => new Promise<Blob>((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) { reject(new Error('Compression d’image indisponible.')); return; }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression WebP indisponible.')), 'image/webp', quality);
    }),
    close: () => bitmap.close(),
  };
}

export async function technicalImageAssetFromBytes(
  bytes: Uint8Array,
  contentType: TechnicalImageAsset['contentType'],
  width: number,
  height: number,
  maximumBytes = TECHNICAL_IMAGE_MAX_BYTES,
): Promise<TechnicalImageAsset> {
  if (bytes.byteLength > maximumBytes) throw new Error('L’image optimisée dépasse encore 70 Ko.');
  const id = await sha256ImageAssetId(bytes);
  return {
    id,
    contentType,
    sizeBytes: bytes.byteLength,
    width,
    height,
    dataUrl: await cacheNativeImage(`data:${contentType};base64,${bytesToBase64(bytes)}`),
  };
}

/** Keeps the largest useful raster, then finds the highest WebP quality that fits 70 KiB. */
export async function optimizeTechnicalImage(
  source: Blob,
  decode: TechnicalImageDecoder = browserImageDecoder,
): Promise<TechnicalImageAsset> {
  if (!source.type.startsWith('image/')) throw new Error('Choisissez un fichier image.');
  const raster = await decode(source);
  try {
    if (raster.width < 1 || raster.height < 1) throw new Error('Cette image est illisible.');
    if (source.size <= TECHNICAL_IMAGE_MAX_BYTES && SUPPORTED_CONTENT_TYPES.has(source.type)) {
      return technicalImageAssetFromBytes(
        new Uint8Array(await source.arrayBuffer()),
        source.type as TechnicalImageAsset['contentType'],
        raster.width,
        raster.height,
      );
    }

    const initialScale = Math.min(1, 1920 / Math.max(raster.width, raster.height));
    let width = Math.max(1, Math.round(raster.width * initialScale));
    let height = Math.max(1, Math.round(raster.height * initialScale));
    let fallback: Blob | null = null;
    let fallbackWidth = width;
    let fallbackHeight = height;

    while (Math.max(width, height) >= 480) {
      let low = 0.58;
      let high = 0.9;
      let accepted: Blob | null = null;
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const quality = (low + high) / 2;
        const encoded = await raster.encode(width, height, quality);
        if (!fallback || encoded.size < fallback.size) {
          fallback = encoded;
          fallbackWidth = width;
          fallbackHeight = height;
        }
        if (encoded.size <= TECHNICAL_IMAGE_MAX_BYTES) {
          accepted = encoded;
          low = quality;
        } else high = quality;
      }
      if (accepted) {
        return technicalImageAssetFromBytes(new Uint8Array(await accepted.arrayBuffer()), 'image/webp', width, height);
      }
      width = Math.max(1, Math.round(width * 0.84));
      height = Math.max(1, Math.round(height * 0.84));
    }

    const last = await raster.encode(width, height, 0.42);
    if (last.size <= TECHNICAL_IMAGE_MAX_BYTES) {
      return technicalImageAssetFromBytes(new Uint8Array(await last.arrayBuffer()), 'image/webp', width, height);
    }
    if (fallback && fallback.size <= TECHNICAL_IMAGE_MAX_BYTES) {
      return technicalImageAssetFromBytes(new Uint8Array(await fallback.arrayBuffer()), 'image/webp', fallbackWidth, fallbackHeight);
    }
    throw new Error('Cette image ne peut pas être optimisée sous 70 Ko sans devenir illisible.');
  } finally {
    raster.close();
  }
}

export async function technicalImageAssetBytes(asset: TechnicalImageAsset): Promise<Uint8Array> {
  const dataUrl = await portableImageUrl(asset.dataUrl);
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error('Données d’image invalides.');
  return base64ToBytes(dataUrl.slice(separator + 1));
}

export function hydrateTechnicalBreakdownImages<T>(value: T, assets: TechnicalImageAssets): T {
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return resolveTechnicalImageSource(item, assets) || item;
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([key, child]) => [key, visit(child)]),
    );
    return item;
  };
  return visit(value) as T;
}

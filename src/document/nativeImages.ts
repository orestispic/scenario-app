import { invoke } from '@tauri-apps/api/core';

export function nativeImageStoreAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__?.invoke === 'function';
}

export function isNativeImageUrl(value: string): boolean {
  return /^http:\/\/senario-image\.localhost\/[a-f0-9]{64}$/u.test(value);
}

export async function cacheNativeImage(dataUrl: string): Promise<string> {
  if (!nativeImageStoreAvailable() || isNativeImageUrl(dataUrl)) return dataUrl;
  return invoke<string>('cache_scenario_image', { dataUrl });
}

export async function portableImageUrl(value: string): Promise<string> {
  return isNativeImageUrl(value) ? invoke<string>('read_scenario_image', { url: value }) : value;
}

/** Expand one image at a time for ZIP/export without a giant JSON string. */
export async function* portableScenarioChunks(file: unknown): AsyncGenerator<string> {
  const compact = JSON.stringify(file);
  const pattern = /"http:\/\/senario-image\.localhost\/[a-f0-9]{64}"/gu;
  let offset = 0;
  for (const match of compact.matchAll(pattern)) {
    yield compact.slice(offset, match.index);
    yield JSON.stringify(await portableImageUrl(JSON.parse(match[0]) as string));
    offset = match.index + match[0].length;
  }
  yield compact.slice(offset);
}

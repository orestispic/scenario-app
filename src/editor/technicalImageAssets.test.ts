import { describe, expect, it, vi } from 'vitest';
import {
  TECHNICAL_IMAGE_MAX_BYTES,
  collectTechnicalImageAssetIds,
  optimizeTechnicalImage,
  resolveTechnicalImageSource,
  technicalImageReference,
  type TechnicalImageRaster,
} from './technicalImageAssets';

describe('technical image assets', () => {
  it('uses a stable content reference and resolves one shared payload', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const source = new Blob([bytes], { type: 'image/png' });
    const asset = await optimizeTechnicalImage(source, async () => ({
      width: 20,
      height: 10,
      encode: vi.fn(),
      close: vi.fn(),
    }));
    const reference = technicalImageReference(asset.id);
    expect(collectTechnicalImageAssetIds({ one: reference, duplicate: reference })).toEqual([asset.id]);
    expect(resolveTechnicalImageSource(reference, { [asset.id]: asset })).toBe(asset.dataUrl);
  });

  it('keeps maximum dimensions while adapting WebP quality below 70 KiB', async () => {
    const encode = vi.fn(async (width: number, height: number, quality: number) => {
      const size = Math.round(width * height * quality * 0.28);
      return new Blob([new Uint8Array(size)], { type: 'image/webp' });
    });
    const raster: TechnicalImageRaster = { width: 4000, height: 3000, encode, close: vi.fn() };
    const asset = await optimizeTechnicalImage(
      new Blob([new Uint8Array(TECHNICAL_IMAGE_MAX_BYTES + 1)], { type: 'image/jpeg' }),
      async () => raster,
    );
    expect(asset.sizeBytes).toBeLessThanOrEqual(TECHNICAL_IMAGE_MAX_BYTES);
    expect(asset.contentType).toBe('image/webp');
    expect(asset.width).toBeGreaterThanOrEqual(480);
    expect(raster.close).toHaveBeenCalledOnce();
  });
});

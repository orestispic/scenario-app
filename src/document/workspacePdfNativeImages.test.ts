import { expect, it, vi } from 'vitest';
const portableImageUrl = vi.hoisted(() => vi.fn());
vi.mock('./nativeImages', () => ({ portableImageUrl }));
import { createTechnicalBreakdownPdf } from './workspacePdfExport';
import type { TechnicalBreakdown } from '../editor/technicalBreakdownModel';

it('embeds a cached native image in the PDF and fails if its bytes are missing', async () => {
  const url = `http://senario-image.localhost/${'a'.repeat(64)}`;
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  portableImageUrl.mockResolvedValue(image);
  const breakdown: TechnicalBreakdown = { version: 1,
    columns: [{ id: 'image', kind: 'image', name: 'Image', width: 80, widthMode: 'auto', hidden: false }],
    shots: [{ id: 'shot', sceneId: 'scene', values: { image: url } }],
  };
  const options = { pageFormat: 'a4', orientation: 'portrait', contentSize: 'normal', includePageNumbers: false, columnIds: ['image'], includeImages: true } as const;
  const pdf = await createTechnicalBreakdownPdf('Images natives', [], breakdown, { ...options, columnIds: [...options.columnIds] });
  expect(portableImageUrl).toHaveBeenCalledWith(url);
  expect(new TextDecoder().decode(pdf)).toContain('/Subtype /Image');
  portableImageUrl.mockRejectedValue(new Error('Image locale absente'));
  await expect(createTechnicalBreakdownPdf('Images natives', [], breakdown, { ...options, columnIds: [...options.columnIds] })).rejects.toThrow('Image locale absente');
});

// Generates real, decodable PNGs; does not copy any user's document or image.
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]); const prefix = Buffer.alloc(4), suffix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length); suffix.writeUInt32BE(crc32(body)); return Buffer.concat([prefix, body, suffix]);
}
export async function createLargeFixture(path) {
  const handle = await open(path, 'wx');
  const ids = []; let bytes = 0;
  const write = async value => { bytes += Buffer.byteLength(value); await handle.write(value); };
  try {
    await write('{"formatVersion":1,"title":"Recette images 0.1.18","technicalImageAssets":{');
    for (let i = 0; i < 192; i++) {
      const pixels = Buffer.alloc(240 * (240 * 3 + 1)); let random = i + 1;
      for (let row = 0; row < 240; row++) for (let col = 1; col <= 720; col++) {
        random ^= random << 13; random ^= random >>> 17; random ^= random << 5;
        pixels[row * 721 + col] = random & 255;
      }
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(240); ihdr.writeUInt32BE(240, 4); ihdr[8] = 8; ihdr[9] = 2;
      const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
      const id = createHash('sha256').update(png).digest('hex'); ids.push(id);
      await write(`${i ? ',' : ''}${JSON.stringify(id)}:${JSON.stringify({ id, contentType: 'image/png', width: 240, height: 240, sizeBytes: png.length, dataUrl: `data:image/png;base64,${png.toString('base64')}` })}`);
    }
    const content = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'large-fixture', scenarioType: 'ACTION' }, content: [{ type: 'text', text: 'RECETTE GROS PROJET : 192 images intactes' }] }] };
    await write(`},"content":${JSON.stringify(content)},"characters":[],"locations":[],"times":[],"comments":[],"savedAt":"2026-09-28T00:00:00Z"}`);
    return { bytes, images: ids.length, ids };
  } finally { await handle.close(); }
}

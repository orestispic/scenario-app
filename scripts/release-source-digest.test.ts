import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releaseSourceDigest } from './release-source-digest.mjs';

it('attests the same checkout with LF or Windows CRLF while retaining binary changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'senario-source-digest-'));
  try {
    for (const directory of ['src', 'src-tauri', 'public', 'scripts', 'tools', '.github/workflows', 'licenses']) mkdirSync(join(root, directory), { recursive: true });
    const textFiles = ['THIRD_PARTY_NOTICES', 'THIRD_PARTY_NOTICES_AUDIO.txt', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'index.html', 'public/_headers', 'public/_redirects', 'public/senario-ui-icons.svg'];
    for (const file of textFiles) writeFileSync(join(root, file), 'first line\nsecond line\n');
    const icon = join(root, 'src-tauri/icon.ico');
    writeFileSync(icon, Buffer.from([0, 10, 13, 10, 255]));
    const original = releaseSourceDigest(root);
    for (const file of textFiles) writeFileSync(join(root, file), 'first line\r\nsecond line\r\n');
    expect(releaseSourceDigest(root)).toBe(original);
    writeFileSync(icon, Buffer.from([0, 10, 10, 255]));
    expect(releaseSourceDigest(root)).not.toBe(original);
  } finally {
    rmSync(root, { recursive: true });
  }
});

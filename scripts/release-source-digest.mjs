import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Review/evidence files are intentionally outside the digest to avoid a cycle
// when recording approval. Generated artifacts and installed dependencies are
// checked by the separate build/signature steps.
export function releaseSourceDigest(root) {
  const files = [];
  function visit(relative) {
    const path = join(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Release sources must not contain symbolic links');
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if (['target', 'audio-runtime', '__pycache__'].includes(name)) continue;
        visit(relative + '/' + name);
      }
    } else if (stat.isFile()) files.push(relative);
  }
  for (const relative of ['src', 'src-tauri', 'public', 'scripts', 'tools', '.github/workflows', 'licenses',
    'THIRD_PARTY_NOTICES', 'THIRD_PARTY_NOTICES_AUDIO.txt',
    'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'index.html']) visit(relative);
  const digest = createHash('sha256');
  for (const relative of files.sort()) {
    const bytes = readFileSync(join(root, relative));
    const content = /\.(?:ts|tsx|js|mjs|json|toml|lock|yml|yaml|ps1|rs|css|html|nsh|txt|md|svg)$/i.test(relative)
      || /(?:^|\/)(?:THIRD_PARTY_NOTICES|LICENSE|NOTICE|_headers|_redirects)$/.test(relative)
      ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes;
    digest.update(relative + '\0' + content.length + '\0');
    digest.update(content);
  }
  return digest.digest('hex');
}

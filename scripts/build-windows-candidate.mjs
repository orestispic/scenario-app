// Local, unsigned internal candidate. Does not install, publish or approve a release.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnv } from 'vite';
import { releaseSourceDigest } from './release-source-digest.mjs';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
assert.equal(process.platform, 'win32', 'Windows build host required');
Object.assign(process.env, loadEnv('production', root, 'VITE_'));
await import('./verify-production-release-config.mjs');
await import('./verify-native-resources.mjs');
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const before = releaseSourceDigest(root);
const directory = resolve('outputs/windows-candidate', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(directory, { recursive: true });
const override = join(directory, 'unsigned-internal.json');
writeFileSync(override, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }, null, 2));
const installer = `src-tauri/target/release/bundle/nsis/senario_${config.version}_x64-setup.exe`;
const executable = 'src-tauri/target/release/scenario-app.exe';
for (const path of [installer, `${installer}.sig`, executable]) {
  if (existsSync(path)) copyFileSync(path, join(directory, 'previous-' + path.split('/').at(-1)));
}
writeFileSync(join(directory, 'build-start.json'), JSON.stringify({ version: config.version, sourceDigest: before, startedAt: new Date().toISOString(), unsignedInternal: true }, null, 2));
const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--bundles', 'nsis', '--config', override], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
assert.equal(result.status, 0, 'Native candidate build failed');
assert.equal(releaseSourceDigest(root), before, 'Sources changed during build; candidate provenance invalid');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const resources = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(path);
    else resources.push({ path, sha256: hash(path) });
  }
}
collect('src-tauri/audio-runtime');
const outputInstaller = join(directory, `senario_${config.version}_x64-setup-UNSIGNED.exe`);
copyFileSync(installer, outputInstaller);
const manifest = {
  version: config.version, identifier: config.identifier, sourceDigest: before,
  builtAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  environment: process.env.VITE_SCENARIO_ENVIRONMENT,
  apiOrigin: process.env.VITE_SCENARIO_API_BASE_URL, authOrigin: process.env.VITE_SUPABASE_URL,
  buildOverrideSha256: hash(override),
  installer: { path: outputInstaller, sha256: hash(outputInstaller) },
  executable: { path: executable, sha256: hash(executable) }, resources,
  authenticode: 'not-obtained', tauriUpdaterSignature: 'not-produced', publicationAuthorized: false,
};
writeFileSync(join(directory, 'candidate.json'), JSON.stringify(manifest, null, 2));
console.log(`Internal unsigned candidate manifest: ${join(directory, 'candidate.json')}`);

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyUpdaterSignature } from './updater-signature.mjs';

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = config.version;
const verifyArtifact = (bytes, signature) => verifyUpdaterSignature(bytes, signature, config.plugins.updater.pubkey);
let bytes, signature;
if (process.argv.includes('--published')) {
  const response = await fetch('https://github.com/orestispic/scenario-app/releases/latest/download/latest.json');
  assert.ok(response.ok);
  const manifest = await response.json();
  assert.equal(manifest.version.replace(/^v/, ''), version);
  const windows = manifest.platforms['windows-x86_64'];
  assert.ok(windows);
  const url = new URL(windows.url);
  assert.equal(url.protocol, 'https:');
  const releaseResponse = await fetch(`https://api.github.com/repos/orestispic/scenario-app/releases/tags/v${version}`);
  assert.ok(releaseResponse.ok);
  const release = await releaseResponse.json();
  const asset = release.assets.find(item => item.name === 'Scenario-Setup.exe');
  assert.ok(asset);
  const publicUrl = `https://github.com/orestispic/scenario-app/releases/download/v${version}/Scenario-Setup.exe`;
  assert.equal(asset.browser_download_url, publicUrl);
  // tauri-action can use the API asset URL; validate its identity against the
  // expected tagged release before fetching with the same Accept header as Tauri.
  assert.ok(windows.url === publicUrl || windows.url === `https://api.github.com/repos/orestispic/scenario-app/releases/assets/${asset.id}`);
  const installer = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
  assert.ok(installer.ok);
  bytes = Buffer.from(await installer.arrayBuffer());
  assert.ok(bytes.length > 1000000 && bytes.length < 64000000);
  signature = windows.signature;
} else {
  const path = `src-tauri/target/release/bundle/nsis/senario_${version}_x64-setup.exe`;
  bytes = readFileSync(path); signature = readFileSync(`${path}.sig`, 'utf8');
}
verifyArtifact(bytes, signature);
const modified = Buffer.from(bytes); modified[100] ^= 1;
assert.throws(() => verifyArtifact(modified, signature), /Installer signature invalid/);
console.log(JSON.stringify({ version, published: process.argv.includes('--published'), bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), updaterSignature: 'valid', modifiedInstaller: 'rejected' }));

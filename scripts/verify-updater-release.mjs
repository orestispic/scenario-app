import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';

const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const version = config.version;
const publicLines = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim().split(/\r?\n/);
const publicBytes = Buffer.from(publicLines[1], 'base64');
assert.equal(publicBytes.length, 42);
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)]), format: 'der', type: 'spki' });
function verifyArtifact(bytes, encodedSignature) {
  const lines = Buffer.from(encodedSignature.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const signature = Buffer.from(lines[1], 'base64');
  assert.equal(signature.length, 74);
  assert.deepEqual(signature.subarray(2, 10), publicBytes.subarray(2, 10));
  assert.ok(lines[2].startsWith('trusted comment: '));
  const algorithm = signature.subarray(0, 2).toString('ascii');
  assert.ok(['ED', 'Ed'].includes(algorithm));
  const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  assert.ok(verify(null, message, key, signature.subarray(10)), 'Installer signature invalid');
  const global = Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice('trusted comment: '.length))]);
  assert.ok(verify(null, global, key, Buffer.from(lines[3], 'base64')), 'Signature comment invalid');
}
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
  const path = `src-tauri/target/release/bundle/nsis/senario Beta_${version}_x64-setup.exe`;
  bytes = readFileSync(path); signature = readFileSync(`${path}.sig`, 'utf8');
}
verifyArtifact(bytes, signature);
const modified = Buffer.from(bytes); modified[100] ^= 1;
assert.throws(() => verifyArtifact(modified, signature), /Installer signature invalid/);
console.log(JSON.stringify({ version, published: process.argv.includes('--published'), bytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), updaterSignature: 'valid', modifiedInstaller: 'rejected' }));

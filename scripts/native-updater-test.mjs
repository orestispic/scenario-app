import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { join } from 'node:path';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
const bytes = await readFile(process.argv[2]);
const version = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8')).version;
const installedVersion = () => execFileSync('pwsh', ['-NoProfile', '-Command', "(Get-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'senario/scenario-app.exe')).VersionInfo.ProductVersion"], { encoding: 'utf8', windowsHide: true }).trim().match(/^\d+\.\d+\.\d+/)?.[0];
const baseline = installedVersion(); assert.equal(baseline, '0.1.17'); assert.equal(version, '0.1.18');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keyId = Buffer.alloc(8, 42), rawKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
const pubkey = Buffer.from(`untrusted comment: disposable test\n${Buffer.concat([Buffer.from('Ed'), keyId, rawKey]).toString('base64')}`).toString('base64');
const signatureBytes = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey);
const comment = 'disposable CI fixture; not a release signature';
const signature = Buffer.from(['untrusted comment: disposable test', Buffer.concat([Buffer.from('ED'), keyId, signatureBytes]).toString('base64'), `trusted comment: ${comment}`, sign(null, Buffer.concat([signatureBytes, Buffer.from(comment)]), privateKey).toString('base64')].join('\n')).toString('base64');
let mode = 'tampered', origin;
const requests = [];
const server = createServer((req, res) => {
  requests.push({ mode, path: req.url });
  if (req.url === '/latest.json') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ version, notes: 'Isolated fixture', pub_date: '2026-09-28T00:00:00Z', platforms: { 'windows-x86_64': { signature, url: `${origin}/candidate.exe` } } }));
  } else if (req.url === '/candidate.exe') {
    res.setHeader('Content-Length', bytes.length);
    if (mode === 'tampered') { res.write(bytes.subarray(0, -1)); res.end(Buffer.from([bytes.at(-1) ^ 1])); } else res.end(bytes);
  } else { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
async function probe() {
  const child = spawn('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'native_updater_probe', '--', '--ignored', '--nocapture', '--test-threads=1'], {
    windowsHide: true, stdio: 'inherit', env: { ...process.env, SENARIO_UPDATER_TEST_ENDPOINT: `${origin}/latest.json`, SENARIO_UPDATER_TEST_PUBKEY: pubkey, SENARIO_UPDATER_TEST_MODE: mode, SENARIO_UPDATER_TEST_INSTALLED_VERSION: baseline },
  });
  const timeout = setTimeout(() => child.kill(), 240_000);
  try { assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }), 0); } finally { clearTimeout(timeout); }
}
try {
  await probe(); assert.equal(installedVersion(), baseline, 'Tampered update must not change the installed version');
  mode = 'install'; await probe();
  for (let i = 0; i < 120; i++) { if (installedVersion() === version) break; await new Promise(resolve => setTimeout(resolve, 1000)); }
  assert.equal(installedVersion(), version, 'Tauri must actually install the newer candidate');
  const evidence = { baseline, installed: version, sha256: createHash('sha256').update(bytes).digest('hex'), tamperedRejected: true, nativeDownloadSignatureVerified: true, nativeInstallerExecuted: true, productionSignature: false, requests };
  await writeFile(join(process.env.RUNNER_TEMP, 'senario-phase14/updater-network-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: real Tauri network download, bad signature rejection and native NSIS update with an ephemeral test key.');
} finally { await new Promise(resolve => server.close(resolve)); }

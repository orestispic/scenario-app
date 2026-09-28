// Real packaged WebView2 + Rust commands on an ephemeral Windows CI runner.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createLargeFixture } from './native-large-fixture.mjs';
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use an isolated CI runner');
assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted', 'Use a disposable GitHub-hosted runner');
const mode = process.argv[2];
assert.ok(['seed', 'verify', 'reinstalled', 'large'].includes(mode));
const root = join(process.env.RUNNER_TEMP, 'senario-phase14');
await mkdir(root, { recursive: true });
const statePath = join(root, 'native-state.json');
const largePath = join(root, 'large-images.scenario');
const fixture = mode === 'large' ? await createLargeFixture(largePath) : null;
const scope = 'https://scenario-commercial-api-production.ore-picard.workers.dev|https://rtqlsnwfbtnscilfdirv.supabase.co';
const profile = join(root, mode === 'reinstalled' ? 'fresh-webview' : 'webview');
// WebView2 150+ ignores environment overrides for elevated hosts (CI runners).
// These policies affect only our executable on the disposable runner, never users.
const policy = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\';
for (const [name, value] of [['AdditionalBrowserArguments', '--remote-debugging-port=19314 --remote-debugging-address=127.0.0.1'], ['UserDataFolder', profile]]) {
  execFileSync('reg.exe', ['add', policy + name, '/v', 'scenario-app.exe', '/t', 'REG_SZ', '/d', value, '/f', '/reg:64'], { windowsHide: true });
}
const child = spawn(join(process.env.LOCALAPPDATA, 'senario', 'scenario-app.exe'), mode === 'large' ? [largePath] : [], {
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
});
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('error', error => console.error('Native process launch:', error.message));
child.on('exit', (code, signal) => console.log('Native process exit:', code, signal));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let target, diagnostic;
  for (let i = 0; i < 300; i++) {
    try { const targets = await (await fetch('http://127.0.0.1:19314/json/list')).json(); diagnostic = JSON.stringify(targets); target = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl); } catch (error) { diagnostic = error.message; }
    if (target) break;
    await delay(300);
  }
  assert.ok(target, `Packaged application must expose its WebView (process exit ${child.exitCode}, ${diagnostic})`);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const waiting = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { const pending = waiting.get(message.id); waiting.delete(message.id); if (message.error) pending?.reject(new Error(message.error.message)); else pending?.resolve(message.result); } };
  async function evaluate(expression) {
    const key = ++id;
    let timeout;
    try {
      const result = await Promise.race([new Promise((resolve, reject) => {
        waiting.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      }), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Native evaluation timeout')), 60000); })]);
      assert.equal(result.exceptionDetails, undefined, 'Native command or renderer failed');
      return result.result.value;
    } finally { clearTimeout(timeout); waiting.delete(key); }
  }
  for (let i = 0; i < 100; i++) {
    if (await evaluate("Boolean(document.querySelector('.scenario-editor'))")) break;
    await delay(200);
  }
  assert.equal(await evaluate("Boolean(document.querySelector('.scenario-editor'))"), true, 'Free editor must open');
  const invoke = (command, args) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
  if (mode === 'large') {
    assert.ok(fixture.bytes > 32 * 1024 * 1024);
    for (let i = 0; i < 100; i++) {
      if (await evaluate("document.querySelector('.scenario-editor')?.textContent.includes('RECETTE GROS PROJET')")) break;
      await delay(300);
    }
    assert.equal(await evaluate("document.querySelector('.scenario-editor')?.textContent.includes('RECETTE GROS PROJET')"), true, 'Large file must open through the real editor startup path');
    const beforeSave = (await stat(largePath)).mtimeMs;
    let savedByEditor = false;
    for (let i = 0; i < 100; i++) {
      try { savedByEditor = (await stat(largePath)).mtimeMs > beforeSave; } catch { /* atomic replacement */ }
      if (savedByEditor) break;
      // Rendering precedes the awaited initial recovery/backup. During that
      // period the application deliberately blocks file actions. Retry only
      // until the first actual save; the app also serializes pending saves.
      if (i % 5 === 0) await evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true, bubbles: true })); true");
      await delay(300);
    }
    if (!savedByEditor) await writeFile(join(root, 'large-save-failure.json'), JSON.stringify({
      body: await evaluate('document.body.innerText.slice(0, 12000)'),
      sourceBytes: (await stat(largePath)).size,
    }, null, 2));
    assert.equal(savedByEditor, true, 'Ctrl+S must save the large document through the real editor');
    assert.equal(createHash('sha256').update(await readFile(`${largePath}.bak`)).digest('hex'), fixture.sha256, 'The complete original large file must survive in .bak');
    const editorSave = JSON.parse(await readFile(largePath, 'utf8'));
    assert.equal(Object.keys(editorSave.technicalImageAssets ?? {}).length, fixture.images, 'Editor serialization must retain every referenced image');
    for (const [id, asset] of Object.entries(editorSave.technicalImageAssets)) {
      assert.ok(asset.dataUrl.startsWith('data:image/png;base64,'));
      assert.equal(createHash('sha256').update(Buffer.from(asset.dataUrl.split(',')[1], 'base64')).digest('hex'), id);
    }
    const result = await evaluate(`(async () => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const contents = await invoke('read_scenario_streamed', { path: ${JSON.stringify(largePath)} });
      const file = JSON.parse(contents), assets = Object.values(file.technicalImageAssets);
      const decode = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = () => reject(new Error('Native image cannot be decoded')); image.src = src; });
      const dimensions = [];
      for (const asset of [assets[0], assets.at(-1)]) dimensions.push(await decode(asset.dataUrl));
      await invoke('write_scenario_streamed', { path: ${JSON.stringify(join(root, 'large-portable.scenario'))}, kind: 'write_scenario', contents });
      const again = JSON.parse(await invoke('read_scenario_streamed', { path: ${JSON.stringify(join(root, 'large-portable.scenario'))} }));
      return { ipcBytes: new TextEncoder().encode(contents).length, images: assets.length, dimensions, ids: Object.keys(again.technicalImageAssets) };
    })()`);
    assert.equal(result.images, fixture.images); assert.ok(result.ipcBytes < 512 * 1024);
    assert.deepEqual(result.dimensions, [[240, 240], [240, 240]]);
    assert.deepEqual(result.ids.sort(), [...fixture.ids].sort());
    // Inspect the actual saved portable bytes independently of the app/cache.
    const saved = JSON.parse(await readFile(join(root, 'large-portable.scenario'), 'utf8'));
    for (const [id, asset] of Object.entries(saved.technicalImageAssets)) {
      assert.ok(asset.dataUrl.startsWith('data:image/png;base64,'));
      assert.equal(createHash('sha256').update(Buffer.from(asset.dataUrl.split(',')[1], 'base64')).digest('hex'), id);
    }
    const evidence = { mode, sourceBytes: fixture.bytes, sourceSha256: fixture.sha256, savedBytes: (await stat(join(root, 'large-portable.scenario'))).size, ...result, portableImageHashesVerified: true, actualPngDecode: true, editorCtrlSSave: true, editorImageHashesVerified: true, completeOriginalBakVerified: true };
    await writeFile(join(root, 'large-project-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(`PASS large project: ${fixture.bytes} bytes, ${result.images} images, ${result.ipcBytes} bytes across IPC, real PNG decode and portable image hashes verified.`);
  } else if (mode === 'seed') {
    const fingerprint = await evaluate("localStorage.getItem('scenario-local-device-fingerprint') || (() => { const value = crypto.randomUUID() + crypto.randomUUID(); localStorage.setItem('scenario-local-device-fingerprint', value); return value; })()");
    await writeFile(statePath, JSON.stringify({ fingerprint }));
  } else {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(await invoke('read_device_identity', { scope }), state.fingerprint, 'Vault identity must survive update/reinstall');
    assert.equal(await evaluate("localStorage.getItem('scenario-local-device-fingerprint')"), state.fingerprint, 'Fresh web data must recover the original device');
    const path = join(root, 'native-roundtrip.scenario');
    const contents = JSON.stringify({ formatVersion: 1, title: 'Native phase14', content: { type: 'doc', content: [] } });
    await invoke('write_scenario', { path, contents });
    assert.equal(await invoke('read_scenario', { path }), contents);
  }
  await invoke('clear_recovery', {});
  console.log(`PASS packaged Windows ${mode}: editor opens, ${mode === 'seed' ? 'legacy identity captured' : mode === 'large' ? 'large project and real images survive editor save' : 'same device identity and native file save/reopen'}`);
} finally {
  socket?.close();
  child.kill();
  await delay(1500);
  for (const name of ['AdditionalBrowserArguments', 'UserDataFolder']) {
    execFileSync('reg.exe', ['delete', policy + name, '/v', 'scenario-app.exe', '/f', '/reg:64'], { windowsHide: true });
  }
}

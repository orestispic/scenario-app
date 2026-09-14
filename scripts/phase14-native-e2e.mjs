// Real packaged WebView2 + Rust commands on an ephemeral Windows CI runner.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use an isolated CI runner');
const mode = process.argv[2];
assert.ok(['seed', 'verify', 'reinstalled'].includes(mode));
const root = join(process.env.RUNNER_TEMP, 'senario-phase14');
await mkdir(root, { recursive: true });
const statePath = join(root, 'native-state.json');
const scope = 'https://scenario-commercial-api-preproduction.ore-picard.workers.dev|https://zblnsdyaoljnezxdidtx.supabase.co';
const profile = join(root, mode === 'reinstalled' ? 'fresh-webview' : 'webview');
// WebView2 150+ ignores environment overrides for elevated hosts (CI runners).
// These policies affect only our executable on the disposable runner, never users.
const policy = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\';
for (const [name, value] of [['AdditionalBrowserArguments', '--remote-debugging-port=19314 --remote-debugging-address=127.0.0.1'], ['UserDataFolder', profile]]) {
  execFileSync('reg.exe', ['add', policy + name, '/v', 'scenario-app.exe', '/t', 'REG_SZ', '/d', value, '/f', '/reg:64'], { windowsHide: true });
}
const child = spawn(join(process.env.LOCALAPPDATA, 'senario Beta', 'scenario-app.exe'), [], {
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
    const result = await Promise.race([new Promise((resolve, reject) => {
      waiting.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    }), delay(15000).then(() => { throw new Error('Native evaluation timeout'); })]);
    assert.equal(result.exceptionDetails, undefined, 'Native command or renderer failed');
    return result.result.value;
  }
  for (let i = 0; i < 100; i++) {
    if (await evaluate("Boolean(document.querySelector('.scenario-editor'))")) break;
    await delay(200);
  }
  assert.equal(await evaluate("Boolean(document.querySelector('.scenario-editor'))"), true, 'Free editor must open');
  const invoke = (command, args) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`);
  if (mode === 'seed') {
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
  console.log(`PASS packaged Windows ${mode}: editor opens, ${mode === 'seed' ? 'legacy identity captured' : 'same device identity and native file save/reopen'}`);
} finally {
  socket?.close();
  child.kill();
  await delay(1500);
  for (const name of ['AdditionalBrowserArguments', 'UserDataFolder']) {
    execFileSync('reg.exe', ['delete', policy + name, '/v', 'scenario-app.exe', '/f', '/reg:64'], { windowsHide: true });
  }
}

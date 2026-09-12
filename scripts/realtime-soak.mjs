// Runs the actual application client against the existing isolated fixture.
// No scenario operation is submitted. Only this run's channels/sessions close.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

function environment(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
}
const app = environment(resolve('.env.phase9.local'));
const accounts = environment(resolve('../scenario-site-commercial/.env.phase9.accounts.local'));
const fixture = environment(resolve('../scenario-site-commercial/.env.phase9.studio.local'));
const project = 'zblnsdyaoljnezxdidtx';
const supabase = app.VITE_SUPABASE_URL;
const apiUrl = app.VITE_SCENARIO_API_BASE_URL;
if (supabase !== `https://${project}.supabase.co` || apiUrl !== 'https://scenario-commercial-api-preproduction.ore-picard.workers.dev')
  throw new Error('Refusing an unexpected test environment');
const seconds = Number(process.argv[2] ?? 120);
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 600) throw new Error('Duration must be 60..600 seconds');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const clients = [];
const tokens = [];
const observations = [];
let failure;
try {
  const { createAuthenticatedCommercialApi } = await vite.ssrLoadModule('/src/commercial/authenticatedApi.ts');
  const { StudioCollaborationClient, applyScenarioMutation } = await vite.ssrLoadModule('/src/commercial/collaborationClient.ts');
  let baseVersionId;
  for (const role of ['owner', 'editor', 'viewer']) {
    const prefix = `PHASE9_${role.toUpperCase()}`;
    const login = await fetch(`${supabase}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: accounts[`${prefix}_EMAIL`], password: accounts[`${prefix}_PASSWORD`] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!login.ok) throw new Error(`Synthetic ${role} login failed: ${login.status}`);
    const session = await login.json();
    tokens.push(session.access_token);
    const observation = { role, connects: 0, polls: 0, heartbeats: 0, errors: {}, statuses: [], state: 'disconnected' };
    observations.push(observation);
    const api = createAuthenticatedCommercialApi({
      baseUrl: apiUrl, accessToken: session.access_token,
      clientContext: { clientVersion: app.VITE_SCENARIO_CLIENT_VERSION, deviceFingerprint: `phase9-${role}-${project}-device`, platform: 'windows' },
      fetcher: async (url, init) => {
        const response = await fetch(url, { ...init, headers: { ...init.headers, Origin: 'http://127.0.0.1:1420' } });
        const path = new URL(url).pathname;
        if (path.endsWith('/realtime/connect')) observation.connects += 1;
        if (path.endsWith('/realtime/poll')) observation.polls += 1;
        if (path.endsWith('/realtime/heartbeat')) observation.heartbeats += 1;
        if (!response.ok) {
          const body = await response.clone().json().catch(() => ({}));
          const code = /^[a-z_]{1,80}$/.test(body.code ?? '') ? body.code : `http_${response.status}`;
          observation.errors[code] = (observation.errors[code] ?? 0) + 1;
        }
        return response;
      },
    });
    const me = await api.getMe();
    if (!baseVersionId) {
      const versions = await api.listCloudVersions(fixture.PHASE9_SCENARIO_ID);
      baseVersionId = [...versions.versions].sort((a,b) => b.versionNumber - a.versionNumber)[0]?.id;
    }
    if (!baseVersionId) throw new Error('Missing fixture version');
    let document = { type: 'doc', content: [] };
    const client = new StudioCollaborationClient(api, fixture.PHASE9_STUDIO_ID, fixture.PHASE9_SCENARIO_ID, baseVersionId, me.account.id, {
      read: () => document,
      applyRemote: (mutation) => { document = applyScenarioMutation(document, mutation); },
      subscribe: () => () => {}, setReadOnly: () => {},
    });
    clients.push(client);
    client.subscribe((state) => {
      observation.state = state.status;
      if (observation.statuses.at(-1) !== state.status) observation.statuses.push(state.status);
    });
    await client.connect();
  }
  for (let elapsed = 0; elapsed < seconds; elapsed += 10) {
    await new Promise((done) => setTimeout(done, 10_000));
    console.log(JSON.stringify({ elapsedSeconds: elapsed + 10, clients: observations }));
  }
  for (const item of observations) {
    if (item.state !== (item.role === 'viewer' ? 'read_only' : 'online') ||
        item.connects !== 1 || Object.keys(item.errors).length || item.polls < 10)
      throw new Error(`Soak failed for synthetic ${item.role}; see content-free counters`);
  }
  console.log(`Actual application client: ${seconds}s stability passed for three accounts`);
} catch (error) {
  failure = error;
} finally {
  await Promise.allSettled(clients.map((client) => client.disconnect()));
  await Promise.allSettled(tokens.map((token) => fetch(`${supabase}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  })));
  await vite.close();
}
if (failure) {
  console.error(failure instanceof Error ? failure.message : 'Soak failed');
  process.exitCode = 1;
}

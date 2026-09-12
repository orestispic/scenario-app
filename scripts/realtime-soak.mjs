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
const sequential = process.argv.includes('--sequential');
if (!Number.isInteger(seconds) || seconds < 60 || seconds > 600) throw new Error('Duration must be 60..600 seconds');
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const clients = [];
const tokens = [];
const observations = [];
const documents = [];
let failure;
try {
  const { createAuthenticatedCommercialApi } = await vite.ssrLoadModule('/src/commercial/authenticatedApi.ts');
  const { StudioCollaborationClient } = await vite.ssrLoadModule('/src/commercial/collaborationClient.ts');
  const { loadStudioBase, selectStudioRoot } = await vite.ssrLoadModule('/src/commercial/studioBase.ts');
  let root;
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
    if (!root) {
      const versions = await api.listCloudVersions(fixture.PHASE9_SCENARIO_ID);
      root = selectStudioRoot(versions.versions, fixture.PHASE9_SCENARIO_ID);
    }
    if (!root) throw new Error('Missing fixture version');
    let document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: `unshared-local-${role}` } }] };
    documents.push(() => document);
    const client = new StudioCollaborationClient(api, fixture.PHASE9_STUDIO_ID, fixture.PHASE9_SCENARIO_ID, root.id, me.account.id, {
      read: () => document,
      replaceDocument: (value) => { document = structuredClone(value); },
      subscribe: () => () => {}, setReadOnly: () => {},
    }, async (signal) => {
      try { return await loadStudioBase(api, root, signal, async (url, init) => {
        const response = await fetch(url, { ...init, redirect: 'manual' });
        if (!response.ok) observation.errors[`base_http_${response.status}`] = (observation.errors[`base_http_${response.status}`] ?? 0) + 1;
        return response;
      }); } catch (error) {
        const name = /^[A-Za-z_]{1,50}$/.test(error?.name ?? '') ? error.name : 'UnknownError';
        observation.errors[`base_${name}`] = (observation.errors[`base_${name}`] ?? 0) + 1;
        throw error;
      }
    });
    clients.push(client);
    client.subscribe((state) => {
      observation.state = state.status;
      if (observation.statuses.at(-1) !== state.status) observation.statuses.push(state.status);
    });
    await client.connect();
    if (sequential) {
      if (observation.state !== (role === 'viewer' ? 'read_only' : 'online')) throw new Error(`Synthetic ${role} catch-up did not complete`);
      await client.disconnect();
    }
  }
  for (let elapsed = 0; !sequential && elapsed < seconds; elapsed += 10) {
    await new Promise((done) => setTimeout(done, 10_000));
    console.log(JSON.stringify({ elapsedSeconds: elapsed + 10, clients: observations }));
  }
  for (const item of observations) {
    if ((!sequential && item.state !== (item.role === 'viewer' ? 'read_only' : 'online')) ||
        item.connects !== 1 || Object.keys(item.errors).length || item.polls < (sequential ? 1 : 10))
      throw new Error(`Soak failed for synthetic ${item.role}; see content-free counters`);
  }
  const converged = documents.map((read) => JSON.stringify(read()));
  if (!converged.every((value) => value === converged[0])) throw new Error('Hosted reconstructed documents diverged');
  console.log('Three reconstructed documents are identical (content not logged)');
  console.log(sequential ? 'Sequential authenticated reconstruction passed for three accounts (not a simultaneous stability test)' : `Actual application client: ${seconds}s stability passed for three accounts`);
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

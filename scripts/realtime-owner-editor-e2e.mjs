// Real preproduction test using the application client. It appends two empty,
// synthetic validation blocks to the dedicated fixture and never logs content.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

function environment(file) {
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
}
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
async function checksum(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const app = environment(resolve('.env.phase9.local'));
const accounts = environment(resolve('../scenario-site-commercial/.env.phase9.accounts.local'));
const fixture = environment(resolve('../scenario-site-commercial/.env.phase9.studio.local'));
const project = 'zblnsdyaoljnezxdidtx';
const apiUrl = 'https://scenario-commercial-api-preproduction.ore-picard.workers.dev';
if (app.VITE_SUPABASE_URL !== `https://${project}.supabase.co` || app.VITE_SCENARIO_API_BASE_URL !== apiUrl)
  throw new Error('Refusing an unexpected environment');

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
const sessions = [];
const clients = [];
let failure;
try {
  const { createAuthenticatedCommercialApi } = await vite.ssrLoadModule('/src/commercial/authenticatedApi.ts');
  const { StudioCollaborationClient } = await vite.ssrLoadModule('/src/commercial/collaborationClient.ts');
  const { loadStudioBase, selectStudioRoot } = await vite.ssrLoadModule('/src/commercial/studioBase.ts');
  const runId = crypto.randomUUID();
  const ids = [`phase9-e2e-owner-${runId}`, `phase9-e2e-editor-${runId}`];
  const participants = [];
  let root;
  for (const [index, role] of ['owner', 'editor'].entries()) {
    const prefix = `PHASE9_${role.toUpperCase()}`;
    const login = await fetch(`${app.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email: accounts[`${prefix}_EMAIL`], password: accounts[`${prefix}_PASSWORD`] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!login.ok) throw new Error(`Synthetic ${role} login failed: ${login.status}`);
    const session = await login.json();
    sessions.push(session.access_token);
    const api = createAuthenticatedCommercialApi({
      baseUrl: apiUrl, accessToken: session.access_token,
      clientContext: { clientVersion: app.VITE_SCENARIO_CLIENT_VERSION, deviceFingerprint: `phase9-${role}-${project}-device`, platform: 'windows' },
      fetcher: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: 'http://127.0.0.1:1420' } }),
    });
    const me = await api.getMe();
    if (!root) root = selectStudioRoot((await api.listCloudVersions(fixture.PHASE9_SCENARIO_ID)).versions, fixture.PHASE9_SCENARIO_ID);
    let document = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: `unshared-${role}` } }] };
    let listener = () => {};
    let status = 'disconnected';
    const client = new StudioCollaborationClient(api, fixture.PHASE9_STUDIO_ID, fixture.PHASE9_SCENARIO_ID, root.id, me.account.id, {
      read: () => structuredClone(document),
      replaceDocument: (value) => { document = structuredClone(value); },
      subscribe: (next) => { listener = next; return () => { listener = () => {}; }; },
      setReadOnly: () => {},
    }, (signal) => loadStudioBase(api, root, signal));
    client.subscribe((state) => { status = state.status; });
    clients.push(client);
    participants.push({ role, index, api, client, read: () => structuredClone(document), edit: (value) => { document = structuredClone(value); listener(document); }, status: () => status });
  }
  await Promise.all(participants.map(({ client }) => client.connect()));
  if (participants.some(({ status }) => status() !== 'online')) throw new Error('Initial Owner/Editor catch-up failed');
  const initial = participants.map(({ read }) => JSON.stringify(read()));
  if (initial[0] !== initial[1]) throw new Error('Owner/Editor initial documents differ');
  for (const participant of participants) {
    const document = participant.read();
    document.content ??= [];
    document.content.push({ type: 'paragraph', attrs: { blockId: ids[participant.index], syntheticValidation: true }, content: [] });
    participant.edit(document);
  }
  const deadline = Date.now() + 35_000;
  let converged = false;
  while (Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 1_000));
    const documents = participants.map(({ read }) => read());
    const containBoth = documents.every((document) => ids.every((id) => document.content?.some((block) => block.attrs?.blockId === id)));
    if (containBoth && JSON.stringify(documents[0]) === JSON.stringify(documents[1])) { converged = true; break; }
  }
  if (!converged) throw new Error('Owner/Editor documents did not converge');
  if (participants.some(({ status }) => status() !== 'online')) throw new Error('Owner/Editor connection became unstable');
  console.log('Owner and Editor concurrent empty-block edit converged (content not logged)');
  // Tombstone validation blocks through their original role. Sending explicit
  // deletes avoids manufacturing move-upserts for neighbouring user blocks.
  const validationIds = participants[0].read().content?.map((block) => String(block.attrs?.blockId ?? '')).filter((id) => id.startsWith('phase9-e2e-')) ?? [];
  for (const participant of participants) {
    const ticket = await participant.api.issueCollaborationTicket(fixture.PHASE9_STUDIO_ID);
    const cleanup = await participant.api.connectCollaboration(fixture.PHASE9_STUDIO_ID, ticket.ticket, 0);
    try {
      let sequence = 0;
      for (const blockId of validationIds.filter((id) => id.startsWith(`phase9-e2e-${participant.role}-`))) {
        const unsigned = { studioId: fixture.PHASE9_STUDIO_ID, scenarioId: fixture.PHASE9_SCENARIO_ID, baseVersionId: root.id,
          operationId: crypto.randomUUID(), clientSequence: ++sequence, logicalClock: Date.now() + sequence,
          mutation: { type: 'block.delete', blockId } };
        await participant.api.submitCollaborationOperation(fixture.PHASE9_STUDIO_ID, cleanup.connectionId, { ...unsigned, checksum: await checksum(unsigned) });
      }
    } finally { await participant.api.disconnectCollaboration(fixture.PHASE9_STUDIO_ID, cleanup.connectionId); }
  }
  const cleanupDeadline = Date.now() + 35_000;
  let cleanupConverged = false;
  while (Date.now() < cleanupDeadline) {
    await new Promise((done) => setTimeout(done, 1_000));
    const documents = participants.map(({ read }) => read());
    const clean = documents.every((document) => !document.content?.some((block) => String(block.attrs?.blockId ?? '').startsWith('phase9-e2e-')));
    if (clean && JSON.stringify(documents[0]) === JSON.stringify(documents[1])) { cleanupConverged = true; break; }
  }
  if (!cleanupConverged) throw new Error('Synthetic validation block cleanup did not converge');
  console.log('Synthetic validation blocks removed; Owner and Editor remain identical');
} catch (error) {
  failure = error;
} finally {
  await Promise.allSettled(clients.map((client) => client.disconnect()));
  await Promise.allSettled(sessions.map((token) => fetch(`${app.VITE_SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST', headers: { apikey: app.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
  })));
  await vite.close();
}
if (failure) {
  console.error(failure instanceof Error ? failure.message : 'Owner/Editor E2E failed');
  process.exitCode = 1;
}

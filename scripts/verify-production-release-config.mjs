import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isPublicSupabaseKey } from './public-build-key.mjs';

const expected = Object.freeze({
  VITE_SCENARIO_API_BASE_URL:
    'https://scenario-commercial-api-production.ore-picard.workers.dev',
  VITE_SCENARIO_ENVIRONMENT: 'production',
  VITE_SCENARIO_AUTH_MODE: 'supabase',
  VITE_SUPABASE_URL: 'https://rtqlsnwfbtnscilfdirv.supabase.co',
  VITE_SCENARIO_BILLING_RETURN_URL: 'https://senario.app/',
  VITE_SCENARIO_PUBLIC_APP_URL: 'https://senario.app/',
});

for (const [name, value] of Object.entries(expected)) {
  assert.equal(process.env[name], value, `${name} must target production`);
}

const publishableKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
assert.ok(
  isPublicSupabaseKey(publishableKey),
  'VITE_SUPABASE_ANON_KEY must be the production publishable/anon key',
);
assert.ok(
  !/(?:sb_secret_|service[_-]?role|sk_(?:live|test)_|whsec_|sk-proj-)/i.test(publishableKey),
  'A server secret was supplied to the public client build',
);

for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_')) {
    assert.doesNotMatch(
      name,
      /(?:SECRET|PRIVATE|SERVICE_ROLE|OPENAI|STRIPE|PEPPER)/i,
      `Forbidden public build variable: ${name}`,
    );
  }
}

const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(tauri.productName, 'senario');
assert.equal(tauri.identifier, 'fr.orepi.scenario');
assert.equal(tauri.bundle?.createUpdaterArtifacts, true);
assert.deepEqual(tauri.bundle?.targets, ['nsis']);
assert.ok(
  tauri.app?.security?.csp?.includes(expected.VITE_SCENARIO_API_BASE_URL),
  'Production API must be allowed by the Tauri CSP',
);
assert.ok(
  tauri.app?.security?.csp?.includes(expected.VITE_SUPABASE_URL),
  'Production Supabase must be allowed by the Tauri CSP',
);
assert.deepEqual(tauri.plugins?.updater?.endpoints, [
  'https://github.com/orestispic/scenario-app/releases/latest/download/latest.json',
]);

console.log('Production release configuration: ready.');

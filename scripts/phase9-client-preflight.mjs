import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLACEHOLDER =
  /(replace|example\.invalid|project-ref|placeholder|not-configured)/i;

function parseEnvironmentFile(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=');
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

function httpsUrl(value) {
  if (!value || PLACEHOLDER.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
      ? url
      : null;
  } catch {
    return null;
  }
}

function run() {
  const argumentIndex = process.argv.indexOf('--env-file');
  const environmentPath = resolve(
    argumentIndex >= 0
      ? (process.argv[argumentIndex + 1] ?? '.env.phase9.local')
      : '.env.phase9.local',
  );
  let environment = {};
  let environmentFound = true;
  try {
    environment = parseEnvironmentFile(readFileSync(environmentPath, 'utf8'));
  } catch {
    environmentFound = false;
  }
  const overlay = JSON.parse(
    readFileSync(resolve('src-tauri/tauri.preproduction.conf.json'), 'utf8'),
  );
  const csp = overlay?.app?.security?.csp ?? '';
  const apiUrl = httpsUrl(environment.VITE_SCENARIO_API_BASE_URL);
  const supabaseUrl = httpsUrl(environment.VITE_SUPABASE_URL);
  const checks = [
    {
      ready: environmentFound,
      action:
        'Créer .env.phase9.local à partir de .env.example, sans le committer.',
    },
    {
      ready:
        environment.VITE_SCENARIO_ENVIRONMENT === 'staging' &&
        environment.VITE_SCENARIO_AUTH_MODE === 'supabase',
      action:
        'Configurer le client en staging avec l’authentification Supabase.',
    },
    {
      ready: Boolean(apiUrl && supabaseUrl),
      action:
        'Remplacer les URL .invalid par les deux URL HTTPS de préproduction.',
    },
    {
      ready:
        /^\d+\.\d+\.\d+$/.test(
          environment.VITE_SCENARIO_CLIENT_VERSION ?? '',
        ) &&
        /^\d+\.\d+\.\d+$/.test(
          environment.VITE_SCENARIO_CLIENT_MIN_SUPPORTED_VERSION ?? '',
        ),
      action: 'Définir les versions cliente et minimale au format x.y.z.',
    },
    {
      ready:
        typeof environment.VITE_SUPABASE_ANON_KEY === 'string' &&
        environment.VITE_SUPABASE_ANON_KEY.length > 10 &&
        !PLACEHOLDER.test(environment.VITE_SUPABASE_ANON_KEY),
      action: 'Fournir uniquement la clé anon/publishable Supabase de test.',
    },
    {
      ready: !Object.keys(environment).some(
        (key) =>
          key.startsWith('VITE_') &&
          /(SERVICE_ROLE|SECRET|PRIVATE|STRIPE|OPENAI|PEPPER)/i.test(key),
      ),
      action: 'Retirer toute variable secrète préfixée VITE_.',
    },
    {
      ready:
        Boolean(apiUrl && csp.includes(apiUrl.origin)) &&
        Boolean(supabaseUrl && csp.includes(supabaseUrl.origin)) &&
        !PLACEHOLDER.test(csp),
      action:
        'Reporter les URL API et Supabase de test dans la CSP Tauri préproduction.',
    },
  ];
  const blocked = checks.filter((check) => !check.ready);
  console.log(
    blocked.length === 0
      ? 'Phase 9 client : PRÊT pour une validation externe contrôlée.'
      : `Phase 9 client : BLOQUÉ (${blocked.length} élément(s) manquant(s)).`,
  );
  for (const check of blocked) console.log(`- ${check.action}`);
  process.exitCode = blocked.length === 0 ? 0 : 2;
}

run();

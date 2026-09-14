import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createLocalRuntime } from '../../scenario-site-commercial/worker/src/localRuntime.ts';
const { chromium } = await import(pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href);
const base = 'http://127.0.0.1:1422';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const profile of ['author', 'studio']) {
    const runtime = await createLocalRuntime({ allowedOrigins: [base], telemetry: { record() {} } });
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    let limited = profile === 'studio', activations = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!/^\/v\d+\//.test(url.pathname)) return url.origin === base ? route.continue() : route.abort();
      if (url.pathname === '/v1/devices/activate') {
        activations++;
        if (limited) return route.fulfill({ status: 409, json: { code: 'device_limit_reached' } });
      }
      if (url.pathname === '/v1/devices' && limited) return route.fulfill({ json: { devices: [{ id: '00000000-0000-4000-8000-000000000001', label: 'Ancien PC', platform: 'windows', status: 'active', lastSeenAt: new Date().toISOString() }] } });
      if (url.pathname === '/v1/devices/deactivate' && limited) { limited = false; return route.fulfill({ status: 204 }); }
      const response = await runtime.worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`, { method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData() } : {}) }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base);
    await page.locator('.scenario-editor').waitFor();
    await page.getByRole('button', { name: 'Compte', exact: true }).click();
    await page.getByRole('button', { name: profile, exact: true }).click();
    const account = page.getByRole('dialog', { name: 'Compte et licence' });
    await account.getByText('Fonctionnalités de votre offre', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Activer cet appareil', exact: true }).count(), 0);
    if (limited) {
      await account.getByText(/Limite d’appareils atteinte/).waitFor();
      await account.getByRole('button', { name: 'Retirer', exact: true }).click();
    }
    await account.getByText('Actuel', { exact: true }).waitFor();
    const before = activations;
    await account.getByRole('button', { name: 'Actualiser', exact: true }).click();
    await account.getByText('Compte actualisé.', { exact: true }).waitFor();
    assert.equal(activations, before, 'Reloading account must not reactivate a revoked device or create duplicates');
    await mkdir('outputs/phase14', { recursive: true });
    await account.screenshot({ path: `outputs/phase14/account-${profile}.png` });
    await account.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await account.getByRole('heading', { name: 'Se connecter', exact: true }).waitFor();
    await account.getByRole('button', { name: 'Fermer', exact: true }).click();
    await context.setOffline(true);
    await page.locator('.scenario-editor').click();
    await page.keyboard.type('Texte de test hors connexion');
    await page.getByText('Texte de test hors connexion', { exact: true }).waitFor();
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${profile}: anonymous editor, auto activation, ${profile === 'studio' ? 'limit recovery, ' : ''}no duplicate, logout, offline writing`);
    await context.close();
  }
} finally { await browser.close(); }

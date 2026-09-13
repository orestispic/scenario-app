// Fresh profile, local assets and in-process Worker only. No real account/document.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createLocalRuntime } from '../../scenario-site-commercial/worker/src/localRuntime.ts';
const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href : 'playwright');
const base = 'http://127.0.0.1:1422';
const runtime = await createLocalRuntime({ allowedOrigins: [base], telemetry: { record() {} } });
const period = { usedTokens: 10, reservedTokens: 0, limitTokens: 1000, usedPercent: 12.34, reservedPercent: 0, costUsedPercent: 1, resetsAt: '2027-01-01T00:00:00Z' };
let budgets = { daily: { ...period }, monthly: { ...period, usedPercent: 5.67 }, blocked: false, updatedAt: new Date().toISOString() };
let unavailable = false;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/v4/ai/usage') {
      assert.equal(request.headers().authorization, 'Bearer local-test:studio');
      return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { code: 'unavailable' } : { budgets } });
    }
    if (/^\/v\d+\//.test(url.pathname)) {
      const response = await runtime.worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`, { method: request.method(), headers: request.headers(), ...(request.postData() ? { body: request.postData() } : {}) }));
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    return url.origin === base ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'studio', exact: true }).waitFor();
  assert.equal(await page.locator('.scenario-editor').count(), 0, 'No editor before authentication');
  await page.getByRole('button', { name: 'studio', exact: true }).click();
  await page.locator('.scenario-editor').waitFor();
  await page.getByRole('button', { name: 'IA', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Réglages IA' });
  await panel.waitFor();
  await panel.getByText('Budget journalier utilisé : 12,34 %', { exact: true }).waitFor();
  await panel.getByText('Budget mensuel utilisé : 5,67 %', { exact: true }).waitFor();
  // Intentionally inconsistent token/percentage fixtures ensure UI never recomputes percentages.
  budgets = { ...budgets, daily: { ...period, usedPercent: 100 }, blocked: true };
  await page.evaluate(() => window.dispatchEvent(new Event('senario:ai-usage-changed')));
  await panel.getByText('Budget journalier utilisé : 100 %', { exact: true }).waitFor();
  await panel.getByText(/Budget IA atteint/).waitFor();
  await mkdir('outputs/phase13', { recursive: true });
  await page.screenshot({ path: 'outputs/phase13/ai-budget-blocked.png' });
  unavailable = true;
  await page.evaluate(() => window.dispatchEvent(new Event('senario:ai-usage-changed')));
  await panel.getByText(/Budgets indisponibles/).waitFor();
  assert.equal(await panel.getByText(/Budget journalier utilisé/).count(), 0, 'No stale percentage during network failure');
  assert.deepEqual(errors, []);
  const storage = await page.evaluate(() => JSON.stringify(localStorage));
  assert.doesNotMatch(storage, /local-test:studio/, 'No authentication tokens in localStorage');
  console.log('PASS: auth gate, login, server percentages, refresh, quota warning, unavailable state, no token in localStorage');
} finally { await browser.close(); }

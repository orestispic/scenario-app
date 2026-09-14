// Raw-browser regression: version creation must not depend on Tauri's native IPC.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href
  : 'playwright');
const base = process.env.SCENARIO_TEST_APP_URL ?? 'http://127.0.0.1:1420';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base
    ? route.continue()
    : route.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base);

  const editor = page.locator('.scenario-editor');
  await editor.waitFor();
  await editor.locator('p').first().click();
  await page.keyboard.type('Contenu de la version 1');

  const versions = page.getByRole('combobox', { name: 'Version', exact: true });
  await versions.click();
  await page.getByRole('option', { name: 'Créer une version vierge…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Versions du projet' });
  await dialog.getByLabel('Nom de la version', { exact: true }).fill('Version navigateur');
  await dialog.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await editor.textContent(), '');

  const records = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('senario-browser-project-persistence-v1', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = await new Promise((resolve, reject) => {
      const transaction = database.transaction('files', 'readonly');
      const request = transaction.objectStore('files').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    database.close();
    return result;
  });
  assert(records.some(record => record.key === 'recovery'));
  assert(records.some(record => record.key.startsWith('backup-')));

  await page.reload();
  await page.waitForFunction(() => document.querySelector('.project-version-control button')
    ?.textContent === 'Version : Version navigateur');
  assert.equal(await page.locator('.scenario-editor').textContent(), '');
  await page.getByRole('combobox', { name: 'Version', exact: true }).click();
  await page.getByRole('option', { name: 'Version : Version 1', exact: true }).click();
  await page.getByText('Contenu de la version 1', { exact: true }).waitFor();
  assert.deepEqual(pageErrors, []);
  console.log('PASS: raw browser creates, safeguards, reloads and switches local project versions without native IPC');
  await context.close();
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const playwright = await import(pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href);
const { chromium } = playwright.default ?? playwright;
const base = process.env.SCENARIO_TEST_URL || 'http://127.0.0.1:1422';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  // Isolated persistence double: no reads/writes to the user's projects or credentials.
  await context.addInitScript(() => {
    if (!localStorage.getItem('version-test-initialized')) {
      const document = { formatVersion: 1, title: 'Test versions', savedAt: '2026-01-01T00:00:00.000Z',
        content: { type: 'doc', content: [{ type: 'paragraph', attrs: { scenarioType: 'ACTION', blockId: 'block_1' }, content: [{ type: 'text', text: 'Texte original.' }] }] },
        characters: [], locations: [], times: [], coverPage: { screenwriter: 'Alice' }, coverPageHidden: false,
        comments: [{ id: 'comment_1', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', resolvedAt: null,
          anchor: { sceneId: '', blockId: 'block_1', startOffset: 0, endOffset: 5, originalText: 'Texte', lost: false },
          messages: [{ id: 'message_1', text: 'Commentaire original', createdAt: '2026-01-01T00:00:00.000Z', editedAt: null }] }] };
      localStorage.setItem('version-test-initialized', 'yes');
      localStorage.setItem('version-test-disk', JSON.stringify(document));
      localStorage.setItem('version-test-recovery', JSON.stringify({ document, filePath: 'C:/isolated/Test versions.scenario' }));
    }
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, args) => {
        if (cmd === 'read_recovery') return localStorage.getItem('version-test-recovery');
        if (cmd === 'read_scenario') return localStorage.getItem('version-test-disk');
        if (cmd === 'write_autosave' || cmd === 'write_backup') {
          if (window.__failVersionWrite === cmd) throw new Error('Disque plein (test)');
          if (cmd === 'write_backup' && window.__delayVersionWrite) await new Promise(resolve => { window.__releaseVersionWrite = resolve; });
          localStorage.setItem(cmd === 'write_autosave' ? 'version-test-recovery' : 'version-test-backup', args.contents); return;
        }
        if (cmd === 'write_scenario') { localStorage.setItem('version-test-disk', args.contents); return; }
        if (cmd === 'read_recent_scenarios' || cmd === 'record_recent_scenario') return [];
        if (cmd === 'plugin:dialog|confirm') return true;
        if (cmd === 'plugin:dialog|message') throw new Error(args?.message ?? 'Unexpected dialog');
        if (cmd === 'plugin:event|listen' || cmd === 'plugin:event|unlisten') return 0;
        throw new Error(`Unavailable in isolated test: ${cmd}`);
      },
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  const editor = page.locator('.scenario-editor');
  await editor.getByText('Texte original.', { exact: true }).waitFor();
  const chooser = page.getByRole('combobox', { name: 'Version', exact: true });
  async function choose(name) {
    await chooser.click();
    await page.getByRole('option', { name, exact: true }).click();
  }
  async function create(action, generatedName) {
    await page.getByRole('button', { name: 'Créer une version', exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
    await page.waitForFunction(name => document.querySelector('.project-version-control [role=combobox]')?.textContent === `Version : ${name}`, generatedName);
  }
  async function rename(currentName, nextName) {
    await chooser.click();
    await page.getByRole('option', { name: currentName, exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Renommer', exact: true }).click();
    await page.getByLabel(`Nouveau nom de ${currentName}`, { exact: true }).fill(nextName);
    await page.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click();
  }
  await create('Dupliquer la version actuelle', 'Version 2');
  await rename('Version 2', 'Variante');
  await page.waitForFunction(() => document.querySelector('.project-version-control [role=combobox]')?.textContent === 'Version : Variante');
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Fin alternative.');
  await choose('Version 1');
  await page.waitForFunction(() => document.querySelector('.scenario-editor')?.textContent === 'Texte original.');
  await editor.click(); await page.keyboard.press('Control+z');
  assert.equal(await editor.textContent(), 'Texte original.', 'Undo cannot pull content from the other version');
  await choose('Variante');
  await editor.getByText('Texte original. Fin alternative.', { exact: true }).waitFor();
  await create('Nouvelle version vierge', 'Version 2');
  await rename('Version 2', 'Vide');
  assert.equal(await editor.textContent(), '');
  assert.equal(await page.locator('.margin-note').count(), 0);
  await page.reload(); await chooser.waitFor();
  await page.waitForFunction(() => document.querySelector('.project-version-control [role=combobox]')?.textContent === 'Version : Vide');
  assert.equal(await editor.textContent(), '', 'Newer recovery wins over older disk file');
  await choose('Variante');
  await editor.getByText('Texte original. Fin alternative.', { exact: true }).waitFor();
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Temporaire.');
  // A context action on an inactive row must target that exact version and leave
  // the current editor and its undo history untouched.
  await chooser.click();
  await page.getByRole('option', { name: 'Vide', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Supprimer', exact: true }).click();
  await page.getByRole('alert').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.project-version-control [role=combobox]')?.textContent === 'Version : Variante');
  assert.equal(await editor.textContent(), 'Texte original. Fin alternative. Temporaire.');
  await editor.click(); await page.keyboard.press('Control+z');
  await editor.getByText('Texte original. Fin alternative.', { exact: true }).waitFor();
  await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' Encore.');
  await page.waitForFunction(() => localStorage.getItem('version-test-recovery')?.includes('Encore.'));
  await page.reload();
  await editor.getByText('Texte original. Fin alternative. Encore.', { exact: true }).waitFor();
  // Failed writes must not switch or lose outgoing edits; retry must work.
  for (const command of ['write_backup', 'write_autosave']) {
    await page.evaluate(command => { window.__failVersionWrite = command; }, command);
    await choose('Version 1');
    await page.getByRole('alert').getByText('Disque plein (test)', { exact: true }).waitFor();
    assert.equal(await editor.textContent(), 'Texte original. Fin alternative. Encore.');
    assert.match(await chooser.textContent(), /Variante/);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Fermer', exact: true }).click();
    await page.evaluate(() => { window.__failVersionWrite = ''; });
  }
  // Double switching, editing and keyboard shortcuts are blocked during persistence.
  await page.evaluate(() => { window.__delayVersionWrite = true; });
  await choose('Version 1');
  await page.waitForFunction(() => Boolean(window.__releaseVersionWrite));
  assert.equal(await chooser.isDisabled(), true);
  assert.equal(await editor.getAttribute('contenteditable'), 'false');
  await page.keyboard.press('Control+n');
  await page.evaluate(() => { window.__delayVersionWrite = false; window.__releaseVersionWrite(); });
  await editor.getByText('Texte original.', { exact: true }).waitFor();
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('version-test-disk')).formatVersion === 2);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('version-test-disk')));
  assert.equal(saved.versions.length, 2);
  assert.equal(saved.versions[1].document.content.content[0].content.filter(n => n.type === 'text').map(n => n.text).join(''), 'Texte original. Fin alternative. Encore.');
  assert.equal(saved.versions[0].document.coverPage.screenwriter, 'Alice');
  assert.equal(saved.versions[0].document.comments[0].messages[0].text, 'Commentaire original');
  await mkdir('outputs/project-versions', { recursive: true });
  await chooser.click(); await page.waitForTimeout(180); await page.screenshot({ path: 'outputs/project-versions/editor.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: compact creation menu, inline rename, targeted permanent delete, independent edits, switch, undo isolation, autosave, reload, I/O failures and transaction lock');
  await context.close();
} finally { await browser.close(); }

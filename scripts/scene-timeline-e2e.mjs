// Isolated browser regression for the live scene timeline. No user file/account is touched.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href
  : 'playwright');
const base = process.env.SCENARIO_TEST_APP_URL ?? 'http://127.0.0.1:1420';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
await mkdir('outputs/scene-timeline', { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const paragraph = (scenarioType, blockId, text) => ({
      type: 'paragraph', attrs: { scenarioType, blockId },
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    });
    const content = [];
    for (const [id, title, action] of [
      ['scene-a', 'INT. ATELIER - JOUR', 'Action A'],
      ['scene-b', 'EXT. RUE - NUIT', 'Action B'],
      ['scene-c', 'INT. CUISINE - SOIR', 'Action C'],
    ]) {
      content.push(paragraph('SCENE_HEADING', id, title));
      for (let index = 0; index < 34; index += 1) {
        content.push(paragraph('ACTION', `${id}-action-${index}`, `${action} ${index + 1}. Une ligne complète pour vérifier le défilement de la timeline.`));
      }
    }
    const now = new Date().toISOString();
    const document = {
      formatVersion: 1,
      title: 'Timeline test',
      savedAt: now,
      content: { type: 'doc', content },
      characters: [], locations: [], times: [],
      coverPage: {}, coverPageHidden: false,
      comments: [{
        id: 'comment-b', status: 'open', createdAt: now, resolvedAt: null,
        anchor: { sceneId: 'scene-b', blockId: 'scene-b-action-0', startOffset: 0, endOffset: 6, originalText: 'Action', lost: false },
        messages: [{ id: 'message-b', text: 'Commentaire de B', createdAt: now, editedAt: null }],
      }],
    };
    localStorage.setItem('timeline-test-recovery', JSON.stringify({ document, filePath: null }));
    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (command, args) => {
        if (command === 'read_recovery') return localStorage.getItem('timeline-test-recovery');
        if (command === 'write_autosave') { localStorage.setItem('timeline-test-recovery', args.contents); return; }
        if (command === 'write_backup' || command === 'clear_recovery') return;
        if (command === 'read_recent_scenarios' || command === 'record_recent_scenario') return [];
        if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 0;
        if (command === 'launched_scenario_path') return null;
        throw new Error(`Unavailable in timeline test: ${command}`);
      },
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto(base);
  const timeline = page.getByRole('complementary', { name: 'Timeline des scènes' });
  await timeline.waitFor();

  const sceneIds = async () => timeline.locator('li[data-scene-id]').evaluateAll(items => items.map(item => item.dataset.sceneId));
  assert.deepEqual(await sceneIds(), ['scene-a', 'scene-b', 'scene-c']);
  assert.deepEqual(await timeline.locator('.scene-timeline-jump strong').allTextContents(), [
    'INT. ATELIER - JOUR', 'EXT. RUE - NUIT', 'INT. CUISINE - SOIR',
  ]);

  // Editing the actual heading immediately changes the derived timeline title.
  const headingA = page.locator('p[data-block-id="scene-a"]');
  await headingA.selectText();
  await page.keyboard.type('INT. LABORATOIRE - NUIT');
  await timeline.getByText('INT. LABORATOIRE - NUIT', { exact: true }).waitFor();

  // Clicking a distant scene scrolls the shared document and marks it current.
  const workspace = page.locator('.workspace');
  const beforeScroll = await workspace.evaluate(element => element.scrollTop);
  await timeline.locator('li[data-scene-id="scene-c"] .scene-timeline-jump').click();
  await page.waitForFunction(previous => document.querySelector('.workspace').scrollTop > previous, beforeScroll);
  assert.equal(await timeline.locator('li[data-scene-id="scene-c"]').getAttribute('class').then(value => value?.includes('is-active')), true);

  // Native DnD shows the exact insertion line, then moves the full scene block.
  const source = timeline.locator('li[data-scene-id="scene-c"]');
  const target = timeline.locator('li[data-scene-id="scene-a"]');
  const targetBox = await target.boundingBox();
  assert(targetBox);
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await source.dispatchEvent('dragstart', { dataTransfer: transfer });
  await target.dispatchEvent('dragover', { dataTransfer: transfer, clientX: targetBox.x + 20, clientY: targetBox.y + 1 });
  await target.waitFor({ state: 'visible' });
  assert.match(await target.getAttribute('class'), /is-drop-before/);
  await page.screenshot({ path: 'outputs/scene-timeline/drop-indicator.png' });
  await target.dispatchEvent('drop', { dataTransfer: transfer, clientX: targetBox.x + 20, clientY: targetBox.y + 1 });
  await page.waitForFunction(() => document.querySelector('.scene-timeline li[data-scene-id]')?.dataset.sceneId === 'scene-c');
  assert.deepEqual(await sceneIds(), ['scene-c', 'scene-a', 'scene-b']);
  const editorOrder = await page.locator('.scenario-editor > p').evaluateAll(paragraphs =>
    paragraphs.map(paragraph => paragraph.getAttribute('data-block-id')),
  );
  assert(editorOrder.indexOf('scene-c') < editorOrder.indexOf('scene-a'));
  assert(editorOrder.indexOf('scene-c-action-33') < editorOrder.indexOf('scene-a'));

  // Direct deletion removes the entire scene and its anchored comment.
  await timeline.locator('li[data-scene-id="scene-b"] .scene-timeline-delete').click();
  await page.waitForFunction(() => !document.querySelector('.scene-timeline li[data-scene-id="scene-b"]'));
  assert.deepEqual(await sceneIds(), ['scene-c', 'scene-a']);
  assert.equal(await page.locator('p[data-block-id="scene-b"], p[data-block-id^="scene-b-action-"]').count(), 0);
  assert.equal(await page.locator('.margin-note').count(), 0);

  // A scene created in the editor appears without a separate timeline write.
  const lastParagraph = page.locator('.scenario-editor > p').last();
  await lastParagraph.click();
  await page.keyboard.press('Control+1');
  await page.keyboard.type('EXT. TOIT - AUBE');
  await timeline.getByText('EXT. TOIT - AUBE', { exact: true }).waitFor();
  assert.equal((await sceneIds()).length, 3);
  await page.screenshot({ path: 'outputs/scene-timeline/final.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: scene timeline projection, title sync, navigation, drop indicator, full-block reorder, deletion and editor-created scene');
  await context.close();
} finally {
  await browser.close();
}

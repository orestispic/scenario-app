// Ephemeral browser profile; never attaches to the user's existing tabs.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href : 'playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const zoom of [60, 100, 160]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await context.addInitScript((value) => localStorage.setItem('scenario-zoom', String(value)), zoom);
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:1420/');
    await page.locator('.scenario-editor').waitFor();
    const canvas = await page.locator('.document-canvas').first().boundingBox();
    assert(canvas);
    const x = Math.max(40, canvas.x + 80);
    const y = Math.max(180, canvas.y + 100);
    await page.mouse.click(x, y, { button: 'right' });
    const menu = page.locator('.scenario-context-menu');
    await menu.waitFor();
    const box = await menu.boundingBox();
    assert(box && Math.abs(box.x - x) <= 2 && Math.abs(box.y - y) <= 2, `Context menu anchor mismatch at ${zoom}%`);
    // Exercise caret-attached SmartType, not just pointer coordinates.
    await page.keyboard.press('Escape');
    await page.locator('.scenario-editor p').first().click();
    await page.keyboard.type('I');
    const smart = page.locator('.smart-type');
    await smart.waitFor({ timeout: 5_000 });
    const smartBox = await smart.boundingBox();
    const caret = await page.evaluate(() => {
      const selection = window.getSelection();
      if (!selection?.rangeCount) return null;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      return { left: rect.left, bottom: rect.bottom };
    });
    assert(smartBox && caret && Math.abs(smartBox.x - caret.left) < 3 && Math.abs(smartBox.y - caret.bottom - 6) < 3, `SmartType anchor mismatch at ${zoom}%`);
    console.log(`Browser context menu and SmartType anchors passed at ${zoom}%`);
    await context.close();
  }
} finally { await browser.close(); }

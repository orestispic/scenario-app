// Isolated browser, local assets only. No hosted session, email or payment.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH
  ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href : 'playwright');
const base = process.env.SCENARIO_TEST_APP_URL ?? 'http://127.0.0.1:1420';
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
await mkdir('outputs/ui-charter', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
  for (const width of [1440, 900, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    // A previously saved light preference must not restore the retired skin.
    await context.addInitScript(() => localStorage.setItem('scenario-theme', 'light'));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('.scenario-editor').waitFor();
    await page.getByRole('button', { name: 'Zoom 100 %, rétablir la taille réelle' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.app-shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(9, 11, 14)');
    assert.equal(await page.locator('.page-sheet').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(15, 20, 26)');
    assert.match(await page.locator('.scenario-editor').evaluate(el => getComputedStyle(el).fontFamily), /Courier Prime/);
    assert(await page.evaluate(() => document.fonts.check('14px Inter') && document.fonts.check('16px "Courier Prime"')));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('button', { name: 'Projets cloud', exact: true }).count(), 0);
    for (const button of await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('button').all()) {
      const box = await button.boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= width + 1, 'Main navigation remains reachable');
    }
    const editor = page.locator('.scenario-editor');
    await editor.locator('p').first().click();
    await page.keyboard.type('INT. ATELIER - JOUR');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Une feuille attend sur la table. Camille ouvre la fenêtre.');
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `outputs/ui-charter/editor-${width}.png` });

    const coverButton = page.getByRole('button', { name: 'Page de garde', exact: true });
    await coverButton.click();
    const cover = page.locator('.cover-menu');
    await cover.waitFor();
    const [box, coverButtonBox] = await Promise.all([cover.boundingBox(), coverButton.boundingBox()]);
    assert(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 960, 'Cover menu fits screen');
    if (width >= 800) assert(box && coverButtonBox && Math.abs(box.x - coverButtonBox.x) < 2, 'Cover menu starts at the left edge of its button');
    assert.equal(await cover.getByRole('button', { name: 'Appliquer', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(70, 153, 243)');
    await page.screenshot({ path: `outputs/ui-charter/cover-menu-${width}.png` });
    await cover.getByLabel('Scénariste', { exact: true }).fill('Camille');
    await cover.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await page.screenshot({ path: `outputs/ui-charter/cover-${width}.png` });

    assert.equal(await page.getByRole('button', { name: /^Commentaires \(/ }).count(), 0);
    assert.equal(await page.getByRole('dialog', { name: 'Commentaires du projet' }).count(), 0);

    await page.getByRole('button', { name: 'Compte', exact: true }).click();
    const account = page.locator('.account-license-panel');
    await account.waitFor();
    assert.equal(await account.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(21, 28, 36)');
    await account.getByRole('heading', { name: 'Se connecter', exact: true }).waitFor();
    await account.getByRole('button', { name: 'Créer un compte', exact: true }).waitFor();
    const input = account.getByLabel('Adresse e-mail');
    await input.focus();
    assert.equal(await input.evaluate(el => getComputedStyle(el).outlineColor), 'rgb(110, 179, 255)');
    await page.screenshot({ path: `outputs/ui-charter/account-${width}.png` });
    await account.getByRole('button', { name: 'Fermer', exact: true }).click();

    if (width === 1440) {
      const action=editor.locator('p[data-scenario-type="ACTION"]').last();await action.hover();
      const highlight=page.locator('.ai-paragraph-highlight');await highlight.waitFor();
      const [highlightBox,sheetBox]=await Promise.all([highlight.boundingBox(),page.locator('.page-sheet').first().boundingBox()]);
      assert(highlightBox&&sheetBox&&Math.abs(highlightBox.x-sheetBox.x)<2&&Math.abs(highlightBox.width-sheetBox.width)<2,'AI hover highlight spans the complete sheet width');
      const aiButton=page.getByRole('button',{name:'Actions IA'});assert.equal((await aiButton.textContent()).trim(),'');assert.equal(await aiButton.locator('svg use').count(),1,'AI action uses the supplied sparkle icon');
      await page.getByRole('button',{name:'Ajouter une transition'}).click();
      await page.locator('.transition-popover').waitFor();
      await aiButton.click();
      const aiMenu=page.locator('.ai-popover');await aiMenu.waitFor();
      assert.equal(await page.locator('.transition-popover').count(),0,'AI replaces an open Transition menu in one click');
      const [aiButtonBox,aiMenuBox]=await Promise.all([aiButton.boundingBox(),aiMenu.boundingBox()]);
      assert(aiButtonBox&&aiMenuBox&&Math.abs(aiMenuBox.x-aiButtonBox.x)<2&&Math.abs(aiMenuBox.y-aiButtonBox.y-aiButtonBox.height)<=3,'AI menu opens directly below its button');
      await aiButton.click();
      for (const [name, label] of [['Rechercher', 'Rechercher et remplacer'], ['Raccourcis', 'Raccourcis de texte'], ['IA', 'Réglages IA'], ['Aide', 'Aide']]) {
        await page.getByRole('navigation', { name: 'Menu principal' }).getByRole('button', { name, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: label, exact: true });
        await dialog.waitFor();
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(21, 28, 36)');
        if(name==='Raccourcis') {
          const toggle=dialog.getByRole('button',{name:'Activer les raccourcis'});
          assert.equal((await toggle.innerText()).trim(),'Activer');
          const initial=await toggle.getAttribute('aria-pressed');await toggle.click();
          assert.notEqual(await toggle.getAttribute('aria-pressed'),initial);assert.equal((await toggle.innerText()).trim(),'Activer');
        }
        if(name==='IA') {
          assert.equal(await dialog.getByRole('button',{name:'Réponse uniquement'}).first().getAttribute('aria-pressed'),'true');
          const field=dialog.getByRole('textbox',{name:'Instruction du prompt'});
          await field.fill('Première ligne.\nDeuxième ligne.');
          assert.equal(await field.inputValue(),'Première ligne.\nDeuxième ligne.');
          assert((await field.boundingBox()).height>=96);
        }
        await page.screenshot({ path: `outputs/ui-charter/panel-${name}.png` });
        await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
      }
      // Real browser pagination with the new font: long content is preserved.
      const types=page.getByRole('combobox',{name:'Type de paragraphe'});
      await types.focus();await page.keyboard.press('Enter');await page.keyboard.press('End');await page.keyboard.press('Enter');
      assert.equal(await editor.locator('p').last().getAttribute('data-scenario-type'),'TRANSITION');
      await types.focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');
      assert.equal(await types.getAttribute('aria-expanded'),'false');
      await editor.locator('p').last().click();
      await page.keyboard.press('End');
      const longText = ' Un paragraphe long reste entier lorsque la page change.'.repeat(180);
      await page.keyboard.insertText(longText);
      await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 3);
      const documentText = await editor.evaluate(el => {
        const copy = el.cloneNode(true);
        // Pagination decorations are not document content.
        copy.querySelectorAll('.page-continuation').forEach(widget => widget.remove());
        return copy.textContent;
      });
      assert(documentText.includes(longText));
    }

    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('.page-sheet').first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
    assert.equal(await editor.evaluate(el => getComputedStyle(el).color), 'rgb(17, 17, 17)');
    assert.equal(await page.locator('.formatting-toolbar').evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('.cover-page').evaluate(el => getComputedStyle(el).color), 'rgb(17, 17, 17)');
    console.log(`PASS: charter, legacy preference, fonts, navigation, cover, comments, account, print at ${width}px`);
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }

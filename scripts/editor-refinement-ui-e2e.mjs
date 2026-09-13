// Isolated profiles, local assets only: no real account or network mutation.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href : 'playwright');
const base = process.env.SCENARIO_TEST_APP_URL ?? 'http://127.0.0.1:1420';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
await mkdir('outputs/editor-refinement', {recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const errors=[];
let currentPage;
async function paragraphType(page,value){
  const label={ACTION:'Action',SCENE_HEADING:'Titre de scène',CHARACTER:'Personnage',DIALOGUE:'Dialogue',PARENTHETICAL:'Parenthèse',TRANSITION:'Transition'}[value];
  await page.getByRole('combobox',{name:'Type de paragraphe'}).click();
  await page.getByRole('option',{name:label,exact:true}).click();
}
try {
  for (const zoom of [60,100,160]) {
    const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
    await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    await context.addInitScript(value=>localStorage.setItem('scenario-zoom',String(value)),zoom);
    const page=await context.newPage();currentPage=page;page.on('pageerror',error=>{if(!errors.length)console.error(error.stack);errors.push(error.message);});page.on('dialog',dialog=>dialog.accept());
    await page.goto(base);const paragraph=page.locator('.scenario-editor p').first();await paragraph.waitFor();
    assert.notEqual(await paragraph.getAttribute('data-placeholder'),'INT. LIEU - JOUR');
    await paragraph.click();await page.keyboard.type('I');await page.locator('.smart-type').waitFor();
    const suggestions=page.locator('.smart-type button');
    const selected=await page.locator('.smart-type button.is-selected').evaluate(el=>getComputedStyle(el).backgroundColor);
    await suggestions.last().hover();await page.waitForFunction(color=>getComputedStyle(document.querySelector('.smart-type button:last-child')).backgroundColor===color,selected);
    await page.keyboard.press('Escape');await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
    await paragraphType(page,'ACTION');
    await page.keyboard.type('Tu as une feuille devant toi.');
    assert.equal(await paragraph.textContent(),'Tu as une feuille devant toi.');
    await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.getByRole('button',{name:'Mettre en italique',exact:true}).click();
    assert.equal(await paragraph.locator('em').textContent(),'Tu as une feuille devant toi.');
    for(const type of ['SCENE_HEADING','CHARACTER','DIALOGUE','PARENTHETICAL','TRANSITION','ACTION']) {
      await paragraphType(page,type);
      assert.equal(await paragraph.textContent(),'Tu as une feuille devant toi.');
      assert.equal(await paragraph.locator('em').textContent(),'Tu as une feuille devant toi.');
      assert.equal(await paragraph.getAttribute('data-scenario-type'),type);
    }
    for (let i=0;i<3;i++) {
      await page.locator('.scenario-editor').focus();await page.keyboard.press('Control+Home');await page.keyboard.press('Shift+End');
      await page.getByRole('button',{name:'Ajouter un commentaire',exact:true}).click();
      await page.getByPlaceholder('Écrire un commentaire…').fill(i===0 ? 'Note 1 : vérifier ce passage en entier.\nLa deuxième ligne doit rester cachée au repos puis apparaître une fois le commentaire ouvert.' : `Note ${i+1} : vérifier ce passage.`);
      await page.getByRole('button',{name:'Commenter',exact:true}).click();
    }
    await page.waitForFunction(()=>document.querySelectorAll('.margin-note').length===3);
    const card=page.locator('.margin-note').first();const hit=card.locator('.margin-note-hitbox');
    const collapsed=await hit.locator('span').evaluate(el=>({whiteSpace:getComputedStyle(el).whiteSpace,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
    assert.equal(collapsed.whiteSpace,'nowrap');assert(collapsed.scrollHeight<=collapsed.clientHeight+1,'inactive comment stays on one line');
    assert((await card.boundingBox()).height<=36,'inactive comment has no unused vertical space');
    assert.match(await card.evaluate(el=>getComputedStyle(el).borderColor),/253, 198, 69/,'comment styling is always amber');
    const idleColor=await card.evaluate(el=>getComputedStyle(el).backgroundColor);await hit.hover();
    assert.notEqual(await card.evaluate(el=>getComputedStyle(el).backgroundColor),idleColor,'hover strengthens the amber card');
    assert.equal(await hit.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','comment hover never falls back to the generic blue button state');
    assert(await page.locator('.scenario-comment-anchor').first().evaluate(el=>el.classList.contains('is-hovered')),'hovering the card strengthens its text anchor');
    await paragraph.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' SUITE NON COMMENTÉE');
    assert.equal(await page.locator('.scenario-comment-anchor').evaluateAll(nodes=>nodes.some(node=>node.textContent?.includes('SUITE NON COMMENTÉE'))),false,'typing after a comment never extends its highlight');
    await page.keyboard.press('Control+z');
    await hit.scrollIntoViewIfNeeded();const hitbox=await hit.boundingBox();await page.mouse.click(hitbox.x+hitbox.width-5,hitbox.y+hitbox.height-5);
    await card.getByRole('button',{name:'Modifier',exact:true}).waitFor();
    const expanded=await hit.locator('span').evaluate(el=>({whiteSpace:getComputedStyle(el).whiteSpace,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,text:el.textContent}));
    assert.equal(expanded.whiteSpace,'pre-wrap');assert(expanded.scrollHeight<=expanded.clientHeight+1,'active comment shows its complete text');assert.match(expanded.text,/deuxième ligne/);
    await hit.click();await card.getByRole('button',{name:'Modifier',exact:true}).waitFor({state:'hidden'});assert.equal(await hit.getAttribute('aria-expanded'),'false');
    await hit.click();await card.getByRole('button',{name:'Modifier',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.getSelection()?.toString()),'');
    assert.equal(await page.getByRole('dialog',{name:'Commentaires du projet'}).count(),0);
    assert.match(await page.locator('.scenario-comment-anchor').first().evaluate(el=>getComputedStyle(el).backgroundColor),/253, 198, 69/);
    await card.getByRole('button',{name:'Modifier',exact:true}).click();
    assert.equal(await card.locator('.margin-note-hitbox').count(),0,'editing replaces the old text instead of duplicating it');
    const editField=card.getByLabel('Modifier le commentaire');
    const [editBox,cardBox]=await Promise.all([editField.boundingBox(),card.boundingBox()]);assert(editBox.y-cardBox.y<=11,'editing field starts at the top of the card');
    assert.equal(await editField.evaluate(el=>getComputedStyle(el).outlineColor),'rgb(253, 198, 69)','comment editing focus stays amber');
    await editField.fill('Une note modifiée sur place.');
    await page.waitForFunction(()=>{
      const cards=[...document.querySelectorAll('.margin-note')].map(el=>el.getBoundingClientRect()).sort((a,b)=>a.top-b.top);
      const sheet=document.querySelector('.page-sheet').getBoundingClientRect();
      return cards.every((r,i)=>r.right<=sheet.left-20 && (!i||r.top>=cards[i-1].bottom+7));
    });
    await page.screenshot({path:`outputs/editor-refinement/comments-${zoom}.png`});
    await page.mouse.click(1400,800);
    await card.getByText('Une note modifiée sur place.',{exact:true}).waitFor();assert.equal(await card.evaluate(el=>el.classList.contains('is-active')),false);assert.equal(await editField.count(),0);
    await card.locator('.margin-note-hitbox').click();await card.getByRole('button',{name:'Supprimer',exact:true}).waitFor();
    await card.getByRole('button',{name:'Supprimer',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.margin-note').length===2);
    const stats=page.locator('.editor-statistics');assert.match(await stats.textContent(),/6 mots.*Temps estimé.*pages.*0 scènes.*0 décors/);
    const before=await stats.boundingBox();await page.locator('.workspace').evaluate(el=>el.scrollTop=el.scrollHeight);assert.deepEqual(await stats.boundingBox(),before);
    await paragraph.click();await page.keyboard.press('End');await page.keyboard.press('Enter');
    await paragraphType(page,'SCENE_HEADING');await page.keyboard.insertText('INT. ATELIER - JOUR');await page.keyboard.press('Enter');
    await paragraphType(page,'SCENE_HEADING');await page.keyboard.insertText('INT. ATELIER - NUIT');
    await page.waitForFunction(()=>/2 scènes.*1 décors/.test(document.querySelector('.editor-statistics').textContent));
    console.log(`PASS: shortcuts, paragraph types/marks, italic, hover, inline notes/hitbox/yellow/non-overlap, fixed stats at ${zoom}%`);
    await context.close();
  }
  assert.deepEqual(errors,[]);
} catch(error) {if(currentPage&&!currentPage.isClosed()){await currentPage.screenshot({path:'outputs/editor-refinement/failure.png'});console.log(await currentPage.evaluate(()=>({selection:getSelection()?.toString(),active:document.activeElement?.outerHTML.slice(0,300)})));}throw error;} finally {await browser.close();}

// Isolated browser context + in-process Worker. No hosted requests or user tabs.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createLocalRuntime } from '../../scenario-site-commercial/worker/src/localRuntime.ts';
const { chromium } = await import(process.env.SCENARIO_PLAYWRIGHT_PATH ? pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href : 'playwright');
const runtime = await createLocalRuntime({telemetry: {record() {}}});
const browser = await chromium.launch({channel: 'msedge', headless: true});
const base = process.env.SCENARIO_TEST_APP_URL ?? 'http://127.0.0.1:1420';
const profileId = '10000000-0000-4000-8000-000000000003';
let testPage;
try {
  const context = await browser.newContext({viewport: {width:1280,height:900}});
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === 'storage.invalid') {
      const encoded = url.pathname.split('/').pop().split('.')[0];
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
      const bytes = await runtime.scenarioStorage.resolveTemporaryDownload(url.toString(), profileId, payload.s);
      return route.fulfill({status: 200, contentType:'application/vnd.scenario+json', body: Buffer.from(bytes)});
    }
    if (/^\/v[1-9]\//.test(url.pathname)) {
      const response = await runtime.worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`, {method:request.method(), headers:request.headers(), ...(request.postData() ? {body:request.postData()} : {})}));
      if (response.status >= 400) console.log(`Isolated API rejected ${url.pathname}: ${response.status}`);
      return route.fulfill({status:response.status, headers:Object.fromEntries(response.headers), body:Buffer.from(await response.arrayBuffer())});
    }
    if (url.origin === base) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  testPage = page;
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base); await page.locator('.scenario-editor').waitFor();
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map((e) => e.name);
    const runtimeUrl = resources.find((url) => /\/src\/commercial\/runtime\.ts(?:\?|$)/.test(url));
    const cloudUrl = resources.find((url) => /\/src\/commercial\/cloudProjectRuntime\.ts(?:\?|$)/.test(url));
    const {sessions, createRuntimeCommercialApi, getDeviceFingerprint, getClientPlatform, authenticatedOperations} = await import(runtimeUrl);
    window.__phase10Cloud = (await import(cloudUrl)).cloudProjectRuntime;
    authenticatedOperations.reset();
    await sessions.accept({ accessToken:'local-test:studio', refreshToken:'isolated-ui-test-refresh', expiresAt:new Date(Date.now()+3600000).toISOString() });
    await createRuntimeCommercialApi().activateDevice({fingerprint:getDeviceFingerprint(), platform:getClientPlatform(), label:'Isolated UI test'});
  });
  await page.getByRole('button', {name:'Projets cloud', exact:true}).click();
  const dialog = page.getByRole('dialog', {name:'Projets cloud'});
  await dialog.getByRole('button', {name:'+ Nouveau projet'}).click();
  await dialog.getByLabel('Nom du projet').fill('Projet privé synthétique');
  await dialog.getByRole('button', {name:'Créer dans le cloud'}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('.scenario-editor p').first().click();
  await page.keyboard.type('Texte local de validation');
  await page.waitForFunction(async () => { const cloudProjectRuntime=window.__phase10Cloud; await cloudProjectRuntime.flush(); let state; const stop=cloudProjectRuntime.subscribe(v=>{state=v;}); stop(); return state.status==='synced'; });
  const privateId = await page.evaluate(() => { const cloudProjectRuntime=window.__phase10Cloud; let state; const stop=cloudProjectRuntime.subscribe(v=>{state=v;}); stop(); return state.project.id; });
  assert.equal(runtime.studioRepository.projectSharing(privateId, profileId).studioId, null);
  await page.getByRole('button', {name:'Projets cloud',exact:true}).click();
  await dialog.getByRole('button', {name:/Projet privé synthétique.*Privé/}).click();
  await dialog.getByRole('button', {name:'Gérer le partage'}).click();
  await dialog.getByLabel('Inviter par adresse e-mail').fill('author@example.invalid');
  await dialog.getByRole('button', {name:'Créer l’invitation'}).click();
  await dialog.getByText('Invitation disponible dans les Projets cloud du destinataire.').waitFor();
  await dialog.getByRole('button', {name:'Ouvrir le projet',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByRole('button', {name:/Projet privé synthétique.*présent/}).waitFor();
  assert.match(await page.locator('.scenario-editor').innerText(), /Texte local de validation/i, 'sharing must retain all edits made while private');
  const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  assert.doesNotMatch(JSON.stringify(storage), /isolated-ui-test-refresh|local-test:studio|Texte local de validation/);
  await page.getByRole('button', {name:'Projets cloud',exact:true}).click();
  await page.setViewportSize({width:640,height:820});
  await dialog.waitFor();
  await page.screenshot({path:'outputs/phase10-cloud-projects.png',fullPage:true});
  const box = await dialog.boundingBox(); assert.ok(box && box.width <= 640 && box.x >= 0 && box.x + box.width <= 640, JSON.stringify(box));
  await page.evaluate(async () => { await window.__phase10Cloud.close(); });
  assert.deepEqual(errors, []);
  console.log('PASS: isolated browser private creation, autosync, project sharing, automatic realtime, responsive dialog and no sensitive localStorage.');
  await context.close();
} catch (error) {
  if (testPage) console.log(await testPage.locator('.cloud-project-panel').innerText().catch(() => 'No project dialog'));
  throw error;
} finally { await browser.close(); }

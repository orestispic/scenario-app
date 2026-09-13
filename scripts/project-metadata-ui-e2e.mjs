// Three isolated browser contexts. Every commercial request is routed to a local
// in-process Worker; external hosts are blocked. Never uses the user's tabs.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createLocalRuntime } from '../../scenario-site-commercial/worker/src/localRuntime.ts';
const {chromium}=await import(process.env.SCENARIO_PLAYWRIGHT_PATH?pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href:'playwright');
const base=process.env.SCENARIO_TEST_APP_URL??'http://127.0.0.1:1420';
assert(['127.0.0.1','localhost'].includes(new URL(base).hostname), 'Local test origin required');
const runtime=await createLocalRuntime({allowedOrigins:[base],telemetry:{record(){}}});
const browser=await chromium.launch({channel:'msedge',headless:true});
const profiles={studio:'10000000-0000-4000-8000-000000000003',author:'10000000-0000-4000-8000-000000000002',discovery:'10000000-0000-4000-8000-000000000001'};
const errors=[],pages=[];
for(const id of Object.values(profiles))runtime.repository.grantEntitlements(id,{configurationVersion:'isolated-metadata-ui',issuedAt:new Date().toISOString(),expiresAt:null,offlineValidUntil:new Date(Date.now()+86400000).toISOString(),deviceLimit:3,entitlements:['cloud_sync','scenario_versions','studio_collaboration'].map(code=>({code,enabled:true,value:null}))});
async function pageFor(profile) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==='storage.invalid'){
      const encoded=url.pathname.split('/').pop().split('.')[0],payload=JSON.parse(Buffer.from(encoded,'base64url').toString());
      const bytes=await runtime.scenarioStorage.resolveTemporaryDownload(url.toString(),profiles[profile],payload.s);
      return route.fulfill({status:200,contentType:'application/vnd.scenario+json',body:Buffer.from(bytes)});
    }
    if(/^\/v\d+\//.test(url.pathname)) {
      const res=await runtime.worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`,{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}));
      if(res.status>=400)console.log(`Isolated ${profile} ${url.pathname.replace(/[0-9a-f-]{36}/g,':id')} ${res.status}`);
      return route.fulfill({status:res.status,headers:Object.fromEntries(res.headers),body:Buffer.from(await res.arrayBuffer())});
    }
    return url.origin===base?route.continue():route.abort();
  });
  const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
  await page.goto(base);await page.locator('.scenario-editor').waitFor();
  await page.evaluate(async profile=>{
    const resources=performance.getEntriesByType('resource').map(e=>e.name),find=name=>resources.find(url=>url.includes(`/src/commercial/${name}.ts`));
    const r=await import(find('runtime')),c=await import(find('cloudProjectRuntime'));
    r.authenticatedOperations.reset();await r.sessions.accept({accessToken:`local-test:${profile}`,refreshToken:'isolated-metadata-refresh',expiresAt:new Date(Date.now()+3600000).toISOString()});
    window.__metadataApi=r.createRuntimeCommercialApi();window.__metadataCloud=c.cloudProjectRuntime;window.__metadataSyncRequest=c.cloudSyncRequest;
    await window.__metadataApi.activateDevice({fingerprint:r.getDeviceFingerprint(),platform:r.getClientPlatform(),label:'Isolated metadata UI'});
  },profile);
  return page;
}
const flush=page=>page.evaluate(()=>window.__metadataCloud.flush());
async function open(page,title) {
  await page.getByRole('button',{name:'Projets cloud',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'Projets cloud'});
  await panel.getByRole('button',{name:new RegExp(title)}).click();
  await panel.getByRole('button',{name:'Ouvrir le projet',exact:true}).click();await panel.waitFor({state:'hidden'});
  await page.waitForFunction(()=>{let state;const stop=window.__metadataCloud.subscribe(s=>{state=s;});stop();return state.status==='realtime';});
}
const comments=page=>page.locator('.comment-rail');
const openComments=async page=>{await page.getByRole('button',{name:/^Commentaires \(/}).click();await comments(page).locator('.margin-note').first().waitFor();};
try {
  const owner=await pageFor('studio'),editor=await pageFor('author'),viewer=await pageFor('discovery');
  const project=await owner.evaluate(async()=>{
    const id=crypto.randomUUID(),title='Commentaires et première page';
    const coverPage=Object.fromEntries(['projectName','screenwriter','director','production','duration','version','date','rights','contactName','contactEmail','contactPhone','contactWebsite'].map(k=>[k,k==='projectName'?'Première page initiale':'']));
    const file={formatVersion:1,title,coverPage,coverPageHidden:false,comments:[],characters:[],locations:[],times:[],savedAt:new Date().toISOString(),content:{type:'doc',content:[{type:'paragraph',attrs:{blockId:'block_shared',scenarioType:'ACTION'},content:[{type:'text',text:'Un passage partagé pour nos commentaires.'}]}]}};
    await window.__metadataApi.syncCloudScenario(await window.__metadataSyncRequest(file,id,null),crypto.randomUUID());
    const shared=await window.__metadataApi.ensureProjectSharing(id,crypto.randomUUID());const studioId=shared.studio.id;
    const invites=[];for(const [email,role] of [['author@example.invalid','editor'],['discovery@example.invalid','viewer']])invites.push((await window.__metadataApi.inviteStudioMember(studioId,email,role,crypto.randomUUID())).invitation.id);
    return {id,title,invites};
  });
  for(const [index,page] of [editor,viewer].entries())await page.evaluate(id=>window.__metadataApi.respondProjectInvitation(id,'accept',crypto.randomUUID()),project.invites[index]);
  for(const page of pages)await open(page,project.title);
  console.log('PASS: three isolated accounts opened the shared project.');
  await owner.getByRole('button',{name:'Page de garde',exact:true}).click();await editor.getByRole('button',{name:'Page de garde',exact:true}).click();
  await Promise.all([owner.locator('.cover-menu').getByLabel('Scénariste',{exact:true}).fill('Auteur partagé'),editor.locator('.cover-menu').getByLabel('Réalisateur',{exact:true}).fill('Réalisateur partagé')]);
  await Promise.all([flush(owner),flush(editor)]);await flush(owner);await flush(editor);await flush(viewer);
  assert.equal(await editor.locator('.cover-menu').getByLabel('Scénariste',{exact:true}).inputValue(),'Auteur partagé');assert.equal(await owner.locator('.cover-menu').getByLabel('Réalisateur',{exact:true}).inputValue(),'Réalisateur partagé');
  await viewer.getByRole('button',{name:'Page de garde',exact:true}).click();assert.equal(await viewer.locator('.cover-menu').getByLabel('Scénariste',{exact:true}).isDisabled(),true);
  for(const page of pages)await page.locator('.cover-menu').getByRole('button',{name:'Fermer',exact:true}).click();
  console.log('PASS: cover fields merge in both editors and are read-only for Viewer.');
  await owner.locator('.scenario-editor p').first().click();await owner.keyboard.press('Home');await owner.keyboard.press('Shift+End');
  await owner.getByRole('button',{name:'Ajouter un commentaire',exact:true}).click();await owner.getByPlaceholder('Écrire un commentaire…').fill('Commentaire partagé initial');await owner.getByRole('button',{name:'Commenter',exact:true}).click();
  await flush(owner);await flush(editor);await flush(viewer);
  for(const page of pages){await openComments(page);await comments(page).getByText('Commentaire partagé initial',{exact:false}).waitFor();}
  assert.equal(await comments(viewer).getByRole('button',{name:'Modifier',exact:true}).count(),0);
  assert.equal(await viewer.getByRole('combobox',{name:'Type de paragraphe'}).isDisabled(),true);
  await comments(editor).getByRole('button',{name:'Modifier',exact:true}).click();await comments(editor).getByLabel('Modifier le commentaire').fill('Brouillon local');
  await comments(owner).getByRole('button',{name:'Modifier',exact:true}).click();await comments(owner).getByLabel('Modifier le commentaire').fill('Commentaire corrigé');await comments(owner).getByRole('button',{name:'Enregistrer',exact:true}).click();await flush(owner);await flush(editor);
  await comments(editor).getByRole('alert').waitFor();
  assert.equal(await comments(editor).getByLabel('Modifier le commentaire').inputValue(),'Brouillon local');
  assert.equal(await comments(editor).getByRole('button',{name:'Enregistrer',exact:true}).isDisabled(),true);
  await comments(editor).getByRole('button',{name:'Annuler',exact:true}).click();
  await comments(editor).getByText('Commentaire corrigé',{exact:false}).waitFor();
  console.log('PASS: inline editing converges, concurrent draft preserved and stale overwrite blocked.');
  await owner.screenshot({path:'outputs/ui-charter-shared-comments.png',fullPage:true});
  // Delete the anchor's text: the discussion must remain available, not vanish.
  await editor.locator('.scenario-editor p').first().click();await editor.keyboard.press('Home');await editor.keyboard.press('Shift+End');await editor.keyboard.press('Backspace');
  await owner.waitForFunction(()=>!document.querySelector('.scenario-editor').textContent.includes('Un passage partagé'));
  for(const page of [owner,editor]){await openComments(page);await comments(page).getByText(/Passage introuvable/).waitFor();}
  await comments(owner).getByRole('button',{name:'Supprimer',exact:true}).click();await flush(owner);await flush(editor);assert.equal(await comments(editor).locator('article').count(),0);
  for(const page of pages) {
    const stored=await page.evaluate(()=>JSON.stringify(Object.fromEntries(Object.entries(localStorage))));assert.doesNotMatch(stored,/Commentaire|Réponse partagée|Auteur partagé|local-test:|isolated-metadata-refresh/);
  }
  await owner.screenshot({path:'outputs/project-metadata-comments.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: lost anchors remain recoverable, deletion converges, no content/tokens in localStorage, no browser errors.');
} finally {
  for(const page of pages)await page.evaluate(()=>window.__metadataCloud?.close()).catch(()=>{});
  await browser.close();
}

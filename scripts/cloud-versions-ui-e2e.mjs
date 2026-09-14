import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createLocalRuntime } from '../../scenario-site-commercial/worker/src/localRuntime.ts';
const {chromium}=await import(pathToFileURL(process.env.SCENARIO_PLAYWRIGHT_PATH).href);
const base='http://127.0.0.1:1422',runtime=await createLocalRuntime({allowedOrigins:[base],telemetry:{record(){}}});
const browser=await chromium.launch({channel:'msedge',headless:true});
const branches=[],documents=new Map();let root,diagnosticPage;
try {
 const context=await browser.newContext({viewport:{width:1440,height:950}});
 // v14 UI fixture, separate from the hosted SQL/Worker security tests. All
 // content writes/downloads still use the existing isolated cloud runtime.
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname==='storage.invalid') {
   const payload=JSON.parse(Buffer.from(url.pathname.split('/').pop().split('.')[0],'base64url').toString());
   return route.fulfill({contentType:'application/vnd.scenario+json',body:Buffer.from(await runtime.scenarioStorage.resolveTemporaryDownload(url.href,payload.p,payload.s))});
  }
  if(!/^\/v\d+\//.test(url.pathname))return url.origin===base?route.continue():route.abort();
  const invoke=async(path,body)=>runtime.worker.fetch(new Request(`http://localhost${path}`,{method:body===undefined?'GET':'POST',headers:{...req.headers(),'idempotency-key':randomUUID()},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const catalogue=async()=>{
   const response=await invoke('/v9/projects'),value=await response.json();
   return branches.map(b=>({...b,project:value.projects.find(p=>p.id===b.id)}));
  };
  if(url.pathname.startsWith('/v14/')) {
   if(req.method()==='POST') {
    const c=req.postDataJSON(),active=branches.find(b=>b.id===c.versionId);
    if(c.action==='duplicate'||c.action==='blank') {
     const id=randomUUID(),file=c.action==='duplicate'?structuredClone(documents.get(c.sourceVersionId)):{formatVersion:1,title:'Projet UI',content:{type:'doc',content:[{type:'paragraph',attrs:{blockId:randomUUID(),scenarioType:'ACTION'}}]},coverPage:{},coverPageHidden:false,comments:[],characters:[],locations:[],times:[],savedAt:new Date().toISOString()};
     const content=JSON.stringify(file),response=await invoke('/v5/scenarios/sync',{scenarioId:id,title:file.title,parentVersionId:null,content,checksum:createHash('sha256').update(content).digest('hex'),sizeBytes:Buffer.byteLength(content),contentType:'application/vnd.scenario+json',format:'scenario-v1',origin:'save'});
     assert.equal(response.status,201);documents.set(id,file);branches.push({id,projectId:root,name:c.name,revision:1,createdAt:new Date().toISOString(),deletedAt:null,sourceVersionId:c.sourceVersionId??null});
    } else if(c.action==='rename') {active.name=c.name;active.revision++;}
    else {active.deletedAt=c.action==='delete'?new Date().toISOString():null;active.revision++;}
   }
   return route.fulfill({json:{contractVersion:'2026-09-v14',versions:await catalogue(),request_id:randomUUID()}});
  }
  const response=await runtime.worker.fetch(new Request(`http://localhost${url.pathname}${url.search}`,{method:req.method(),headers:req.headers(),...(req.postData()?{body:req.postData()}:{})}));
  if(url.pathname==='/v5/scenarios/sync'&&response.ok) {
   const body=req.postDataJSON();documents.set(body.scenarioId,JSON.parse(body.content));
   if(!root){root=body.scenarioId;branches.push({id:root,projectId:root,name:'Version 1',revision:1,createdAt:new Date().toISOString(),deletedAt:null,sourceVersionId:null});}
  }
  if(url.pathname==='/v9/projects'&&response.ok){const value=await response.json();value.projects=value.projects.filter(p=>!root||p.id===root);return route.fulfill({json:value});}
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 const page=await context.newPage(),errors=[];diagnosticPage=page;page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.locator('.scenario-editor').waitFor();
 await page.getByRole('button',{name:'Compte',exact:true}).click();await page.getByRole('button',{name:'studio',exact:true}).click();
 const account=page.getByRole('dialog',{name:'Compte et licence'});await account.getByText('Actuel',{exact:true}).waitFor();await account.getByRole('button',{name:'Fermer',exact:true}).click();
 await page.getByRole('button',{name:'Fichier',exact:true}).click();await page.getByRole('menuitem',{name:'Projets cloud…',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Projets cloud'});
 await panel.getByRole('button',{name:'+ Nouveau projet',exact:true}).click();
 await panel.getByLabel('Nom du projet').fill('Projet UI');await panel.getByRole('button',{name:'Créer dans le cloud',exact:true}).click();await panel.waitFor({state:'hidden'});
 const editor=page.locator('.scenario-editor'),chooser=page.getByRole('combobox',{name:'Version',exact:true});
 await editor.click();await page.keyboard.type('Texte de la version A');
 async function choose(name){await chooser.click();await page.getByRole('option',{name,exact:true}).click();}
 async function create(action,name){await choose(action);const dialog=page.getByRole('dialog',{name:'Versions du projet'});await dialog.getByLabel('Nom de la version',{exact:true}).fill(name);await dialog.getByRole('button',{name:'Enregistrer',exact:true}).click();await dialog.waitFor({state:'hidden'});}
 await create('Dupliquer une version…','Variante');
 assert.ok((await editor.textContent()).includes('Texte de la version A'));
 await editor.click();await page.keyboard.press('Control+End');await page.keyboard.type(' Suite B');
 await choose('Version : Version 1');await page.waitForFunction(()=>document.querySelector('.scenario-editor')?.textContent==='Texte de la version A');
 await choose('Version : Variante');await page.waitForFunction(()=>document.querySelector('.scenario-editor')?.textContent?.includes('Suite B'));
 await create('Créer une version vierge…','Vide');assert.equal(await editor.textContent(),'');
 await choose('Version : Variante');await page.waitForFunction(()=>document.querySelector('.scenario-editor')?.textContent?.includes('Suite B'));
 await choose('Supprimer cette version…');await page.getByRole('button',{name:'Supprimer la version',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.scenario-editor')?.textContent==='Texte de la version A');
 assert.deepEqual(errors,[]);
 console.log('PASS real app UI with isolated v14 fixture: cloud open, duplicate, outgoing save, A/B switch, blank and delete.');
} catch(error){console.error(await diagnosticPage?.locator('[role="dialog"]').allTextContents());throw error;}
finally {await browser.close();}

import { afterEach, expect, it, vi } from 'vitest';
import { CloudProjectRuntime, type CloudProjectEditor } from './cloudProjectRuntime';
import { createEmptyCoverPage, type ScenarioFile } from '../document/scenarioFile';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProjectVersion, VersionCommand } from './contractsV14';
import type { CloudWorkingCopy } from './cloudProjectStore';
import { CollaborationRuntime } from './collaborationRuntime';
const roots: CloudProjectRuntime[] = [];
afterEach(async () => { for (const r of roots.splice(0)) await r.close(); });
function fixture() {
  const file = (text:string):ScenarioFile => ({formatVersion:1,title:'Projet',content:{type:'doc',content:[{type:'paragraph',attrs:{blockId:'one'},content:[{type:'text',text}]}]},characters:[],locations:[],times:[],coverPage:{...createEmptyCoverPage(),projectName:text},coverPageHidden:false,comments:[],savedAt:''});
  const branches:CloudProjectVersion[] = ['a','b'].map((id,i)=>({id,projectId:'root',name:`Version ${i+1}`,revision:1,createdAt:'',deletedAt:null,sourceVersionId:null,project:{id,title:'Projet',currentVersionId:`${id}-1`,role:'owner',sharing:'private',memberCount:1,canShare:false,realtimeStudioId:null,realtimeBaseVersionId:null,deletedAt:null,createdAt:'',updatedAt:''}}));
  const docs = new Map([['a',file('Texte A')],['b',file('Texte B')]]), copies = new Map<string,CloudWorkingCopy>();
  let doc = file('Local'); const listeners = new Set<()=>void>();
  const editor:CloudProjectEditor = { read:()=>doc.content,readFile:()=>structuredClone(doc),openFile:v=>{doc=structuredClone(v);},replaceDocument:v=>{doc.content=v;},replaceMetadata:v=>{doc={...doc,...v};},setReadOnly:vi.fn(),subscribe:fn=>{const cb=()=>fn(doc.content);listeners.add(cb);return()=>{listeners.delete(cb);};} };
  const api = {
    listCloudProjects:async()=>({projects:[{...branches[0].project,id:'root'}]}),
    listProjectVersions:vi.fn(async()=>structuredClone(branches)),
    listCloudVersions:async(id:string)=>({versions:[{id:branches.find(b=>b.project.id===id)!.project.currentVersionId,scenarioId:id}]}),
    syncCloudScenario:vi.fn(async(body)=>{docs.set(body.scenarioId,JSON.parse(body.content));const b=branches.find(b=>b.project.id===body.scenarioId)!;b.project.currentVersionId+= '-next';return {version:{id:b.project.currentVersionId}};}),
    changeProjectVersion:vi.fn(async(_root:string,c:VersionCommand)=>{const b=branches.find(b=>b.id===c.versionId)!;if(c.action==='rename'){b.name=c.name!;b.revision++;}else if(c.action==='delete'){b.deletedAt=new Date().toISOString();b.revision++;}}),
  } as unknown as AuthenticatedCommercialApi;
  const backup=vi.fn(async()=>{});
  const runtime = new CloudProjectRuntime({read:async(a,id)=>copies.get(`${a}:${id}`)??null,write:async(copy)=>{copies.set(`${copy.accountId}:${copy.projectId}`,structuredClone(copy));},backup,list:async()=>[]},new CollaborationRuntime(),async(_api,v)=>structuredClone(docs.get(v.scenarioId)!));
  roots.push(runtime);
  const edit=(text:string)=>{doc=file(text);for(const cb of listeners)cb();};
  return {api,runtime,editor,branches,docs,copies,edit,backup};
}
it('saves A before switching to B and isolates contents, cover and account caches',async()=>{
  const f=fixture();await f.runtime.open(f.api,'account','root',f.editor);
  f.edit('A modifié');await f.runtime.changeVersion('b');
  expect(f.editor.readFile().coverPage.projectName).toBe('Texte B');
  expect(f.docs.get('a')?.coverPage.projectName).toBe('A modifié');
  f.edit('B modifié');await f.runtime.changeVersion('a');
  expect(f.editor.readFile().coverPage.projectName).toBe('A modifié');
  expect(f.docs.get('b')?.coverPage.projectName).toBe('B modifié');
  expect([...f.copies.keys()].sort()).toEqual(['account:a','account:b']);
});
it('a failed flush keeps the current text and refuses a switch',async()=>{
  const f=fixture();await f.runtime.open(f.api,'account','root',f.editor);f.edit('Ne pas perdre');
  vi.mocked(f.api.syncCloudScenario).mockRejectedValue(new TypeError('offline'));
  await expect(f.runtime.changeVersion('b')).rejects.toThrow('pas encore synchronisée');
  expect(f.editor.readFile().coverPage.projectName).toBe('Ne pas perdre');
  expect(f.docs.get('b')?.coverPage.projectName).toBe('Texte B');
});
it('retries uncertain commands with exactly the same operation id',async()=>{
  const f=fixture();await f.runtime.open(f.api,'account','root',f.editor);
  vi.mocked(f.api.changeProjectVersion).mockRejectedValueOnce(new TypeError('uncertain'));
  await expect(f.runtime.changeVersion('rename','Nouveau')).rejects.toThrow('uncertain');
  await f.runtime.changeVersion('rename','Nouveau');
  expect(vi.mocked(f.api.changeProjectVersion).mock.calls[0]).toEqual(vi.mocked(f.api.changeProjectVersion).mock.calls[1]);
});
it('deletion elsewhere locks the current version and preserves its text',async()=>{
  const f=fixture();await f.runtime.open(f.api,'account','root',f.editor);f.edit('Copie conservée');f.branches[0].deletedAt=new Date().toISOString();
  await f.runtime.flush();
  expect(f.api.syncCloudScenario).not.toHaveBeenCalled();
  expect(f.editor.setReadOnly).toHaveBeenLastCalledWith(true);
  expect(f.editor.readFile().coverPage.projectName).toBe('Copie conservée');
});
it('deleting the active version selects a surviving sibling without writing over it',async()=>{
  const f=fixture();await f.runtime.open(f.api,'account','root',f.editor);
  await f.runtime.changeVersion('delete');
  expect(f.editor.readFile().coverPage.projectName).toBe('Texte B');
  expect(f.api.syncCloudScenario).not.toHaveBeenCalled();
});
it('closing during a version request prevents a late response from reopening the account',async()=>{
  const f=fixture();await f.runtime.open(f.api,'account','root',f.editor);
  let release!:()=>void, started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  vi.mocked(f.api.changeProjectVersion).mockImplementationOnce(async()=>{started();await new Promise<void>(resolve=>{release=resolve;});});
  const changing=f.runtime.changeVersion('rename','New name');
  const rejected=expect(changing).rejects.toThrow('projet a été fermé');
  await ready;await f.runtime.close();release();await rejected;
  let status='';f.runtime.subscribe(s=>{status=s.status;});expect(status).toBe('closed');
});

import { expect, it, vi } from 'vitest';
import { downloadCloudProject } from './cloudProjectDownload';
import { createEmptyCoverPage } from '../document/scenarioFile';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProject } from './contractsV9';

it('downloads every active version with the current cover, comments and scene attributes',async()=>{
 const file=(id:string)=>({formatVersion:1,title:'Film',savedAt:new Date().toISOString(),characters:[],locations:[],times:[],comments:[],coverPage:createEmptyCoverPage(),coverPageHidden:false,
   content:{type:'doc',content:[{type:'paragraph',attrs:{blockId:'scene',scenarioType:'SCENE_HEADING',technicalBreakdownData:JSON.stringify({image:'data:image/png;base64,AAAA',description:id})},content:[{type:'text',text:id}]}]}});
 const api={listProjectVersions:async()=>['a','b','deleted'].map(id=>({id,name:id,createdAt:new Date().toISOString(),deletedAt:id==='deleted'?new Date().toISOString():null,sourceVersionId:null,project:{id}})),readCurrentProjectDocument:vi.fn(async id=>file(id))} as unknown as AuthenticatedCommercialApi;
 const result=await downloadCloudProject(api,{id:'project',title:'Film'} as CloudProject);
 expect(result.formatVersion).toBe(2); expect(result.versions).toHaveLength(2);
 expect(result.versions?.[1].document.content.content?.[0].attrs?.technicalBreakdownData).toContain('description');
 expect(api.readCurrentProjectDocument).toHaveBeenCalledTimes(2);
});

it('never returns a partial project if a version becomes inaccessible during download',async()=>{
 const api={listProjectVersions:async()=>[{id:'a',deletedAt:null,project:{id:'a'}}],readCurrentProjectDocument:async()=>{throw new Error('Access revoked');}} as unknown as AuthenticatedCommercialApi;
 await expect(downloadCloudProject(api,{id:'project'} as CloudProject)).rejects.toThrow('Access revoked');
});

it('never downloads a local copy for a reader',async()=>{
 const api={listProjectVersions:vi.fn(),readCurrentProjectDocument:vi.fn()} as unknown as AuthenticatedCommercialApi;
 await expect(downloadCloudProject(api,{id:'project',title:'Film',role:'viewer'} as CloudProject)).rejects.toThrow('lecteur');
 expect(api.listProjectVersions).not.toHaveBeenCalled();
 expect(api.readCurrentProjectDocument).not.toHaveBeenCalled();
});

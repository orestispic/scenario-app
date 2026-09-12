import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudProjectRuntime, fileIdentity, type CloudProjectEditor } from './cloudProjectRuntime';
import type { CloudProjectStore, CloudWorkingCopy } from './cloudProjectStore';
import { CollaborationRuntime } from './collaborationRuntime';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import { createEmptyCoverPage, type ScenarioFile } from '../document/scenarioFile';
import type { CloudProject } from './contractsV9';
import { parseCloudProjects } from './contractsV9';

const projectId = '80000000-0000-4000-8000-000000000001';
const project: CloudProject = { id: projectId, title: 'Privé', role: 'owner', sharing: 'private', memberCount: 1, canShare: true, realtimeStudioId: null, realtimeBaseVersionId: null, currentVersionId: 'v1', deletedAt: null, createdAt: '', updatedAt: '' };
const file = (text: string): ScenarioFile => ({ formatVersion: 1, title: 'Privé', content: { type: 'doc', content: [{ type: 'paragraph', attrs: {blockId: 'one'}, content: [{type: 'text', text}] }] }, characters: [], locations: [], times: [], coverPage: createEmptyCoverPage(), coverPageHidden: false, comments: [], savedAt: '' });
const active: CloudProjectRuntime[] = [];
afterEach(async () => { for (const r of active.splice(0)) await r.close(); vi.restoreAllMocks(); });
function fixture() {
  let document = file('Local original');
  const listeners = new Set<() => void>();
  const editor: CloudProjectEditor = {
    read: () => document.content, readFile: () => structuredClone(document),
    openFile: (value) => { document = structuredClone(value); }, replaceDocument: (content) => { document.content = structuredClone(content); },
    setReadOnly: vi.fn(), subscribe: (listener) => { const callback = () => listener(document.content); listeners.add(callback); return () => {listeners.delete(callback);}; },
  };
  const copies = new Map<string, CloudWorkingCopy>();
  const store: CloudProjectStore = { read: async (account,id) => copies.get(`${account}:${id}`) ?? null, write: async (copy) => { copies.set(`${copy.accountId}:${copy.projectId}`, structuredClone(copy)); }, backup: vi.fn(async () => undefined), list: async (account) => [...copies.values()].filter((c) => c.accountId === account) };
  let serverProject = structuredClone(project);
  let remote = file('Cloud original');
  const sync = vi.fn(async (body) => {
    remote = JSON.parse(body.content); serverProject.currentVersionId = `v${Number(serverProject.currentVersionId?.slice(1))+1}`;
    return { version: {id: serverProject.currentVersionId} };
  });
  const api = { listCloudProjects: vi.fn(async () => ({ projects: [serverProject] })), listCloudVersions: vi.fn(async () => ({versions: [{id: serverProject.currentVersionId, parentVersionId: null, scenarioId: projectId}]})), syncCloudScenario: sync } as unknown as AuthenticatedCommercialApi;
  const createLive = vi.fn(() => ({ connect: async () => undefined, disconnect: async () => undefined, subscribe: () => () => undefined, recoveryCopy: vi.fn() }));
  const live = new CollaborationRuntime(createLive);
  const runtime = new CloudProjectRuntime(store, live, async () => structuredClone(remote)); active.push(runtime);
  const edit = (text: string) => { document = file(text); for(const cb of listeners) cb(); };
  return { api, store, editor, runtime, sync, copies, edit, createLive, get remote() {return remote;}, setProject: (value: Partial<CloudProject>) => {serverProject = {...serverProject, ...value};} };
}

describe('cloud project lifecycle', () => {
  it('backs up the current file before opening a private project and never connects a channel', async () => {
    const f = fixture(); await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    expect(f.store.backup).toHaveBeenCalledWith('account-a', file('Local original'));
    expect(f.editor.readFile()).toEqual(file('Cloud original'));
    expect(f.createLive).not.toHaveBeenCalled();
    f.edit('New text'); await f.runtime.flush();
    expect(f.sync).toHaveBeenCalledTimes(1); expect(f.remote).toEqual(file('New text'));
    expect(f.copies.get(`account-a:${projectId}`)?.pending).toBe(false);
  });
  it('opens the project-specific real-time connection automatically', async () => {
    const f = fixture(); f.setProject({ sharing: 'shared', memberCount: 2, realtimeStudioId: 'studio-a', realtimeBaseVersionId: 'v1' });
    await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    expect(f.createLive).toHaveBeenCalledWith(expect.objectContaining({studioId: 'studio-a', scenarioId: projectId, actorId: 'account-a'}));
    await f.runtime.flush(); expect(f.sync).not.toHaveBeenCalled();
  });
  it('sharing uses the frozen latest private version, not the original empty root', async () => {
    const f = fixture(); f.setProject({currentVersionId: 'v2', realtimeStudioId: 'studio-a', realtimeBaseVersionId: 'v2'});
    await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    expect(f.createLive).toHaveBeenCalledWith(expect.objectContaining({baseVersionId: 'v2'}));
  });
  it('never falls back to whole-file autosaves when a shared project has no authorized channel', async () => {
    const f = fixture(); f.setProject({sharing:'shared',memberCount:2,realtimeStudioId:null});
    await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    expect(f.editor.setReadOnly).toHaveBeenLastCalledWith(true);
    f.edit('Unsynchronized copy'); await f.runtime.flush(); expect(f.sync).not.toHaveBeenCalled();
  });
  it('keeps an uncertain request identical on retry and sends newer edits separately', async () => {
    const f = fixture(); await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    f.sync.mockRejectedValueOnce(new TypeError('network'));
    f.edit('First'); await f.runtime.flush(); f.edit('Second'); await f.runtime.flush();
    const calls = f.sync.mock.calls as unknown[][];
    expect(calls.length).toBe(3);
    expect(calls[1]).toEqual(calls[0]); expect(calls[2][1]).not.toBe(calls[0][1]);
    expect(f.remote).toEqual(file('Second'));
  });
  it('a competing private version causes an explicit conflict without overwriting local text', async () => {
    const f = fixture(); const states: string[] = []; f.runtime.subscribe((s) => states.push(s.status));
    await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    f.edit('My unsent text'); f.setProject({currentVersionId: 'v2'}); await f.runtime.flush();
    expect(states).toContain('conflict'); expect(f.sync).not.toHaveBeenCalled();
    expect(f.editor.readFile()).toEqual(file('My unsent text')); expect(f.editor.setReadOnly).toHaveBeenLastCalledWith(true);
  });
  it('membership loss locks editing and never authorizes from a local copy', async () => {
    const f = fixture(); await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    f.edit('Unsent'); vi.mocked(f.api.listCloudProjects).mockResolvedValue({projects: []} as never); await f.runtime.flush();
    expect(f.editor.setReadOnly).toHaveBeenLastCalledWith(true); expect(f.sync).not.toHaveBeenCalled();
    expect(f.editor.readFile()).toEqual(file('Unsent'));
  });
  it('reopening pending work preserves it and offers recovery, isolated per account', async () => {
    const f = fixture(); await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    f.edit('Offline work'); await f.runtime.close();
    await f.runtime.open(f.api, 'account-a', projectId, f.editor);
    expect(f.editor.readFile()).toEqual(file('Offline work'));
    expect(f.editor.setReadOnly).toHaveBeenLastCalledWith(true);
    await f.runtime.open(f.api, 'account-b', projectId, f.editor);
    expect(f.editor.readFile()).toEqual(file('Cloud original'));
  });
  it('a late download cannot replace the document after closing', async () => {
    const f = fixture(); let finish!: () => void;
    const wait = new Promise<void>((resolve) => { finish = resolve; });
    vi.mocked(f.api.listCloudVersions).mockImplementationOnce(async () => { await wait; return {versions: [{id:'v1', parentVersionId: null, scenarioId: projectId}]} as never; });
    const opening = f.runtime.open(f.api, 'account-a', projectId, f.editor);
    await new Promise((r) => setTimeout(r, 5)); await f.runtime.close(); finish(); await opening;
    expect(f.editor.readFile()).toEqual(file('Local original'));
  });
});

it('v9 refuses forged capabilities, duplicate projects and inconsistent private/shared state', () => {
  const data = {contractVersion: '2026-09-v9', projects: [project], receivedInvitations: [], request_id: 'request'};
  expect(parseCloudProjects(data).projects[0].sharing).toBe('private');
  for (const projects of [[{...project, role:'viewer'}], [{...project, memberCount:2}], [project,project]]) expect(() => parseCloudProjects({...data, projects})).toThrow();
  expect(fileIdentity({...file('a'), savedAt: 'later'})).toBe(fileIdentity(file('a')));
});

import type { ScenarioFile } from '../document/scenarioFile';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProject } from './contractsV9';
import type { CloudSyncRequest } from './contractsV6';
import type { ScenarioEditorBridge } from './collaborationClient';
import { collaborationRuntime, type CollaborationRuntime } from './collaborationRuntime';
import { loadCloudProjectFile } from './studioBase';
import { cloudProjectStore, type CloudProjectStore } from './cloudProjectStore';
import { metadataFromRegisters, type ProjectMetadata } from './contractsV10';
import { ProjectMetadataClient } from './projectMetadataClient';
import type { CloudProjectVersion, VersionCommand } from './contractsV14';

export interface CloudProjectEditor extends ScenarioEditorBridge {
  readFile(): ScenarioFile;
  openFile(file: ScenarioFile): void;
  replaceMetadata(metadata:ProjectMetadata):void;
}
export interface OpenProjectState {
  project: CloudProject | null;
  status: 'closed' | 'loading' | 'synced' | 'pending' | 'offline' | 'conflict' | 'read_only' | 'realtime' | 'error';
  message: string;
  rootProjectId?: string;
  branches?: CloudProjectVersion[];
  activeBranchId?: string;
}
export function fileIdentity(file: ScenarioFile): string {
  const { savedAt: _savedAt, characters: _characters, locations: _locations, times: _times, ...value } = file;
  return JSON.stringify(value);
}
export async function cloudSyncRequest(file: ScenarioFile, scenarioId: string, parentVersionId: string | null): Promise<CloudSyncRequest> {
  if (file.formatVersion !== 1) throw new Error('L’import dans le cloud d’un fichier contenant plusieurs versions n’est pas encore disponible. Conservez ce fichier local : toutes ses versions sont préservées. Vous pouvez créer des versions directement dans un projet cloud.');
  const content = JSON.stringify(file);
  const bytes = new TextEncoder().encode(content);
  const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((v) => v.toString(16).padStart(2, '0')).join('');
  return { scenarioId, parentVersionId, content, checksum, sizeBytes: bytes.byteLength, title: file.title, contentType: 'application/vnd.scenario+json', format: 'scenario-v1', origin: 'save' };
}

/** Lives outside the dialog. A private project never receives a Studio membership. */
export class CloudProjectRuntime {
  private state: OpenProjectState = { project: null, status: 'closed', message: '' };
  private listeners = new Set<(state: OpenProjectState) => void>();
  private scope = new AbortController();
  private generation = 0;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeLive: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private editor: CloudProjectEditor | null = null;
  private api: AuthenticatedCommercialApi | null = null;
  private accountId = '';
  private parent: string | null = null;
  private confirmed = '';
  private pendingRequest: { body: CloudSyncRequest; key: string; identity: string } | null = null;
  private running = false;
  private saving: Promise<void> = Promise.resolve();
  private metadata:ProjectMetadataClient|null=null;
  private textPending=false;
  private branchBusy=false;
  private branchAttempt: { signature: string; command: VersionCommand } | null = null;
  constructor(private readonly store: CloudProjectStore = cloudProjectStore, private readonly live: CollaborationRuntime = collaborationRuntime, private readonly load = loadCloudProjectFile) {}
  subscribe(listener: (state: OpenProjectState) => void) {
    this.listeners.add(listener); listener(structuredClone(this.state));
    return () => { this.listeners.delete(listener); };
  }
  private publish() {
    for (const listener of this.listeners) listener(structuredClone(this.state));
  }
  private update(status: OpenProjectState['status'], message = '') {
    if (this.state.status === status && this.state.message === message) return;
    this.state = { ...this.state, status, message };
    this.publish();
  }
  hasUnsyncedChanges(): boolean {
    if (!this.editor || !this.state.project) return false;
    return this.state.project.realtimeStudioId
      ? this.textPending || Boolean(this.metadata?.hasPending())
      : Boolean(this.pendingRequest) || fileIdentity(this.editor.readFile()) !== this.confirmed;
  }
  async close(): Promise<void> {
    const saving = this.saveCopy();
    const editor = this.editor;
    const generation = ++this.generation;
    this.scope.abort(); this.scope = new AbortController();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.unsubscribeLive?.(); this.unsubscribeLive = null;
    this.metadata?.stop();this.metadata=null;
    this.pendingRequest = null;
    this.running = false;
    this.branchAttempt = null;
    this.api = null; this.editor = null;
    this.state = { project: null, status: 'closed', message: '' };
    this.publish();
    await Promise.all([this.live.disconnect(), saving]);
    if (generation === this.generation) editor?.setReadOnly(false);
  }
  async open(api: AuthenticatedCommercialApi, accountId: string, projectId: string, editor: CloudProjectEditor, useRemote = false, branchId?: string): Promise<void> {
    const previousAccount = this.accountId;
    const closing = this.close();
    const generation = this.generation;
    await closing;
    if (generation !== this.generation) return;
    this.api = api; this.accountId = accountId; this.editor = editor;
    editor.setReadOnly(true);
    this.update('loading', 'Ouverture du projet…');
    const before = editor.readFile();
    try {
      await this.store.backup(previousAccount || accountId, before);
      if (generation !== this.generation) return;
      const root = (await api.listCloudProjects()).projects.find((p) => p.id === projectId && !p.deletedAt);
      if (generation !== this.generation) return;
      if (!root) throw Object.assign(new Error('Ce projet n’est plus accessible.'), { status: 403 });
      // Older test/local servers may not expose v14 yet. Never flatten a bundle
      // or silently choose another branch when a requested branch is unavailable.
      let branches: CloudProjectVersion[] = [];
      if (api.listProjectVersions) {
        try { branches = await api.listProjectVersions(projectId); }
        catch (error) {
          // The locally isolated API can intentionally omit v14. Opening the
          // root project remains safe through the immutable v6 history.
          if ((error as { status?: number }).status !== 503) throw error;
        }
      }
      if (generation !== this.generation) return;
      const selected = branchId ? branches.find(b => b.id === branchId && !b.deletedAt) : branches.find(b => b.id === projectId && !b.deletedAt) ?? branches.find(b => !b.deletedAt);
      if (branchId && !selected) throw new Error('Cette version n’est plus accessible. Votre copie est conservée.');
      const project = selected?.project ?? root;
      this.state = { ...this.state, rootProjectId: projectId, branches, activeBranchId: selected?.id };
      const versions = (await api.listCloudVersions(project.id)).versions;
      if (generation !== this.generation) return;
      const version = versions.find((v) => v.id === project.currentVersionId);
      if (!version) throw new Error('Version du projet indisponible.');
      const cached = await this.store.read(accountId, project.id);
      if (generation !== this.generation) return;
      let file = await this.load(api, version, this.scope.signal);
      if (project.sharing === 'shared' && !project.realtimeStudioId && api.readCurrentProjectDocument)
        file = await api.readCurrentProjectDocument(project.id, this.scope.signal);
      const metadataState=project.realtimeStudioId?(await api.getProjectMetadata(project.id,this.scope.signal)).state:null;
      if(metadataState)file={...file,...metadataFromRegisters(metadataState.registers)};
      if (generation !== this.generation) return;
      this.state.project = project; this.parent = version.id; this.confirmed = fileIdentity(file);
      if (cached?.pending && !useRemote && fileIdentity(cached.file) !== this.confirmed) {
        editor.openFile(cached.file); editor.setReadOnly(true);
        this.update('conflict', 'Une copie locale non synchronisée a été retrouvée. Téléchargez-la ou ouvrez-la comme copie indépendante avant de charger la version cloud.');
        return;
      }
      if (cached?.pending && useRemote) await this.store.backup(accountId, cached.file);
      if (generation !== this.generation) return;
      editor.openFile(file);
      this.unsubscribe = editor.subscribe(() => this.changed());
      if (project.realtimeStudioId) {
        if(!metadataState)throw new Error('Commentaires et premières pages indisponibles.');
        this.metadata=new ProjectMetadataClient(api,metadataState,()=>editor.readFile(),(metadata)=>editor.replaceMetadata(metadata),this.scope.signal,project.role==='viewer');
        this.textPending=true;
        const root = versions.find((v) => v.id === project.realtimeBaseVersionId && v.scenarioId === project.id);
        if (!root) throw new Error('Base du partage indisponible. Votre copie locale est conservée.');
        this.unsubscribeLive = this.live.subscribe((state) => {
          if (generation !== this.generation || state.studioId !== project.realtimeStudioId) return;
          this.textPending=Boolean(state.syncLag)||!['online','read_only'].includes(state.status)||Boolean(state.lastErrorCode);
          if ((state.status === 'online' || state.status === 'read_only') && !state.syncLag && !state.lastErrorCode) {
            this.confirmed = fileIdentity({ ...file, content: editor.readFile().content });
            void this.saveCopy().catch(() => this.update('error', 'Copie locale indisponible. Exportez votre scénario.'));
          }
        });
        await this.live.connect({ api, actorId: accountId, studioId: project.realtimeStudioId, scenarioId: project.id, baseVersionId: root.id, editor, loadBase: async (signal) => (await this.load(api, root, signal)).content });
        if (generation !== this.generation) return;
        this.update('realtime');
      } else {
        const readOnly = project.role === 'viewer' || project.sharing === 'shared';
        editor.setReadOnly(readOnly);
        this.update(readOnly ? 'read_only' : 'synced', project.role === 'viewer' ? 'Lecture seule. Actualisation automatique.' : project.sharing === 'shared' ? 'Canal collaboratif non autorisé. Le fichier cloud reste consultable, sans sauvegarde concurrente.' : '');
      }
      await this.saveCopy();
      this.schedule();
    } catch (error) {
      if (generation !== this.generation) return;
      editor.setReadOnly(Boolean(this.state.project));
      this.update('error', error instanceof Error ? error.message : 'Projet indisponible.');
      throw error;
    }
  }
  private changed() {
    if (!this.editor || !this.state.project) return;
    if(this.state.project.realtimeStudioId)this.textPending=true;
    void this.saveCopy().catch(() => this.update('error', 'Copie locale indisponible : exportez votre scénario.'));
    if (!this.state.project.realtimeStudioId && !['read_only', 'conflict'].includes(this.state.status)) {
      this.update('pending'); this.schedule(1500);
    }
  }
  /** Flush before leaving, then freeze the source until the new channel is open.
   * Pending/uncertain live writes are never dropped to make a switch succeed. */
  async changeVersion(action: string, name = '', sourceId = ''): Promise<void> {
    if (this.branchBusy || !this.api || !this.editor || !this.state.rootProjectId || !this.state.branches?.length) throw new Error('Versions cloud indisponibles.');
    const api = this.api, editor = this.editor, account = this.accountId, root = this.state.rootProjectId;
    const generation = this.generation;
    const assertCurrent = () => {
      if (generation !== this.generation || this.api !== api || this.editor !== editor) throw new Error('Le projet a été fermé. Aucune version n’a été ouverte.');
    };
    const active = this.state.branches.find(b => b.id === this.state.activeBranchId)!;
    this.branchBusy = true; editor.setReadOnly(true);
    try {
      await this.flush();
      assertCurrent();
      if (this.running || ['conflict','error','offline'].includes(this.state.status) || this.pendingRequest ||
        (this.state.project?.realtimeStudioId ? this.textPending || this.metadata?.hasPending() : fileIdentity(editor.readFile()) !== this.confirmed))
        throw new Error('La version actuelle n’est pas encore synchronisée. Attendez la fin de la synchronisation avant de changer de version.');
      await this.store.backup(account, editor.readFile());
      assertCurrent();
      let target = action;
      if (['duplicate','blank','rename','delete','restore'].includes(action)) {
        if (active.project.role === 'viewer') throw new Error('Un lecteur ne peut pas modifier les versions.');
        const requestedVersion = sourceId ? this.state.branches.find(b => b.id === sourceId && !b.deletedAt) : active;
        const version = action === 'restore' ? this.state.branches.find(b => b.id === sourceId) : requestedVersion;
        if (!version) throw new Error('Version introuvable.');
        const signature = JSON.stringify([root,active.id,action,name,sourceId]);
        if (this.branchAttempt && this.branchAttempt.signature !== signature) throw new Error('Réessayez d’abord la demande précédente pour vérifier son résultat.');
        const command: VersionCommand = this.branchAttempt?.command ?? {
          action: action as VersionCommand['action'], operationId: crypto.randomUUID(),
          ...(['duplicate','blank','rename'].includes(action) ? { name } : {}),
          ...(action === 'duplicate' ? { sourceVersionId: sourceId || active.id } : {}),
          ...(!['duplicate','blank'].includes(action) ? { versionId: version.id, expectedRevision: version.revision } : {}),
        };
        this.branchAttempt = { signature, command };
        try { await api.changeProjectVersion(root, command); assertCurrent(); }
        catch (error) {
          const status = (error as {status?:number}).status;
          if (status && status >= 400 && status < 500) this.branchAttempt = null;
          throw error;
        }
        const branches = await api.listProjectVersions(root);
        assertCurrent();
        this.branchAttempt = null;
        this.state.branches = branches;
        target = ['duplicate','blank'].includes(action) ? branches.find(b => b.name === name.trim() && !b.deletedAt)!.id
          : action === 'restore' ? sourceId : action === 'delete' && version.id === active.id ? branches.find(b => !b.deletedAt)!.id : active.id;
        this.publish();
        if (action === 'rename' || (action === 'delete' && version.id !== active.id)) return;
      }
      await this.open(api, account, root, editor, false, target);
    } finally {
      this.branchBusy = false;
      if (this.editor === editor) editor.setReadOnly(this.state.project?.role === 'viewer' || ['conflict','error','read_only'].includes(this.state.status));
    }
  }
  metadataChanged() {
    if(!this.state.project||!this.editor)return;
    if(!this.state.project.realtimeStudioId){this.changed();return;}
    if(this.metadata?.hasPending()&&!['conflict','read_only','error'].includes(this.state.status)) {
      void this.saveCopy().catch(()=>this.update('error','Copie locale indisponible.'));
      this.update('realtime','Commentaires et premières pages : synchronisation…');this.schedule(800);
    }
  }
  private async saveCopy() {
    const editor = this.editor, project = this.state.project;
    if (!editor || !project) return;
    const file = editor.readFile();
    const pending=project.realtimeStudioId?this.textPending||Boolean(this.metadata?.hasPending()):fileIdentity(file)!==this.confirmed;
    const copy = { accountId: this.accountId, projectId: project.id, parentVersionId: this.parent, file, pending, savedAt: new Date().toISOString() };
    this.saving = this.saving.catch(() => undefined).then(() => this.store.write(copy));
    await this.saving;
  }
  private schedule(delay = this.state.project?.realtimeStudioId ? 4_000 : 10_000) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }
  async flush(): Promise<void> {
    const guestReader = this.state.project?.role === 'viewer' && !this.state.project.realtimeStudioId && Boolean(this.api?.readCurrentProjectDocument);
    if (this.running || !this.api || !this.editor || !this.state.project || ['conflict', 'error'].includes(this.state.status) || (this.state.status === 'read_only' && !guestReader)) return;
    this.running = true;
    const generation = this.generation, api = this.api, editor = this.editor, project = this.state.project;
    let delay = project.realtimeStudioId ? 4_000 : 10_000;
    try {
      if (guestReader) {
        const current = await api.readCurrentProjectDocument(project.id, this.scope.signal);
        if (generation !== this.generation) return;
        if (fileIdentity(current) !== this.confirmed) editor.openFile(current);
        this.confirmed = fileIdentity(current);
        editor.setReadOnly(true);
        this.update('read_only');
        await this.saveCopy();
        return;
      }
      await this.saveCopy();
      const rootId = this.state.rootProjectId ?? project.id;
      let branches = this.state.activeBranchId && api.listProjectVersions ? await api.listProjectVersions(rootId) : null;
      if (generation !== this.generation) return;
      if (branches) {
        const branchesChanged = JSON.stringify(this.state.branches ?? []) !== JSON.stringify(branches);
        this.state.branches = branches;
        if (!branches.some(b => b.id === this.state.activeBranchId && !b.deletedAt)) throw Object.assign(new Error('Version supprimée.'), {status:404});
        if (branchesChanged) this.publish();
      }
      if (project.realtimeStudioId) {
        await this.metadata?.sync();
        if(generation!==this.generation)return;
        this.update('realtime',this.metadata?.hasPending()?'Commentaires et premières pages : synchronisation…':'Commentaires et premières pages à jour.');
        await this.saveCopy();return;
      }
      if (project.sharing === 'shared') { editor.setReadOnly(true); this.update('read_only', 'Canal collaboratif non autorisé.'); return; }
      // A retry uses the exact original bytes + key, even if the editor changed meanwhile.
      if (this.pendingRequest) {
        const pending = this.pendingRequest;
        const saved = await api.syncCloudScenario(pending.body, pending.key);
        if (generation !== this.generation) return;
        this.parent = saved.version.id; this.confirmed = pending.identity; this.pendingRequest = null;
        // The branch list above predates this retry. Re-read it before comparing
        // its head with the just-acknowledged write (otherwise a false conflict).
        if (branches) branches = await api.listProjectVersions(rootId);
        if (generation !== this.generation) return;
      }
      const latest = branches ? branches.find(b => b.id === this.state.activeBranchId && !b.deletedAt)?.project : (await api.listCloudProjects()).projects.find((p) => p.id === project.id && !p.deletedAt);
      if (generation !== this.generation) return;
      if (!latest) throw Object.assign(new Error('Accès au projet retiré.'), { status: 403 });
      if (latest.role === 'viewer') { editor.setReadOnly(true); this.update('read_only'); return; }
      const dirty = fileIdentity(editor.readFile()) !== this.confirmed;
      if (latest.realtimeStudioId || latest.currentVersionId !== this.parent) {
        if (dirty) { this.update('conflict', 'Le projet a changé ailleurs. Votre copie locale est conservée ; choisissez la version à ouvrir.'); editor.setReadOnly(true); return; }
        await this.open(api, this.accountId, rootId, editor, false, this.state.activeBranchId);
        return;
      }
      if (dirty) {
        const file = editor.readFile();
        this.pendingRequest = { body: await cloudSyncRequest(file, project.id, this.parent), key: crypto.randomUUID(), identity: fileIdentity(file) };
        const pending = this.pendingRequest;
        const saved = await api.syncCloudScenario(pending.body, pending.key);
        if (generation !== this.generation) return;
        this.parent = saved.version.id; this.confirmed = pending.identity; this.pendingRequest = null;
      }
      if (generation !== this.generation) return;
      this.update(fileIdentity(editor.readFile()) === this.confirmed ? 'synced' : 'pending');
      await this.saveCopy();
    } catch (error) {
      if (generation !== this.generation) return;
      const status = (error as { status?: number }).status;
      if (status === 409) { if(project.realtimeStudioId)await this.live.disconnect(); editor.setReadOnly(true); this.update('conflict', 'Commentaire, première page ou version modifié ailleurs. Votre copie locale est conservée.'); }
      else if (status && [401, 403, 404, 426].includes(status)) { if(project.realtimeStudioId)await this.live.disconnect(); editor.setReadOnly(true); this.update('read_only', 'Accès suspendu. Votre copie locale reste disponible.'); }
      else { delay = 30_000; this.update('offline', 'Connexion indisponible. Les modifications restent sur cet appareil.'); }
    } finally {
      if (generation === this.generation) {
        this.running = false;
        if (this.state.project && (!['conflict', 'error', 'read_only'].includes(this.state.status) || (guestReader && this.state.status === 'read_only'))) this.schedule(delay);
      }
    }
  }
}

export const cloudProjectRuntime = new CloudProjectRuntime();
if (import.meta.hot) import.meta.hot.dispose(() => { void cloudProjectRuntime.close(); });

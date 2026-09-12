import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProject } from './contractsV9';
import type { StudioDetailResponse, StudioInvitationView } from './contractsV7';
import type { CloudScenarioVersion } from './contractsV6';
import { createEmptyCoverPage, type ScenarioFile } from '../document/scenarioFile';
import { cloudProjectRuntime, cloudSyncRequest, type CloudProjectEditor, type OpenProjectState } from './cloudProjectRuntime';
import { cloudProjectStore, type CloudWorkingCopy } from './cloudProjectStore';
import { collaborationRuntime, type RuntimeCollaborationState } from './collaborationRuntime';
import './cloudProjects.css';
import { offlineTrust } from './runtime';
import { loadCloudProjectFile } from './studioBase';
import { DEFAULT_SCENARIO_ELEMENT_TYPE } from '../editor/scenarioTypes';

const roleLabel = { owner: 'Propriétaire', editor: 'Éditeur', viewer: 'Lecteur' };
const statusLabel = { closed: '', loading: 'Ouverture…', synced: 'À jour', pending: 'Synchronisation…', offline: 'Hors ligne · copie locale conservée', conflict: 'Choix de version nécessaire', read_only: 'Lecture seule', realtime: 'Collaboration en direct', error: 'Action nécessaire' };
export function downloadScenario(file: ScenarioFile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/vnd.scenario+json' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${file.title.replace(/[\\/:*?"<>|]/g, '-') || 'Scenario'}.scenario`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CloudProjectsPanel({ apiFactory, editor, onClose, onSignIn }: {
  apiFactory: () => AuthenticatedCommercialApi; editor: CloudProjectEditor; onClose(): void; onSignIn(): void;
}) {
  const [api] = useState(apiFactory);
  const [accountId, setAccountId] = useState('');
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [invitations, setInvitations] = useState<StudioInvitationView[]>([]);
  const [selected, setSelected] = useState<CloudProject | null>(null);
  const [detail, setDetail] = useState<StudioDetailResponse | null>(null);
  const [versions, setVersions] = useState<CloudScenarioVersion[]>([]);
  const [copies, setCopies] = useState<CloudWorkingCopy[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [createMode, setCreateMode] = useState<'empty' | 'current' | null>(null);
  const [runtime, setRuntime] = useState<OpenProjectState | null>(null);
  const [live, setLive] = useState<RuntimeCollaborationState | null>(null);
  const [restoreId, setRestoreId] = useState('');
  const dialog = useRef<HTMLElement>(null);
  const alive = useRef(true);
  const selectedGeneration = useRef(0);
  const createAttempt = useRef<{ id: string; body: Awaited<ReturnType<typeof cloudSyncRequest>> } | null>(null);

  async function refresh(id = accountId) {
    const list = await api.listCloudProjects();
    if (!alive.current) return;
    setProjects(list.projects); setInvitations(list.receivedInvitations);
    if (id) setCopies(await cloudProjectStore.list(id));
  }
  async function select(project: CloudProject) {
    const generation = ++selectedGeneration.current;
    setSelected(project); setDetail(null); setVersions([]); setRestoreId('');
    const [history, sharing] = await Promise.all([
      api.listCloudVersions(project.id),
      project.realtimeStudioId && !project.deletedAt ? api.getStudio(project.realtimeStudioId) : Promise.resolve(null),
    ]);
    if (generation !== selectedGeneration.current || !alive.current) return;
    setVersions(history.versions); setDetail(sharing);
  }
  async function run(action: () => Promise<unknown>, success = '') {
    setBusy(true); setMessage('');
    try { await action(); if (alive.current) setMessage(success); }
    catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : 'Action indisponible.'); }
    finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    const stopProject = cloudProjectRuntime.subscribe(setRuntime);
    const stopLive = collaborationRuntime.subscribe(setLive);
    dialog.current?.focus();
    void run(async () => {
      let me;
      try { me = await api.getMe(); }
      catch (error) {
        const status = (error as { status?: number }).status;
        const cached = error instanceof TypeError || (status && status >= 500) ? await offlineTrust.read() : null;
        if (!cached || !alive.current) throw error;
        setAccountId(cached.me.account.id);
        setCopies(await cloudProjectStore.list(cached.me.account.id));
        throw new Error('Hors ligne : retrouvez vos fichiers dans « Copies conservées sur cet appareil ».');
      }
      if (!alive.current) return;
      setAccountId(me.account.id); await refresh(me.account.id);
    });
    return () => { alive.current = false; ++selectedGeneration.current; stopProject(); stopLive(); };
  }, [api]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = String(new FormData(event.currentTarget).get('title')).trim();
    if (!title) return;
    await run(async () => {
      const file: ScenarioFile = createMode === 'current' ? { ...editor.readFile(), title } : {
        formatVersion: 1, title, content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: crypto.randomUUID(), scenarioType: DEFAULT_SCENARIO_ELEMENT_TYPE } }] },
        characters: [], locations: [], times: [], coverPage: createEmptyCoverPage(), coverPageHidden: false, comments: [], savedAt: new Date().toISOString(),
      };
      if (!createAttempt.current) {
        const id = crypto.randomUUID();
        await cloudProjectStore.backup(accountId, file);
        createAttempt.current = { id, body: await cloudSyncRequest(file, id, null) };
      }
      const { id, body } = createAttempt.current;
      await api.syncCloudScenario(body, id);
      createAttempt.current = null;
      setCreateMode(null); await refresh();
      await cloudProjectRuntime.open(api, accountId, id, editor);
      onClose();
    });
  }
  async function sharing() {
    if (!selected) return;
    const result = await api.ensureProjectSharing(selected.id, `project-sharing-${selected.id}`);
    const next = { ...selected, realtimeStudioId: result.studio.id };
    await refresh(); await select(next);
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget, data = new FormData(form);
    await run(async () => {
      await api.inviteStudioMember(detail.studio.id, String(data.get('email')), String(data.get('role')) as 'editor' | 'viewer', crypto.randomUUID());
      setDetail(await api.getStudio(detail.studio.id)); form.reset();
    }, 'Invitation disponible dans les Projets cloud du destinataire.');
  }
  async function memberAction(profileId: string, role: 'editor' | 'viewer' | null) {
    if (!detail) return;
    if (role) await api.changeStudioRole(detail.studio.id, profileId, role, crypto.randomUUID());
    else await api.removeStudioMember(detail.studio.id, profileId, crypto.randomUUID());
    setDetail(await api.getStudio(detail.studio.id)); await refresh();
  }
  const visible = projects.filter((p) => (filter === 'trash' ? Boolean(p.deletedAt) : !p.deletedAt && (filter === 'all' || p.sharing === filter)) && p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="modal-backdrop cloud-project-backdrop">
    <section ref={dialog} tabIndex={-1} className="cloud-project-panel" role="dialog" aria-modal="true" aria-label="Projets cloud" onKeyDown={(e) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab') {
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]') ?? [])].filter((el) => el.offsetParent !== null);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="cloud-project-header"><div><p className="cloud-eyebrow">VOTRE ESPACE DE TRAVAIL</p><h2>Projets cloud</h2><p>Vos scénarios, privés ou partagés avec les personnes de votre choix.</p></div><button type="button" aria-label="Fermer les projets cloud" onClick={onClose}>×</button></header>
      {!accountId ? <div className="cloud-empty"><h3>{busy ? 'Connexion à votre espace…' : 'Connectez-vous pour retrouver vos projets'}</h3><p>Les scénarios locaux restent disponibles dans l’éditeur.</p><button disabled={busy} onClick={onSignIn}>Ouvrir mon compte</button></div> : <>
        <div className="cloud-project-toolbar"><input aria-label="Rechercher un projet" placeholder="Rechercher un projet…" value={query} onChange={(e) => setQuery(e.target.value)} /><button disabled={busy} onClick={() => setCreateMode('empty')}>+ Nouveau projet</button><button disabled={busy} onClick={() => setCreateMode('current')}>Ajouter le scénario ouvert</button><button disabled={busy} onClick={() => void run(() => refresh())}>Actualiser</button></div>
        {createMode && <form className="cloud-create-form" onSubmit={(e) => void create(e)}><label>Nom du projet<input name="title" maxLength={120} required autoFocus readOnly={Boolean(createAttempt.current)} defaultValue={createMode === 'current' ? editor.readFile().title : ''} /></label><p>{createAttempt.current ? 'Confirmation en attente. Réessayer renverra exactement la même création, sans doublon.' : 'Le projet sera privé. Vous pourrez inviter des personnes ensuite.'}</p><button disabled={busy} type="submit">{createAttempt.current ? 'Réessayer la création' : 'Créer dans le cloud'}</button><button disabled={busy} type="button" onClick={() => { createAttempt.current = null; setCreateMode(null); }}>Annuler</button></form>}
        {invitations.length > 0 && <section className="cloud-invitations" aria-label="Invitations reçues"><h3>Invitations reçues</h3>{invitations.map((i) => <div key={i.id}><span>Invitation à un projet · {roleLabel[i.role]}</span><button disabled={busy} onClick={() => void run(async () => { await api.respondProjectInvitation(i.id, 'accept', crypto.randomUUID()); await refresh(); }, 'Projet ajouté à votre espace.')}>Accepter</button><button disabled={busy} onClick={() => void run(async () => { await api.respondProjectInvitation(i.id, 'decline', crypto.randomUUID()); await refresh(); })}>Refuser</button></div>)}</section>}
        <nav className="cloud-project-filters" aria-label="Filtrer les projets">{[['all','Tous les projets'],['private','Privés'],['shared','Partagés'],['trash','Corbeille']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</nav>
        <div className="cloud-project-layout"><div className="cloud-project-list">
          {visible.length === 0 && <div className="cloud-empty"><h3>Aucun projet ici pour le moment</h3><p>Créez un projet privé ou ajoutez le scénario actuellement ouvert.</p></div>}
          {visible.map((p) => <button key={p.id} className={`cloud-project-card ${selected?.id === p.id ? 'is-selected' : ''}`} disabled={busy} onClick={() => void run(() => select(p))}><span className="cloud-project-icon" aria-hidden="true">▤</span><span><strong>{p.title}</strong><small>{p.sharing === 'private' ? 'Privé · vous uniquement' : `Partagé · ${p.memberCount} membres`} · {roleLabel[p.role]}</small><small>Modifié le {new Date(p.updatedAt).toLocaleDateString('fr-FR')}</small></span><span aria-hidden="true">›</span></button>)}
        </div><aside className="cloud-project-detail">
          {!selected ? <div className="cloud-empty"><h3>Sélectionnez un projet</h3><p>Ouvrez-le, consultez ses versions ou choisissez avec qui le partager.</p></div> : <>
            <h3>{selected.title}</h3><p>{roleLabel[selected.role]} · {selected.sharing === 'private' ? 'Projet privé' : 'Projet partagé'}</p>
            {!selected.deletedAt && <button className="primary-button" disabled={busy || (selected.sharing === 'shared' && !selected.realtimeStudioId)} onClick={() => void run(async () => { await cloudProjectRuntime.open(api, accountId, selected.id, editor); onClose(); })}>Ouvrir le projet</button>}
            {selected.sharing === 'shared' && !selected.realtimeStudioId && <p>La collaboration nécessite un accès actif. Vérifiez votre compte.</p>}
            <p className="cloud-help">L’ouverture conserve une copie du scénario actuel sur cet appareil.</p>
            {selected.realtimeStudioId && <p className="cloud-help">Le texte est partagé en direct. Les changements de couverture et de commentaires restent dans votre copie locale.</p>}
            {selected.canShare && !detail && <button disabled={busy} onClick={() => void run(sharing)}>Gérer le partage</button>}
            {detail && <section><h4>Accès à ce projet</h4>{detail.members.map((m) => <div className="cloud-member" key={m.profileId}><span><strong>{m.displayName}{m.profileId === accountId ? ' (vous)' : ''}</strong><small>{roleLabel[m.role]}</small></span>{detail.studio.role === 'owner' && m.role !== 'owner' && <div><select aria-label={`Accès de ${m.displayName}`} value={m.role} disabled={busy} onChange={(e) => void run(() => memberAction(m.profileId, e.target.value as 'editor' | 'viewer'))}><option value="viewer">Lecteur</option><option value="editor">Éditeur</option></select><button disabled={busy} onClick={() => void run(() => memberAction(m.profileId, null))}>Retirer</button></div>}</div>)}
              {detail.studio.role === 'owner' && <form className="cloud-invite-form" onSubmit={(e) => void invite(e)}><label>Inviter par adresse e-mail<input name="email" type="email" required placeholder="nom@exemple.fr" /></label><label>Autorisation<select name="role" defaultValue="viewer"><option value="viewer">Lecteur · consulter</option><option value="editor">Éditeur · modifier</option></select></label><button disabled={busy}>Créer l’invitation</button></form>}
              {detail.invitations.filter((i) => i.status === 'pending').map((i) => <div className="cloud-member" key={i.id}><span>{i.recipient} · {roleLabel[i.role]} · en attente</span><button disabled={busy} onClick={() => void run(async () => { await api.revokeStudioInvitation(detail.studio.id, i.id, crypto.randomUUID()); setDetail(await api.getStudio(detail.studio.id)); })}>Annuler</button></div>)}
            </section>}
            <details><summary>Historique des versions ({versions.length})</summary>{selected.realtimeStudioId && <p className="cloud-help">Pour préserver les modifications collaboratives, une ancienne version se récupère comme fichier indépendant ; elle ne remplace pas le projet partagé.</p>}{[...versions].reverse().map((v) => <div className="cloud-version" key={v.id}><span>Version {v.versionNumber} · {new Date(v.createdAt).toLocaleString('fr-FR')}</span><button disabled={busy} onClick={() => void run(async () => downloadScenario(await loadCloudProjectFile(api, v, new AbortController().signal)))}>Télécharger</button>{selected.role !== 'viewer' && !selected.realtimeStudioId && <button disabled={busy || runtime?.project?.id === selected.id} onClick={() => setRestoreId(v.id)}>Restaurer</button>}</div>)}{restoreId && <div className="cloud-notice"><p>Créer une nouvelle version à partir de cette version ? L’historique sera conservé.</p><button disabled={busy} onClick={() => void run(async () => { await api.restoreCloudVersion(selected.id, restoreId, crypto.randomUUID()); await refresh(); await select(selected); }, 'Version restaurée.')} >Confirmer la restauration</button><button onClick={() => setRestoreId('')}>Annuler</button></div>}</details>
            {selected.role === 'owner' && !selected.deletedAt && <details><summary>Mettre dans la corbeille</summary><p>Le projet sera fermé aux autres membres. Son historique sera conservé.</p><button disabled={busy} onClick={() => void run(async () => { if (runtime?.project?.id === selected.id) await cloudProjectRuntime.close(); await api.deleteCloudScenario(selected.id, crypto.randomUUID()); setSelected(null); setDetail(null); await refresh(); }, 'Projet placé dans la corbeille.')}>Confirmer</button></details>}
          </>}
        </aside></div>
        {runtime?.project && <div className="cloud-current" aria-live="polite"><strong>{runtime.project.title} · {statusLabel[runtime.status]}</strong>{runtime.status === 'realtime' && <span>{live?.status === 'online' ? `${live.presence.length} membre(s) présent(s)` : live?.status === 'read_only' ? 'Lecture seule' : live?.status === 'reconnecting' ? 'Reconnexion…' : live?.status === 'conflict' || live?.status === 'recovery_required' ? 'Conflit · copie locale conservée' : 'Connexion…'}{live?.syncLag ? ` · ${live.syncLag} modification(s) en attente` : ''}</span>}<p>{runtime.message}</p><button onClick={() => downloadScenario(editor.readFile())}>Télécharger ma copie locale</button>{runtime.status === 'conflict' && <button disabled={busy} onClick={() => void run(async () => { downloadScenario(editor.readFile()); await cloudProjectRuntime.open(api, accountId, runtime.project!.id, editor, true); })}>Conserver ma copie et ouvrir la version cloud</button>}<button onClick={() => void run(async () => { await cloudProjectRuntime.close(); editor.setReadOnly(false); }, 'Le scénario ouvert est maintenant une copie locale indépendante.')}>Continuer comme copie locale</button></div>}
        <details className="cloud-local-copies" onToggle={(e) => { if (e.currentTarget.open) void cloudProjectStore.list(accountId).then(setCopies); }}><summary>Copies conservées sur cet appareil ({copies.length})</summary><p>Ces fichiers restent sur cet appareil après une déconnexion. Vous pouvez les télécharger pour les garder ailleurs.</p>{[...copies].sort((a,b) => b.savedAt.localeCompare(a.savedAt)).map((c) => <div className="cloud-version" key={c.projectId}><span>{c.file.title} · {new Date(c.savedAt).toLocaleString('fr-FR')}</span><button onClick={() => downloadScenario(c.file)}>Télécharger</button></div>)}</details>
      </>}
      {message && <p className="cloud-notice" role="status">{message}</p>}
    </section>
  </div>;
}

export function CloudProjectStatus({ onOpen }: { onOpen(): void }) {
  const [state, setState] = useState<OpenProjectState | null>(null);
  const [live, setLive] = useState<RuntimeCollaborationState | null>(null);
  useEffect(() => cloudProjectRuntime.subscribe(setState), []);
  useEffect(() => collaborationRuntime.subscribe(setLive), []);
  if (!state?.project) return null;
  const status = state.status === 'realtime' ? live?.status === 'online' ? `${live.presence.length} présent(s)${live.syncLag ? ' · synchronisation…' : ' · à jour'}` : live?.status === 'read_only' ? 'Lecture seule' : live?.status === 'conflict' || live?.status === 'recovery_required' ? 'Conflit à résoudre' : 'Reconnexion…' : statusLabel[state.status];
  return <button className="menu-button cloud-menu-status" onClick={onOpen} title={state.message}>{state.project.title} · {status}</button>;
}

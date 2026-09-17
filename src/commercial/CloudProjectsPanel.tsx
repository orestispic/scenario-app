import { UiIcon } from '../ui/UiIcon';
import { UiSelect } from '../ui/UiSelect';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type PointerEvent } from 'react';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProject } from './contractsV9';
import type { StudioDetailResponse, StudioInvitationView } from './contractsV7';
import type { CloudScenarioVersion } from './contractsV6';
import type { ContactListResponse, ContactView } from './contractsV15';
import { createEmptyCoverPage, type ScenarioFile } from '../document/scenarioFile';
import { cloudProjectRuntime, cloudSyncRequest, type CloudProjectEditor, type OpenProjectState } from './cloudProjectRuntime';
import { cloudProjectStore, type CloudWorkingCopy } from './cloudProjectStore';
import { collaborationRuntime, type RuntimeCollaborationState } from './collaborationRuntime';
import './cloudProjects.css';
import { offlineTrust } from './runtime';
import { loadCloudProjectFile } from './studioBase';
import { downloadCloudProject } from './cloudProjectDownload';
import { DEFAULT_SCENARIO_ELEMENT_TYPE } from '../editor/scenarioTypes';
import {
  addCloudProjectFolder,
  cloudFolderPath,
  moveCloudProject,
  moveCloudProjectFolder,
  readCloudProjectFolders,
  removeCloudProjectFolder,
  writeCloudProjectFolders,
  type CloudProjectFolderState,
} from './cloudProjectFolders';

const roleLabel = { owner: 'Propriétaire', editor: 'Éditeur', viewer: 'Lecteur' };
const statusLabel = { closed: '', loading: 'Ouverture…', synced: 'À jour', pending: 'Synchronisation…', offline: 'Hors ligne · copie locale conservée', conflict: 'Choix de version nécessaire', read_only: 'Lecture seule', realtime: 'Collaboration en direct', error: 'Action nécessaire' };
const EMPTY_FOLDER_STATE: CloudProjectFolderState = { folders: [], projectFolders: {} };
const EMPTY_CONTACTS: ContactListResponse = { contractVersion: '2026-09-v15', contacts: [], receivedRequests: [], sentRequests: [], request_id: '' };

type ExplorerDrag = { kind: 'project' | 'folder'; id: string };
type ExplorerContextMenu = { x: number; y: number; folderId: string | null; openFolderId?: string; target?: ExplorerDrag };
type CloudViewMode = 'icons' | 'list';
type ExplorerSelectionBox = { left: number; top: number; width: number; height: number };
type ExplorerSelectionStart = { clientX: number; clientY: number; additive: boolean; previous: ExplorerDrag[] };

const CLOUD_VIEW_MODE_KEY = 'senario-cloud-project-view-mode';

function formatProjectDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatCloudUsage(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Go utilisés`;
}

function explorerEntryKey(entry: ExplorerDrag): string {
  return `${entry.kind}:${entry.id}`;
}

function uniqueExplorerEntries(entries: ExplorerDrag[]): ExplorerDrag[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (!entry.id || (entry.kind !== 'project' && entry.kind !== 'folder')) return false;
    const key = explorerEntryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scenarioText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const item = node as { text?: unknown; content?: unknown[] };
  return `${typeof item.text === 'string' ? item.text : ''} ${Array.isArray(item.content) ? item.content.map(scenarioText).join(' ') : ''}`;
}

export function estimateScenarioPageCount(file: ScenarioFile): number {
  const words = scenarioText(file.content).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const screenplayPages = Math.max(1, Math.ceil(words / 250));
  return screenplayPages + (file.coverPageHidden ? 0 : 1);
}

function CloudScenarioIcon({ updatedAt, pages }: { updatedAt: string; pages: number | null | undefined }) {
  const date = new Date(updatedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return <span className="cloud-scenario-icon" aria-hidden="true">
    <svg viewBox="0 0 68 82"><path className="cloud-scenario-paper" d="M10 2h32l16 16v62H10z"/><path className="cloud-scenario-fold" d="M42 2v16h16"/><path className="cloud-scenario-lines" d="M20 29h28M20 37h28M20 45h20"/></svg>
    <span className="cloud-scenario-icon-pages">{pages === undefined ? '…' : pages === null ? '?' : `≈ ${pages}`} p.</span>
    <span className="cloud-scenario-icon-date">{date}</span>
  </span>;
}

function CloudFolderIcon() {
  return <span className="cloud-folder-icon" aria-hidden="true"><svg viewBox="0 0 72 58"><path d="M3 13a6 6 0 0 1 6-6h20l7 8h27a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6z"/><path d="M3 23h66"/></svg></span>;
}
export function downloadScenario(file: ScenarioFile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/vnd.scenario+json' }));
  const a = document.createElement('a'); a.href = url;
  a.download = `${file.title.replace(/[\\/:*?"<>|]/g, '-') || 'Scenario'}.scenario`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CloudProjectsPanel({ apiFactory, editor, onClose, onSignIn, embedded = false }: {
  apiFactory: () => AuthenticatedCommercialApi; editor: CloudProjectEditor; onClose(): void; onSignIn(): void; embedded?: boolean;
}) {
  const [api] = useState(apiFactory);
  const [accountId, setAccountId] = useState('');
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [invitations, setInvitations] = useState<StudioInvitationView[]>([]);
  const [contacts, setContacts] = useState<ContactListResponse>(EMPTY_CONTACTS);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contactToRemove, setContactToRemove] = useState<ContactView | null>(null);
  const [selected, setSelected] = useState<CloudProject | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
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
  const [folderState, setFolderState] = useState<CloudProjectFolderState>(EMPTY_FOLDER_STATE);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentId, setCreateFolderParentId] = useState<string | null>(null);
  const [createProjectFolderId, setCreateProjectFolderId] = useState<string | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<ExplorerDrag[]>([]);
  const [draggedEntries, setDraggedEntries] = useState<ExplorerDrag[]>([]);
  const [dropFolderId, setDropFolderId] = useState<string | 'root' | null>(null);
  const [contextMenu, setContextMenu] = useState<ExplorerContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExplorerDrag | null>(null);
  const [viewMode, setViewMode] = useState<CloudViewMode>(() => {
    try { return window.localStorage.getItem(CLOUD_VIEW_MODE_KEY) === 'list' ? 'list' : 'icons'; }
    catch { return 'icons'; }
  });
  const [projectPages, setProjectPages] = useState<Record<string, number | null>>({});
  const [projectStorageBytes, setProjectStorageBytes] = useState<Record<string, number>>({});
  const [selectionBox, setSelectionBox] = useState<ExplorerSelectionBox | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const projectList = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const pageCountCache = useRef(new Map<string, number | null>());
  const loadingPageCounts = useRef(new Set<string>());
  const storageBytesCache = useRef(new Map<string, number>());
  const selectionStart = useRef<ExplorerSelectionStart | null>(null);
  const marqueeSelectionOccurred = useRef(false);
  const selectedGeneration = useRef(0);
  const createAttempt = useRef<{ id: string; body: Awaited<ReturnType<typeof cloudSyncRequest>> } | null>(null);

  async function refresh(id = accountId) {
    const [list, directory] = await Promise.all([api.listCloudProjects(), api.listContacts()]);
    if (!alive.current) return;
    setProjects(list.projects); setInvitations(list.receivedInvitations);
    setContacts(directory);
    if (id) setCopies(await cloudProjectStore.list(id));
  }
  async function select(project: CloudProject) {
    const generation = ++selectedGeneration.current;
    setSelectedFolderId(null);
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

  useEffect(() => {
    if (!accountId) {
      setFolderState(EMPTY_FOLDER_STATE);
      setActiveFolderId(null);
      setSelectedEntries([]);
      setDraggedEntries([]);
      setProjectStorageBytes({});
      return;
    }
    setFolderState(readCloudProjectFolders(window.localStorage, accountId));
    setActiveFolderId(null);
    pageCountCache.current.clear();
    loadingPageCounts.current.clear();
    storageBytesCache.current.clear();
    setProjectPages({});
    setProjectStorageBytes({});
    setSelectedEntries([]);
    setDraggedEntries([]);
  }, [accountId]);

  function updateFolders(update: (previous: CloudProjectFolderState) => CloudProjectFolderState) {
    setFolderState((previous) => {
      const next = update(previous);
      if (next !== previous) writeCloudProjectFolders(window.localStorage, accountId, next);
      return next;
    });
  }

  function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get('folderName') ?? '');
    const next = addCloudProjectFolder(folderState, name, createFolderParentId);
    if (next === folderState) {
      setMessage('Choisissez un nom de dossier différent.');
      return;
    }
    writeCloudProjectFolders(window.localStorage, accountId, next);
    setFolderState(next);
    setCreateFolderOpen(false);
    form.reset();
    setMessage(`Dossier « ${next.folders[next.folders.length - 1]?.name} » créé.`);
  }

  function beginFolderCreation(parentId: string | null = activeFolderId) {
    setContextMenu(null);
    setCreateFolderParentId(parentId);
    setCreateFolderOpen(true);
  }

  function beginProjectCreation(mode: 'empty' | 'current', folderId: string | null = activeFolderId) {
    setContextMenu(null);
    setCreateProjectFolderId(folderId);
    setCreateMode(mode);
  }

  function isEntrySelected(entry: ExplorerDrag) {
    return selectedEntries.some((candidate) => explorerEntryKey(candidate) === explorerEntryKey(entry));
  }

  function isEntryDragged(entry: ExplorerDrag) {
    return draggedEntries.some((candidate) => explorerEntryKey(candidate) === explorerEntryKey(entry));
  }

  function entriesForMove(entries: ExplorerDrag[]) {
    const unique = uniqueExplorerEntries(entries);
    const movedFolderIds = new Set(unique.filter((entry) => entry.kind === 'folder').map((entry) => entry.id));
    return unique.filter((entry) => entry.kind !== 'folder' || !cloudFolderPath(folderState, entry.id)
      .slice(0, -1)
      .some((folder) => movedFolderIds.has(folder.id)));
  }

  function moveEntriesToFolder(entries: ExplorerDrag[], folderId: string | null) {
    const moving = entriesForMove(entries);
    const folder = folderId ? folderState.folders.find((item) => item.id === folderId) : null;
    let movedCount = 0;
    updateFolders((previous) => moving.reduce((next, entry) => {
      if (entry.kind === 'project') {
        if ((next.projectFolders[entry.id] ?? null) === folderId) return next;
        movedCount += 1;
        return moveCloudProject(next, entry.id, folderId);
      }
      const moved = moveCloudProjectFolder(next, entry.id, folderId);
      if (moved !== next) movedCount += 1;
      return moved;
    }, previous));
    setDropFolderId(null);
    setDraggedEntries([]);
    if (!moving.length || !movedCount) {
      setMessage('Aucun élément ne peut être déplacé à cet emplacement.');
      return;
    }
    const destination = folder ? `« ${folder.name} »` : 'Tous les projets';
    setMessage(`${movedCount} élément${movedCount > 1 ? 's' : ''} déplacé${movedCount > 1 ? 's' : ''} dans ${destination}.`);
  }

  function startEntryDrag(event: DragEvent<HTMLButtonElement>, entry: ExplorerDrag) {
    const moving = isEntrySelected(entry) ? entriesForMove(selectedEntries) : [entry];
    if (!isEntrySelected(entry)) setSelectedEntries(moving);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-senario-cloud-entry', JSON.stringify(moving));
    setDraggedEntries(moving);
  }

  function droppedEntry(event: DragEvent, folderId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    let entries = draggedEntries;
    try {
      const transferred = JSON.parse(event.dataTransfer.getData('application/x-senario-cloud-entry')) as unknown;
      const candidateEntries = Array.isArray(transferred) ? transferred : [transferred];
      entries = uniqueExplorerEntries(candidateEntries.filter((entry): entry is ExplorerDrag => Boolean(entry) && typeof entry === 'object' &&
        ((entry as ExplorerDrag).kind === 'project' || (entry as ExplorerDrag).kind === 'folder') && typeof (entry as ExplorerDrag).id === 'string'));
    } catch { /* The in-memory drag state remains the fallback. */ }
    moveEntriesToFolder(entries, folderId);
  }

  function selectEntry(entry: ExplorerDrag, additive: boolean) {
    const alreadySelected = isEntrySelected(entry);
    const next = additive
      ? alreadySelected
        ? selectedEntries.filter((candidate) => explorerEntryKey(candidate) !== explorerEntryKey(entry))
        : [...selectedEntries, entry]
      : [entry];
    setSelectedEntries(uniqueExplorerEntries(next));
    return additive && alreadySelected ? false : true;
  }

  function selectProjectFromExplorer(event: MouseEvent<HTMLButtonElement>, project: CloudProject) {
    const entry = { kind: 'project' as const, id: project.id };
    const active = selectEntry(entry, event.ctrlKey || event.metaKey);
    if (active) void select(project).catch((error) => setMessage(error instanceof Error ? error.message : 'Projet indisponible.'));
    else if (selectedEntries.length === 1) { setSelected(null); setDetail(null); }
  }

  function selectFolderFromExplorer(event: MouseEvent<HTMLButtonElement>, folderId: string) {
    const entry = { kind: 'folder' as const, id: folderId };
    const active = selectEntry(entry, event.ctrlKey || event.metaKey);
    if (active) inspectFolder(folderId);
    else if (selectedEntries.length === 1) setSelectedFolderId(null);
  }

  function updateMarqueeSelection(event: PointerEvent<HTMLDivElement>) {
    const start = selectionStart.current;
    const container = projectList.current;
    if (!start || !container) return;
    const bounds = container.getBoundingClientRect();
    const viewportLeft = Math.min(start.clientX, event.clientX);
    const viewportTop = Math.min(start.clientY, event.clientY);
    const viewportRight = Math.max(start.clientX, event.clientX);
    const viewportBottom = Math.max(start.clientY, event.clientY);
    const moved = Math.abs(event.clientX - start.clientX) > 3 || Math.abs(event.clientY - start.clientY) > 3;
    if (!moved) return;
    marqueeSelectionOccurred.current = true;
    const hitEntries = [...container.querySelectorAll<HTMLButtonElement>('[data-cloud-entry]')].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.right < viewportLeft || rect.left > viewportRight || rect.bottom < viewportTop || rect.top > viewportBottom) return [];
      const entry = element.dataset.cloudEntry;
      const [kind, id] = entry?.split(':') ?? [];
      return (kind === 'project' || kind === 'folder') && id ? [{ kind, id }] as ExplorerDrag[] : [];
    });
    setSelectedEntries(uniqueExplorerEntries(start.additive ? [...start.previous, ...hitEntries] : hitEntries));
    setSelectionBox({
      left: viewportLeft - bounds.left + container.scrollLeft,
      top: viewportTop - bounds.top + container.scrollTop,
      width: viewportRight - viewportLeft,
      height: viewportBottom - viewportTop,
    });
  }

  function beginMarqueeSelection(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const additive = event.ctrlKey || event.metaKey;
    selectionStart.current = { clientX: event.clientX, clientY: event.clientY, additive, previous: additive ? selectedEntries : [] };
    marqueeSelectionOccurred.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endMarqueeSelection(event: PointerEvent<HTMLDivElement>) {
    if (!selectionStart.current) return;
    selectionStart.current = null;
    setSelectionBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function showExplorerMenu(event: MouseEvent, folderId: string | null, openFolderId?: string, target?: ExplorerDrag) {
    event.preventDefault();
    event.stopPropagation();
    const width = 220, height = target ? 178 : openFolderId ? 132 : 94;
    setContextMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      folderId,
      openFolderId,
      target,
    });
  }

  function changeViewMode(next: CloudViewMode) {
    setViewMode(next);
    try { window.localStorage.setItem(CLOUD_VIEW_MODE_KEY, next); }
    catch { /* The selected view still remains active for this session. */ }
  }

  async function confirmDeleteTarget() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'folder') {
      const folder = folderState.folders.find((item) => item.id === deleteTarget.id);
      if (!folder) { setDeleteTarget(null); return; }
      const destination = folder.parentId;
      const next = removeCloudProjectFolder(folderState, folder.id);
      writeCloudProjectFolders(window.localStorage, accountId, next);
      setFolderState(next);
      if (activeFolderId === folder.id) setActiveFolderId(destination);
      setSelectedFolderId(null);
      setMessage(`Dossier « ${folder.name} » supprimé. Son contenu a été conservé.`);
      setDeleteTarget(null);
      return;
    }
    const project = projects.find((item) => item.id === deleteTarget.id);
    if (!project || project.role !== 'owner' || project.deletedAt) { setDeleteTarget(null); return; }
    await run(async () => {
      if ((runtime?.rootProjectId ?? runtime?.project?.id) === project.id) await cloudProjectRuntime.close();
      await api.deleteCloudScenario(project.id, crypto.randomUUID());
      updateFolders((previous) => moveCloudProject(previous, project.id, null));
      setSelected(null);
      setDetail(null);
      setDeleteTarget(null);
      await refresh();
    }, 'Projet placé dans la corbeille.');
  }

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
      if (createProjectFolderId) updateFolders((previous) => moveCloudProject(previous, id, createProjectFolderId));
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
      await api.inviteStudioMember(detail.studio.id, String(data.get('contactEmail')), String(data.get('role')) as 'editor' | 'viewer', crypto.randomUUID());
      setDetail(await api.getStudio(detail.studio.id)); form.reset();
    }, 'Invitation disponible dans les Projets cloud du destinataire.');
  }
  async function memberAction(profileId: string, role: 'editor' | 'viewer' | null) {
    if (!detail) return;
    if (role) await api.changeStudioRole(detail.studio.id, profileId, role, crypto.randomUUID());
    else await api.removeStudioMember(detail.studio.id, profileId, crypto.randomUUID());
    setDetail(await api.getStudio(detail.studio.id)); await refresh();
  }

  async function openProject(project: CloudProject) {
    await run(async () => {
      await cloudProjectRuntime.open(api, accountId, project.id, editor);
      onClose();
    });
  }

  async function downloadSelectedProject() {
    if (!selected) return;
    downloadScenario(await downloadCloudProject(api, selected));
  }

  async function requestContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get('contactEmail') ?? '').trim();
    if (!email) return;
    await run(async () => { await api.requestContact(email, crypto.randomUUID()); setContacts(await api.listContacts()); form.reset(); }, 'Demande de contact envoyée.');
  }

  async function respondContact(requestId: string, decision: 'accept' | 'decline' | 'cancel') {
    await api.respondContactRequest(requestId, decision, crypto.randomUUID());
    setContacts(await api.listContacts());
  }

  async function removeContact(contact: ContactView) {
    await api.removeContact(contact.profileId, crypto.randomUUID());
    setContactToRemove(null);
    await refresh();
    if (selected) await select(selected);
  }

  function inspectFolder(folderId: string) {
    ++selectedGeneration.current;
    setSelectedFolderId(folderId);
    setSelected(null);
    setDetail(null);
    setVersions([]);
    setRestoreId('');
  }

  function openFolder(folderId: string | null) {
    ++selectedGeneration.current;
    setActiveFolderId(folderId);
    setQuery('');
    setSelectedFolderId(null);
    setSelected(null);
    setDetail(null);
    setVersions([]);
    setRestoreId('');
    setSelectedEntries([]);
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingProjects = projects.filter((project) =>
    (filter === 'trash'
      ? Boolean(project.deletedAt)
      : !project.deletedAt && (filter === 'all' || project.sharing === filter)) &&
    project.title.toLocaleLowerCase().includes(normalizedQuery));
  const activeFolder = folderState.folders.find((folder) => folder.id === activeFolderId) ?? null;
  const selectedFolder = folderState.folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const activeFolderPath = cloudFolderPath(folderState, activeFolderId);
  const visible = normalizedQuery || filter === 'trash'
    ? matchingProjects
    : matchingProjects.filter((project) => (folderState.projectFolders[project.id] ?? null) === activeFolderId);
  const visibleFolders = filter === 'trash' ? [] : folderState.folders.filter((folder) => normalizedQuery
    ? folder.name.toLocaleLowerCase().includes(normalizedQuery)
    : folder.parentId === activeFolderId);
  const pageCountKey = projects.map((project) => `${project.id}:${project.currentVersionId ?? ''}`).join('|');

  useEffect(() => {
    const controller = new AbortController();
    const localFiles = new Map(copies.map((copy) => [copy.projectId, copy.file]));
    const pending = projects.filter((project) => !project.deletedAt && !loadingPageCounts.current.has(project.id) &&
      (!storageBytesCache.current.has(project.id) || (project.currentVersionId && !pageCountCache.current.has(project.id))));
    const nextMetrics = () => {
      setProjectPages(Object.fromEntries(pageCountCache.current));
      setProjectStorageBytes(Object.fromEntries(storageBytesCache.current));
    };
    const load = async (project: CloudProject) => {
      loadingPageCounts.current.add(project.id);
      let sizeFallback: number | null = null;
      try {
        const history = await api.listCloudVersions(project.id);
        storageBytesCache.current.set(project.id, history.versions.reduce((total, version) => total + version.sizeBytes, 0));
        const version = history.versions.find((item) => item.id === project.currentVersionId);
        if (!version) {
          if (project.currentVersionId) throw new Error('Version actuelle indisponible.');
          pageCountCache.current.set(project.id, null);
          return;
        }
        sizeFallback = Math.max(1, Math.ceil(version.sizeBytes / 3_500));
        const local = localFiles.get(project.id);
        if (local) pageCountCache.current.set(project.id, estimateScenarioPageCount(local));
        else {
          const file = await loadCloudProjectFile(api, version, controller.signal);
          pageCountCache.current.set(project.id, estimateScenarioPageCount(file));
        }
      } catch {
        if (!controller.signal.aborted) {
          pageCountCache.current.set(project.id, sizeFallback);
          if (!storageBytesCache.current.has(project.id)) storageBytesCache.current.set(project.id, 0);
        }
      } finally {
        loadingPageCounts.current.delete(project.id);
        if (!controller.signal.aborted && alive.current) nextMetrics();
      }
    };
    void (async () => {
      for (let index = 0; index < pending.length; index += 3) {
        await Promise.all(pending.slice(index, index + 3).map(load));
        if (controller.signal.aborted) break;
      }
    })();
    return () => controller.abort();
  }, [api, pageCountKey, copies]);

  const selectedProjectPages = selected ? projectPages[selected.id] : undefined;
  const selectedLocalSave = selected ? copies.filter((copy) => copy.projectId === selected.id)
    .sort((first, second) => second.savedAt.localeCompare(first.savedAt))[0] ?? null : null;
  const cloudStorageBytes = projects.filter((project) => !project.deletedAt)
    .reduce((total, project) => total + (projectStorageBytes[project.id] ?? 0), 0);
  const cloudStoragePending = projects.some((project) => !project.deletedAt && projectStorageBytes[project.id] === undefined);
  const deleteProject = deleteTarget?.kind === 'project' ? projects.find((project) => project.id === deleteTarget.id) ?? null : null;
  const deleteFolder = deleteTarget?.kind === 'folder' ? folderState.folders.find((folder) => folder.id === deleteTarget.id) ?? null : null;

  return <div className={embedded ? 'cloud-workspace-page' : 'modal-backdrop cloud-project-backdrop'}>
    <section ref={dialog} tabIndex={-1} className="cloud-project-panel" role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="Projets cloud" onKeyDown={(e) => {
      if (e.key === 'Escape' && contactToRemove) { e.stopPropagation(); setContactToRemove(null); return; }
      if (e.key === 'Escape' && contactsOpen) { e.stopPropagation(); setContactsOpen(false); return; }
      if (e.key === 'Escape' && deleteTarget) { e.stopPropagation(); setDeleteTarget(null); return; }
      if (e.key === 'Escape' && contextMenu) { e.stopPropagation(); setContextMenu(null); return; }
      if (e.key === 'Escape' && !busy && !embedded) onClose();
      if (e.key === 'Tab' && !embedded) {
        const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, summary, [tabindex="0"]') ?? [])].filter((el) => el.offsetParent !== null);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header className="cloud-project-header"><h2>Projets cloud</h2>{!embedded && <button type="button" aria-label="Fermer les projets cloud" onClick={onClose}><UiIcon name="x"/></button>}</header>
      {!accountId ? <div className="cloud-empty"><h3>{busy ? 'Connexion à votre espace…' : 'Connectez-vous pour retrouver vos projets'}</h3><p>Les scénarios locaux restent disponibles dans l’éditeur.</p><button disabled={busy} onClick={onSignIn}>Ouvrir mon compte</button></div> : <>
        <div className="cloud-project-toolbar"><input className="cloud-project-search" aria-label="Rechercher un projet ou un dossier" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="cloud-view-switch" role="group" aria-label="Mode d’affichage"><button type="button" aria-label="Vue en icônes" title="Vue en icônes" aria-pressed={viewMode === 'icons'} onClick={() => changeViewMode('icons')}><span className="cloud-grid-view-icon" aria-hidden="true"><i/><i/><i/><i/></span></button><button type="button" aria-label="Vue en liste" title="Vue en liste" aria-pressed={viewMode === 'list'} onClick={() => changeViewMode('list')}><UiIcon name="list"/></button></div><div className="cloud-storage-usage" aria-live="polite" title="Espace utilisé par les versions conservées dans le cloud"><span>Stockage cloud</span><strong>{cloudStoragePending ? 'Calcul…' : formatCloudUsage(cloudStorageBytes)}</strong></div><button disabled={busy} onClick={() => setContactsOpen(true)}><UiIcon name="user"/> Contacts{contacts.receivedRequests.length ? ` (${contacts.receivedRequests.length})` : ''}</button><button disabled={busy} onClick={() => beginProjectCreation('empty')}><UiIcon name="plus"/> Nouveau projet</button><button disabled={busy || filter === 'trash'} onClick={() => beginFolderCreation()}><UiIcon name="folder"/> Nouveau dossier</button><button disabled={busy} onClick={() => beginProjectCreation('current')}>Ajouter le scénario ouvert</button><button disabled={busy} onClick={() => void run(() => refresh())}>Actualiser</button></div>
        {createFolderOpen && <form className="cloud-folder-create-form" onSubmit={createFolder}><label>Nom du dossier<input name="folderName" maxLength={80} required autoFocus placeholder="Ex. Courts-métrages" /></label><span className="cloud-create-location">Dans : {createFolderParentId ? cloudFolderPath(folderState, createFolderParentId).map((folder) => folder.name).join(' / ') : 'Tous les projets'}</span><button type="submit">Créer</button><button type="button" onClick={() => setCreateFolderOpen(false)}>Annuler</button></form>}
        {createMode && <form className="cloud-create-form" onSubmit={(e) => void create(e)}><label>Nom du projet<input name="title" maxLength={120} required autoFocus readOnly={Boolean(createAttempt.current)} defaultValue={createMode === 'current' ? editor.readFile().title : ''} /></label><p>{createAttempt.current ? 'Confirmation en attente. Réessayer renverra exactement la même création, sans doublon.' : `Le projet sera privé et créé dans ${createProjectFolderId ? `« ${cloudFolderPath(folderState, createProjectFolderId).map((folder) => folder.name).join(' / ')} »` : '« Tous les projets »'}.`}</p><button disabled={busy} type="submit">{createAttempt.current ? 'Réessayer la création' : 'Créer dans le cloud'}</button><button disabled={busy} type="button" onClick={() => { createAttempt.current = null; setCreateMode(null); }}>Annuler</button></form>}
        {invitations.length > 0 && <section className="cloud-invitations" aria-label="Invitations reçues"><div className="cloud-invitations-heading"><h3>Invitations</h3><span>{invitations.length} en attente</span></div>{invitations.map((i) => <div key={i.id}><span><strong>Invitation à rejoindre un projet</strong><small>Rôle attribué : {roleLabel[i.role]}</small></span><button disabled={busy} onClick={() => void run(async () => { await api.respondProjectInvitation(i.id, 'accept', crypto.randomUUID()); await refresh(); }, 'Projet ajouté à votre espace.')}>Accepter</button><button disabled={busy} onClick={() => void run(async () => { await api.respondProjectInvitation(i.id, 'decline', crypto.randomUUID()); await refresh(); })}>Refuser</button></div>)}</section>}
        <nav className="cloud-project-filters" aria-label="Filtrer les projets">{[['all','Tous les projets'],['private','Privés'],['shared','Partagés'],['trash','Corbeille']].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelected(null); setSelectedFolderId(null); setSelectedEntries([]); if (key === 'trash') setActiveFolderId(null); }}>{label}</button>)}</nav>
        {!normalizedQuery && filter !== 'trash' && <div className="cloud-folder-navigation" aria-label="Emplacement actuel"><button className={dropFolderId === 'root' ? 'is-drop-target' : ''} onClick={() => openFolder(null)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropFolderId('root'); }} onDragLeave={() => setDropFolderId(null)} onDrop={(event) => droppedEntry(event, null)}><CloudFolderIcon/> Tous les projets</button>{activeFolderPath.map((folder, index) => <span className="cloud-breadcrumb-part" key={folder.id}><UiIcon name="chevron"/><button className={dropFolderId === folder.id ? 'is-drop-target' : ''} onClick={() => openFolder(folder.id)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropFolderId(folder.id); }} onDragLeave={() => setDropFolderId(null)} onDrop={(event) => droppedEntry(event, folder.id)} aria-current={index === activeFolderPath.length - 1 ? 'location' : undefined}>{folder.name}</button></span>)}</div>}
        <div className="cloud-project-layout"><div ref={projectList} className={`cloud-project-list is-${viewMode} ${dropFolderId === (activeFolderId ?? 'root') ? 'is-current-drop-target' : ''}`} aria-label={activeFolder ? `Projets du dossier ${activeFolder.name}` : 'Projets et dossiers cloud'} onPointerDown={beginMarqueeSelection} onPointerMove={updateMarqueeSelection} onPointerUp={endMarqueeSelection} onPointerCancel={endMarqueeSelection} onClick={(event) => { if (event.target !== event.currentTarget) return; if (marqueeSelectionOccurred.current) { marqueeSelectionOccurred.current = false; return; } setSelected(null); setSelectedFolderId(null); setSelectedEntries([]); }} onContextMenu={(event) => showExplorerMenu(event, activeFolderId)} onDragOver={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropFolderId(activeFolderId ?? 'root'); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropFolderId(null); }} onDrop={(event) => droppedEntry(event, activeFolderId)}>
          {visibleFolders.map((folder) => {
            const projectCount = projects.filter((project) => !project.deletedAt && folderState.projectFolders[project.id] === folder.id).length;
            const folderCount = folderState.folders.filter((candidate) => candidate.parentId === folder.id).length;
            const itemCount = projectCount + folderCount;
            const entry = { kind: 'folder' as const, id: folder.id };
            return <button key={folder.id} data-cloud-entry={explorerEntryKey(entry)} className={`cloud-folder-card ${isEntrySelected(entry) ? 'is-selected' : ''} ${dropFolderId === folder.id ? 'is-drop-target' : ''} ${isEntryDragged(entry) ? 'is-dragging' : ''}`} draggable={!busy} onClick={(event) => selectFolderFromExplorer(event, folder.id)} onDoubleClick={() => openFolder(folder.id)} onContextMenu={(event) => showExplorerMenu(event, folder.id, folder.id, entry)} onDragStart={(event) => startEntryDrag(event, entry)} onDragEnd={() => { setDraggedEntries([]); setDropFolderId(null); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropFolderId(folder.id); }} onDragLeave={() => setDropFolderId(null)} onDrop={(event) => droppedEntry(event, folder.id)}><CloudFolderIcon/><span><strong>{folder.name}</strong><small>{itemCount} élément{itemCount > 1 ? 's' : ''}</small>{normalizedQuery && <small>{cloudFolderPath(folderState, folder.parentId).map((item) => item.name).join(' / ') || 'Tous les projets'}</small>}</span></button>;
          })}
          {visible.length === 0 && visibleFolders.length === 0 && <div className="cloud-empty"><h3>Aucun élément ici</h3><p>{activeFolder ? 'Glissez un scénario ou un dossier ici, ou utilisez le clic droit.' : 'Créez un dossier ou un projet avec les boutons ou le clic droit.'}</p></div>}
          {visible.map((project) => {
            const entry = { kind: 'project' as const, id: project.id };
            return <button key={project.id} data-cloud-entry={explorerEntryKey(entry)} className={`cloud-project-card ${isEntrySelected(entry) ? 'is-selected' : ''} ${isEntryDragged(entry) ? 'is-dragging' : ''}`} disabled={busy} draggable={!busy && !project.deletedAt} onDragStart={(event) => startEntryDrag(event, entry)} onDragEnd={() => { setDraggedEntries([]); setDropFolderId(null); }} onClick={(event) => selectProjectFromExplorer(event, project)} onDoubleClick={() => void openProject(project)} onContextMenu={(event) => showExplorerMenu(event, folderState.projectFolders[project.id] ?? null, undefined, entry)} title={`${project.title} · ${project.sharing === 'private' ? 'Privé' : `Partagé avec ${project.memberCount} membres`}`}><CloudScenarioIcon updatedAt={project.updatedAt} pages={projectPages[project.id]}/><span><strong>{project.title}</strong><small className="cloud-item-list-meta">{projectPages[project.id] === undefined ? 'Calcul des pages…' : projectPages[project.id] === null ? 'Pages indisponibles' : `${projectPages[project.id]} page${projectPages[project.id] === 1 ? '' : 's'}`} · Modifié {new Date(project.updatedAt).toLocaleDateString('fr-FR')}</small></span></button>;
          })}
          {selectionBox && <span className="cloud-selection-rectangle" aria-hidden="true" style={{ left: selectionBox.left, top: selectionBox.top, width: selectionBox.width, height: selectionBox.height }} />}
        </div><aside className="cloud-project-detail">
          {selectedFolder ? <div className="cloud-folder-properties"><CloudFolderIcon/><h3>{selectedFolder.name}</h3><p>Dossier</p><dl><div><dt>Emplacement</dt><dd>{cloudFolderPath(folderState, selectedFolder.parentId).map((folder) => folder.name).join(' / ') || 'Tous les projets'}</dd></div><div><dt>Sous-dossiers</dt><dd>{folderState.folders.filter((folder) => folder.parentId === selectedFolder.id).length}</dd></div><div><dt>Projets</dt><dd>{projects.filter((project) => !project.deletedAt && folderState.projectFolders[project.id] === selectedFolder.id).length}</dd></div></dl><button className="primary-button" onClick={() => openFolder(selectedFolder.id)}>Ouvrir le dossier</button></div> : !selected ? <div className="cloud-empty"><h3>Sélectionnez un élément</h3><p>Un clic affiche ses propriétés. Un double-clic l’ouvre.</p></div> : <>
            <div className="cloud-project-properties"><CloudScenarioIcon updatedAt={selected.updatedAt} pages={selectedProjectPages}/><div className="cloud-project-properties-heading"><h3>{selected.title}</h3><span>{roleLabel[selected.role]} · {selected.sharing === 'private' ? 'Privé' : 'Partagé'}</span></div>{!selected.deletedAt && <div className="cloud-project-property-actions"><button className="primary-button" disabled={busy} onClick={() => void openProject(selected)}>Ouvrir</button><button disabled={busy} onClick={() => void run(downloadSelectedProject, 'Projet téléchargé.')}>Télécharger</button></div>}<dl><div><dt>Pages</dt><dd>{selectedProjectPages === undefined ? 'Calcul…' : selectedProjectPages === null ? 'Indisponible' : selectedProjectPages}</dd></div><div><dt>Créé le</dt><dd>{formatProjectDate(selected.createdAt)}</dd></div><div><dt>Modifié le</dt><dd>{formatProjectDate(selected.updatedAt)}</dd></div><div><dt>Dernier enregistrement local</dt><dd>{selectedLocalSave ? formatProjectDate(selectedLocalSave.savedAt) : 'Aucun'}</dd></div><div><dt>Accès</dt><dd>{selected.sharing === 'private' ? 'Vous uniquement' : `${selected.memberCount} membre${selected.memberCount > 1 ? 's' : ''}`}</dd></div></dl></div>
            {selected.sharing === 'shared' && !selected.realtimeStudioId && <p className="cloud-compact-alert">{selected.role === 'viewer' ? 'Accès lecteur : ce projet reste consultable, sans modification.' : 'Accès collaboratif indisponible. Vérifiez votre compte.'}</p>}
            {selected.canShare && !detail && <button disabled={busy} onClick={() => void run(sharing)}>Gérer le partage</button>}
            {detail && <section><h4>Accès à ce projet</h4>{detail.members.map((m) => <div className="cloud-member" key={m.profileId}><span><strong>{m.displayName}{m.profileId === accountId ? ' (vous)' : ''}</strong><small>{roleLabel[m.role]}</small></span>{detail.studio.role === 'owner' && m.role !== 'owner' && <div><UiSelect aria-label={`Accès de ${m.displayName}`} value={m.role} disabled={busy} onChange={(e) => void run(() => memberAction(m.profileId, e.target.value as 'editor' | 'viewer'))}><option value="viewer">Lecteur</option><option value="editor">Éditeur</option></UiSelect><button disabled={busy} onClick={() => void run(() => memberAction(m.profileId, null))}>Retirer</button></div>}</div>)}
              {detail.studio.role === 'owner' && (contacts.contacts.length ? <form className="cloud-invite-form" onSubmit={(e) => void invite(e)}><label>Contact<UiSelect aria-label="Contact à inviter" name="contactEmail" required defaultValue=""><option value="" disabled>Choisir un contact…</option>{contacts.contacts.filter((contact) => !detail.members.some((member) => member.profileId === contact.profileId)).map((contact) => <option key={contact.profileId} value={contact.email}>{contact.displayName}</option>)}</UiSelect></label><label>Autorisation<UiSelect aria-label="Autorisation" name="role" defaultValue="viewer"><option value="viewer">Lecteur · consulter</option><option value="editor">Éditeur · modifier</option></UiSelect></label><button disabled={busy}>Créer l’invitation</button></form> : <div className="cloud-contact-required"><p>Ajoutez d’abord un contact pour partager ce projet.</p><button type="button" onClick={() => setContactsOpen(true)}>Gérer mes contacts</button></div>)}
              {detail.invitations.filter((i) => i.status === 'pending').map((i) => <div className="cloud-member" key={i.id}><span>{i.recipient} · {roleLabel[i.role]} · en attente</span><button disabled={busy} onClick={() => void run(async () => { await api.revokeStudioInvitation(detail.studio.id, i.id, crypto.randomUUID()); setDetail(await api.getStudio(detail.studio.id)); })}>Annuler</button></div>)}
            </section>}
            <details><summary>Sauvegardes de la version initiale ({versions.length})</summary>{selected.realtimeStudioId && <p className="cloud-help">Pour préserver les modifications collaboratives, une ancienne version se récupère comme fichier indépendant ; elle ne remplace pas le projet partagé.</p>}{[...versions].reverse().map((v) => <div className="cloud-version" key={v.id}><span>Version {v.versionNumber} · {new Date(v.createdAt).toLocaleString('fr-FR')}</span><button disabled={busy} onClick={() => void run(async () => downloadScenario(await loadCloudProjectFile(api, v, new AbortController().signal)))}>Télécharger</button>{selected.role !== 'viewer' && !selected.realtimeStudioId && <button disabled={busy || (runtime?.rootProjectId ?? runtime?.project?.id) === selected.id} onClick={() => setRestoreId(v.id)}>Restaurer</button>}</div>)}{restoreId && <div className="cloud-notice"><p>Restaurer cette sauvegarde dans la version initiale ? L’historique sera conservé.</p><button disabled={busy} onClick={() => void run(async () => { await api.restoreCloudVersion(selected.id, restoreId, crypto.randomUUID()); await refresh(); await select(selected); }, 'Version restaurée.')} >Confirmer la restauration</button><button onClick={() => setRestoreId('')}>Annuler</button></div>}</details>
          </>}
        </aside></div>
        {runtime?.project && <div className="cloud-current" aria-live="polite"><div className="cloud-current-summary"><strong>{runtime.project.title} · {statusLabel[runtime.status]}</strong>{runtime.status === 'realtime' && <span>{live?.status === 'online' ? `${live.presence.length} membre(s) présent(s)` : live?.status === 'read_only' ? 'Lecture seule' : live?.status === 'reconnecting' ? 'Reconnexion…' : live?.status === 'conflict' || live?.status === 'recovery_required' ? 'Conflit · copie locale conservée' : 'Connexion…'}{live?.syncLag ? ` · ${live.syncLag} modification(s) en attente` : ''}</span>}<p>{runtime.message || 'Le projet cloud est à jour.'}</p></div><div className="cloud-current-actions"><button onClick={() => downloadScenario(editor.readFile())}>Télécharger ma copie locale</button>{runtime.status === 'conflict' && <button disabled={busy} onClick={() => void run(async () => { downloadScenario(editor.readFile()); await cloudProjectRuntime.open(api, accountId, runtime.rootProjectId ?? runtime.project!.id, editor, true, runtime.activeBranchId); })}>Conserver ma copie et ouvrir la version cloud</button>}<button onClick={() => void run(async () => { await cloudProjectRuntime.close(); editor.setReadOnly(false); }, 'Le scénario ouvert est maintenant une copie locale indépendante.')}>Continuer comme copie locale</button></div></div>}
        <details className="cloud-local-copies" onToggle={(e) => { if (e.currentTarget.open) void cloudProjectStore.list(accountId).then(setCopies); }}><summary>Copies conservées sur cet appareil ({copies.length})</summary><p>Ces fichiers restent sur cet appareil après une déconnexion. Vous pouvez les télécharger pour les garder ailleurs.</p>{[...copies].sort((a,b) => b.savedAt.localeCompare(a.savedAt)).map((c) => <div className="cloud-version" key={c.projectId}><span>{c.file.title} · {new Date(c.savedAt).toLocaleString('fr-FR')}</span><button onClick={() => downloadScenario(c.file)}>Télécharger</button></div>)}</details>
      </>}
      {contactsOpen && <div className="cloud-contacts-layer" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) setContactsOpen(false); }}><section className="cloud-contacts-panel" role="dialog" aria-modal="true" aria-labelledby="cloud-contacts-title">
        <header><div><h3 id="cloud-contacts-title">Contacts</h3><p>Seuls vos contacts acceptés peuvent recevoir un projet.</p></div><button type="button" aria-label="Fermer les contacts" onClick={() => setContactsOpen(false)}><UiIcon name="x"/></button></header>
        <form className="cloud-contact-request-form" onSubmit={(event) => void requestContact(event)}><label>Ajouter avec une adresse e-mail<input name="contactEmail" type="email" required placeholder="nom@exemple.fr" autoComplete="email" /></label><button disabled={busy}>Envoyer la demande</button></form>
        <div className="cloud-contact-columns">
          <section><h4>Mes contacts <span>{contacts.contacts.length}</span></h4>{contacts.contacts.length === 0 ? <p className="cloud-contact-empty">Aucun contact pour le moment.</p> : contacts.contacts.map((contact) => <div className="cloud-contact-row" key={contact.profileId}><span><strong>{contact.displayName}</strong><small>{contact.email}</small></span><button disabled={busy} onClick={() => setContactToRemove(contact)}>Supprimer</button></div>)}</section>
          <section><h4>Demandes reçues <span>{contacts.receivedRequests.length}</span></h4>{contacts.receivedRequests.length === 0 ? <p className="cloud-contact-empty">Aucune demande reçue.</p> : contacts.receivedRequests.map((request) => <div className="cloud-contact-row" key={request.id}><span><strong>{request.displayName}</strong><small>{request.email}</small></span><div><button disabled={busy} onClick={() => void run(() => respondContact(request.id, 'accept'), 'Contact ajouté.')}>Accepter</button><button disabled={busy} onClick={() => void run(() => respondContact(request.id, 'decline'))}>Refuser</button></div></div>)}</section>
          <section><h4>Demandes envoyées <span>{contacts.sentRequests.length}</span></h4>{contacts.sentRequests.length === 0 ? <p className="cloud-contact-empty">Aucune demande en attente.</p> : contacts.sentRequests.map((request) => <div className="cloud-contact-row" key={request.id}><span><strong>{request.displayName}</strong><small>{request.email}</small></span><button disabled={busy} onClick={() => void run(() => respondContact(request.id, 'cancel'))}>Annuler</button></div>)}</section>
        </div>
        {contactToRemove && <div className="cloud-contact-remove-confirm"><p>Supprimer <strong>{contactToRemove.displayName}</strong> de vos contacts ? Les accès aux projets partagés entre vous et les invitations en attente seront retirés. Les copies déjà téléchargées restent sur les appareils.</p><div><button onClick={() => setContactToRemove(null)}>Annuler</button><button className="cloud-delete-button" disabled={busy} onClick={() => void run(() => removeContact(contactToRemove), 'Contact supprimé.')}>Supprimer</button></div></div>}
      </section></div>}
      {contextMenu && <div className="cloud-explorer-context-layer" onPointerDown={() => setContextMenu(null)} onContextMenu={(event) => event.preventDefault()}><div className="cloud-explorer-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        {contextMenu.openFolderId && <button role="menuitem" onClick={() => { openFolder(contextMenu.openFolderId!); setContextMenu(null); }}><CloudFolderIcon/><span>Ouvrir le dossier</span></button>}
        <button role="menuitem" disabled={busy || filter === 'trash'} onClick={() => beginFolderCreation(contextMenu.folderId)}><UiIcon name="folder"/><span>Nouveau dossier</span></button>
        <button role="menuitem" disabled={busy} onClick={() => beginProjectCreation('empty', contextMenu.folderId)}><UiIcon name="file"/><span>Nouveau projet</span></button>
        {contextMenu.target && <button className="cloud-context-delete" role="menuitem" disabled={busy || (contextMenu.target.kind === 'project' && projects.find((project) => project.id === contextMenu.target!.id)?.role !== 'owner')} title={contextMenu.target.kind === 'project' && projects.find((project) => project.id === contextMenu.target!.id)?.role !== 'owner' ? 'Seul le propriétaire peut supprimer ce projet' : undefined} onClick={() => { setDeleteTarget(contextMenu.target!); setContextMenu(null); }}><UiIcon name="trash"/><span>Supprimer</span></button>}
      </div></div>}
      {deleteTarget && <div className="cloud-delete-confirm-layer" role="presentation"><section className="cloud-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="cloud-delete-confirm-title"><UiIcon name="trash"/><h3 id="cloud-delete-confirm-title">Supprimer {deleteTarget.kind === 'folder' ? 'ce dossier' : 'ce projet'} ?</h3><p>{deleteFolder ? `Le dossier « ${deleteFolder.name} » sera supprimé. Ses projets et sous-dossiers seront conservés dans le dossier parent.` : deleteProject ? `Le projet « ${deleteProject.title} » sera placé dans la corbeille. Son historique sera conservé.` : 'Cet élément n’est plus disponible.'}</p><div><button type="button" autoFocus onClick={() => setDeleteTarget(null)}>Annuler</button><button className="cloud-delete-button" type="button" disabled={busy || (!deleteFolder && !deleteProject)} onClick={() => void confirmDeleteTarget()}>Supprimer</button></div></section></div>}
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

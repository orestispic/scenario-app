import { UiIcon } from '../ui/UiIcon';
import { UiSelect } from '../ui/UiSelect';
import { UiButton, UiDialog, UiEmptyState, UiFeedback, UiIconButton, UiTabs, type UiFeedbackMessage } from '../ui';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type PointerEvent } from 'react';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { CloudProject } from './contractsV9';
import type { StudioDetailResponse, StudioInvitationView } from './contractsV7';
import type { CloudScenarioVersion } from './contractsV6';
import type { ContactListResponse, ContactView } from './contractsV15';
import type { CloudStorageStatus } from './contractsV18';
import { createEmptyCoverPage, type ScenarioFile } from '../document/scenarioFile';
import { cloudProjectRuntime, cloudSyncRequest, type CloudProjectEditor, type OpenProjectState } from './cloudProjectRuntime';
import { uploadCloudImageAssets } from './cloudImageAssets';
import { cloudProjectStore, type CloudWorkingCopy } from './cloudProjectStore';
import { collaborationRuntime, type RuntimeCollaborationState } from './collaborationRuntime';
import './cloudProjects.css';
import { auth, offlineTrust } from './runtime';
import { loadCloudProjectFile } from './studioBase';
import { canDownloadCloudProject, downloadCloudProject } from './cloudProjectDownload';
import { hydrateCloudImageAssets } from './cloudImageAssets';
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
import { accountOverview } from './accountOverview';

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

function formatCloudBytes(bytes: number): string {
  if (bytes < 1024 ** 3) return `${Math.max(0, bytes / (1024 ** 2)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Mo`;
  return `${(bytes / (1024 ** 3)).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Go`;
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
  const [accountEmail, setAccountEmail] = useState('');
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
  const [message, setMessage] = useState<UiFeedbackMessage | null>(null);
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
  const [cloudStorage, setCloudStorage] = useState<CloudStorageStatus | null>(null);
  const [cloudAccess, setCloudAccess] = useState<boolean | null>(null);
  const [selectionBox, setSelectionBox] = useState<ExplorerSelectionBox | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const projectList = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const pageCountCache = useRef(new Map<string, number | null>());
  const loadingPageCounts = useRef(new Set<string>());
  const selectionStart = useRef<ExplorerSelectionStart | null>(null);
  const marqueeSelectionOccurred = useRef(false);
  const selectedGeneration = useRef(0);
  const createAttempt = useRef<{ id: string; body: Awaited<ReturnType<typeof cloudSyncRequest>>; file: ScenarioFile } | null>(null);

  async function refresh(id = accountId) {
    const [listResult, directoryResult, storageResult] = await Promise.allSettled([
      api.listCloudProjects(), api.listContacts(), api.getCloudStorageStatus(),
    ]);
    if (listResult.status === 'rejected') throw listResult.reason;
    if (!alive.current) return;
    setProjects(listResult.value.projects); setInvitations(listResult.value.receivedInvitations);
    if (directoryResult.status === 'fulfilled') setContacts(directoryResult.value);
    if (storageResult.status === 'fulfilled') setCloudStorage(storageResult.value);
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
    setBusy(true); setMessage(null);
    try { await action(); if (alive.current) setMessage(success ? { text: success, tone: 'success' } : null); }
    catch (error) { if (alive.current) setMessage({ text: error instanceof Error ? error.message : 'Action indisponible.', tone: 'danger' }); }
    finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    const stopProject = cloudProjectRuntime.subscribe(setRuntime);
    const stopLive = collaborationRuntime.subscribe(setLive);
    dialog.current?.focus();
    void run(async () => {
      let me;
      try {
        const overview = await accountOverview.loadPrimary(api);
        if (overview.profile.status === 'error') throw overview.profile.error;
        me = overview.profile.value;
        if (overview.entitlements.status === 'ready')
          setCloudAccess(overview.entitlements.value.snapshot.entitlements.some(right =>
            ['cloud_sync', 'cloud.sync'].includes(right.code) && right.enabled,
          ));
      }
      catch (error) {
        const status = (error as { status?: number }).status;
        const cached = error instanceof TypeError || (status && status >= 500) ? await offlineTrust.read() : null;
        if (!cached || !alive.current) throw error;
        setAccountId(cached.me.account.id);
        setCopies(await cloudProjectStore.list(cached.me.account.id));
        throw new Error('Hors ligne : retrouvez vos fichiers dans « Copies conservées sur cet appareil ».');
      }
      if (!alive.current) return;
      setAccountId(me.account.id); setAccountEmail(me.account.email); await refresh(me.account.id);
    });
    return () => { alive.current = false; ++selectedGeneration.current; stopProject(); stopLive(); };
  }, [api]);

  useEffect(() => {
    if (!accountId) {
      setFolderState(EMPTY_FOLDER_STATE);
      setActiveFolderId(null);
      setSelectedEntries([]);
      setDraggedEntries([]);
      setCloudStorage(null);
      return;
    }
    setFolderState(readCloudProjectFolders(window.localStorage, accountId));
    setActiveFolderId(null);
    pageCountCache.current.clear();
    loadingPageCounts.current.clear();
    setProjectPages({});
    setSelectedEntries([]);
    setDraggedEntries([]);
  }, [accountId]);

  function cloudBillingReturnUrl() {
    return ['http:', 'https:'].includes(window.location.protocol)
      ? `${window.location.origin}${window.location.pathname}`
      : (import.meta.env.VITE_SCENARIO_BILLING_RETURN_URL ?? 'https://senario-app-preproduction.pages.dev/');
  }

  async function openBillingUrl(url: string) {
    if (isTauri()) await openUrl(url);
    else window.location.assign(url);
  }

  async function upgradeCloudStorage() {
    const browserReturn = cloudBillingReturnUrl();
    const success = new URL(browserReturn); success.searchParams.set('cloud-storage', 'success');
    const cancel = new URL(browserReturn); cancel.searchParams.set('cloud-storage', 'canceled');
    const checkout = await api.createCloudStorageCheckout(success.toString(), cancel.toString());
    await openBillingUrl(checkout.checkoutUrl);
  }

  async function manageCloudStorage() {
    const portal = await api.createBillingPortal(cloudBillingReturnUrl());
    await openBillingUrl(portal.portalUrl);
  }

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
      setMessage({ text: 'Choisissez un nom de dossier différent.', tone: 'warning' });
      return;
    }
    writeCloudProjectFolders(window.localStorage, accountId, next);
    setFolderState(next);
    setCreateFolderOpen(false);
    form.reset();
    setMessage({ text: `Dossier « ${next.folders[next.folders.length - 1]?.name} » créé.`, tone: 'success' });
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
      setMessage({ text: 'Aucun élément ne peut être déplacé à cet emplacement.', tone: 'warning' });
      return;
    }
    const destination = folder ? `« ${folder.name} »` : 'Tous les projets';
    setMessage({ text: `${movedCount} élément${movedCount > 1 ? 's' : ''} déplacé${movedCount > 1 ? 's' : ''} dans ${destination}.`, tone: 'success' });
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
    if (active) void select(project).catch((error) => setMessage({ text: error instanceof Error ? error.message : 'Projet indisponible.', tone: 'danger' }));
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

  function changeFilter(next: string) {
    setFilter(next);
    setSelected(null);
    setSelectedFolderId(null);
    setSelectedEntries([]);
    if (next === 'trash') setActiveFolderId(null);
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
      setMessage({ text: `Dossier « ${folder.name} » supprimé. Son contenu a été conservé.`, tone: 'success' });
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
        createAttempt.current = { id, body: await cloudSyncRequest(file, id, null), file };
      }
      const { id, body, file: pendingFile } = createAttempt.current;
      await api.syncCloudScenario(body, id);
      await uploadCloudImageAssets(api, pendingFile, id);
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
      if (cloudAccess === false && project.role === 'owner') {
        downloadScenario(await hydrateCloudImageAssets(api, project.id, await api.readCurrentProjectDocument(project.id)));
        return;
      }
      await cloudProjectRuntime.open(api, accountId, project.id, editor);
      onClose();
    });
  }

  async function downloadSelectedProject() {
    if (!selected) return;
    if (!canDownloadCloudProject(selected)) throw new Error('Un lecteur ne peut pas télécharger de copie locale du projet.');
    if (cloudAccess === false && selected.role === 'owner') {
      downloadScenario(await hydrateCloudImageAssets(api, selected.id, await api.readCurrentProjectDocument(selected.id)));
      return;
    }
    downloadScenario(await downloadCloudProject(api, selected));
  }

  async function downloadRecoveryArchive() {
    const recoverableProjects = projects.filter(project => canDownloadCloudProject(project) && !project.deletedAt);
    if (!recoverableProjects.length) throw new Error('Aucun projet cloud à récupérer.');
    const archiveName = `Senario-projets-cloud-${new Date().toISOString().slice(0, 10)}.zip`;
    const picker = (window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{ createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;
    }).showSaveFilePicker;
    const writable = picker
      ? await (await picker({
          suggestedName: archiveName,
          types: [{ description: 'Archive ZIP', accept: { 'application/zip': ['.zip'] } }],
        })).createWritable()
      : null;
    const { Zip, ZipDeflate, strToU8 } = await import('fflate');
    const chunks: Uint8Array[] = [];
    let writeChain = Promise.resolve();
    const completed = new Promise<Uint8Array | null>((resolve, reject) => {
      const zip = new Zip((error, data, final) => {
        if (error) {
          if (writable) void writable.abort().catch(() => undefined);
          reject(error);
          return;
        }
        if (writable) writeChain = writeChain.then(() => writable.write(data.slice()));
        else chunks.push(data);
        if (!final) return;
        void writeChain.then(async () => {
          if (writable) {
            await writable.close();
            resolve(null);
            return;
          }
          const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
          const archive = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { archive.set(chunk, offset); offset += chunk.length; }
          resolve(archive);
        }).catch(reject);
      });
      void (async () => {
        try {
          const names = new Set<string>();
          for (const [index, project] of recoverableProjects.entries()) {
            setMessage({ text: `Préparation de l’archive · ${index + 1}/${recoverableProjects.length} · ${project.title}`, tone: 'info' });
            const file = await downloadCloudProject(api, project);
            const baseName = project.title.replace(/[\\/:*?"<>|]/gu, '-').trim() || 'Projet';
            let name = `${baseName}.scenario`;
            if (names.has(name.toLocaleLowerCase('fr-FR'))) name = `${baseName}-${project.id.slice(0, 8)}.scenario`;
            names.add(name.toLocaleLowerCase('fr-FR'));
            const entry = new ZipDeflate(name, { level: 6 });
            zip.add(entry);
            entry.push(strToU8(JSON.stringify(file, null, 2)), true);
            // Flush each project before hydrating the next one. Supporting
            // browsers therefore never retain the complete archive in memory.
            await writeChain;
          }
          zip.end();
        } catch (error) {
          zip.terminate();
          if (writable) await writable.abort().catch(() => undefined);
          reject(error);
        }
      })();
    });
    const archive = await completed;
    if (!archive) return;
    const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = archiveName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function sendRecoveryEmail() {
    if (!accountEmail) throw new Error('Adresse e-mail du compte indisponible.');
    const configured = String(import.meta.env.VITE_SCENARIO_PUBLIC_APP_URL ?? '').trim();
    const browserUrl = ['http:', 'https:'].includes(window.location.protocol)
      ? `${window.location.origin}${window.location.pathname}`
      : (import.meta.env.VITE_SCENARIO_BILLING_RETURN_URL ?? 'https://senario.app/');
    const redirect = new URL(configured || browserUrl);
    redirect.searchParams.set('cloud-recovery', '1');
    await auth.sendCloudRecoveryLink(accountEmail, redirect.toString());
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
      project.currentVersionId && !pageCountCache.current.has(project.id));
    const nextMetrics = () => {
      setProjectPages(Object.fromEntries(pageCountCache.current));
    };
    const load = async (project: CloudProject) => {
      loadingPageCounts.current.add(project.id);
      let sizeFallback: number | null = null;
      try {
        const history = await api.listCloudVersions(project.id);
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
  const cloudStoragePercent = cloudStorage
    ? Math.min(100, Math.round((cloudStorage.usedBytes / Math.max(1, cloudStorage.limitBytes)) * 100))
    : 0;
  const cloudStorageNeedsManagement = Boolean(cloudStorage && (
    cloudStorage.limitBytes >= cloudStorage.expandedLimitBytes ||
    (cloudStorage.addon && cloudStorage.addon.status !== 'expired' &&
      !(cloudStorage.addon.status === 'canceled' && cloudStorage.limitBytes < cloudStorage.expandedLimitBytes))
  ));
  const viewerProjectIds = new Set([
    ...projects.filter((project) => project.role === 'viewer').map((project) => project.id),
    ...(runtime?.branches ?? []).filter((version) => version.project.role === 'viewer').map((version) => version.project.id),
  ]);
  const downloadableCopies = copies.filter((copy) => copy.downloadAllowed !== false && !viewerProjectIds.has(copy.projectId));
  const deleteProject = deleteTarget?.kind === 'project' ? projects.find((project) => project.id === deleteTarget.id) ?? null : null;
  const deleteFolder = deleteTarget?.kind === 'folder' ? folderState.folders.find((folder) => folder.id === deleteTarget.id) ?? null : null;

  return <div className={embedded ? 'cloud-workspace-page' : 'modal-backdrop cloud-project-backdrop'}>
    <section ref={dialog} tabIndex={-1} className="cloud-project-panel" role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="Projets cloud" aria-busy={busy || undefined} onKeyDown={(e) => {
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
      <header className="cloud-project-header"><h2>Projets cloud</h2>{!embedded && <UiIconButton label="Fermer les projets cloud" tooltip="Fermer" onClick={onClose}><UiIcon name="x"/></UiIconButton>}</header>
      {!accountId ? <UiEmptyState className="cloud-empty" title={busy ? 'Connexion à votre espace…' : 'Connectez-vous pour retrouver vos projets'}
        description="Les scénarios locaux restent disponibles dans l’éditeur."
        action={<UiButton disabled={busy} onClick={onSignIn}>Ouvrir mon compte</UiButton>} /> : <>
        <div className="cloud-project-toolbar"><input className="cloud-project-search" aria-label="Rechercher un projet ou un dossier" placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="cloud-view-switch" role="group" aria-label="Mode d’affichage"><UiIconButton label="Vue en icônes" tooltip="Vue en icônes" aria-pressed={viewMode === 'icons'} onClick={() => changeViewMode('icons')}><span className="cloud-grid-view-icon" aria-hidden="true"><i/><i/><i/><i/></span></UiIconButton><UiIconButton label="Vue en liste" tooltip="Vue en liste" aria-pressed={viewMode === 'list'} onClick={() => changeViewMode('list')}><UiIcon name="list"/></UiIconButton></div><div className={`cloud-storage-usage ${cloudStoragePercent >= 95 ? 'is-critical' : cloudStoragePercent >= 80 ? 'is-warning' : ''}`} aria-live="polite" title="Seuls les projets dont vous êtes propriétaire sont comptabilisés"><span>Stockage cloud · {cloudStoragePercent} %</span><strong>{cloudStorage ? `${formatCloudBytes(cloudStorage.usedBytes)} / ${formatCloudBytes(cloudStorage.limitBytes)}` : 'Calcul…'}</strong>{cloudAccess !== false && cloudStorage && (cloudStorageNeedsManagement ? <button type="button" disabled={busy} onClick={() => void run(manageCloudStorage)}>Gérer l’extension</button> : <button type="button" disabled={busy} onClick={() => void run(upgradeCloudStorage)}>Passer à 20 Go · 2,99 €/mois</button>)}</div><button disabled={busy} onClick={() => setContactsOpen(true)}><UiIcon name="user"/> Contacts{contacts.receivedRequests.length ? ` (${contacts.receivedRequests.length})` : ''}</button>{cloudAccess === false ? <button disabled={busy} onClick={() => void run(downloadRecoveryArchive, 'Archive ZIP téléchargée.')}><UiIcon name="file"/> Récupérer tous mes projets</button> : <><button disabled={busy} onClick={() => beginProjectCreation('empty')}><UiIcon name="plus"/> Nouveau projet</button><button disabled={busy || filter === 'trash'} onClick={() => beginFolderCreation()}><UiIcon name="folder"/> Nouveau dossier</button><button disabled={busy} onClick={() => beginProjectCreation('current')}>Ajouter le scénario ouvert</button></>}<button disabled={busy} onClick={() => void run(() => refresh())}>Actualiser</button></div>
        {cloudAccess === false && <UiFeedback className="cloud-recovery-notice" tone="warning"><UiIcon name="file"/><span><strong>Accès Cloud arrivé à échéance</strong><small>Vos projets sont conservés. Téléchargez-les ici ou recevez par e-mail un lien authentifié vers cet espace de récupération.</small></span>{accountEmail && <UiButton disabled={busy} onClick={() => void run(sendRecoveryEmail, 'Lien de récupération envoyé par e-mail.')}><UiIcon name="message"/> Envoyer le lien</UiButton>}</UiFeedback>}
        {createFolderOpen && <form className="cloud-folder-create-form" onSubmit={createFolder}><label>Nom du dossier<input name="folderName" maxLength={80} required autoFocus placeholder="Ex. Courts-métrages" /></label><span className="cloud-create-location">Dans : {createFolderParentId ? cloudFolderPath(folderState, createFolderParentId).map((folder) => folder.name).join(' / ') : 'Tous les projets'}</span><button type="submit">Créer</button><button type="button" onClick={() => setCreateFolderOpen(false)}>Annuler</button></form>}
        {createMode && <form className="cloud-create-form" onSubmit={(e) => void create(e)}><label>Nom du projet<input name="title" maxLength={120} required autoFocus readOnly={Boolean(createAttempt.current)} defaultValue={createMode === 'current' ? editor.readFile().title : ''} /></label><p>{createAttempt.current ? 'Confirmation en attente. Réessayer renverra exactement la même création, sans doublon.' : `Le projet sera privé et créé dans ${createProjectFolderId ? `« ${cloudFolderPath(folderState, createProjectFolderId).map((folder) => folder.name).join(' / ')} »` : '« Tous les projets »'}.`}</p><button disabled={busy} type="submit">{createAttempt.current ? 'Réessayer la création' : 'Créer dans le cloud'}</button><button disabled={busy} type="button" onClick={() => { createAttempt.current = null; setCreateMode(null); }}>Annuler</button></form>}
        {invitations.length > 0 && <section className="cloud-invitations" aria-label="Invitations reçues"><div className="cloud-invitations-heading"><h3>Invitations</h3><span>{invitations.length} en attente</span></div>{invitations.map((i) => <div key={i.id}><span><strong>Invitation à rejoindre un projet</strong><small>Rôle attribué : {roleLabel[i.role]}</small></span><button disabled={busy} onClick={() => void run(async () => { await api.respondProjectInvitation(i.id, 'accept', crypto.randomUUID()); await refresh(); }, 'Projet ajouté à votre espace.')}>Accepter</button><button disabled={busy} onClick={() => void run(async () => { await api.respondProjectInvitation(i.id, 'decline', crypto.randomUUID()); await refresh(); })}>Refuser</button></div>)}</section>}
        <UiTabs className="cloud-project-filters" ariaLabel="Filtrer les projets" value={filter} onValueChange={changeFilter}
          tabs={[['all', 'Tous les projets'], ['private', 'Privés'], ['shared', 'Partagés'], ['trash', 'Corbeille']].map(([value, label]) => ({ value, label }))} />
        {!normalizedQuery && filter !== 'trash' && <div className="cloud-folder-navigation" aria-label="Emplacement actuel"><button className={dropFolderId === 'root' ? 'is-drop-target' : ''} onClick={() => openFolder(null)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropFolderId('root'); }} onDragLeave={() => setDropFolderId(null)} onDrop={(event) => droppedEntry(event, null)}><CloudFolderIcon/> Tous les projets</button>{activeFolderPath.map((folder, index) => <span className="cloud-breadcrumb-part" key={folder.id}><UiIcon name="chevron"/><button className={dropFolderId === folder.id ? 'is-drop-target' : ''} onClick={() => openFolder(folder.id)} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropFolderId(folder.id); }} onDragLeave={() => setDropFolderId(null)} onDrop={(event) => droppedEntry(event, folder.id)} aria-current={index === activeFolderPath.length - 1 ? 'location' : undefined}>{folder.name}</button></span>)}</div>}
        <div className="cloud-project-layout"><div ref={projectList} className={`cloud-project-list is-${viewMode} ${dropFolderId === (activeFolderId ?? 'root') ? 'is-current-drop-target' : ''}`} aria-label={activeFolder ? `Projets du dossier ${activeFolder.name}` : 'Projets et dossiers cloud'} onPointerDown={beginMarqueeSelection} onPointerMove={updateMarqueeSelection} onPointerUp={endMarqueeSelection} onPointerCancel={endMarqueeSelection} onClick={(event) => { if (event.target !== event.currentTarget) return; if (marqueeSelectionOccurred.current) { marqueeSelectionOccurred.current = false; return; } setSelected(null); setSelectedFolderId(null); setSelectedEntries([]); }} onContextMenu={(event) => showExplorerMenu(event, activeFolderId)} onDragOver={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropFolderId(activeFolderId ?? 'root'); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropFolderId(null); }} onDrop={(event) => droppedEntry(event, activeFolderId)}>
          {visibleFolders.map((folder) => {
            const projectCount = projects.filter((project) => !project.deletedAt && folderState.projectFolders[project.id] === folder.id).length;
            const folderCount = folderState.folders.filter((candidate) => candidate.parentId === folder.id).length;
            const itemCount = projectCount + folderCount;
            const entry = { kind: 'folder' as const, id: folder.id };
            return <button key={folder.id} data-cloud-entry={explorerEntryKey(entry)} className={`cloud-folder-card ${isEntrySelected(entry) ? 'is-selected' : ''} ${dropFolderId === folder.id ? 'is-drop-target' : ''} ${isEntryDragged(entry) ? 'is-dragging' : ''}`} draggable={!busy} onClick={(event) => selectFolderFromExplorer(event, folder.id)} onDoubleClick={() => openFolder(folder.id)} onContextMenu={(event) => showExplorerMenu(event, folder.id, folder.id, entry)} onDragStart={(event) => startEntryDrag(event, entry)} onDragEnd={() => { setDraggedEntries([]); setDropFolderId(null); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; setDropFolderId(folder.id); }} onDragLeave={() => setDropFolderId(null)} onDrop={(event) => droppedEntry(event, folder.id)}><CloudFolderIcon/><span><strong>{folder.name}</strong><small>{itemCount} élément{itemCount > 1 ? 's' : ''}</small>{normalizedQuery && <small>{cloudFolderPath(folderState, folder.parentId).map((item) => item.name).join(' / ') || 'Tous les projets'}</small>}</span></button>;
          })}
          {visible.length === 0 && visibleFolders.length === 0 && <UiEmptyState className="cloud-empty" title="Aucun élément ici"
            description={activeFolder ? 'Glissez un scénario ou un dossier ici, ou utilisez le clic droit.' : 'Créez un dossier ou un projet avec les boutons ou le clic droit.'} />}
          {visible.map((project) => {
            const entry = { kind: 'project' as const, id: project.id };
            return <button key={project.id} data-cloud-entry={explorerEntryKey(entry)} className={`cloud-project-card ${isEntrySelected(entry) ? 'is-selected' : ''} ${isEntryDragged(entry) ? 'is-dragging' : ''}`} disabled={busy} draggable={!busy && !project.deletedAt} onDragStart={(event) => startEntryDrag(event, entry)} onDragEnd={() => { setDraggedEntries([]); setDropFolderId(null); }} onClick={(event) => selectProjectFromExplorer(event, project)} onDoubleClick={() => void openProject(project)} onContextMenu={(event) => showExplorerMenu(event, folderState.projectFolders[project.id] ?? null, undefined, entry)} title={`${project.title} · ${project.sharing === 'private' ? 'Privé' : `Partagé avec ${project.memberCount} membres`}`}><CloudScenarioIcon updatedAt={project.updatedAt} pages={projectPages[project.id]}/><span><strong>{project.title}</strong><small className="cloud-item-list-meta">{projectPages[project.id] === undefined ? 'Calcul des pages…' : projectPages[project.id] === null ? 'Pages indisponibles' : `${projectPages[project.id]} page${projectPages[project.id] === 1 ? '' : 's'}`} · Modifié {new Date(project.updatedAt).toLocaleDateString('fr-FR')}</small></span></button>;
          })}
          {selectionBox && <span className="cloud-selection-rectangle" aria-hidden="true" style={{ left: selectionBox.left, top: selectionBox.top, width: selectionBox.width, height: selectionBox.height }} />}
        </div><aside className="cloud-project-detail">
          {selectedFolder ? <div className="cloud-folder-properties"><CloudFolderIcon/><h3>{selectedFolder.name}</h3><p>Dossier</p><dl><div><dt>Emplacement</dt><dd>{cloudFolderPath(folderState, selectedFolder.parentId).map((folder) => folder.name).join(' / ') || 'Tous les projets'}</dd></div><div><dt>Sous-dossiers</dt><dd>{folderState.folders.filter((folder) => folder.parentId === selectedFolder.id).length}</dd></div><div><dt>Projets</dt><dd>{projects.filter((project) => !project.deletedAt && folderState.projectFolders[project.id] === selectedFolder.id).length}</dd></div></dl><button className="primary-button" onClick={() => openFolder(selectedFolder.id)}>Ouvrir le dossier</button></div> : !selected ? <UiEmptyState className="cloud-empty" title="Sélectionnez un élément" description="Un clic affiche ses propriétés. Un double-clic l’ouvre." /> : <>
            <div className="cloud-project-properties"><CloudScenarioIcon updatedAt={selected.updatedAt} pages={selectedProjectPages}/><div className="cloud-project-properties-heading"><h3>{selected.title}</h3><span>{roleLabel[selected.role]} · {selected.sharing === 'private' ? 'Privé' : 'Partagé'}</span></div>{!selected.deletedAt && <div className="cloud-project-property-actions">{cloudAccess !== false && <button className="primary-button" disabled={busy} onClick={() => void openProject(selected)}>Ouvrir</button>}{canDownloadCloudProject(selected) && <button disabled={busy} onClick={() => void run(downloadSelectedProject, 'Projet téléchargé.')}>Télécharger</button>}</div>}<dl><div><dt>Pages</dt><dd>{selectedProjectPages === undefined ? 'Calcul…' : selectedProjectPages === null ? 'Indisponible' : selectedProjectPages}</dd></div><div><dt>Créé le</dt><dd>{formatProjectDate(selected.createdAt)}</dd></div><div><dt>Modifié le</dt><dd>{formatProjectDate(selected.updatedAt)}</dd></div><div><dt>Dernier enregistrement local</dt><dd>{selectedLocalSave ? formatProjectDate(selectedLocalSave.savedAt) : 'Aucun'}</dd></div><div><dt>Accès</dt><dd>{selected.sharing === 'private' ? 'Vous uniquement' : `${selected.memberCount} membre${selected.memberCount > 1 ? 's' : ''}`}</dd></div></dl></div>
            {selected.sharing === 'shared' && !selected.realtimeStudioId && <p className="cloud-compact-alert">{selected.role === 'viewer' ? 'Accès lecteur : ce projet reste consultable, sans modification.' : 'Accès collaboratif indisponible. Vérifiez votre compte.'}</p>}
            {selected.canShare && !detail && <button disabled={busy} onClick={() => void run(sharing)}>Gérer le partage</button>}
            {detail && <section><h4>Accès à ce projet</h4>{detail.members.map((m) => <div className="cloud-member" key={m.profileId}><span><strong>{m.displayName}{m.profileId === accountId ? ' (vous)' : ''}</strong><small>{roleLabel[m.role]}</small></span>{detail.studio.role === 'owner' && m.role !== 'owner' && <div><UiSelect aria-label={`Accès de ${m.displayName}`} value={m.role} disabled={busy} onChange={(e) => void run(() => memberAction(m.profileId, e.target.value as 'editor' | 'viewer'))}><option value="viewer">Lecteur</option><option value="editor">Éditeur</option></UiSelect><button disabled={busy} onClick={() => void run(() => memberAction(m.profileId, null))}>Retirer</button></div>}</div>)}
              {detail.studio.role === 'owner' && <form className="cloud-invite-form" onSubmit={(e) => void invite(e)}><label>Adresse e-mail<input aria-label="Adresse e-mail à inviter" name="contactEmail" type="email" list="cloud-share-contacts" required autoComplete="email" placeholder="nom@exemple.com" /><datalist id="cloud-share-contacts">{contacts.contacts.filter((contact) => !detail.members.some((member) => member.profileId === contact.profileId)).map((contact) => <option key={contact.profileId} value={contact.email}>{contact.displayName}</option>)}</datalist></label><label>Autorisation<UiSelect aria-label="Autorisation" name="role" defaultValue="viewer"><option value="viewer">Lecteur · consulter</option><option value="editor">Éditeur · modifier</option></UiSelect></label><button disabled={busy}>Créer l’invitation</button></form>}
              {detail.invitations.filter((i) => i.status === 'pending').map((i) => <div className="cloud-member" key={i.id}><span>{i.recipient} · {roleLabel[i.role]} · en attente</span><button disabled={busy} onClick={() => void run(async () => { await api.revokeStudioInvitation(detail.studio.id, i.id, crypto.randomUUID()); setDetail(await api.getStudio(detail.studio.id)); })}>Annuler</button></div>)}
            </section>}
            <details><summary>Sauvegardes de la version initiale ({versions.length})</summary>{selected.realtimeStudioId && <p className="cloud-help">Pour préserver les modifications collaboratives, une ancienne version se récupère comme fichier indépendant ; elle ne remplace pas le projet partagé.</p>}{[...versions].reverse().map((v) => <div className="cloud-version" key={v.id}><span>Version {v.versionNumber} · {new Date(v.createdAt).toLocaleString('fr-FR')}</span>{selected.role !== 'viewer' && <button disabled={busy} onClick={() => void run(async () => downloadScenario(await loadCloudProjectFile(api, v, new AbortController().signal)))}>Télécharger</button>}{selected.role !== 'viewer' && !selected.realtimeStudioId && <button disabled={busy || (runtime?.rootProjectId ?? runtime?.project?.id) === selected.id} onClick={() => setRestoreId(v.id)}>Restaurer</button>}</div>)}{restoreId && <div className="cloud-notice"><p>Restaurer cette sauvegarde dans la version initiale ? L’historique sera conservé.</p><button disabled={busy} onClick={() => void run(async () => { await api.restoreCloudVersion(selected.id, restoreId, crypto.randomUUID()); await refresh(); await select(selected); }, 'Version restaurée.')} >Confirmer la restauration</button><button onClick={() => setRestoreId('')}>Annuler</button></div>}</details>
          </>}
        </aside></div>
        {runtime?.project && <div className="cloud-current" aria-live="polite"><div className="cloud-current-summary"><strong>{runtime.project.title} · {statusLabel[runtime.status]}</strong>{runtime.status === 'realtime' && <span>{live?.status === 'online' ? `${live.presence.length} membre(s) présent(s)` : live?.status === 'read_only' ? 'Lecture seule' : live?.status === 'reconnecting' ? 'Reconnexion…' : live?.status === 'conflict' || live?.status === 'recovery_required' ? 'Conflit · copie locale conservée' : 'Connexion…'}{live?.syncLag ? ` · ${live.syncLag} modification(s) en attente` : ''}</span>}<p>{runtime.message || 'Le projet cloud est à jour.'}</p></div>{runtime.project.role !== 'viewer' && <div className="cloud-current-actions"><button onClick={() => downloadScenario(editor.readFile())}>Télécharger ma copie locale</button>{runtime.status === 'conflict' && <button disabled={busy} onClick={() => void run(async () => { downloadScenario(editor.readFile()); await cloudProjectRuntime.open(api, accountId, runtime.rootProjectId ?? runtime.project!.id, editor, true, runtime.activeBranchId); })}>Conserver ma copie et ouvrir la version cloud</button>}<button onClick={() => void run(async () => { await cloudProjectRuntime.close(); editor.setReadOnly(false); }, 'Le scénario ouvert est maintenant une copie locale indépendante.')}>Continuer comme copie locale</button></div>}</div>}
        <details className="cloud-local-copies" onToggle={(e) => { if (e.currentTarget.open) void cloudProjectStore.list(accountId).then(setCopies); }}><summary>Copies conservées sur cet appareil ({downloadableCopies.length})</summary><p>Ces fichiers restent sur cet appareil après une déconnexion. Vous pouvez les télécharger pour les garder ailleurs.</p>{[...downloadableCopies].sort((a,b) => b.savedAt.localeCompare(a.savedAt)).map((c) => <div className="cloud-version" key={c.projectId}><span>{c.file.title} · {new Date(c.savedAt).toLocaleString('fr-FR')}</span><button onClick={() => downloadScenario(c.file)}>Télécharger</button></div>)}</details>
      </>}
      <UiDialog open={contactsOpen} onOpenChange={(open) => { setContactsOpen(open); if (!open) setContactToRemove(null); }}
        title="Contacts" description="Seuls vos contacts acceptés peuvent recevoir un projet."
        className="cloud-contacts-panel" backdropClassName="theme-dark" bodyClassName="cloud-contacts-body"
        headerAction={<UiIconButton label="Fermer les contacts" tooltip="Fermer" onClick={() => { setContactsOpen(false); setContactToRemove(null); }}><UiIcon name="x"/></UiIconButton>}>
        <form className="cloud-contact-request-form" onSubmit={(event) => void requestContact(event)}><label>Ajouter avec une adresse e-mail<input name="contactEmail" type="email" required placeholder="nom@exemple.fr" autoComplete="email" /></label><button disabled={busy}>Envoyer la demande</button></form>
        <div className="cloud-contact-columns">
          <section><h4>Mes contacts <span>{contacts.contacts.length}</span></h4>{contacts.contacts.length === 0 ? <p className="cloud-contact-empty">Aucun contact pour le moment.</p> : contacts.contacts.map((contact) => <div className="cloud-contact-row" key={contact.profileId}><span><strong>{contact.displayName}</strong><small>{contact.email}</small></span><button disabled={busy} onClick={() => setContactToRemove(contact)}>Supprimer</button></div>)}</section>
          <section><h4>Demandes reçues <span>{contacts.receivedRequests.length}</span></h4>{contacts.receivedRequests.length === 0 ? <p className="cloud-contact-empty">Aucune demande reçue.</p> : contacts.receivedRequests.map((request) => <div className="cloud-contact-row" key={request.id}><span><strong>{request.displayName}</strong><small>{request.email}</small></span><div><button disabled={busy} onClick={() => void run(() => respondContact(request.id, 'accept'), 'Contact ajouté.')}>Accepter</button><button disabled={busy} onClick={() => void run(() => respondContact(request.id, 'decline'))}>Refuser</button></div></div>)}</section>
          <section><h4>Demandes envoyées <span>{contacts.sentRequests.length}</span></h4>{contacts.sentRequests.length === 0 ? <p className="cloud-contact-empty">Aucune demande en attente.</p> : contacts.sentRequests.map((request) => <div className="cloud-contact-row" key={request.id}><span><strong>{request.displayName}</strong><small>{request.email}</small></span><button disabled={busy} onClick={() => void run(() => respondContact(request.id, 'cancel'))}>Annuler</button></div>)}</section>
        </div>
        {contactToRemove && <UiFeedback className="cloud-contact-remove-confirm" tone="danger"><p>Supprimer <strong>{contactToRemove.displayName}</strong> de vos contacts ? Ses accès aux projets partagés ne seront pas modifiés.</p><div><UiButton onClick={() => setContactToRemove(null)}>Annuler</UiButton><UiButton variant="danger" disabled={busy} onClick={() => void run(() => removeContact(contactToRemove), 'Contact supprimé.')}>Supprimer</UiButton></div></UiFeedback>}
      </UiDialog>
      {contextMenu && <div className="cloud-explorer-context-layer" onPointerDown={() => setContextMenu(null)} onContextMenu={(event) => event.preventDefault()}><div className="cloud-explorer-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
        {contextMenu.openFolderId && <button role="menuitem" onClick={() => { openFolder(contextMenu.openFolderId!); setContextMenu(null); }}><CloudFolderIcon/><span>Ouvrir le dossier</span></button>}
        <button role="menuitem" disabled={busy || filter === 'trash'} onClick={() => beginFolderCreation(contextMenu.folderId)}><UiIcon name="folder"/><span>Nouveau dossier</span></button>
        <button role="menuitem" disabled={busy} onClick={() => beginProjectCreation('empty', contextMenu.folderId)}><UiIcon name="file"/><span>Nouveau projet</span></button>
        {contextMenu.target && <button className="cloud-context-delete" role="menuitem" disabled={busy || (contextMenu.target.kind === 'project' && projects.find((project) => project.id === contextMenu.target!.id)?.role !== 'owner')} title={contextMenu.target.kind === 'project' && projects.find((project) => project.id === contextMenu.target!.id)?.role !== 'owner' ? 'Seul le propriétaire peut supprimer ce projet' : undefined} onClick={() => { setDeleteTarget(contextMenu.target!); setContextMenu(null); }}><UiIcon name="trash"/><span>Supprimer</span></button>}
      </div></div>}
      <UiDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={<span className="cloud-delete-dialog-title"><UiIcon name="trash"/>Supprimer {deleteTarget?.kind === 'folder' ? 'ce dossier' : 'ce projet'} ?</span>}
        description={deleteFolder ? `Le dossier « ${deleteFolder.name} » sera supprimé. Ses projets et sous-dossiers seront conservés dans le dossier parent.` : deleteProject ? `Le projet « ${deleteProject.title} » sera placé dans la corbeille. Son historique sera conservé.` : 'Cet élément n’est plus disponible.'}
        className="cloud-delete-confirm" backdropClassName="theme-dark" destructive dismissible={!busy}
        footer={<><UiButton onClick={() => setDeleteTarget(null)}>Annuler</UiButton><UiButton variant="danger" disabled={busy || (!deleteFolder && !deleteProject)} onClick={() => void confirmDeleteTarget()}>Supprimer</UiButton></>}
      />
      {message && <UiFeedback className="cloud-notice" tone={message.tone}>{message.text}</UiFeedback>}
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

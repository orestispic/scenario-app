export interface CloudProjectFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface CloudProjectFolderState {
  folders: CloudProjectFolder[];
  projectFolders: Record<string, string>;
}

type FolderStorage = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_PREFIX = 'senario-cloud-project-folders-v1:';
const EMPTY_STATE: CloudProjectFolderState = { folders: [], projectFolders: {} };

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

export function readCloudProjectFolders(storage: FolderStorage, accountId: string): CloudProjectFolderState {
  if (!accountId) return structuredClone(EMPTY_STATE);
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(accountId)) ?? 'null') as Partial<CloudProjectFolderState> | null;
    if (!parsed || !Array.isArray(parsed.folders) || !parsed.projectFolders || typeof parsed.projectFolders !== 'object')
      return structuredClone(EMPTY_STATE);
    const seen = new Set<string>();
    const rawFolders = parsed.folders.flatMap((folder) => {
      if (!folder || typeof folder.id !== 'string' || typeof folder.name !== 'string') return [];
      const name = folder.name.trim().slice(0, 80);
      if (!folder.id || !name || seen.has(folder.id)) return [];
      seen.add(folder.id);
      return [{ id: folder.id, name, parentId: typeof folder.parentId === 'string' ? folder.parentId : null }];
    });
    const folders = rawFolders.map((folder) => ({
      ...folder,
      parentId: folder.parentId && seen.has(folder.parentId) && folder.parentId !== folder.id ? folder.parentId : null,
    }));
    // Repair legacy/corrupt cycles so every folder remains reachable from root.
    const byId = new Map(folders.map(folder => [folder.id, folder]));
    for (const folder of folders) {
      const visited = new Set([folder.id]);
      let parent = folder.parentId;
      while (parent) {
        if (visited.has(parent)) { folder.parentId = null; break; }
        visited.add(parent);
        parent = byId.get(parent)?.parentId ?? null;
      }
    }
    const projectFolders = Object.fromEntries(Object.entries(parsed.projectFolders)
      .filter(([projectId, folderId]) => projectId && typeof folderId === 'string' && seen.has(folderId)));
    return { folders, projectFolders };
  } catch {
    return structuredClone(EMPTY_STATE);
  }
}

export function writeCloudProjectFolders(storage: FolderStorage, accountId: string, state: CloudProjectFolderState): void {
  if (!accountId) return;
  try { storage.setItem(storageKey(accountId), JSON.stringify(state)); }
  catch { /* Folder organization remains available for the current session. */ }
}

export function addCloudProjectFolder(
  state: CloudProjectFolderState,
  name: string,
  parentId: string | null = null,
  id: string = crypto.randomUUID(),
): CloudProjectFolderState {
  const normalized = name.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (parentId && !state.folders.some((folder) => folder.id === parentId)) return state;
  if (!normalized || state.folders.some((folder) => folder.parentId === parentId && folder.name.localeCompare(normalized, 'fr', { sensitivity: 'accent' }) === 0)) return state;
  return { ...state, folders: [...state.folders, { id, name: normalized, parentId }] };
}

export function moveCloudProject(state: CloudProjectFolderState, projectId: string, folderId: string | null): CloudProjectFolderState {
  if (!projectId || (folderId && !state.folders.some((folder) => folder.id === folderId))) return state;
  const projectFolders = { ...state.projectFolders };
  if (folderId) projectFolders[projectId] = folderId;
  else delete projectFolders[projectId];
  return { ...state, projectFolders };
}

export function cloudFolderPath(state: CloudProjectFolderState, folderId: string | null): CloudProjectFolder[] {
  if (!folderId) return [];
  const byId = new Map(state.folders.map((folder) => [folder.id, folder]));
  const path: CloudProjectFolder[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function moveCloudProjectFolder(state: CloudProjectFolderState, folderId: string, parentId: string | null): CloudProjectFolderState {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder || folderId === parentId || (parentId && !state.folders.some((item) => item.id === parentId))) return state;
  if (parentId && cloudFolderPath(state, parentId).some((item) => item.id === folderId)) return state;
  if (folder.parentId === parentId) return state;
  return {
    ...state,
    folders: state.folders.map((item) => item.id === folderId ? { ...item, parentId } : item),
  };
}

export function removeCloudProjectFolder(state: CloudProjectFolderState, folderId: string): CloudProjectFolderState {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return state;
  const projectFolders = Object.fromEntries(Object.entries(state.projectFolders).flatMap(([projectId, assignedFolderId]) => {
    if (assignedFolderId !== folderId) return [[projectId, assignedFolderId]];
    return folder.parentId ? [[projectId, folder.parentId]] : [];
  }));
  return {
    folders: state.folders
      .filter((item) => item.id !== folderId)
      .map((item) => item.parentId === folderId ? { ...item, parentId: folder.parentId } : item),
    projectFolders,
  };
}

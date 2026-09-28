import { describe, expect, it } from 'vitest';
import { addCloudProjectFolder, cloudFolderPath, moveCloudProject, moveCloudProjectFolder, readCloudProjectFolders, removeCloudProjectFolder, writeCloudProjectFolders } from './cloudProjectFolders';

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('organisation des projets cloud', () => {
  it('répare les cycles persistés sans perdre de dossier ou de projet', () => {
    const storage = memoryStorage();
    writeCloudProjectFolders(storage, 'a', {folders:[{id:'a',name:'A',parentId:'b'},{id:'b',name:'B',parentId:'a'}],projectFolders:{project:'b'}});
    const state=readCloudProjectFolders(storage,'a');
    expect(state.folders).toHaveLength(2); expect(state.projectFolders.project).toBe('b');
    for(const folder of state.folders) expect(cloudFolderPath(state,folder.id)[0].parentId).toBeNull();
  });
  it('crée des dossiers uniques et normalise leur nom', () => {
    const first = addCloudProjectFolder({ folders: [], projectFolders: {} }, '  Préparation   été  ', null, 'folder-a');
    const duplicate = addCloudProjectFolder(first, 'Préparation été', null, 'folder-b');
    expect(first.folders).toEqual([{ id: 'folder-a', name: 'Préparation été', parentId: null }]);
    expect(duplicate).toBe(first);
  });

  it('déplace un projet dans un dossier puis à la racine', () => {
    const state = { folders: [{ id: 'folder-a', name: 'Tournage', parentId: null }], projectFolders: {} };
    const moved = moveCloudProject(state, 'project-a', 'folder-a');
    expect(moved.projectFolders).toEqual({ 'project-a': 'folder-a' });
    expect(moveCloudProject(moved, 'project-a', null).projectFolders).toEqual({});
  });

  it('persiste par compte et ignore les affectations corrompues', () => {
    const storage = memoryStorage();
    const state = { folders: [{ id: 'folder-a', name: 'Archives', parentId: null }], projectFolders: { 'project-a': 'folder-a' } };
    writeCloudProjectFolders(storage, 'account-a', state);
    expect(readCloudProjectFolders(storage, 'account-a')).toEqual(state);
    expect(readCloudProjectFolders(storage, 'account-b')).toEqual({ folders: [], projectFolders: {} });
  });

  it('crée des sous-dossiers et empêche les cycles lors des déplacements', () => {
    const root = addCloudProjectFolder({ folders: [], projectFolders: {} }, 'Production', null, 'folder-a');
    const nested = addCloudProjectFolder(root, 'Tournage', 'folder-a', 'folder-b');
    expect(cloudFolderPath(nested, 'folder-b').map((folder) => folder.name)).toEqual(['Production', 'Tournage']);
    expect(moveCloudProjectFolder(nested, 'folder-a', 'folder-b')).toBe(nested);
    expect(moveCloudProjectFolder(nested, 'folder-b', null).folders.find((folder) => folder.id === 'folder-b')?.parentId).toBeNull();
  });

  it('autorise le même nom de dossier dans deux emplacements différents', () => {
    const root = addCloudProjectFolder({ folders: [], projectFolders: {} }, 'Film A', null, 'folder-a');
    const second = addCloudProjectFolder(root, 'Film B', null, 'folder-b');
    const firstArchive = addCloudProjectFolder(second, 'Archives', 'folder-a', 'folder-c');
    const secondArchive = addCloudProjectFolder(firstArchive, 'Archives', 'folder-b', 'folder-d');
    expect(secondArchive.folders).toHaveLength(4);
  });

  it('supprime un dossier sans perdre ses projets ni ses sous-dossiers', () => {
    const state = {
      folders: [
        { id: 'folder-a', name: 'Film', parentId: null },
        { id: 'folder-b', name: 'Tournage', parentId: 'folder-a' },
        { id: 'folder-c', name: 'Jour 1', parentId: 'folder-b' },
      ],
      projectFolders: { 'project-a': 'folder-b', 'project-b': 'folder-c' },
    };
    expect(removeCloudProjectFolder(state, 'folder-b')).toEqual({
      folders: [
        { id: 'folder-a', name: 'Film', parentId: null },
        { id: 'folder-c', name: 'Jour 1', parentId: 'folder-a' },
      ],
      projectFolders: { 'project-a': 'folder-a', 'project-b': 'folder-c' },
    });
  });
});

import type { ScenarioFile } from '../document/scenarioFile';

export interface CloudWorkingCopy {
  accountId: string;
  projectId: string;
  parentVersionId: string | null;
  file: ScenarioFile;
  pending: boolean;
  savedAt: string;
}
export interface CloudProjectStore {
  read(accountId: string, projectId: string): Promise<CloudWorkingCopy | null>;
  write(copy: CloudWorkingCopy): Promise<void>;
  backup(accountId: string, file: ScenarioFile): Promise<void>;
  list(accountId: string): Promise<CloudWorkingCopy[]>;
}

/** User-owned .scenario copies only: no bearer tokens, URLs, tickets or raw operations. */
export class IndexedDbCloudProjectStore implements CloudProjectStore {
  private async database(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('scenario-cloud-working-copies-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: ['accountId', 'projectId'] });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('La copie locale ne peut pas être conservée. Exportez votre scénario avant de continuer.'));
    });
  }
  private async operation<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('copies', mode);
      const request = action(tx.objectStore('copies'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Copie locale indisponible.')); };
    });
  }
  async read(accountId: string, projectId: string) { return await this.operation('readonly', (s) => s.get([accountId, projectId])) ?? null; }
  async write(copy: CloudWorkingCopy) { await this.operation('readwrite', (s) => s.put(structuredClone(copy))); }
  async backup(accountId: string, file: ScenarioFile) {
    await this.write({ accountId, projectId: `local-${crypto.randomUUID()}`, parentVersionId: null, file, pending: true, savedAt: new Date().toISOString() });
  }
  async list(accountId: string): Promise<CloudWorkingCopy[]> {
    const range = IDBKeyRange.bound([accountId, ''], [accountId, '\uffff']);
    return this.operation('readonly', (s) => s.getAll(range));
  }
}

export const cloudProjectStore = new IndexedDbCloudProjectStore();

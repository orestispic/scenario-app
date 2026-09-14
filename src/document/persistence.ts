import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const SCENARIO_FILTER = [{ name: "Scénario", extensions: ["scenario"] }];
const BROWSER_DATABASE = "senario-browser-project-persistence-v1";
const BROWSER_STORE = "files";
const BROWSER_RECOVERY_KEY = "recovery";
const MAX_BROWSER_BACKUPS = 30;
const MAX_SCENARIO_BYTES = 32 * 1024 * 1024;

interface BrowserPersistenceRecord {
  key: string;
  contents: string;
  createdAt: number;
}

function nativePersistenceAvailable(): boolean {
  if (typeof window === "undefined") {
    // Unit tests replace invoke directly and do not provide a browser window.
    return true;
  }
  return typeof (window as Window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__?.invoke === "function";
}

function validateBrowserScenario(contents: string): void {
  if (new TextEncoder().encode(contents).byteLength > MAX_SCENARIO_BYTES) {
    throw new Error("La sauvegarde dépasse la taille maximale autorisée de 32 Mo.");
  }
}

function openBrowserDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error(
      "Le stockage local du navigateur est indisponible. La version actuelle est conservée.",
    ));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BROWSER_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BROWSER_STORE)) {
        request.result.createObjectStore(BROWSER_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(
      "Le stockage local du navigateur ne peut pas être ouvert. La version actuelle est conservée.",
    ));
  });
}

async function writeBrowserRecord(record: BrowserPersistenceRecord): Promise<void> {
  validateBrowserScenario(record.contents);
  const database = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(BROWSER_STORE, "readwrite");
    transaction.objectStore(BROWSER_STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error(
      "La copie locale n'a pas pu être enregistrée. La version actuelle est conservée.",
    ));
  }).finally(() => database.close());
}

async function readBrowserRecord(key: string): Promise<string | null> {
  const database = await openBrowserDatabase();
  return new Promise<string | null>((resolve, reject) => {
    const transaction = database.transaction(BROWSER_STORE, "readonly");
    const request = transaction.objectStore(BROWSER_STORE).get(key);
    transaction.oncomplete = () => resolve((request.result as BrowserPersistenceRecord | undefined)?.contents ?? null);
    transaction.onerror = transaction.onabort = () => reject(new Error(
      "La sauvegarde locale du navigateur ne peut pas être lue.",
    ));
  }).finally(() => database.close());
}

async function deleteBrowserRecord(key: string): Promise<void> {
  const database = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(BROWSER_STORE, "readwrite");
    transaction.objectStore(BROWSER_STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error(
      "La sauvegarde locale du navigateur ne peut pas être effacée.",
    ));
  }).finally(() => database.close());
}

async function writeBrowserBackup(contents: string): Promise<void> {
  validateBrowserScenario(contents);
  const database = await openBrowserDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(BROWSER_STORE, "readwrite");
    const store = transaction.objectStore(BROWSER_STORE);
    const createdAt = Date.now();
    store.put({
      key: `backup-${createdAt}-${crypto.randomUUID()}`,
      contents,
      createdAt,
    } satisfies BrowserPersistenceRecord);
    const request = store.getAll();
    request.onsuccess = () => {
      const backups = (request.result as BrowserPersistenceRecord[])
        .filter(record => record.key.startsWith("backup-"))
        .sort((left, right) => right.createdAt - left.createdAt);
      for (const backup of backups.slice(MAX_BROWSER_BACKUPS)) {
        store.delete(backup.key);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error(
      "La copie de secours n'a pas pu être enregistrée. La version actuelle est conservée.",
    ));
  }).finally(() => database.close());
}

// Serialize writes so a delayed autosave cannot overtake a version transition.
let writes: Promise<unknown> = Promise.resolve();
function persist(command: string, args: Record<string, unknown>): Promise<void> {
  const pending = writes.catch(() => undefined).then(async () => {
    if (nativePersistenceAvailable()) {
      await invoke<void>(command, args);
      return;
    }
    const contents = typeof args.contents === "string" ? args.contents : "";
    if (command === "write_autosave") {
      await writeBrowserRecord({ key: BROWSER_RECOVERY_KEY, contents, createdAt: Date.now() });
      return;
    }
    if (command === "write_backup") {
      await writeBrowserBackup(contents);
      return;
    }
    if (command === "clear_recovery") {
      await deleteBrowserRecord(BROWSER_RECOVERY_KEY);
      return;
    }
    throw new Error("Cette opération de fichier nécessite l'application Windows Senario.");
  });
  writes = pending;
  return pending;
}
const PDF_FILTER = [{ name: "Document PDF", extensions: ["pdf"] }];

export interface RecentScenario {
  path: string;
  title: string;
  openedAt: number;
}

export async function chooseScenarioToOpen(): Promise<string | null> {
  const path = await open({
    title: "Ouvrir un scénario",
    multiple: false,
    directory: false,
    filters: SCENARIO_FILTER,
  });

  return typeof path === "string" ? path : null;
}

export async function chooseScenarioToSave(title: string): Promise<string | null> {
  const selectedPath = await save({
    title: "Enregistrer le scénario",
    defaultPath: `${title || "Sans titre"}.scenario`,
    filters: SCENARIO_FILTER,
  });

  if (!selectedPath) {
    return null;
  }

  return selectedPath.toLocaleLowerCase().endsWith(".scenario")
    ? selectedPath
    : `${selectedPath}.scenario`;
}

export async function choosePdfToSave(title: string): Promise<string | null> {
  const safeTitle = (title || "Sans titre").replace(/[\\/:*?"<>|]/g, "-");
  const selectedPath = await save({
    title: "Exporter le scénario en PDF",
    defaultPath: `${safeTitle}.pdf`,
    filters: PDF_FILTER,
  });

  if (!selectedPath) {
    return null;
  }

  return selectedPath.toLocaleLowerCase().endsWith(".pdf")
    ? selectedPath
    : `${selectedPath}.pdf`;
}

export async function choosePdfToOpen(): Promise<string | null> {
  const path = await open({
    title: "Importer un PDF",
    multiple: false,
    directory: false,
    filters: PDF_FILTER,
  });

  return typeof path === "string" ? path : null;
}

export async function readScenario(path: string): Promise<string> {
  return invoke<string>("read_scenario", { path });
}

export async function readPdf(path: string): Promise<number[]> {
  return invoke<number[]>("read_pdf", { path });
}

export async function writeScenario(path: string, contents: string): Promise<void> {
  await persist("write_scenario", { path, contents });
}

export async function readRecentScenarios(): Promise<RecentScenario[]> {
  return invoke<RecentScenario[]>("read_recent_scenarios");
}

export async function recordRecentScenario(path: string): Promise<RecentScenario[]> {
  return invoke<RecentScenario[]>("record_recent_scenario", { path });
}

export async function writePdf(path: string, contents: Uint8Array): Promise<void> {
  await invoke("write_pdf", { path, contents: Array.from(contents) });
}

export async function writeAutosave(contents: string): Promise<void> {
  await persist("write_autosave", { contents });
}

export async function writeBackup(contents: string): Promise<void> {
  await persist("write_backup", { contents });
}

export async function readRecovery(): Promise<string | null> {
  return nativePersistenceAvailable()
    ? invoke<string | null>("read_recovery")
    : readBrowserRecord(BROWSER_RECOVERY_KEY);
}

export async function clearRecovery(): Promise<void> {
  await persist("clear_recovery", {});
}

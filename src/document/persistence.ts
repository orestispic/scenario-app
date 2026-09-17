import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { INTERCHANGE_FORMATS, type InterchangeFormat } from './interchange';
import { assertInterchangeSize } from './interchangeCommon';

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
  const safeTitle = safeExportTitle(title);
  if (!nativePersistenceAvailable()) return `${safeTitle}.pdf`;
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
  if (!nativePersistenceAvailable()) {
    const file = await selectBrowserFile('pdf');
    return file ? registerBrowserPdf(file) : null;
  }
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
  if (!nativePersistenceAvailable()) {
    if (!browserPdf || browserPdf.path !== path) throw new Error('Sélectionnez à nouveau le PDF à importer.');
    return Array.from(new Uint8Array(await browserPdf.file.arrayBuffer()));
  }
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
  if (!nativePersistenceAvailable()) {
    assertInterchangeSize(contents);
    downloadBrowserFile(path, contents, 'application/pdf');
    return;
  }
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

export async function chooseWorkspacePdfToSave(title: string, workspace: 'depouillement' | 'decoupage-technique'): Promise<string | null> {
  const safeTitle = safeExportTitle(title);
  if (!nativePersistenceAvailable()) return `${safeTitle}-${workspace}.pdf`;
  const label = workspace === 'depouillement' ? 'dépouillement' : 'découpage technique';
  const selectedPath = await save({
    title: `Exporter le ${label} en PDF`,
    defaultPath: `${safeTitle}-${workspace}.pdf`,
    filters: PDF_FILTER,
  });

  if (!selectedPath) return null;
  return selectedPath.toLocaleLowerCase().endsWith('.pdf') ? selectedPath : `${selectedPath}.pdf`;
}

export interface SelectedInterchangeFile {
  name: string;
  bytes: Uint8Array;
}

function safeExportTitle(title: string): string {
  let result = (title || 'Sans titre').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/[ .]+$/g, '').slice(0, 120) || 'Sans titre';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result)) result = `_${result}`;
  return result;
}

function validateInterchangeFilename(name: string, format: InterchangeFormat): void {
  if (!name.toLocaleLowerCase().endsWith(`.${format}`)) {
    throw new Error(`Le fichier sélectionné n’est pas au format .${format}.`);
  }
}

let browserPdf: { path: string; file: File } | null = null;
export function registerBrowserPdf(file: File): string {
  if (!file.name.toLocaleLowerCase().endsWith('.pdf')) throw new Error('Sélectionnez un fichier PDF.');
  if (!file.size || file.size > 64 * 1024 * 1024) throw new Error('Le PDF doit être non vide et ne pas dépasser 64 Mo.');
  const path = `browser-pdf://${crypto.randomUUID()}/${file.name.replace(/[\\/]/g, '-')}`;
  browserPdf = { path, file };
  return path;
}

async function selectBrowserFile(format: InterchangeFormat | 'pdf'): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${format}`;
    input.hidden = true;
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      input.remove();
      resolve(file);
    };
    const onFocus = () => window.setTimeout(() => finish(input.files?.[0] ?? null), 350);
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.append(input);
    window.addEventListener('focus', onFocus, { once: true });
    input.click();
  });
}

export async function chooseInterchangeToOpen(format: InterchangeFormat): Promise<SelectedInterchangeFile | null> {
  const definition = INTERCHANGE_FORMATS[format];
  if (nativePersistenceAvailable()) {
    const path = await open({
      title: `Importer un fichier ${definition.label}`,
      multiple: false,
      directory: false,
      filters: [{ name: definition.label, extensions: [definition.extension] }],
    });
    if (typeof path !== 'string') return null;
    validateInterchangeFilename(path, format);
    const contents = await invoke<number[]>('read_interchange_file', { path });
    const bytes = Uint8Array.from(contents);
    assertInterchangeSize(bytes);
    return { name: path.split(/[\\/]/).pop() ?? `Sans titre.${format}`, bytes };
  }
  const file = await selectBrowserFile(format);
  if (!file) return null;
  validateInterchangeFilename(file.name, format);
  if (file.size === 0) throw new Error('Le fichier sélectionné est vide.');
  if (file.size > 64 * 1024 * 1024) throw new Error('Le fichier dépasse la taille maximale autorisée de 64 Mo.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  assertInterchangeSize(bytes);
  return { name: file.name, bytes };
}

export async function saveInterchangeFile(format: InterchangeFormat, title: string, contents: Uint8Array): Promise<string | null> {
  assertInterchangeSize(contents);
  const definition = INTERCHANGE_FORMATS[format];
  const filename = `${safeExportTitle(title)}.${definition.extension}`;
  if (nativePersistenceAvailable()) {
    const selectedPath = await save({
      title: `Exporter en ${definition.label}`,
      defaultPath: filename,
      filters: [{ name: definition.label, extensions: [definition.extension] }],
    });
    if (!selectedPath) return null;
    const path = selectedPath.toLocaleLowerCase().endsWith(`.${definition.extension}`) ? selectedPath : `${selectedPath}.${definition.extension}`;
    await invoke('write_interchange_file', { path, contents: Array.from(contents) });
    return path;
  }
  downloadBrowserFile(filename, contents, definition.mimeType);
  return filename;
}

function downloadBrowserFile(filename: string, contents: Uint8Array, mimeType: string): void {
  const blob = new Blob([contents.slice().buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function clearRecovery(): Promise<void> {
  await persist("clear_recovery", {});
}

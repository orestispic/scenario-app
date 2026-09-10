import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

const SCENARIO_FILTER = [{ name: "Scénario", extensions: ["scenario"] }];
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
  await invoke("write_scenario", { path, contents });
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
  await invoke("write_autosave", { contents });
}

export async function writeBackup(contents: string): Promise<void> {
  await invoke("write_backup", { contents });
}

export async function readRecovery(): Promise<string | null> {
  return invoke<string | null>("read_recovery");
}

export async function clearRecovery(): Promise<void> {
  await invoke("clear_recovery");
}

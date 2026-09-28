import type { Editor, JSONContent } from "@tiptap/core";
import type { CommentThread } from "../editor/comments";
import { parseVersionedProject, type ProjectVersion } from './projectVersions';
import {
  normalizeTechnicalImageAssets,
  type TechnicalImageAssets,
} from '../editor/technicalImageAssets';

export const SCENARIO_FORMAT_VERSION = 1;

export interface CoverPageData {
  projectName: string;
  screenwriter: string;
  director: string;
  production: string;
  duration: string;
  version: string;
  date: string;
  rights: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contactWebsite: string;
}

export interface ScenarioFile {
  formatVersion: number;
  title: string;
  content: JSONContent;
  characters: string[];
  locations: string[];
  times: string[];
  coverPage: CoverPageData;
  coverPageHidden: boolean;
  comments: CommentThread[];
  technicalImageAssets?: TechnicalImageAssets;
  savedAt: string;
  projectId?: string;
  activeVersionId?: string;
  versions?: ProjectVersion[];
}

export interface RecoveryFile {
  document: ScenarioFile;
  filePath: string | null;
}

export function createEmptyCoverPage(): CoverPageData {
  return {
    projectName: "",
    screenwriter: "",
    director: "",
    production: "",
    duration: "",
    version: "",
    date: "",
    rights: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    contactWebsite: "",
  };
}

export function normalizeCoverPage(value: Partial<CoverPageData> | undefined): CoverPageData {
  const text = (field: keyof CoverPageData) =>
    typeof value?.[field] === "string" ? value[field].trim() : "";

  return {
    projectName: text("projectName"),
    screenwriter: text("screenwriter"),
    director: text("director"),
    production: text("production"),
    duration: text("duration"),
    version: text("version"),
    date: text("date"),
    rights: text("rights"),
    contactName: text("contactName"),
    contactEmail: text("contactEmail"),
    contactPhone: text("contactPhone"),
    contactWebsite: text("contactWebsite"),
  };
}

export function hasCoverPageContent(coverPage: CoverPageData): boolean {
  return Object.values(coverPage).some(Boolean);
}

export function getCoverCredits(coverPage: CoverPageData): string[] {
  const samePerson =
    coverPage.screenwriter &&
    coverPage.director &&
    coverPage.screenwriter.localeCompare(coverPage.director, "fr", {
      sensitivity: "accent",
    }) === 0;

  if (samePerson) {
    return ["ÉCRIT ET RÉALISÉ PAR", coverPage.screenwriter];
  }

  const credits: string[] = [];
  if (coverPage.screenwriter) {
    credits.push("ÉCRIT PAR", coverPage.screenwriter);
  }
  if (coverPage.director) {
    credits.push("RÉALISÉ PAR", coverPage.director);
  }
  return credits;
}

export function createScenarioFile(
  editor: Editor,
  title: string,
  coverPage: CoverPageData = createEmptyCoverPage(),
  comments: CommentThread[] = [],
  coverPageHidden = false,
  technicalImageAssets: TechnicalImageAssets = {},
): ScenarioFile {
  const content = editor.getJSON();
  const metadata = collectScenarioMetadata(content);

  return {
    formatVersion: SCENARIO_FORMAT_VERSION,
    title: title.trim() || "Sans titre",
    content,
    ...metadata,
    coverPage: normalizeCoverPage(coverPage),
    coverPageHidden,
    comments,
    ...(Object.keys(technicalImageAssets).length
      ? { technicalImageAssets: structuredClone(technicalImageAssets) }
      : {}),
    savedAt: new Date().toISOString(),
  };
}

export function parseScenarioFile(rawContent: string): ScenarioFile {
  let parsed: unknown;
  try { parsed = JSON.parse(rawContent.replace(/^\uFEFF/u, '')); }
  catch { throw new Error('Ce fichier .scenario est corrompu ou tronqué. Le fichier reste inchangé.'); }
  if (!isRecord(parsed) || Array.isArray(parsed)) {
    throw new Error('Ce fichier .scenario n’est pas compatible avec cette version.');
  }
  const file = parsed as Partial<ScenarioFile>;
  if (file.formatVersion === 2) return parseVersionedProject(file);
  if (file.versions !== undefined || file.activeVersionId !== undefined) {
    throw new Error('Ce projet contient des versions mais son format est incohérent. Le fichier reste inchangé.');
  }
  if (
    file.formatVersion !== SCENARIO_FORMAT_VERSION ||
    !file.content ||
    file.content.type !== "doc"
  ) {
    throw new Error("Ce fichier .scenario n’est pas compatible avec cette version.");
  }

  validateDocumentTree(file.content);

  return {
    formatVersion: SCENARIO_FORMAT_VERSION,
    title: typeof file.title === "string" ? file.title : "Sans titre",
    content: file.content,
    characters: Array.isArray(file.characters) ? file.characters : [],
    locations: Array.isArray(file.locations) ? file.locations : [],
    times: Array.isArray(file.times) ? file.times : [],
    coverPage: normalizeCoverPage(file.coverPage),
    coverPageHidden: file.coverPageHidden === true,
    comments: normalizeComments(file.comments),
    ...(() => {
      const technicalImageAssets = normalizeTechnicalImageAssets(file.technicalImageAssets);
      return Object.keys(technicalImageAssets).length ? { technicalImageAssets } : {};
    })(),
    savedAt: typeof file.savedAt === "string" ? file.savedAt : "",
  };
}

function validateDocumentTree(root: JSONContent): void {
  const pending = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (!isRecord(node) || typeof node.type !== 'string'
      || (node.text !== undefined && typeof node.text !== 'string')
      || (node.content !== undefined && !Array.isArray(node.content))) {
      throw new Error('Le contenu du scénario est corrompu. Le fichier reste inchangé.');
    }
    if (++count > 250_000 || depth > 128) throw new Error('La structure du scénario est trop complexe pour être ouverte en sécurité.');
    if (node.content) {
      if (count + pending.length + node.content.length > 250_000) throw new Error('La structure du scénario est trop complexe pour être ouverte en sécurité.');
      for (const child of node.content) pending.push({ node: child, depth: depth + 1 });
    }
  }
}

function normalizeComments(value: unknown): CommentThread[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids = new Set<string>();
  return value.flatMap((thread): CommentThread[] => {
    if (!isRecord(thread) || !isRecord(thread.anchor) || !Array.isArray(thread.messages)) {
      return [];
    }
    const id = stringValue(thread.id);
    const blockId = stringValue(thread.anchor.blockId);
    const startOffset = thread.anchor.startOffset;
    const endOffset = thread.anchor.endOffset;
    if (
      !id || ids.has(id) || !blockId ||
      !Number.isInteger(startOffset) || !Number.isInteger(endOffset) ||
      Number(startOffset) < 0 || Number(endOffset) <= Number(startOffset)
    ) {
      return [];
    }
    const messages = thread.messages.flatMap((message, index) => {
      if (!isRecord(message)) {
        return [];
      }
      const text = stringValue(message.text);
      if (!text) {
        return [];
      }
      return [{
        id: stringValue(message.id) || `${id}-message-${index}`,
        text,
        createdAt: stringValue(message.createdAt),
        editedAt: typeof message.editedAt === "string" ? message.editedAt : null,
      }];
    });
    if (messages.length === 0) {
      return [];
    }
    ids.add(id);
    return [{
      id,
      status: thread.status === "resolved" ? "resolved" : "open",
      createdAt: stringValue(thread.createdAt),
      resolvedAt: typeof thread.resolvedAt === "string" ? thread.resolvedAt : null,
      anchor: {
        sceneId: stringValue(thread.anchor.sceneId) || "scene_root",
        blockId,
        startOffset: Number(startOffset),
        endOffset: Number(endOffset),
        originalText: stringValue(thread.anchor.originalText),
        lost: thread.anchor.lost === true,
      },
      messages,
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseRecoveryFile(rawContent: string): RecoveryFile {
  const recovery = JSON.parse(rawContent) as Partial<RecoveryFile>;
  if (!recovery || !recovery.document) {
    throw new Error("La sauvegarde de récupération est invalide.");
  }

  return {
    document: parseScenarioFile(JSON.stringify(recovery.document)),
    filePath: typeof recovery.filePath === "string" ? recovery.filePath : null,
  };
}

export function serializeRecoveryFile(
  document: ScenarioFile,
  filePath: string | null,
): string {
  return JSON.stringify({ document, filePath } satisfies RecoveryFile, null, 2);
}

export function getFileTitle(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? "Sans titre";
  return filename.replace(/\.scenario$/i, "") || "Sans titre";
}

function collectScenarioMetadata(content: JSONContent): {
  characters: string[];
  locations: string[];
  times: string[];
} {
  const characters: string[] = [];
  const locations: string[] = [];
  const times: string[] = [];

  for (const node of content.content ?? []) {
    if (node.type !== "paragraph") {
      continue;
    }

    const text = getNodeText(node).trim().replace(/\s+/g, " ");
    const type = node.attrs?.scenarioType;
    if (type === "CHARACTER" && text) {
      characters.push(normalize(text));
    }

    if (type === "SCENE_HEADING") {
      const match = normalize(text).match(
        /^(?:INT\.\/EXT\.|INT\.|EXT\.)\s+(.+?)(?:\s+-\s+(.+))?$/,
      );
      if (match?.[1]) {
        locations.push(match[1]);
      }
      if (match?.[2]) {
        times.push(match[2]);
      }
    }
  }

  return {
    characters: unique(characters),
    locations: unique(locations),
    times: unique(times),
  };
}

function getNodeText(node: JSONContent): string {
  if (node.type === "text") {
    return node.text ?? "";
  }

  return (node.content ?? []).map(getNodeText).join("");
}

function normalize(value: string): string {
  return value.toLocaleUpperCase("fr-FR");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

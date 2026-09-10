import type { Editor, JSONContent } from "@tiptap/core";
import type { CommentThread } from "../editor/comments";

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
  savedAt: string;
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
    savedAt: new Date().toISOString(),
  };
}

export function parseScenarioFile(rawContent: string): ScenarioFile {
  const file = JSON.parse(rawContent) as Partial<ScenarioFile>;
  if (
    file.formatVersion !== SCENARIO_FORMAT_VERSION ||
    !file.content ||
    file.content.type !== "doc"
  ) {
    throw new Error("Ce fichier .scenario n’est pas compatible avec cette version.");
  }

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
    savedAt: typeof file.savedAt === "string" ? file.savedAt : "",
  };
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
  if (!recovery.document) {
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

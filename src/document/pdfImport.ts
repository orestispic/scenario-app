import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { JSONContent } from "@tiptap/core";
import { readPdf } from "./persistence";
import { createEmptyCoverPage, normalizeCoverPage, type CoverPageData, type ScenarioFile } from "./scenarioFile";

type PdfTextItem = {
  str?: string;
  transform?: number[];
};

type PositionedText = { text: string; x: number; y: number };
type PdfLine = { text: string; x: number; y: number };

export interface ImportedPdf {
  content: JSONContent;
  coverPage: CoverPageData;
}

export const PDF_TO_SCENARIO_PROMPT = `Tu es un convertisseur professionnel de scénarios au format JSON.

Analyse entièrement le PDF joint et transforme-le en fichier .scenario compatible avec mon logiciel.

Retourne uniquement un objet JSON valide, sans Markdown ni explication, avec exactement cette structure : formatVersion (1), title, content (document Tiptap), characters, locations, times, coverPage, coverPageHidden, comments et savedAt.

Analyse le PDF page par page, dans l'ordre exact. Ignore complètement les numéros de page, les numéros de scène et les mentions « SUITE » ou « (SUITE) ».

Ne transforme jamais un simple retour automatique à la ligne en nouveau paragraphe. Regroupe toutes les lignes qui appartiennent au même bloc de texte, y compris lorsqu'un paragraphe continue sur la page suivante.

Pour chaque paragraphe, utilise exactement l'un de ces scenarioType : ACTION, SCENE_HEADING, CHARACTER, PARENTHETICAL, DIALOGUE ou TRANSITION.

Règles impératives de classification :
- SCENE_HEADING uniquement si le texte commence par INT., EXT. ou INT./EXT. (éventuellement précédé d'un numéro de scène, qui doit être retiré).
- CHARACTER uniquement pour un nom de personnage isolé, généralement en majuscules et sans phrase.
- PARENTHETICAL uniquement pour une indication entièrement entre parenthèses sous un personnage.
- DIALOGUE uniquement pour le texte prononcé sous un CHARACTER ou une PARENTHETICAL.
- TRANSITION pour CUT TO:, FADE OUT:, FADE IN:, MATCH CUT TO:, FONDU AU NOIR, FONDU ENCHAÎNÉ, etc.
- Tout le reste est ACTION.
- Un en-tête INT./EXT. est toujours SCENE_HEADING, jamais CHARACTER ou ACTION.

Détecte la page de garde séparément du scénario. Ne transforme jamais son contenu en paragraphes. Remplis correctement projectName, screenwriter, director, production, duration, version, date, rights, contactName, contactEmail, contactPhone et contactWebsite.

Ne confonds jamais une adresse avec la production, un e-mail avec un réalisateur, un téléphone avec une durée, un site avec une date ou un contact avec un personnage. Si une information manque, laisse son champ vide.

Préserve exactement le texte, les accents, les apostrophes, la ponctuation, les majuscules et l'ordre. Ne corrige aucune faute. Si le PDF est scanné, utilise l'OCR.

Vérifie avant de répondre que chaque paragraphe possède le bon scenarioType et que le JSON est complet et valide.`;

/** Prompt destiné à une conversion manuelle dans ChatGPT avec le PDF joint. */
export const PDF_MANUAL_PROMPT = `Tu dois convertir le PDF joint en un véritable fichier téléchargeable nommé scenario-importe.scenario, compatible avec mon logiciel Scénario.

Utilise l’analyse de fichiers ou le mode Code Interpreter pour créer réellement le fichier sur le disque. Ne renvoie pas seulement un exemple, un extrait JSON ou du Markdown : crée le fichier .scenario et donne-moi son lien de téléchargement.

Le fichier doit être un JSON UTF-8 valide avec exactement ces champs : formatVersion (1), title, content, characters, locations, times, coverPage, coverPageHidden, comments et savedAt.

content doit être un document Tiptap {"type":"doc","content":[...]} avec un paragraphe par bloc réel. Chaque paragraphe doit avoir attrs.scenarioType égal à ACTION, SCENE_HEADING, CHARACTER, PARENTHETICAL, DIALOGUE ou TRANSITION.

Regroupe les lignes simplement coupées par la mise en page PDF. SCENE_HEADING uniquement si le texte commence par INT., EXT. ou INT./EXT. Retire les numéros de scène avant ou après l’en-tête. CHARACTER est réservé à un nom isolé, généralement en majuscules. PARENTHETICAL est réservé au texte entre parenthèses sous un personnage. DIALOGUE apparaît sous CHARACTER ou PARENTHETICAL. TRANSITION comprend CUT TO:, FADE OUT:, FADE IN:, MATCH CUT TO:, FONDU AU NOIR, etc. Tout le reste est ACTION.

Le mot final FIN doit être converti exactement en paragraphe {"type":"paragraph","attrs":{"scenarioType":"ACTION","ending":true},"content":[{"type":"text","text":"FIN"}]}. Il ne doit jamais être une action ordinaire.

Ignore les numéros de page, numéros de scène et mentions SUITE. Détecte la page de garde séparément et remplis projectName, screenwriter, director, production, duration, version, date, rights, contactName, contactEmail, contactPhone et contactWebsite. Ne confonds jamais adresse, e-mail, téléphone ou site avec une personne ou une production. Laisse les informations absentes vides.

Préserve exactement le texte, les accents, la ponctuation et l’ordre. Ne corrige pas les fautes. Si le PDF est scanné, utilise l’OCR.

Vérifie que le JSON est valide, que le fichier porte bien l’extension .scenario et que le lien de téléchargement fonctionne. Réponds uniquement avec le lien du fichier créé.`;

/** Extrait uniquement le texte brut du PDF ; l'interprétation est réalisée par l'IA. */
export async function extractPdfText(path: string): Promise<string> {
  const bytes = new Uint8Array(await readPdf(path));
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupTextItems(textContent.items as PdfTextItem[]);
    pages.push(lines.map((line) => line.text).join("\\n"));
  }
  return pages.join("\\n\\n--- PAGE PDF ---\\n\\n").trim();
}

/** Normalise une réponse JSON produite par l’IA vers le format .scenario. */
export function parseAiScenarioResponse(raw: string, fallbackTitle: string): ScenarioFile {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("L’IA n’a pas renvoyé un JSON valide. Réessaie l’import ou utilise le prompt manuel.");
  }
  if (!value || typeof value !== "object") {
    throw new Error("L’IA n’a pas renvoyé un objet de scénario exploitable.");
  }
  const source = value as Record<string, unknown>;
  const rawContent = source.content ?? source.document;
  const content = normalizeImportedContent(rawContent);
  const coverPage = normalizeCoverPage(source.coverPage as Partial<CoverPageData> | undefined);
  return {
    formatVersion: 1,
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : fallbackTitle,
    content,
    characters: stringArray(source.characters),
    locations: stringArray(source.locations),
    times: stringArray(source.times),
    coverPage,
    coverPageHidden: source.coverPageHidden === true,
    comments: [],
    savedAt: typeof source.savedAt === "string" ? source.savedAt : new Date().toISOString(),
  };
}

function normalizeImportedContent(value: unknown): JSONContent {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawParagraphs = source.type === "doc" && Array.isArray(source.content) ? source.content : Array.isArray(value) ? value : [];
  let previousType = "";
  const paragraphs = rawParagraphs.flatMap((paragraph): JSONContent[] => {
    if (!paragraph || typeof paragraph !== "object") return [];
    const item = paragraph as Record<string, unknown>;
    const rawText = Array.isArray(item.content)
      ? item.content.filter((part) => part && typeof part === "object").map((part) => String((part as Record<string, unknown>).text ?? "")).join("")
      : typeof item.text === "string" ? item.text : "";
    const text = rawText.trim();
    const attrs = item.attrs && typeof item.attrs === "object" ? item.attrs as Record<string, unknown> : {};
    const rawType = attrs.scenarioType ?? item.scenarioType ?? item.paragraphType ?? item.kind
      ?? (typeof item.type === "string" && item.type !== "paragraph" ? item.type : undefined);
    const candidateType = typeof rawType === "string" ? rawType.toUpperCase().replace(/[ -]/g, "_") : "";
    const scenarioType = normalizeScenarioType(candidateType, text, previousType);
    previousType = scenarioType;
    const isEnding = item.ending === true || candidateType === "ENDING" || candidateType === "FIN" || text.toLocaleUpperCase("fr-FR") === "FIN";
    return [{ type: "paragraph", attrs: { scenarioType, ...(isEnding ? { ending: true } : {}) }, ...(text ? { content: [{ type: "text", text }] } : {}) }];
  });
  return { type: "doc", content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", attrs: { scenarioType: "ACTION" } }] };
}

function normalizeScenarioType(candidate: string, text: string, previousType: string): string {
  const aliases: Record<string, string> = {
    SCENE: "SCENE_HEADING", SCENE_HEADER: "SCENE_HEADING", SCENEHEADING: "SCENE_HEADING",
    HEADING: "SCENE_HEADING", PERSONNAGE: "CHARACTER", CHARACTER_NAME: "CHARACTER",
    PARENTHESIS: "PARENTHETICAL", PARENTHÈSE: "PARENTHETICAL", DIALOG: "DIALOGUE",
    TRANSITION_LINE: "TRANSITION",
  };
  const normalized = aliases[candidate] ?? candidate;
  if (normalized === "SCENE_HEADING" && /^(?:INT\.\/EXT\.|INT\.|EXT\.)\s+/i.test(normalizeSceneHeading(text))) return normalized;
  if (normalized === "PARENTHETICAL" && /^\(.+\)$/.test(text)) return normalized;
  if (normalized === "TRANSITION" && /^(?:CUT TO|FADE OUT|FADE IN|MATCH CUT|FONDU|DISSOLVE)\b/i.test(text)) return normalized;
  if (normalized === "CHARACTER" && isCharacterName(text)) return normalized;
  if (["ACTION", "DIALOGUE"].includes(normalized)) return normalized;
  if (/^(?:INT\.\/EXT\.|INT\.|EXT\.)\s+/i.test(text)) return "SCENE_HEADING";
  if (/^(?:CUT TO|FADE OUT|FADE IN|MATCH CUT|FONDU|DISSOLVE)\b/i.test(text)) return "TRANSITION";
  if (/^\(.+\)$/.test(text)) return "PARENTHETICAL";
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 2 && letters.length <= 35 && letters === letters.toLocaleUpperCase("fr-FR") && !/[.!?,;:]$/.test(text)) return "CHARACTER";
  if (previousType === "CHARACTER" || previousType === "PARENTHETICAL") return "DIALOGUE";
  return "ACTION";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

const SCENE_HEADING_PATTERN = /^(?:INT\.\/EXT\.|INT\.|EXT\.)\s+/i;
const TRANSITION_PATTERN = /^(?:CUT TO|FADE OUT|FADE IN|FONDU|MATCH CUT|DISSOLVE)\b/i;

GlobalWorkerOptions.workerSrc = workerUrl;

/** Extrait le texte visible d'un PDF et le convertit en paragraphes structurés. */
export async function importPdfAsScenario(path: string): Promise<ImportedPdf> {
  const bytes = new Uint8Array(await readPdf(path));
  const pdf = await getDocument({ data: bytes }).promise;
  const pages: PdfLine[][] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const lines = groupTextItems(textContent.items as PdfTextItem[]);
    pages.push(lines);
  }

  const coverPage = looksLikeCoverPage(pages[0] ?? [])
    ? parseCoverPage(pages.shift() ?? [])
    : createEmptyCoverPage();
  const blocks = pages.flatMap((page, index) => index < pages.length - 1
    ? [...groupLinesIntoBlocks(page), ""]
    : groupLinesIntoBlocks(page));

  const content = blocks.flatMap((text, index): JSONContent[] => {
    const cleanText = text.trim().replace(/\s+/g, " ");
    if (!cleanText || /^\d{1,4}$/.test(cleanText) || /^\(SUITE\)$/i.test(cleanText)) {
      return [];
    }

    const previousValues = blocks
      .slice(0, index)
      .map((value) => value.trim())
      .filter(Boolean);
    const previous = previousValues.length > 0
      ? previousValues[previousValues.length - 1]
      : "";
    const scenarioType = detectParagraphType(cleanText, previous);
    const scenarioText = scenarioType === "SCENE_HEADING"
      ? normalizeSceneHeading(cleanText)
      : cleanText;
    return [{
      type: "paragraph",
      attrs: { scenarioType },
      ...(scenarioText ? { content: [{ type: "text", text: scenarioText }] } : {}),
    } satisfies JSONContent];
  });

  return {
    content: {
      type: "doc",
      content: content.length > 0
        ? content
        : [{ type: "paragraph", attrs: { scenarioType: "ACTION" } }],
    },
    coverPage,
  };
}

export async function importPdfAsScenarioContent(path: string): Promise<JSONContent> {
  return (await importPdfAsScenario(path)).content;
}

function groupTextItems(items: PdfTextItem[]): PdfLine[] {
  const positioned: PositionedText[] = items
    .filter((item) => typeof item.str === "string" && item.str.trim())
    .map((item) => ({
      text: item.str!.trim(),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((left, right) => right.y - left.y || left.x - right.x);

  const rows: Array<{ y: number; items: PositionedText[] }> = [];
  for (const item of positioned) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - item.y) <= 2.5) {
      row.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }

  return rows.map((row) => {
    const sorted = row.items.sort((left, right) => left.x - right.x);
    return {
      text: sorted.map((item) => item.text).join(" ").trim(),
      x: sorted[0]?.x ?? 0,
      y: row.y,
    };
  });
}

function groupLinesIntoBlocks(lines: PdfLine[]): string[] {
  const blocks: string[] = [];
  let current = "";
  let previousY: number | null = null;
  const gaps = lines.slice(1).map((line, index) => Math.abs(lines[index].y - line.y)).filter((gap) => gap > 0);
  const typicalLineGap = gaps.length > 0 ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 12;
  const paragraphGap = Math.max(typicalLineGap * 1.55, typicalLineGap + 4);

  for (const line of lines) {
    const text = line.text.trim();
    const startsNewBlock = isStructuralLine(text);
    const gap = previousY === null ? 0 : Math.abs(previousY - line.y);
    if (!text) {
      if (current) {
        blocks.push(current);
        current = "";
      }
      previousY = line.y;
      continue;
    }
    if (current && (startsNewBlock || gap > paragraphGap)) {
      blocks.push(current);
      current = "";
    }
    current = current ? `${current} ${text}` : text;
    previousY = line.y;
  }
  if (current) {
    blocks.push(current);
  }
  return blocks;
}

function isStructuralLine(text: string): boolean {
  const normalized = normalizeSceneHeading(text);
  return SCENE_HEADING_PATTERN.test(normalized) || TRANSITION_PATTERN.test(normalized)
    || /^\(.+\)$/.test(normalized) || isCharacterName(normalized);
}

function detectParagraphType(text: string, previousText: string): string {
  const normalizedText = normalizeSceneHeading(text);
  const normalizedPrevious = normalizeSceneHeading(previousText);
  if (SCENE_HEADING_PATTERN.test(normalizedText)) {
    return "SCENE_HEADING";
  }
  if (TRANSITION_PATTERN.test(normalizedText)) {
    return "TRANSITION";
  }
  if (/^\(.+\)$/.test(normalizedText)) {
    return "PARENTHETICAL";
  }
  if (isCharacterName(normalizedText)) {
    return "CHARACTER";
  }
  if (normalizedPrevious && (isCharacterName(normalizedPrevious) || /^\(.+\)$/.test(normalizedPrevious))) {
    return "DIALOGUE";
  }
  return "ACTION";
}

function normalizeSceneHeading(text: string): string {
  const value = text.trim().replace(/^\d{1,4}\s+(?=(?:INT|EXT)\.)/i, "");
  return /^(?:INT\.\/EXT\.|INT\.|EXT\.)\s+/i.test(value)
    ? value.replace(/\s+\d{1,4}$/, "")
    : value;
}

function isCharacterName(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters.length <= 35 && letters === letters.toLocaleUpperCase("fr-FR") && !/[.!?,;:]$/.test(text);
}

function looksLikeCoverPage(lines: PdfLine[]): boolean {
  const values = lines.map((line) => line.text.trim()).filter(Boolean);
  const text = values.join(" ");
  if (!text || values.some((line) => SCENE_HEADING_PATTERN.test(normalizeSceneHeading(line)))) return false;
  return /(?:ÉCRIT|ECRIT|RÉALISÉ|REALISE|PRODUC|VERSION|DURÉE|DUREE|DROITS|@)/i.test(text);
}

function parseCoverPage(lines: PdfLine[]): CoverPageData {
  const cover = createEmptyCoverPage();
  const values = lines.map((line) => line.text.trim()).filter(Boolean);
  if (values.length === 0) return cover;

  cover.projectName = values[0].replace(/^titre\s*:\s*/i, "").trim();
  const creditIndex = values.findIndex((line) => /(?:ÉCRIT|ECRIT|RÉALISÉ|REALISE)/i.test(line));
  if (creditIndex >= 0) {
    const credit = values[creditIndex];
    const next = values[creditIndex + 1] ?? "";
    if (/ÉCRIT ET RÉALISÉ|ECRIT ET REALISE/i.test(credit) && looksLikePersonName(next)) {
      cover.screenwriter = next;
      cover.director = next;
    } else if (/ÉCRIT|ECRIT/i.test(credit)) {
      if (looksLikePersonName(next)) cover.screenwriter = next;
      const director = values.slice(creditIndex + 2).find(looksLikePersonName);
      if (director) cover.director = director;
    } else {
      if (looksLikePersonName(next)) cover.director = next;
    }
  }

  for (const line of values) {
    const match = line.match(/^([^:]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const key = match[1].toLocaleLowerCase("fr-FR");
    const value = match[2].trim();
    if (/production/.test(key)) cover.production = value;
    else if (/dur[ée]e/.test(key)) cover.duration = value;
    else if (/version/.test(key)) cover.version = value.replace(/^version\s*/i, "");
    else if (/date/.test(key)) cover.date = value;
    else if (/droit/.test(key)) cover.rights = value;
    else if (/mail|e-mail|email/.test(key)) cover.contactEmail = value;
    else if (/t[ée]l[ée]phone|tel/.test(key)) cover.contactPhone = value;
    else if (/site|web|url/.test(key)) cover.contactWebsite = value;
    else if (/nom\s*pr[ée]nom|contact/.test(key)) cover.contactName = value;
  }

  const afterCredits = creditIndex >= 0 ? values.slice(creditIndex + 2) : values.slice(1);
  const unlabelled = afterCredits.filter((line) => !/^([^:]+):\s*(.+)$/.test(line));
  if (!cover.production && unlabelled.find((line) => looksLikeProduction(line))) {
    cover.production = unlabelled.find((line) => looksLikeProduction(line))!;
  }
  if (!cover.duration && unlabelled[1] && /\d|h|min/i.test(unlabelled[1])) cover.duration = unlabelled[1];
  const versionLine = unlabelled.find((line) => /^version\s+/i.test(line));
  if (!cover.version && versionLine) cover.version = versionLine.replace(/^version\s+/i, "");
  const dateLine = unlabelled.find((line) => /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(line));
  if (!cover.date && dateLine) cover.date = dateLine;
  const email = values.find((line) => /@/.test(line));
  if (!cover.contactEmail && email) cover.contactEmail = email;
  const website = values.find((line) => /(?:https?:\/\/|www\.)/i.test(line));
  if (!cover.contactWebsite && website) cover.contactWebsite = website;
  return cover;
}

function looksLikePersonName(value: string): boolean {
  return value.length >= 2 && !/@/.test(value) && !/https?:\/\//i.test(value)
    && !/^\+?[\d\s().-]{7,}$/.test(value) && !looksLikeAddress(value)
    && !/^version\b/i.test(value) && !/\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(value);
}

function looksLikeAddress(value: string): boolean {
  return /\d/.test(value) && /\b(?:rue|avenue| boulevard|blvd|road|street|\d{5}\s)/i.test(value);
}

function looksLikeProduction(value: string): boolean {
  return looksLikePersonName(value) && !/^\d/.test(value) && !/\b(?:h|min|minute|minutes)\b/i.test(value);
}

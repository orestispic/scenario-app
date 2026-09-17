import type { JSONContent } from '@tiptap/core';
import type { ScenarioElementType } from '../editor/scenarioTypes';
import { createEmptyCoverPage, normalizeCoverPage, type CoverPageData, type ScenarioFile } from './scenarioFile';

export const MAX_INTERCHANGE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_INTERCHANGE_TEXT_BYTES = 32 * 1024 * 1024;
export const MAX_INTERCHANGE_PARAGRAPHS = 100_000;
export const MAX_INTERCHANGE_TEXT_LENGTH = 16_000_000;

export interface RichTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ScenarioInterchangeBlock {
  type: ScenarioElementType;
  runs: RichTextRun[];
  sceneNumber?: string;
}

export function assertInterchangeSize(bytes: Uint8Array, maximum = MAX_INTERCHANGE_FILE_BYTES): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('Le fichier sélectionné est vide.');
  if (bytes.byteLength > maximum) throw new Error(`Le fichier dépasse la taille maximale autorisée de ${Math.floor(maximum / 1024 / 1024)} Mo.`);
}

export function decodeTextFile(bytes: Uint8Array, allowWindows1252 = false): string {
  assertInterchangeSize(bytes, MAX_INTERCHANGE_TEXT_BYTES);
  let value: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    if ((bytes.length - 2) % 2 !== 0) throw new Error('Le fichier UTF-16 est tronqué.');
    value = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    if ((bytes.length - 2) % 2 !== 0) throw new Error('Le fichier UTF-16 est tronqué.');
    const swapped = new Uint8Array(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    value = new TextDecoder('utf-16le', { fatal: true }).decode(swapped);
  } else {
    try {
      value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      if (!allowWindows1252) throw new Error(`Le fichier texte n’est pas encodé en UTF-8 ou UTF-16 : ${error instanceof Error ? error.message : String(error)}`);
      value = new TextDecoder('windows-1252').decode(bytes);
    }
  }
  value = value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (value.includes('\0')) throw new Error('Le fichier contient des octets nuls inattendus.');
  if (value.length > MAX_INTERCHANGE_TEXT_LENGTH) throw new Error('Le contenu texte décompressé est trop volumineux.');
  return value;
}

export const encodeUtf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

export function xmlEscape(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '\uFFFD')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function xmlDecode(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_entity, body: string) => {
    if (body[0] === '#') {
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
          || (code < 0x20 && ![0x09, 0x0a, 0x0d].includes(code))) throw new Error('Entité XML numérique invalide.');
      return String.fromCodePoint(code);
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[body.toLowerCase()];
  });
}

export function assertSafeXml(xml: string): void {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Le fichier XML contient une déclaration externe interdite.');
  if (xml.length > MAX_INTERCHANGE_TEXT_LENGTH) throw new Error('Le document XML décompressé est trop volumineux.');
}

export function xmlAttribute(source: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\s)(?:[\\w-]+:)?${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? xmlDecode(match[1] ?? match[2] ?? '') : '';
}

export const stripXmlTags = (source: string): string => xmlDecode(source.replace(/<[^>]*>/g, ''));

export function mergeRuns(runs: RichTextRun[]): RichTextRun[] {
  const merged: RichTextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const normalized: RichTextRun = { text: run.text, ...(run.bold ? { bold: true } : {}), ...(run.italic ? { italic: true } : {}), ...(run.underline ? { underline: true } : {}) };
    const previous = merged[merged.length - 1];
    if (previous && Boolean(previous.bold) === Boolean(normalized.bold) && Boolean(previous.italic) === Boolean(normalized.italic) && Boolean(previous.underline) === Boolean(normalized.underline)) previous.text += normalized.text;
    else merged.push(normalized);
  }
  return merged;
}

function runNodes(run: RichTextRun): JSONContent[] {
  return run.text.split('\n').flatMap((text, index): JSONContent[] => {
    const nodes: JSONContent[] = index ? [{ type: 'hardBreak' }] : [];
    if (text) {
      const marks = [run.bold ? { type: 'bold' } : null, run.italic ? { type: 'italic' } : null, run.underline ? { type: 'underline' } : null]
        .filter((mark): mark is { type: string } => mark !== null);
      nodes.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
    }
    return nodes;
  });
}

export const blockText = (block: ScenarioInterchangeBlock): string => block.runs.map(run => run.text).join('');

export function createInterchangeScenario(title: string, blocks: ScenarioInterchangeBlock[], coverPage: Partial<CoverPageData> = {}): ScenarioFile {
  if (blocks.length > MAX_INTERCHANGE_PARAGRAPHS) throw new Error(`Le document contient plus de ${MAX_INTERCHANGE_PARAGRAPHS.toLocaleString('fr-FR')} paragraphes.`);
  let textLength = 0;
  const content = blocks.map((block): JSONContent => {
    const runs = mergeRuns(block.runs);
    textLength += runs.reduce((total, run) => total + run.text.length, 0);
    return {
      type: 'paragraph',
      attrs: { scenarioType: block.type, blockId: crypto.randomUUID(), ...(block.sceneNumber ? { sceneNumber: block.sceneNumber } : {}) },
      ...(runs.length ? { content: runs.flatMap(runNodes) } : {}),
    };
  });
  if (textLength > MAX_INTERCHANGE_TEXT_LENGTH) throw new Error('Le document contient trop de texte pour être importé en sécurité.');
  if (!content.length) content.push({ type: 'paragraph', attrs: { scenarioType: 'SCENE_HEADING', blockId: crypto.randomUUID() } });

  const characters: string[] = [], locations: string[] = [], times: string[] = [];
  for (const block of blocks) {
    const text = blockText(block).trim().replace(/\s+/g, ' ');
    if (block.type === 'CHARACTER' && text) characters.push(text.toLocaleUpperCase('fr-FR'));
    if (block.type === 'SCENE_HEADING') {
      const match = text.toLocaleUpperCase('fr-FR').match(/^(?:INT\.?\/EXT\.?|INT\/EXT\.?|I\/E\.?|INT\.|EXT\.|EST\.)\s*(.+?)(?:\s+-\s+(.+))?$/);
      if (match?.[1]) locations.push(match[1]);
      if (match?.[2]) times.push(match[2]);
    }
  }
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
  const normalizedCover = normalizeCoverPage({ ...createEmptyCoverPage(), ...coverPage });
  return {
    formatVersion: 1,
    title: normalizedCover.projectName || title.trim() || 'Sans titre',
    content: { type: 'doc', content },
    characters: unique(characters), locations: unique(locations), times: unique(times),
    coverPage: normalizedCover, coverPageHidden: false, comments: [], savedAt: new Date().toISOString(),
  };
}

function collectNodeRuns(node: JSONContent, inherited = { bold: false, italic: false, underline: false }): RichTextRun[] {
  if (node.type === 'hardBreak') return [{ text: '\n', ...inherited }];
  const marks = new Set((node.marks ?? []).map(mark => mark.type));
  const style = { bold: inherited.bold || marks.has('bold'), italic: inherited.italic || marks.has('italic'), underline: inherited.underline || marks.has('underline') };
  if (node.type === 'text') return node.text ? [{ text: node.text, ...style }] : [];
  return (node.content ?? []).flatMap(child => collectNodeRuns(child, style));
}

export function scenarioBlocks(document: ScenarioFile): ScenarioInterchangeBlock[] {
  const allowed = new Set<ScenarioElementType>(['SCENE_HEADING', 'ACTION', 'CHARACTER', 'DIALOGUE', 'PARENTHETICAL', 'TRANSITION']);
  return (document.content.content ?? []).flatMap((node): ScenarioInterchangeBlock[] => {
    if (node.type !== 'paragraph') return [];
    const rawType = node.attrs?.scenarioType as ScenarioElementType;
    const type = allowed.has(rawType) ? rawType : 'ACTION';
    return [{ type, runs: mergeRuns(collectNodeRuns(node)), ...(typeof node.attrs?.sceneNumber === 'string' && node.attrs.sceneNumber ? { sceneNumber: node.attrs.sceneNumber } : {}) }];
  });
}

export function filenameTitle(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() ?? 'Sans titre';
  return basename.replace(/\.(?:fdx|fountain|docx)$/i, '') || 'Sans titre';
}

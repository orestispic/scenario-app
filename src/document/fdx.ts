import { hasCoverPageContent, type CoverPageData, type ScenarioFile } from './scenarioFile';
import {
  assertSafeXml,
  createInterchangeScenario,
  decodeTextFile,
  encodeUtf8,
  filenameTitle,
  mergeRuns,
  scenarioBlocks,
  stripXmlTags,
  xmlAttribute,
  xmlDecode,
  xmlEscape,
  type RichTextRun,
  type ScenarioInterchangeBlock,
} from './interchangeCommon';

const FDX_TYPES = new Map<string, ScenarioInterchangeBlock['type']>([
  ['scene heading', 'SCENE_HEADING'],
  ['slugline', 'SCENE_HEADING'],
  ['action', 'ACTION'],
  ['character', 'CHARACTER'],
  ['dialogue', 'DIALOGUE'],
  ['parenthetical', 'PARENTHETICAL'],
  ['transition', 'TRANSITION'],
]);

const EXPORTED_FDX_TYPES: Record<ScenarioInterchangeBlock['type'], string> = {
  SCENE_HEADING: 'Scene Heading',
  ACTION: 'Action',
  CHARACTER: 'Character',
  DIALOGUE: 'Dialogue',
  PARENTHETICAL: 'Parenthetical',
  TRANSITION: 'Transition',
};

function parseStyle(value: string): Pick<RichTextRun, 'bold' | 'italic' | 'underline'> {
  const parts = new Set(value.toLowerCase().split(/[+,;\s]+/).filter(Boolean));
  return {
    ...(parts.has('bold') ? { bold: true } : {}),
    ...(parts.has('italic') ? { italic: true } : {}),
    ...(parts.has('underline') ? { underline: true } : {}),
  };
}

function readTextRuns(paragraphBody: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  const textPattern = /<(?:[\w-]+:)?Text\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?Text\s*>)/gi;
  for (const match of paragraphBody.matchAll(textPattern)) {
    const raw = match[2] ?? '';
    const value = xmlDecode(raw
      .replace(/<(?:[\w-]+:)?(?:LineBreak|Break)\b[^>]*\/>/gi, '\n')
      .replace(/<[^>]+>/g, ''));
    if (value) runs.push({ text: value, ...parseStyle(xmlAttribute(match[1] ?? '', 'Style')) });
  }
  if (runs.length) return mergeRuns(runs);
  const fallback = stripXmlTags(paragraphBody).trimEnd();
  return fallback ? [{ text: fallback }] : [];
}

function extractParagraphs(source: string): Array<{ attrs: string; body: string }> {
  const paragraphs: Array<{ attrs: string; body: string }> = [];
  const pattern = /<(?:[\w-]+:)?Paragraph\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?Paragraph\s*>/gi;
  for (const match of source.matchAll(pattern)) paragraphs.push({ attrs: match[1] ?? '', body: match[2] ?? '' });
  return paragraphs;
}

function parseTitlePage(source: string): Partial<CoverPageData> {
  const titlePage = source.match(/<(?:[\w-]+:)?TitlePage\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?TitlePage\s*>/i)?.[1] ?? '';
  if (!titlePage) return {};
  const values = new Map<string, string[]>();
  for (const paragraph of extractParagraphs(titlePage)) {
    const type = xmlAttribute(paragraph.attrs, 'Type').trim().toLowerCase();
    const value = readTextRuns(paragraph.body).map(run => run.text).join('').trim();
    if (type && value) values.set(type, [...(values.get(type) ?? []), value]);
  }
  const get = (...types: string[]) => types.flatMap(type => values.get(type) ?? []).join('\n');
  const contact = get('contact');
  const contactLines = contact.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const email = contactLines.find(line => /\S+@\S+\.\S+/.test(line)) ?? '';
  const website = contactLines.find(line => /(?:https?:\/\/|www\.)/i.test(line)) ?? '';
  const phone = contactLines.find(line => /(?:\+?\d[\d .()-]{6,}\d)/.test(line)) ?? '';
  const name = contactLines.find(line => line !== email && line !== website && line !== phone) ?? '';
  return {
    projectName: get('title'),
    screenwriter: get('author', 'written by', 'screenwriter'),
    director: get('director'),
    production: get('production', 'source'),
    duration: get('duration'),
    version: get('version'),
    date: get('draft date', 'date'),
    rights: get('copyright', 'rights'),
    contactName: name,
    contactEmail: email,
    contactPhone: phone,
    contactWebsite: website,
  };
}

export function importFdx(bytes: Uint8Array, filename = 'Sans titre.fdx'): ScenarioFile {
  const xml = decodeTextFile(bytes);
  assertSafeXml(xml);
  if (!/<(?:[\w-]+:)?FinalDraft\b/i.test(xml)) throw new Error('Ce fichier ne contient pas un document Final Draft valide.');
  const cover = parseTitlePage(xml);
  const withoutTitlePage = xml.replace(/<(?:[\w-]+:)?TitlePage\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?TitlePage\s*>/gi, '');
  const content = withoutTitlePage.match(/<(?:[\w-]+:)?Content\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Content\s*>/i)?.[1];
  if (content === undefined) throw new Error('Le fichier FDX ne contient pas de scénario lisible.');
  const blocks: ScenarioInterchangeBlock[] = [];
  for (const paragraph of extractParagraphs(content)) {
    const importedType = xmlAttribute(paragraph.attrs, 'Type').trim().toLowerCase();
    const type = FDX_TYPES.get(importedType) ?? 'ACTION';
    const sceneNumber = xmlAttribute(paragraph.attrs, 'Number').trim();
    blocks.push({ type, runs: readTextRuns(paragraph.body), ...(type === 'SCENE_HEADING' && sceneNumber ? { sceneNumber } : {}) });
  }
  if (!blocks.length) throw new Error('Le fichier FDX ne contient aucun paragraphe de scénario.');
  return createInterchangeScenario(cover.projectName || filenameTitle(filename), blocks, cover);
}

function styleAttribute(run: RichTextRun): string {
  const values = [run.bold ? 'Bold' : '', run.italic ? 'Italic' : '', run.underline ? 'Underline' : ''].filter(Boolean);
  return values.length ? ` Style="${values.join('+')}"` : '';
}

function exportRuns(runs: RichTextRun[]): string {
  if (!runs.length) return '<Text></Text>';
  return runs.map(run => `<Text${styleAttribute(run)}>${xmlEscape(run.text).replace(/\n/g, '&#10;')}</Text>`).join('');
}

function titleParagraph(type: string, value: string): string {
  if (!value.trim()) return '';
  return `      <Paragraph Type="${xmlEscape(type)}">${exportRuns([{ text: value.trim() }])}</Paragraph>\n`;
}

function exportTitlePage(document: ScenarioFile): string {
  const cover = document.coverPage;
  const contact = [cover.contactName, cover.contactEmail, cover.contactPhone, cover.contactWebsite].filter(Boolean).join('\n');
  const paragraphs = [
    titleParagraph('Title', cover.projectName || document.title),
    titleParagraph('Written By', cover.screenwriter),
    titleParagraph('Director', cover.director),
    titleParagraph('Production', cover.production),
    titleParagraph('Duration', cover.duration),
    titleParagraph('Version', cover.version),
    titleParagraph('Draft Date', cover.date),
    titleParagraph('Copyright', cover.rights),
    titleParagraph('Contact', contact),
  ].join('');
  return paragraphs ? `  <TitlePage>\n    <Content>\n${paragraphs}    </Content>\n  </TitlePage>\n` : '';
}

export function exportFdx(document: ScenarioFile): Uint8Array {
  const paragraphs = scenarioBlocks(document).map(block => {
    const number = block.type === 'SCENE_HEADING' && block.sceneNumber ? ` Number="${xmlEscape(block.sceneNumber)}"` : '';
    return `    <Paragraph Type="${EXPORTED_FDX_TYPES[block.type]}"${number}>${exportRuns(block.runs)}</Paragraph>`;
  }).join('\n');
  return encodeUtf8([
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    document.coverPageHidden || !hasCoverPageContent(document.coverPage) ? '' : exportTitlePage(document).trimEnd(),
    '  <Content>',
    paragraphs,
    '  </Content>',
    '</FinalDraft>',
    '',
  ].filter((line, index) => line || index !== 2).join('\n'));
}

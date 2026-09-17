import { hasCoverPageContent, type CoverPageData, type ScenarioFile } from './scenarioFile';
import {
  blockText,
  createInterchangeScenario,
  decodeTextFile,
  encodeUtf8,
  filenameTitle,
  mergeRuns,
  scenarioBlocks,
  type RichTextRun,
  type ScenarioInterchangeBlock,
} from './interchangeCommon';

const SCENE_HEADING = /^(?:INT\.?\/EXT\.?|INT\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.)(?:\s|$)/i;
const TITLE_KEYS = new Set(['title', 'credit', 'author', 'authors', 'source', 'draft date', 'date', 'contact', 'copyright', 'director', 'production', 'duration', 'version', 'contact name', 'contact email', 'contact phone', 'contact website']);

function hasLetters(value: string): boolean {
  return /[A-ZÀ-ÖØ-Þ]/i.test(value);
}

function isUppercase(value: string): boolean {
  return hasLetters(value) && value === value.toLocaleUpperCase('fr-FR');
}

function unescapedAhead(value: string, token: string, from: number): boolean {
  for (let index = from; index <= value.length - token.length; index++) {
    if (value.slice(index, index + token.length) === token) {
      let slashes = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor--) slashes++;
      if (slashes % 2 === 0) return true;
    }
  }
  return false;
}

export function parseFountainInline(value: string): RichTextRun[] {
  const runs: RichTextRun[] = [];
  let text = '', bold = false, italic = false, underline = false;
  const flush = () => {
    if (!text) return;
    runs.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}), ...(underline ? { underline: true } : {}) });
    text = '';
  };
  for (let index = 0; index < value.length;) {
    if (value[index] === '\\' && index + 1 < value.length) {
      text += value[index + 1]; index += 2; continue;
    }
    const token = value.startsWith('***', index) ? '***' : value.startsWith('**', index) ? '**' : value[index] === '*' ? '*' : value[index] === '_' ? '_' : '';
    if (token) {
      const active = token === '***' ? bold && italic : token === '**' ? bold : token === '*' ? italic : underline;
      if (active || unescapedAhead(value, token, index + token.length)) {
        flush();
        if (token === '***') { bold = !bold; italic = !italic; }
        else if (token === '**') bold = !bold;
        else if (token === '*') italic = !italic;
        else underline = !underline;
        index += token.length; continue;
      }
    }
    text += value[index++];
  }
  flush();
  return mergeRuns(runs);
}

function inlinePlain(value: string): string {
  return parseFountainInline(value).map(run => run.text).join('');
}

function parseTitlePage(lines: string[]): { cover: Partial<CoverPageData>; bodyStart: number; title: string } {
  const fields = new Map<string, string[]>();
  let index = 0, found = false;
  while (index < lines.length && !lines[index].trim()) index++;
  const start = index;
  while (index < lines.length) {
    const match = lines[index].match(/^([^:]{1,40}):(?:\s*(.*))$/);
    if (!match || !TITLE_KEYS.has(match[1].trim().toLowerCase())) break;
    found = true;
    const key = match[1].trim().toLowerCase(), values = match[2].trim() ? [match[2].trim()] : [];
    index++;
    while (index < lines.length && /^(?:\t| {3,})/.test(lines[index])) values.push(lines[index++].trim());
    fields.set(key, [...(fields.get(key) ?? []), ...values]);
    while (index < lines.length && !lines[index].trim()) {
      const next = lines[index + 1]?.match(/^([^:]{1,40}):/);
      if (next && TITLE_KEYS.has(next[1].trim().toLowerCase())) index++;
      else break;
    }
  }
  if (!found) return { cover: {}, bodyStart: start, title: '' };
  while (index < lines.length && !lines[index].trim()) index++;
  const get = (...keys: string[]) => keys.flatMap(key => fields.get(key) ?? []).map(inlinePlain).filter(Boolean);
  const contact = get('contact');
  const email = get('contact email')[0] ?? contact.find(value => /\S+@\S+\.\S+/.test(value)) ?? '';
  const website = get('contact website')[0] ?? contact.find(value => /(?:https?:\/\/|www\.)/i.test(value)) ?? '';
  const phone = get('contact phone')[0] ?? contact.find(value => /(?:\+?\d[\d .()-]{6,}\d)/.test(value)) ?? '';
  const contactName = get('contact name')[0] ?? contact.find(value => value !== email && value !== website && value !== phone) ?? '';
  const title = get('title').join(' — ');
  return {
    title,
    bodyStart: index,
    cover: {
      projectName: title,
      screenwriter: get('author', 'authors').join(', '),
      director: get('director').join(', '),
      production: get('production', 'source').join(' — '),
      duration: get('duration')[0] ?? '',
      version: get('version')[0] ?? '',
      date: get('draft date', 'date')[0] ?? '',
      rights: get('copyright')[0] ?? '',
      contactName, contactEmail: email, contactPhone: phone, contactWebsite: website,
    },
  };
}

function cleanLine(value: string): string {
  return value.replace(/\[\[[\s\S]*?\]\]/g, '').trimEnd();
}

function sceneLine(value: string): { text: string; number?: string } | null {
  const trimmed = value.trim();
  const forced = /^\.(?=[\p{L}\p{N}])/u.test(trimmed);
  if (!forced && !SCENE_HEADING.test(trimmed)) return null;
  let text = forced ? trimmed.slice(1) : trimmed;
  const number = text.match(/\s+#([\p{L}\p{N}_.-]+)#\s*$/u);
  if (number) text = text.slice(0, number.index).trimEnd();
  return { text, ...(number?.[1] ? { number: number[1] } : {}) };
}

function transitionLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('>') && !trimmed.endsWith('<')) return trimmed.slice(1).trim();
  return isUppercase(trimmed) && (trimmed.endsWith('TO:') || /^(?:FADE OUT\.?|FADE TO BLACK\.?|CUT TO BLACK\.?)$/.test(trimmed)) ? trimmed : null;
}

function characterLine(value: string, next: string | undefined): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('@') && trimmed.length > 1) return trimmed.slice(1).replace(/\s*\^\s*$/, '').trim();
  if (!next?.trim() || sceneLine(next.trim()) || transitionLine(next) || trimmed.length > 80 || !isUppercase(trimmed) || SCENE_HEADING.test(trimmed) || trimmed.endsWith('TO:')) return null;
  return trimmed.replace(/\s*\^\s*$/, '').trim();
}

export function importFountain(bytes: Uint8Array, filename = 'Sans titre.fountain'): ScenarioFile {
  const source = decodeTextFile(bytes, true).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
  const lines = source.split('\n'), titlePage = parseTitlePage(lines);
  const blocks: ScenarioInterchangeBlock[] = [];
  let index = titlePage.bodyStart;
  while (index < lines.length) {
    const raw = cleanLine(lines[index]);
    const trimmed = raw.trim();
    if (!trimmed || /^={3,}$/.test(trimmed) || /^#{1,6}\s/.test(trimmed) || /^=(?!=)/.test(trimmed)) { index++; continue; }
    if (trimmed.startsWith('!')) {
      const actionLines = [trimmed.slice(1)];
      index++;
      while (index < lines.length && lines[index].trim()) {
        const candidate = cleanLine(lines[index]);
        if (sceneLine(candidate.trim()) || transitionLine(candidate) || characterLine(candidate, lines[index + 1])) break;
        actionLines.push(candidate.trimStart().replace(/^!/, ''));
        index++;
      }
      blocks.push({ type: 'ACTION', runs: parseFountainInline(actionLines.join('\n')) });
      continue;
    }
    const scene = sceneLine(trimmed);
    if (scene) {
      blocks.push({ type: 'SCENE_HEADING', runs: parseFountainInline(scene.text), ...(scene.number ? { sceneNumber: scene.number } : {}) });
      index++; continue;
    }
    const transition = transitionLine(trimmed);
    if (transition) { blocks.push({ type: 'TRANSITION', runs: parseFountainInline(transition) }); index++; continue; }
    const character = characterLine(trimmed, lines[index + 1]);
    if (character) {
      blocks.push({ type: 'CHARACTER', runs: parseFountainInline(character) });
      index++;
      while (index < lines.length && lines[index].trim()) {
        const dialogue = cleanLine(lines[index]).trim();
        if (/^\([^\n]*\)$/.test(dialogue)) blocks.push({ type: 'PARENTHETICAL', runs: parseFountainInline(dialogue) });
        else blocks.push({ type: 'DIALOGUE', runs: parseFountainInline(dialogue.startsWith('~') ? dialogue.slice(1) : dialogue) });
        index++;
      }
      continue;
    }
    const centered = trimmed.startsWith('>') && trimmed.endsWith('<') ? trimmed.slice(1, -1).trim() : trimmed.startsWith('~') ? trimmed.slice(1) : raw.trimStart();
    const actionLines = [centered];
    index++;
    while (index < lines.length && lines[index].trim()) {
      const candidate = cleanLine(lines[index]);
      if (sceneLine(candidate.trim()) || transitionLine(candidate) || characterLine(candidate, lines[index + 1])) break;
      if (/^#{1,6}\s/.test(candidate.trim()) || /^=(?!=)/.test(candidate.trim())) { index++; continue; }
      actionLines.push(candidate.trimStart().replace(/^!/, ''));
      index++;
    }
    blocks.push({ type: 'ACTION', runs: parseFountainInline(actionLines.join('\n')) });
  }
  return createInterchangeScenario(titlePage.title || filenameTitle(filename), blocks, titlePage.cover);
}

function escapeFountain(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([*_])/g, '\\$1');
}

function exportInline(runs: RichTextRun[]): string {
  return runs.map(run => {
    const text = escapeFountain(run.text);
    const emphasis = run.bold && run.italic ? '***' : run.bold ? '**' : run.italic ? '*' : '';
    const decorated = emphasis ? `${emphasis}${text}${emphasis}` : text;
    return run.underline ? `_${decorated}_` : decorated;
  }).join('');
}

function titleEntry(key: string, value: string): string[] {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  return lines.length === 1 ? [`${key}: ${escapeFountain(lines[0])}`] : [`${key}:`, ...lines.map(line => `    ${escapeFountain(line)}`)];
}

function coverLines(cover: CoverPageData, fallbackTitle: string): string[] {
  return [
    ...titleEntry('Title', cover.projectName || fallbackTitle),
    ...titleEntry('Credit', cover.screenwriter ? 'Écrit par' : ''),
    ...titleEntry('Author', cover.screenwriter),
    ...titleEntry('Director', cover.director),
    ...titleEntry('Production', cover.production),
    ...titleEntry('Duration', cover.duration),
    ...titleEntry('Version', cover.version),
    ...titleEntry('Draft date', cover.date),
    ...titleEntry('Copyright', cover.rights),
    ...titleEntry('Contact name', cover.contactName),
    ...titleEntry('Contact email', cover.contactEmail),
    ...titleEntry('Contact phone', cover.contactPhone),
    ...titleEntry('Contact website', cover.contactWebsite),
  ];
}

function ambiguousAction(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(sceneLine(trimmed) || transitionLine(trimmed) || isUppercase(trimmed) || /^[.@>~#!]/.test(trimmed));
}

export function exportFountain(document: ScenarioFile): Uint8Array {
  const blocks = scenarioBlocks(document), output: string[] = [];
  const title = document.coverPageHidden || !hasCoverPageContent(document.coverPage) ? [] : coverLines(document.coverPage, document.title);
  if (title.length) output.push(...title, '');
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === 'CHARACTER') {
      output.push(`@${exportInline(block.runs).replace(/\n/g, ' ')}`);
      while (blocks[index + 1] && ['DIALOGUE', 'PARENTHETICAL'].includes(blocks[index + 1].type)) {
        output.push(exportInline(blocks[++index].runs));
      }
      output.push('');
      continue;
    }
    if (block.type === 'SCENE_HEADING') output.push(`${SCENE_HEADING.test(blockText(block).trim()) ? '' : '.'}${exportInline(block.runs)}${block.sceneNumber ? ` #${block.sceneNumber}#` : ''}`, '');
    else if (block.type === 'TRANSITION') output.push(`>${exportInline(block.runs)}`, '');
    else if (block.type === 'ACTION') output.push(exportInline(block.runs).split('\n').map(line => `${ambiguousAction(line) ? '!' : ''}${line}`).join('\n'), '');
    else output.push(`!${exportInline(block.runs)}`, '');
  }
  return encodeUtf8(`${output.join('\n').replace(/\n{3,}$/g, '\n\n')}`);
}

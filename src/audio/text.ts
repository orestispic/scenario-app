import type { Node as DocumentNode } from '@tiptap/pm/model';
export interface ReadingSettings { titles: boolean; characters: boolean }
export const DEFAULT_READING_SETTINGS: ReadingSettings = { titles: true, characters: true };
export interface SpeechSegment { text: string; blockId: string; label: string; pauseBefore: number; pauseAfter: number }
export type ReadingScope = 'selection' | 'cursor' | 'scene' | 'all';

/** Expands screenplay abbreviations only in the disposable speech snapshot. */
export function normalizeSceneHeadingForSpeech(text: string): string {
  const prefix = /^(\s*)(INT\.?\s*\/\s*EXT\.?|EXT\.?\s*\/\s*INT\.?|INT\.?|EXT\.?)(?=\s|[-–—]|$)/iu;
  return text.replace(prefix, (_match, leading: string, abbreviation: string) => {
    const normalized = abbreviation.replace(/[.\s]/gu, '').toLocaleUpperCase('fr-FR');
    const spoken = normalized === 'INT/EXT'
      ? 'INTÉRIEUR / EXTÉRIEUR'
      : normalized === 'EXT/INT'
        ? 'EXTÉRIEUR / INTÉRIEUR'
        : normalized === 'INT'
          ? 'INTÉRIEUR'
          : 'EXTÉRIEUR';
    return `${leading}${spoken}`;
  });
}
/** Sentence-boundary chunks retain every character (including selected whitespace). */
export function splitSpeech(text: string, limit = 350): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+[\s»”"']*|[^.!?…]+$|[.!?…]+/gu) ?? [text];
  const output: string[] = []; let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > limit) { output.push(current); current = ''; }
    current += sentence;
  }
  if (current) output.push(current);
  return output;
}
export function buildSpeech(doc: DocumentNode, scope: ReadingScope, from: number, to: number, settings: ReadingSettings): SpeechSegment[] {
  if (scope === 'selection' && from === to) return [];
  const blocks: { text: string; type: string; id: string; from: number; to: number; label: string }[] = [];
  let label = 'Début du scénario'; let scene = 0;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    if (node.attrs.scenarioType === 'SCENE_HEADING') label = `Scène ${++scene} · ${node.textContent || 'Sans titre'}`;
    blocks.push({ text: node.textContent, type: node.attrs.scenarioType, id: node.attrs.blockId ?? '', from: pos + 1, to: pos + 1 + node.content.size, label });
    return false;
  });
  let sceneStart = 0; let sceneEnd = doc.content.size + 1;
  for (const b of blocks) if (b.type === 'SCENE_HEADING') {
    if (b.from <= from + 1) sceneStart = b.from;
    else { sceneEnd = b.from; break; }
  }
  const segments: SpeechSegment[] = [];
  for (const b of blocks) {
    if (scope === 'scene' && (b.from < sceneStart || b.from >= sceneEnd)) continue;
    if (scope === 'cursor' && b.to <= from) continue;
    if (scope === 'selection' && (b.to <= from || b.from >= to)) continue;
    // Explicit selections always override scene/name reading preferences.
    if (scope !== 'selection' && ((!settings.titles && b.type === 'SCENE_HEADING') || (!settings.characters && b.type === 'CHARACTER'))) continue;
    const begin = scope === 'selection' || scope === 'cursor' ? Math.max(b.from, from) : b.from;
    const end = scope === 'selection' ? Math.min(b.to, to) : b.to;
    const originalText = doc.textBetween(begin, end, '\n', '\n');
    const text = b.type === 'SCENE_HEADING' ? normalizeSceneHeadingForSpeech(originalText) : originalText;
    if (!text.trim()) continue;
    const chunks = splitSpeech(text);
    chunks.forEach((chunk, i) => segments.push({ text: chunk, blockId: b.id, label: scope === 'selection' ? 'Texte sélectionné' : b.label,
      pauseBefore: i === 0 && scope !== 'selection' && b.type === 'SCENE_HEADING' ? 250 : 0,
      pauseAfter: i === chunks.length - 1 && ['SCENE_HEADING','TRANSITION'].includes(b.type) ? 450 : 100 }));
  }
  return segments;
}

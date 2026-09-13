import type { JSONContent } from '@tiptap/core';

function textOf(node: JSONContent): string {
  if (node.type === 'hardBreak') return ' ';
  return node.text ?? (node.content ?? []).map(textOf).join('');
}

export function getDocumentStatistics(document: JSONContent) {
  const paragraphs = document.content ?? [];
  const text = paragraphs.map(textOf).join(' ');
  const headings = paragraphs.filter(node => node.attrs?.scenarioType === 'SCENE_HEADING' && textOf(node).trim());
  const locations = new Set(headings.map(node => textOf(node)
    .normalize('NFC').toLocaleUpperCase('fr-FR')
    .replace(/^(?:INT\.?\s*[/.-]\s*EXT\.?|EXT\.?\s*[/.-]\s*INT\.?|INT\.?|EXT\.?)\s*/u, '')
    .replace(/\s*[-–—]\s*(?:JOUR|NUIT|MATIN|SOIR|AUBE|CRÉPUSCULE|CONTINU|PLUS TARD)\s*$/u, '')
    .replace(/\s+/g, ' ').trim()).filter(Boolean));
  return { words: (text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) ?? []).length,
    scenes: headings.length, locations: locations.size };
}

/** Earliest placement at/after each anchor, using actual unscaled card heights. */
export function placeMarginNotes(notes: {id: string; anchor: number; height: number}[], gap = 8) {
  let bottom = 0;
  return [...notes].sort((a,b) => a.anchor-b.anchor || a.id.localeCompare(b.id)).map(note => {
    const top = Math.max(0, note.anchor, bottom);
    bottom = top + note.height + gap;
    return {id: note.id, top, bottom};
  });
}

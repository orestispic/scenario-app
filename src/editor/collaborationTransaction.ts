import type { JSONContent } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';

/** One minimal ProseMirror replacement keeps unchanged text/selection mapped.
 * Remote edits never become local undo entries or invoke typing transforms.
 */
export function collaborationTransaction(state: EditorState, content: JSONContent) {
  const normalized = structuredClone(content);
  if (!normalized.content?.length) normalized.content = [{ type: 'paragraph', attrs: { blockId: 'studio-empty-paragraph' } }];
  const next = state.schema.nodeFromJSON(normalized);
  next.check();
  const from = state.doc.content.findDiffStart(next.content);
  if (from === null) return null;
  const end = state.doc.content.findDiffEnd(next.content)!;
  const overlap = from - Math.min(end.a, end.b);
  const oldEnd = overlap > 0 ? end.a + overlap : end.a;
  const newEnd = overlap > 0 ? end.b + overlap : end.b;
  return state.tr.replace(from, oldEnd, next.slice(from, newEnd))
    .setMeta('scenario-collaboration-remote', true).setMeta('addToHistory', false);
}

import { Mark, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface CommentMessage {
  id: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
}

export interface CommentAnchor {
  sceneId: string;
  blockId: string;
  startOffset: number;
  endOffset: number;
  originalText: string;
  lost: boolean;
}

export interface CommentThread {
  id: string;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  anchor: CommentAnchor;
  messages: CommentMessage[];
}

interface ScenarioBlock {
  id: string;
  sceneId: string;
  position: number;
  text: string;
}

export function createStableId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function getSelectionCommentAnchor(editor: Editor): CommentAnchor | null {
  const { $from, $to, empty } = editor.state.selection;
  if (empty || $from.depth < 1 || $to.depth < 1 || $from.parent !== $to.parent) {
    return null;
  }
  const blockId = $from.parent.attrs.blockId;
  if (typeof blockId !== "string" || !blockId) {
    return null;
  }
  const sceneId = findSceneId(editor.state.doc, $from.before($from.depth));
  const originalText = $from.parent.textBetween($from.parentOffset, $to.parentOffset, " ");
  if (!originalText) {
    return null;
  }
  return {
    sceneId,
    blockId,
    startOffset: $from.parentOffset,
    endOffset: $to.parentOffset,
    originalText,
    lost: false,
  };
}

export function ensureScenarioBlockIds(editor: Editor): void {
  const seen = new Set<string>();
  let transaction = editor.state.tr;
  let changed = false;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== "paragraph") {
      return;
    }
    const current = node.attrs.blockId;
    const blockId = typeof current === "string" && current && !seen.has(current)
      ? current
      : createStableId("block");
    seen.add(blockId);
    if (blockId !== current) {
      transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, blockId });
      changed = true;
    }
  });
  if (changed) {
    // Ces identifiants sont une infrastructure interne des commentaires.
    // Ils ne doivent jamais constituer une étape Ctrl+Z de l'auteur.
    transaction.setMeta("scenario-block-ids", true);
    transaction.setMeta("addToHistory", false);
    editor.view.dispatch(transaction);
  }
}

export function reconcileCommentAnchors(
  threads: CommentThread[],
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): CommentThread[] {
  const oldBlocks = collectBlocks(before);
  const newBlocks = collectBlocks(after);
  return threads.map((thread) => {
    const oldBlock = oldBlocks.get(thread.anchor.blockId);
    const newBlock = newBlocks.get(thread.anchor.blockId);
    if (!newBlock) {
      return { ...thread, anchor: { ...thread.anchor, lost: true } };
    }
    if (!oldBlock) {
      return { ...thread, anchor: { ...thread.anchor, sceneId: newBlock.sceneId } };
    }
    const anchor = mapAnchorTextChange(thread.anchor, oldBlock.text, newBlock.text);
    return { ...thread, anchor: { ...anchor, sceneId: newBlock.sceneId } };
  });
}

export function findCommentAnchorPosition(editor: Editor, anchor: CommentAnchor): { from: number; to: number } | null {
  const block = collectBlocks(editor.state.doc).get(anchor.blockId);
  if (!block || anchor.lost) {
    return null;
  }
  const textLength = block.text.length;
  if (anchor.startOffset < 0 || anchor.endOffset > textLength || anchor.endOffset <= anchor.startOffset) {
    return null;
  }
  return { from: block.position + 1 + anchor.startOffset, to: block.position + 1 + anchor.endOffset };
}

/**
 * Marque persistée dans le document, uniquement utilisée pour rendre visible
 * l'ancre du commentaire. Les données du commentaire restent dans le fichier
 * projet : cette marque n'est pas sa source de vérité.
 */
export const CommentAnchorMark = Mark.create({
  name: "commentAnchor",
  excludes: "",
  // A comment belongs only to the range explicitly selected by the author.
  // Typing at either edge must never extend that highlighted range.
  inclusive: false,

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment-thread-id"),
        renderHTML: (attributes) => attributes.threadId
          ? { "data-comment-thread-id": attributes.threadId }
          : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-thread-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "scenario-comment-anchor" }), 0];
  },
});

export function addCommentMark(editor: Editor, threadId: string, anchor: CommentAnchor): void {
  const position = findCommentAnchorPosition(editor, anchor);
  const markType = editor.schema.marks.commentAnchor;
  if (!position || !markType) {
    return;
  }
  editor.view.dispatch(
    editor.state.tr
      .addMark(position.from, position.to, markType.create({ threadId }))
      .setMeta('scenario-comment-projection', true)
      .setMeta("addToHistory", false),
  );
}

export function removeCommentMark(editor: Editor, threadId: string, anchor: CommentAnchor): void {
  const position = findCommentAnchorPosition(editor, anchor);
  const markType = editor.schema.marks.commentAnchor;
  if (!position || !markType) {
    return;
  }
  editor.view.dispatch(
    editor.state.tr
      .removeMark(position.from, position.to, markType.create({ threadId }))
      .setMeta('scenario-comment-projection', true)
      .setMeta("addToHistory", false),
  );
}

/** Rebuild visual anchors without creating user undo steps or collaborative text edits. */
export function syncProjectCommentMarks(editor:Editor,threads:CommentThread[]):void {
  const markType=editor.schema.marks.commentAnchor;
  if(!markType)return;
  let tr=editor.state.tr.removeMark(0,editor.state.doc.content.size,markType);
  for(const thread of threads) {
    const position=thread.status==='open'?findCommentAnchorPosition(editor,thread.anchor):null;
    if(position)tr=tr.addMark(position.from,position.to,markType.create({threadId:thread.id}));
  }
  if(!tr.doc.eq(editor.state.doc))editor.view.dispatch(tr.setMeta('scenario-comment-projection',true).setMeta('addToHistory',false));
}

function collectBlocks(doc: ProseMirrorNode): Map<string, ScenarioBlock> {
  const blocks = new Map<string, ScenarioBlock>();
  let currentSceneId = "scene_root";
  doc.descendants((node, position) => {
    if (node.type.name !== "paragraph") {
      return;
    }
    const id = node.attrs.blockId;
    if (typeof id !== "string" || !id) {
      return;
    }
    if (node.attrs.scenarioType === "SCENE_HEADING") {
      currentSceneId = id;
    }
    blocks.set(id, { id, sceneId: currentSceneId, position, text: node.textContent });
  });
  return blocks;
}

function findSceneId(doc: ProseMirrorNode, blockPosition: number): string {
  let currentSceneId = "scene_root";
  doc.descendants((node, position) => {
    if (position > blockPosition) {
      return false;
    }
    if (node.type.name === "paragraph" && node.attrs.scenarioType === "SCENE_HEADING" && node.attrs.blockId) {
      currentSceneId = node.attrs.blockId;
    }
    return undefined;
  });
  return currentSceneId;
}

function mapAnchorTextChange(anchor: CommentAnchor, before: string, after: string): CommentAnchor {
  if (before === after) {
    return anchor;
  }
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const oldChangeEnd = before.length - suffix;
  const insertedLength = after.length - prefix - suffix;
  const delta = after.length - before.length;
  let start = anchor.startOffset;
  let end = anchor.endOffset;

  if (end <= prefix) {
    return anchor;
  }
  if (start >= oldChangeEnd) {
    start += delta;
    end += delta;
  } else {
    start = Math.min(start, prefix);
    end = end > oldChangeEnd ? end + delta : prefix + insertedLength;
  }
  return { ...anchor, startOffset: start, endOffset: Math.max(start, end), lost: end <= start };
}

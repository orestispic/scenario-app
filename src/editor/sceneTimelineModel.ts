import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

export interface ScenarioScene {
  id: string;
  title: string;
  index: number;
  from: number;
  to: number;
  blockIds: string[];
}

interface TopLevelBlock {
  node: ProseMirrorNode;
  position: number;
}

function topLevelBlocks(document: ProseMirrorNode): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  document.forEach((node, _offset, index) => {
    const previous = blocks[index - 1];
    blocks.push({ node, position: previous ? previous.position + previous.node.nodeSize : 0 });
  });
  return blocks;
}

function sceneId(node: ProseMirrorNode, position: number): string {
  return typeof node.attrs.blockId === 'string' && node.attrs.blockId
    ? node.attrs.blockId
    : `scene-at-${position}`;
}

/**
 * The timeline is a projection of the editor document. Nothing in this list is
 * persisted independently, so its order and titles cannot drift from the script.
 */
export function getScenarioScenes(document: ProseMirrorNode): ScenarioScene[] {
  const blocks = topLevelBlocks(document);
  const headingIndices = blocks.flatMap((block, index) =>
    block.node.type.name === 'paragraph' && block.node.attrs.scenarioType === 'SCENE_HEADING'
      ? [index]
      : [],
  );
  return headingIndices.map((startIndex, index) => {
    const endIndex = headingIndices[index + 1] ?? blocks.length;
    const heading = blocks[startIndex];
    const blockIds = blocks.slice(startIndex, endIndex).flatMap(({ node }) =>
      typeof node.attrs.blockId === 'string' && node.attrs.blockId ? [node.attrs.blockId] : [],
    );
    return {
      id: sceneId(heading.node, heading.position),
      title: heading.node.textContent.trim() || 'Scène sans titre',
      index,
      from: heading.position,
      to: endIndex < blocks.length ? blocks[endIndex].position : document.content.size,
      blockIds,
    };
  });
}

export function getScenarioSceneAtPosition(
  document: ProseMirrorNode,
  position: number,
): ScenarioScene | null {
  const scenes = getScenarioScenes(document);
  return scenes.find(scene => position >= scene.from && position < scene.to) ?? null;
}

function rebuildWithSceneOrder(
  document: ProseMirrorNode,
  orderedSceneIds: string[],
): ProseMirrorNode {
  const blocks = topLevelBlocks(document);
  const scenes = getScenarioScenes(document);
  if (!scenes.length) return document;
  const firstHeadingIndex = blocks.findIndex(block => block.position === scenes[0].from);
  const preamble = blocks.slice(0, firstHeadingIndex).map(block => block.node);
  const sections = new Map(scenes.map(scene => [
    scene.id,
    blocks.filter(block => block.position >= scene.from && block.position < scene.to).map(block => block.node),
  ]));
  return document.type.create(
    document.attrs,
    [...preamble, ...orderedSceneIds.flatMap(id => sections.get(id) ?? [])],
  );
}

/** destinationBoundary is one of the N+1 gaps in the current timeline. */
export function reorderScenarioScenes(
  document: ProseMirrorNode,
  movedSceneId: string,
  destinationBoundary: number,
): ProseMirrorNode {
  const scenes = getScenarioScenes(document);
  const sourceIndex = scenes.findIndex(scene => scene.id === movedSceneId);
  if (sourceIndex < 0) return document;
  const boundary = Math.max(0, Math.min(destinationBoundary, scenes.length));
  if (boundary === sourceIndex || boundary === sourceIndex + 1) return document;
  const order = scenes.map(scene => scene.id);
  order.splice(sourceIndex, 1);
  order.splice(boundary > sourceIndex ? boundary - 1 : boundary, 0, movedSceneId);
  return rebuildWithSceneOrder(document, order);
}

export function removeScenarioScene(
  document: ProseMirrorNode,
  removedSceneId: string,
): ProseMirrorNode {
  const scenes = getScenarioScenes(document);
  if (!scenes.some(scene => scene.id === removedSceneId)) return document;
  const remaining = scenes.filter(scene => scene.id !== removedSceneId).map(scene => scene.id);
  if (remaining.length) return rebuildWithSceneOrder(document, remaining);

  const blocks = topLevelBlocks(document);
  const firstScene = scenes[0];
  const preamble = blocks.filter(block => block.position < firstScene.from).map(block => block.node);
  // ProseMirror's document requires at least one block. It is deliberately an
  // action paragraph, so deleting the final scene leaves an empty script and no
  // synthetic scene in the timeline.
  const empty = document.type.schema.nodes.paragraph.create({
    scenarioType: 'ACTION',
    ending: false,
    blockId: null,
  });
  return document.type.create(document.attrs, preamble.length ? preamble : [empty]);
}

function replaceEditorDocument(editor: Editor, next: ProseMirrorNode, selectedSceneId?: string): boolean {
  if (next === editor.state.doc || next.eq(editor.state.doc)) return false;
  let transaction = editor.state.tr
    .replaceWith(0, editor.state.doc.content.size, next.content)
    .setMeta('scenario-scene-structure', true);
  if (selectedSceneId) {
    const selected = getScenarioScenes(transaction.doc).find(scene => scene.id === selectedSceneId);
    if (selected) transaction = transaction.setSelection(TextSelection.create(transaction.doc, selected.from + 1));
  }
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

export function moveScenarioScene(
  editor: Editor,
  movedSceneId: string,
  destinationBoundary: number,
): boolean {
  if (!editor.isEditable) return false;
  return replaceEditorDocument(
    editor,
    reorderScenarioScenes(editor.state.doc, movedSceneId, destinationBoundary),
    movedSceneId,
  );
}

export function deleteScenarioScene(editor: Editor, removedSceneId: string): boolean {
  if (!editor.isEditable) return false;
  return replaceEditorDocument(editor, removeScenarioScene(editor.state.doc, removedSceneId));
}

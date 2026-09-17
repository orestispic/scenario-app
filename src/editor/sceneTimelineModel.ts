import type { Editor } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { toScenarioElementType, type ScenarioElementType } from './scenarioTypes';

export type ScenarioAct = number;
export const DEFAULT_SCENARIO_ACT_COUNT = 3;
export const MAX_SCENARIO_ACT_COUNT = 9;
export const DEFAULT_SCENARIO_ACT_DESCRIPTIONS = ['Mise en place', 'Confrontation', 'Résolution'];
export type SceneCardColor = '' | 'blue' | 'amber' | 'green' | 'red' | 'orange' | 'pink' | 'violet' | 'turquoise';

export interface ScenarioScene {
  id: string;
  title: string;
  index: number;
  from: number;
  to: number;
  blockIds: string[];
  act: ScenarioAct;
  summary: string;
  tag: string;
  color: SceneCardColor;
  estimatedPages: number;
}

export interface ScenarioScenePreviewBlock {
  id: string;
  type: ScenarioElementType;
  text: string;
  ending: boolean;
}

export interface SceneWhiteboardMetadata {
  title?: string;
  summary?: string;
  tag?: string;
  color?: SceneCardColor;
  act?: ScenarioAct;
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

function isScenarioAct(value: unknown): value is ScenarioAct {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SCENARIO_ACT_COUNT;
}

function isSceneCardColor(value: unknown): value is SceneCardColor {
  return value === '' || value === 'blue' || value === 'amber' || value === 'green' || value === 'red'
    || value === 'orange' || value === 'pink' || value === 'violet' || value === 'turquoise';
}

export function inferScenarioAct(index: number, total: number, actCount = DEFAULT_SCENARIO_ACT_COUNT): ScenarioAct {
  const boundedActCount = Math.max(1, Math.min(MAX_SCENARIO_ACT_COUNT, Math.floor(actCount)));
  if (boundedActCount !== 3) {
    if (total <= 1) return 1;
    return Math.min(boundedActCount, Math.floor((index / total) * boundedActCount) + 1);
  }
  if (total <= 1) return 1;
  if (total === 2) return index === 0 ? 1 : 2;
  const progress = (index + 0.5) / total;
  return progress <= 0.25 ? 1 : progress <= 0.75 ? 2 : 3;
}

export function getScenarioActCount(document: ProseMirrorNode): number {
  let configured = 0;
  let greatestAssignedAct = 0;
  document.forEach(node => {
    if (isScenarioAct(node.attrs.whiteboardActCount)) configured = Math.max(configured, node.attrs.whiteboardActCount);
    if (isScenarioAct(node.attrs.whiteboardAct)) greatestAssignedAct = Math.max(greatestAssignedAct, node.attrs.whiteboardAct);
  });
  return Math.max(
    1,
    Math.min(MAX_SCENARIO_ACT_COUNT, configured || Math.max(DEFAULT_SCENARIO_ACT_COUNT, greatestAssignedAct)),
  );
}

function defaultActDescription(index: number): string {
  return DEFAULT_SCENARIO_ACT_DESCRIPTIONS[index] ?? 'Section narrative';
}

export function getScenarioActDescriptions(document: ProseMirrorNode): string[] {
  const actCount = getScenarioActCount(document);
  let stored: string[] | null = null;
  document.forEach(node => {
    if (stored || typeof node.attrs.whiteboardActDescriptions !== 'string' || !node.attrs.whiteboardActDescriptions) return;
    try {
      const value = JSON.parse(node.attrs.whiteboardActDescriptions) as unknown;
      if (Array.isArray(value) && value.every(item => typeof item === 'string')) stored = value;
    } catch {
      // Une ancienne valeur invalide ne doit jamais empêcher l'ouverture du projet.
    }
  });
  return Array.from({ length: actCount }, (_, index) => stored?.[index] ?? defaultActDescription(index));
}

function estimatedPages(nodes: ProseMirrorNode[]): number {
  const words = nodes
    .map(node => node.textContent.trim())
    .filter(Boolean)
    .join(' ')
    .split(/\s+/u)
    .filter(Boolean).length;
  return Math.round((words / 250) * 10) / 10;
}

/**
 * The timeline is a projection of the editor document. Nothing in this list is
 * persisted independently, so its order and titles cannot drift from the script.
 */
export function getScenarioScenes(document: ProseMirrorNode): ScenarioScene[] {
  const blocks = topLevelBlocks(document);
  const actCount = getScenarioActCount(document);
  const headingIndices = blocks.flatMap((block, index) =>
    block.node.type.name === 'paragraph' && block.node.attrs.scenarioType === 'SCENE_HEADING'
      ? [index]
      : [],
  );
  const explicitActs = headingIndices.map(startIndex => {
    const value = blocks[startIndex].node.attrs.whiteboardAct;
    return isScenarioAct(value) && value <= actCount ? value : null;
  });
  return headingIndices.map((startIndex, index) => {
    const endIndex = headingIndices[index + 1] ?? blocks.length;
    const heading = blocks[startIndex];
    const sceneBlocks = blocks.slice(startIndex, endIndex);
    const blockIds = sceneBlocks.flatMap(({ node }) =>
      typeof node.attrs.blockId === 'string' && node.attrs.blockId ? [node.attrs.blockId] : [],
    );
    const act = explicitActs[index]
      ?? explicitActs.slice(0, index).reverse().find(value => value !== null)
      ?? explicitActs.slice(index + 1).find(value => value !== null)
      ?? inferScenarioAct(index, headingIndices.length, actCount);
    const color = isSceneCardColor(heading.node.attrs.whiteboardColor)
      ? heading.node.attrs.whiteboardColor
      : '';
    return {
      id: sceneId(heading.node, heading.position),
      title: heading.node.textContent.trim() || 'Scène sans titre',
      index,
      from: heading.position,
      to: endIndex < blocks.length ? blocks[endIndex].position : document.content.size,
      blockIds,
      act,
      summary: typeof heading.node.attrs.whiteboardSummary === 'string'
        ? heading.node.attrs.whiteboardSummary.trim()
        : '',
      tag: typeof heading.node.attrs.whiteboardTag === 'string'
        ? heading.node.attrs.whiteboardTag.trim()
        : '',
      color,
      estimatedPages: estimatedPages(sceneBlocks.map(block => block.node)),
    };
  });
}

/** Read-only projection of one scene's actual blocks for secondary workspaces. */
export function getScenarioScenePreviewBlocks(
  document: ProseMirrorNode,
  targetSceneId: string,
): ScenarioScenePreviewBlock[] {
  const scene = getScenarioScenes(document).find(candidate => candidate.id === targetSceneId);
  if (!scene) return [];
  const blocks: ScenarioScenePreviewBlock[] = [];
  document.forEach((node, offset) => {
    if (offset < scene.from || offset >= scene.to || node.type.name !== 'paragraph') return;
    blocks.push({
      id: typeof node.attrs.blockId === 'string' && node.attrs.blockId ? node.attrs.blockId : `block-at-${offset}`,
      type: toScenarioElementType(node.attrs.scenarioType),
      text: node.textContent,
      ending: node.attrs.ending === true,
    });
  });
  return blocks;
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
  actOverrides: ReadonlyMap<string, ScenarioAct> = new Map(),
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
    [...preamble, ...orderedSceneIds.flatMap(id => {
      const section = sections.get(id) ?? [];
      const act = actOverrides.get(id);
      if (!act || !section.length) return section;
      return section.map((node, index) => index === 0
        ? node.type.create({ ...node.attrs, whiteboardAct: act }, node.content, node.marks)
        : node);
    })],
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
  const insertionIndex = boundary > sourceIndex ? boundary - 1 : boundary;
  const targetAct = scenes.find(scene => scene.id === order[insertionIndex])?.act
    ?? scenes.find(scene => scene.id === order[insertionIndex - 1])?.act
    ?? scenes[sourceIndex].act;
  order.splice(insertionIndex, 0, movedSceneId);
  const overrides = new Map(scenes.map(scene => [scene.id, scene.act] as const));
  overrides.set(movedSceneId, targetAct);
  return rebuildWithSceneOrder(document, order, overrides);
}

/**
 * Reorders a selected scene group in one atomic document replacement. Acts are
 * serialized in I → II → III order, which keeps the whiteboard, timeline and
 * screenplay structure identical after every drop.
 */
export function reorderScenarioSceneGroup(
  document: ProseMirrorNode,
  movedSceneIds: string[],
  targetAct: ScenarioAct,
  destinationActBoundary: number,
): ProseMirrorNode {
  const scenes = getScenarioScenes(document);
  const actCount = getScenarioActCount(document);
  const boundedTargetAct = Math.max(1, Math.min(actCount, Math.floor(targetAct)));
  const existing = new Set(scenes.map(scene => scene.id));
  const moved = [...new Set(movedSceneIds)].filter(id => existing.has(id));
  if (!moved.length) return document;
  const movedSet = new Set(moved);
  const originalTargetAct = scenes.filter(scene => scene.act === boundedTargetAct);
  const boundedBoundary = Math.max(0, Math.min(destinationActBoundary, originalTargetAct.length));
  const removedBeforeBoundary = originalTargetAct
    .slice(0, boundedBoundary)
    .filter(scene => movedSet.has(scene.id)).length;
  const insertionIndex = boundedBoundary - removedBeforeBoundary;
  const buckets = new Map<ScenarioAct, string[]>(
    Array.from({ length: actCount }, (_, index) => [index + 1, []]),
  );
  for (const scene of scenes) {
    if (!movedSet.has(scene.id)) (buckets.get(scene.act) ?? buckets.get(1)!).push(scene.id);
  }
  buckets.get(boundedTargetAct)!.splice(insertionIndex, 0, ...moved);
  const order = [...buckets.values()].flat();
  const overrides = new Map(scenes.map(scene => [scene.id, scene.act] as const));
  for (const id of moved) overrides.set(id, boundedTargetAct);
  const rebuilt = rebuildWithSceneOrder(document, order, overrides);
  return rebuilt.eq(document) ? document : rebuilt;
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

export function moveScenarioSceneGroup(
  editor: Editor,
  movedSceneIds: string[],
  targetAct: ScenarioAct,
  destinationActBoundary: number,
): boolean {
  if (!editor.isEditable) return false;
  const selectedId = movedSceneIds[0];
  return replaceEditorDocument(
    editor,
    reorderScenarioSceneGroup(editor.state.doc, movedSceneIds, targetAct, destinationActBoundary),
    selectedId,
  );
}

export function ensureScenarioSceneActs(editor: Editor): boolean {
  if (!editor.isEditable) return false;
  const scenes = getScenarioScenes(editor.state.doc);
  let transaction = editor.state.tr;
  let changed = false;
  for (const scene of scenes) {
    const heading = editor.state.doc.nodeAt(scene.from);
    if (!heading || isScenarioAct(heading.attrs.whiteboardAct)) continue;
    transaction = transaction.setNodeMarkup(scene.from, undefined, {
      ...heading.attrs,
      whiteboardAct: scene.act,
    });
    changed = true;
  }
  if (!changed) return false;
  editor.view.dispatch(
    transaction
      .setMeta('whiteboard-initialize', true)
      .setMeta('addToHistory', false),
  );
  return true;
}

function updateScenarioActStructure(
  editor: Editor,
  nextActCount: number,
  removedAct?: ScenarioAct,
): boolean {
  if (!editor.isEditable) return false;
  const currentActCount = getScenarioActCount(editor.state.doc);
  const currentDescriptions = getScenarioActDescriptions(editor.state.doc);
  const boundedCount = Math.max(1, Math.min(MAX_SCENARIO_ACT_COUNT, Math.floor(nextActCount)));
  if (boundedCount === currentActCount && removedAct === undefined) return false;
  const sceneAtPosition = new Map(getScenarioScenes(editor.state.doc).map(scene => [scene.from, scene]));
  const nextDescriptions = removedAct === undefined
    ? Array.from({ length: boundedCount }, (_, index) => currentDescriptions[index] ?? defaultActDescription(index))
    : currentDescriptions.filter((_description, index) => index !== removedAct - 1).slice(0, boundedCount);
  const serializedDescriptions = JSON.stringify(nextDescriptions);
  let transaction = editor.state.tr;
  editor.state.doc.forEach((node, position) => {
    if (node.type.name !== 'paragraph') return;
    const scene = sceneAtPosition.get(position);
    let act = scene?.act;
    if (act !== undefined && removedAct !== undefined) {
      if (act === removedAct) act = removedAct > 1 ? removedAct - 1 : 1;
      else if (act > removedAct) act -= 1;
    }
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      whiteboardActCount: boundedCount,
      whiteboardActDescriptions: serializedDescriptions,
      ...(scene ? { whiteboardAct: Math.max(1, Math.min(boundedCount, act ?? 1)) } : {}),
    });
  });
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.setMeta('scenario-scene-structure', true));
  return true;
}

export function updateScenarioActDescription(
  editor: Editor,
  act: ScenarioAct,
  description: string,
): boolean {
  if (!editor.isEditable) return false;
  const actCount = getScenarioActCount(editor.state.doc);
  if (!Number.isInteger(act) || act < 1 || act > actCount) return false;
  const descriptions = getScenarioActDescriptions(editor.state.doc);
  const nextDescription = description.trim();
  if (descriptions[act - 1] === nextDescription) return false;
  descriptions[act - 1] = nextDescription;
  const serializedDescriptions = JSON.stringify(descriptions);
  let transaction = editor.state.tr;
  editor.state.doc.forEach((node, position) => {
    if (node.type.name !== 'paragraph') return;
    transaction = transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      whiteboardActDescriptions: serializedDescriptions,
    });
  });
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.setMeta('scenario-scene-structure', true));
  return true;
}

export function addScenarioAct(editor: Editor): boolean {
  const current = getScenarioActCount(editor.state.doc);
  if (current >= MAX_SCENARIO_ACT_COUNT) return false;
  return updateScenarioActStructure(editor, current + 1);
}

export function deleteScenarioAct(editor: Editor, removedAct: ScenarioAct): boolean {
  const current = getScenarioActCount(editor.state.doc);
  if (current <= 1 || !Number.isInteger(removedAct) || removedAct < 1 || removedAct > current) return false;
  return updateScenarioActStructure(editor, current - 1, removedAct);
}

export function updateScenarioScene(
  editor: Editor,
  sceneIdToUpdate: string,
  metadata: SceneWhiteboardMetadata,
): boolean {
  if (!editor.isEditable) return false;
  const scene = getScenarioScenes(editor.state.doc).find(item => item.id === sceneIdToUpdate);
  if (!scene) return false;
  const heading = editor.state.doc.nodeAt(scene.from);
  if (!heading) return false;
  const nextTitle = metadata.title === undefined ? heading.textContent : metadata.title.trim();
  if (metadata.title !== undefined && !nextTitle) return false;
  const nextAttrs = {
    ...heading.attrs,
    ...(metadata.summary === undefined ? {} : { whiteboardSummary: metadata.summary.trim() }),
    ...(metadata.tag === undefined ? {} : { whiteboardTag: metadata.tag.trim() }),
    ...(metadata.color === undefined ? {} : { whiteboardColor: metadata.color }),
    ...(metadata.act === undefined ? {} : { whiteboardAct: metadata.act }),
  };
  let transaction = editor.state.tr.setNodeMarkup(scene.from, undefined, nextAttrs);
  if (nextTitle !== heading.textContent) {
    transaction = transaction.insertText(nextTitle, scene.from + 1, scene.from + heading.nodeSize - 1);
  }
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction.setMeta('scenario-scene-structure', true));
  return true;
}

function freshBlockId(): string {
  return `block_${crypto.randomUUID()}`;
}

/** Adds one real, empty scene at the end of an act. The heading and its empty
 * action paragraph are inserted in the shared ProseMirror document, so every
 * structural view observes the same scene immediately. */
export function addScenarioScene(editor: Editor, targetAct: ScenarioAct): string | null {
  if (!editor.isEditable) return null;
  const actCount = getScenarioActCount(editor.state.doc);
  if (!Number.isInteger(targetAct) || targetAct < 1 || targetAct > actCount) return null;
  const scenes = getScenarioScenes(editor.state.doc);
  const scenesInAct = scenes.filter(scene => scene.act === targetAct);
  const nextActScene = scenes.find(scene => scene.act > targetAct);
  const lastSceneInAct = scenesInAct[scenesInAct.length - 1];
  const insertionPosition = lastSceneInAct?.to ?? nextActScene?.from ?? editor.state.doc.content.size;
  const descriptions = JSON.stringify(getScenarioActDescriptions(editor.state.doc));
  const id = freshBlockId();
  const heading = editor.state.schema.nodes.paragraph.create({
    scenarioType: 'SCENE_HEADING',
    ending: false,
    blockId: id,
    whiteboardAct: targetAct,
    whiteboardActCount: actCount,
    whiteboardActDescriptions: descriptions,
  });
  const action = editor.state.schema.nodes.paragraph.create({
    scenarioType: 'ACTION',
    ending: false,
    blockId: freshBlockId(),
    whiteboardActCount: actCount,
    whiteboardActDescriptions: descriptions,
  });
  let transaction = editor.state.tr.insert(insertionPosition, Fragment.fromArray([heading, action]));
  transaction = transaction.setSelection(TextSelection.create(transaction.doc, insertionPosition + 1));
  editor.view.dispatch(transaction.setMeta('scenario-scene-structure', true).scrollIntoView());
  return id;
}

function cloneSceneNode(node: ProseMirrorNode): ProseMirrorNode {
  const marks = node.marks.filter(mark => mark.type.name !== 'commentAnchor');
  if (node.isText) return node.type.schema.text(node.text ?? '', marks);
  const children: ProseMirrorNode[] = [];
  node.content.forEach(child => children.push(cloneSceneNode(child)));
  const attrs = node.type.name === 'paragraph'
    ? { ...node.attrs, blockId: freshBlockId() }
    : node.attrs;
  return node.type.create(attrs, Fragment.fromArray(children), marks);
}

/** Duplicates the complete scene but deliberately leaves comment threads on the source. */
export function duplicateScenarioScene(editor: Editor, sourceSceneId: string): string | null {
  if (!editor.isEditable) return null;
  const source = getScenarioScenes(editor.state.doc).find(scene => scene.id === sourceSceneId);
  if (!source) return null;
  const nodes: ProseMirrorNode[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (offset >= source.from && offset < source.to) nodes.push(cloneSceneNode(node));
  });
  if (!nodes.length) return null;
  const newSceneId = String(nodes[0].attrs.blockId);
  let transaction = editor.state.tr.insert(source.to, Fragment.fromArray(nodes));
  transaction = transaction.setSelection(
    TextSelection.create(transaction.doc, Math.min(source.to + 1, transaction.doc.content.size)),
  );
  editor.view.dispatch(transaction.setMeta('scenario-scene-structure', true).scrollIntoView());
  return newSceneId;
}

export function deleteScenarioScene(editor: Editor, removedSceneId: string): boolean {
  if (!editor.isEditable) return false;
  return replaceEditorDocument(editor, removeScenarioScene(editor.state.doc, removedSceneId));
}

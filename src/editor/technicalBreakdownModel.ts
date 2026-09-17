import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { getScenarioScenes, type ScenarioScene } from './sceneTimelineModel';

export type TechnicalColumnKind =
  | 'scene' | 'plan' | 'image' | 'description' | 'actors' | 'focal'
  | 'angle' | 'shotSize' | 'dialogue' | 'duration' | 'vfx' | 'fps' | 'notes' | 'custom';

export type TechnicalFilterCombinationMode = 'addition' | 'restriction';
export type TechnicalFilterDisplayMode = 'keep' | 'exclude';

export interface TechnicalColumn {
  id: string;
  name: string;
  kind: TechnicalColumnKind;
  width: number;
  hidden: boolean;
}

export interface TechnicalShot {
  id: string;
  sceneId: string;
  values: Record<string, string>;
}

export interface TechnicalBreakdown {
  version: 1;
  columns: TechnicalColumn[];
  shots: TechnicalShot[];
  adaptedCells?: string[];
}

interface StoredSceneBreakdown {
  version: 1;
  columns?: TechnicalColumn[];
  shots?: TechnicalShot[];
  adaptedCells?: string[];
}

const COLUMN_WIDTH_MIN = 72;
const COLUMN_WIDTH_MAX = 640;

export const DEFAULT_TECHNICAL_COLUMNS: readonly TechnicalColumn[] = [
  { id: 'scene', name: 'Scène', kind: 'scene', width: 210, hidden: false },
  { id: 'plan', name: 'Plan', kind: 'plan', width: 82, hidden: false },
  { id: 'image', name: 'Image', kind: 'image', width: 136, hidden: false },
  { id: 'description', name: 'Description', kind: 'description', width: 280, hidden: false },
  { id: 'actors', name: 'Acteurs', kind: 'actors', width: 190, hidden: false },
  { id: 'focal', name: 'Focale', kind: 'focal', width: 116, hidden: false },
  { id: 'angle', name: 'Angle', kind: 'angle', width: 170, hidden: false },
  { id: 'shot-size', name: 'Valeur de plan', kind: 'shotSize', width: 176, hidden: false },
  { id: 'dialogue', name: 'Dialogue', kind: 'dialogue', width: 260, hidden: false },
  { id: 'duration', name: 'Durée', kind: 'duration', width: 104, hidden: false },
  { id: 'vfx', name: 'VFX', kind: 'vfx', width: 150, hidden: false },
  { id: 'fps', name: 'IPS', kind: 'fps', width: 96, hidden: false },
  { id: 'notes', name: 'Notes', kind: 'notes', width: 260, hidden: false },
];

export const NATIVE_TECHNICAL_SUGGESTIONS: Partial<Record<TechnicalColumnKind, readonly string[]>> = {
  angle: ['Plongée', 'Contre-plongée', 'Niveau des yeux', 'Vue zénithale', 'Contre-zénithale', 'Profil', 'Trois-quarts', 'Face', 'Dos'],
  shotSize: ['Très gros plan', 'Gros plan', 'Plan rapproché', 'Plan poitrine', 'Plan taille', 'Plan américain', 'Plan moyen', 'Plan pied', 'Plan d’ensemble', 'Plan large', 'Très large'],
  focal: ['14 mm', '18 mm', '24 mm', '28 mm', '35 mm', '50 mm', '75 mm', '85 mm', '100 mm', '135 mm'],
  fps: ['23,976', '24', '25', '30', '50', '60', '100', '120'],
};

export function createTechnicalId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function applyTechnicalFilterLogic(
  matches: readonly boolean[],
  combinationMode: TechnicalFilterCombinationMode,
  displayMode: TechnicalFilterDisplayMode,
): boolean {
  if (!matches.length) return true;
  const matchesCombination = combinationMode === 'addition' ? matches.some(Boolean) : matches.every(Boolean);
  return displayMode === 'exclude' ? !matchesCombination : matchesCombination;
}

function cloneDefaultColumns(): TechnicalColumn[] {
  return DEFAULT_TECHNICAL_COLUMNS.map(column => ({ ...column }));
}

export function createDefaultTechnicalBreakdown(): TechnicalBreakdown {
  return { version: 1, columns: cloneDefaultColumns(), shots: [] };
}

export function getVisibleTechnicalColumns(breakdown: Pick<TechnicalBreakdown, 'columns'>): TechnicalColumn[] {
  return breakdown.columns.filter(column => !column.hidden);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isColumnKind(value: unknown): value is TechnicalColumnKind {
  return ['scene', 'plan', 'image', 'description', 'actors', 'focal', 'angle', 'shotSize', 'dialogue', 'duration', 'vfx', 'fps', 'notes', 'custom'].includes(String(value));
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

function parseColumn(value: unknown, usedIds: Set<string>): TechnicalColumn | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || usedIds.has(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || !isColumnKind(value.kind)) return null;
  usedIds.add(value.id);
  const width = typeof value.width === 'number' && Number.isFinite(value.width) ? value.width : 160;
  return {
    id: value.id,
    name: value.name.trim().slice(0, 80),
    kind: value.kind,
    width: Math.max(COLUMN_WIDTH_MIN, Math.min(COLUMN_WIDTH_MAX, Math.round(width))),
    hidden: value.hidden === true,
  };
}

function parseColumns(value: unknown): TechnicalColumn[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const usedIds = new Set<string>();
  const columns = value.flatMap(item => {
    const column = parseColumn(item, usedIds);
    return column ? [column] : [];
  });
  return columns.length ? columns : null;
}

function parseShot(value: unknown, sceneId: string, columnIds: Set<string>, usedIds: Set<string>): TechnicalShot | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isRecord(value.values)) return null;
  let id = value.id;
  if (usedIds.has(id)) id = `${id}-${sceneId}`;
  usedIds.add(id);
  const values: Record<string, string> = {};
  for (const [columnId, cell] of Object.entries(value.values)) {
    if (columnIds.has(columnId) && typeof cell === 'string' && cell) values[columnId] = cell;
  }
  return { id, sceneId, values };
}

function readStoredScene(node: ProseMirrorNode | undefined): StoredSceneBreakdown | null {
  if (!node || typeof node.attrs.technicalBreakdownData !== 'string' || !node.attrs.technicalBreakdownData) return null;
  try {
    const value = JSON.parse(node.attrs.technicalBreakdownData) as unknown;
    return isRecord(value) && value.version === 1 ? value as unknown as StoredSceneBreakdown : null;
  } catch {
    return null;
  }
}

function headingNodes(document: ProseMirrorNode): Map<string, ProseMirrorNode> {
  const nodes = new Map<string, ProseMirrorNode>();
  document.forEach(node => {
    if (node.type.name !== 'paragraph' || node.attrs.scenarioType !== 'SCENE_HEADING') return;
    if (typeof node.attrs.blockId === 'string' && node.attrs.blockId) nodes.set(node.attrs.blockId, node);
  });
  return nodes;
}

/** Reads the technical sheet as a projection of the scenario's current scenes. */
export function getTechnicalBreakdown(document: ProseMirrorNode): TechnicalBreakdown {
  const scenes = getScenarioScenes(document);
  const nodes = headingNodes(document);
  let columns: TechnicalColumn[] | null = null;
  for (const scene of scenes) {
    columns = parseColumns(readStoredScene(nodes.get(scene.id)!)?.columns);
    if (columns) break;
  }
  columns ??= cloneDefaultColumns();
  const columnIds = new Set(columns.map(column => column.id));
  const usedShotIds = new Set<string>();
  const shots = scenes.flatMap(scene => {
    const stored = readStoredScene(nodes.get(scene.id)!);
    if (!Array.isArray(stored?.shots)) return [];
    return stored.shots.flatMap(value => {
      const shot = parseShot(value, scene.id, columnIds, usedShotIds);
      return shot ? [shot] : [];
    });
  });
  const validCellKeys = new Set(shots.flatMap(shot => columns.map(column => `${shot.id}:${column.id}`)));
  const storedAdaptedCells = scenes
    .map(scene => readStoredScene(nodes.get(scene.id)!)?.adaptedCells)
    .find((value): value is string[] => Array.isArray(value)) ?? [];
  const adaptedCells = [...new Set(storedAdaptedCells.filter(value => typeof value === 'string' && validCellKeys.has(value)))];
  return { version: 1, columns, shots, adaptedCells };
}

/** One transaction updates every affected scene, so the operation is a single Undo step. */
export function updateTechnicalBreakdown(editor: Editor, value: TechnicalBreakdown): boolean {
  if (!editor.isEditable) return false;
  const scenes = getScenarioScenes(editor.state.doc);
  if (!scenes.length) return false;
  const sceneIds = new Set(scenes.map(scene => scene.id));
  const columns = parseColumns(value.columns) ?? cloneDefaultColumns();
  const columnIds = new Set(columns.map(column => column.id));
  const shotsByScene = new Map<string, TechnicalShot[]>(scenes.map(scene => [scene.id, []]));
  const usedShotIds = new Set<string>();
  for (const candidate of value.shots) {
    if (!sceneIds.has(candidate.sceneId)) continue;
    const shot = parseShot(candidate, candidate.sceneId, columnIds, usedShotIds);
    if (shot) shotsByScene.get(candidate.sceneId)!.push(shot);
  }
  const validCellKeys = new Set([...shotsByScene.values()].flatMap(shots => shots.flatMap(shot => columns.map(column => `${shot.id}:${column.id}`))));
  const adaptedCells = [...new Set((value.adaptedCells ?? []).filter(cellKey => validCellKeys.has(cellKey)))];
  let transaction = editor.state.tr;
  let changed = false;
  for (const scene of scenes) {
    const node = transaction.doc.nodeAt(scene.from);
    if (!node) continue;
    const serialized = JSON.stringify({
      version: 1,
      columns,
      shots: shotsByScene.get(scene.id) ?? [],
      adaptedCells,
    } satisfies StoredSceneBreakdown);
    if (node.attrs.technicalBreakdownData === serialized) continue;
    transaction = transaction.setNodeMarkup(scene.from, undefined, {
      ...node.attrs,
      technicalBreakdownData: serialized,
    });
    changed = true;
  }
  if (changed) editor.view.dispatch(transaction.setMeta('technical-breakdown', true));
  return changed;
}

export function getScenarioCharacters(document: ProseMirrorNode): string[] {
  const values = new Map<string, string>();
  document.forEach(node => {
    if (node.type.name !== 'paragraph' || node.attrs.scenarioType !== 'CHARACTER') return;
    const value = node.textContent.trim().replace(/\s*\([^)]*\)\s*$/u, '').replace(/\s+/gu, ' ');
    const key = normalizedName(value);
    if (key && !values.has(key)) values.set(key, value);
  });
  return [...values.values()].sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base' }));
}

export function getTechnicalSuggestions(
  breakdown: TechnicalBreakdown,
  column: TechnicalColumn,
  characters: string[] = [],
  query = '',
): string[] {
  if (column.kind === 'scene' || column.kind === 'plan' || column.kind === 'image' || column.kind === 'duration') return [];
  const values = new Map<string, string>();
  const append = (value: string) => {
    const clean = value.trim().replace(/\s+/gu, ' ');
    const key = normalizedName(clean);
    if (key && !values.has(key)) values.set(key, clean);
  };
  for (const seed of NATIVE_TECHNICAL_SUGGESTIONS[column.kind] ?? []) append(seed);
  if (column.kind === 'actors') characters.forEach(append);
  const sharedName = normalizedName(column.name);
  const matchingIds = new Set(breakdown.columns
    .filter(candidate => normalizedName(candidate.name) === sharedName)
    .map(candidate => candidate.id));
  for (const shot of breakdown.shots) {
    for (const id of matchingIds) {
      const value = shot.values[id];
      if (!value) continue;
      // Actor cells accept a compact comma-separated cast while learning each name too.
      if (column.kind === 'actors') value.split(/[,;]+/u).forEach(append);
      else append(value);
    }
  }
  const normalizedQuery = normalizedName(query);
  return [...values.values()]
    .filter(value => !normalizedQuery || normalizedName(value).includes(normalizedQuery))
    .sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base', numeric: true }))
    .slice(0, 12);
}

export function parseTechnicalDuration(value: string): number {
  const normalized = value.trim().toLocaleLowerCase('fr-FR').replace(',', '.');
  if (!normalized) return 0;
  const colon = normalized.match(/^(?:(\d+):)?(\d{1,2})(?::(\d{1,2}))?$/u);
  if (colon) {
    if (colon[3] !== undefined) return Number(colon[1] ?? 0) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
    return Number(colon[1] ?? 0) * 60 + Number(colon[2]);
  }
  const hours = Number(normalized.match(/([\d.]+)\s*h/u)?.[1] ?? 0);
  const minutes = Number(normalized.match(/([\d.]+)\s*m(?:in)?/u)?.[1] ?? 0);
  const seconds = Number(normalized.match(/([\d.]+)\s*s/u)?.[1] ?? 0);
  if (hours || minutes || seconds) return Math.round(hours * 3600 + minutes * 60 + seconds);
  const plain = Number(normalized);
  return Number.isFinite(plain) && plain > 0 ? plain : 0;
}

export function formatTechnicalDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, '0')} min ${String(remainder).padStart(2, '0')} s`;
  if (minutes) return `${minutes} min ${String(remainder).padStart(2, '0')} s`;
  return `${remainder} s`;
}

export function getSceneDuration(
  breakdown: TechnicalBreakdown,
  sceneId: string,
): number {
  const durationColumns = breakdown.columns.filter(column => column.kind === 'duration');
  return breakdown.shots
    .filter(shot => shot.sceneId === sceneId)
    .reduce((total, shot) => total + durationColumns.reduce(
      (shotTotal, column) => shotTotal + parseTechnicalDuration(shot.values[column.id] ?? ''), 0,
    ), 0);
}

export function addTechnicalShot(
  breakdown: TechnicalBreakdown,
  sceneId: string,
  beforeShotId: string | null = null,
  values: Record<string, string> = {},
): TechnicalBreakdown {
  const shot: TechnicalShot = { id: createTechnicalId('shot'), sceneId, values: { ...values } };
  const insertionIndex = beforeShotId ? breakdown.shots.findIndex(candidate => candidate.id === beforeShotId) : -1;
  if (insertionIndex >= 0) {
    const shots = [...breakdown.shots];
    shots.splice(insertionIndex, 0, shot);
    return { ...breakdown, shots };
  }
  const lastInScene = breakdown.shots.reduce((last, candidate, index) => candidate.sceneId === sceneId ? index : last, -1);
  const shots = [...breakdown.shots];
  shots.splice(lastInScene + 1, 0, shot);
  return { ...breakdown, shots };
}

export function reorderTechnicalShots(
  breakdown: TechnicalBreakdown,
  movedShotIds: string[],
  targetSceneId: string,
  beforeShotId: string | null,
  scenes: ScenarioScene[],
): TechnicalBreakdown {
  const movedSet = new Set(movedShotIds);
  if (beforeShotId && movedSet.has(beforeShotId)) return breakdown;
  const moved = breakdown.shots.filter(shot => movedSet.has(shot.id)).map(shot => ({ ...shot, sceneId: targetSceneId }));
  if (!moved.length) return breakdown;
  const remaining = breakdown.shots.filter(shot => !movedSet.has(shot.id));
  let insertionIndex = beforeShotId ? remaining.findIndex(shot => shot.id === beforeShotId) : -1;
  if (insertionIndex < 0) insertionIndex = remaining.reduce((last, shot, index) => shot.sceneId === targetSceneId ? index + 1 : last, 0);
  remaining.splice(insertionIndex, 0, ...moved);
  const sceneOrder = new Map(scenes.map((scene, index) => [scene.id, index]));
  const stable = remaining.map((shot, index) => ({ shot, index }));
  stable.sort((left, right) =>
    (sceneOrder.get(left.shot.sceneId) ?? Number.MAX_SAFE_INTEGER) - (sceneOrder.get(right.shot.sceneId) ?? Number.MAX_SAFE_INTEGER)
    || left.index - right.index);
  return { ...breakdown, shots: stable.map(item => item.shot) };
}

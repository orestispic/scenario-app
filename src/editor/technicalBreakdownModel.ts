import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { getScenarioScenes, type ScenarioScene } from './sceneTimelineModel';

export type TechnicalColumnKind =
  | 'scene' | 'plan' | 'image' | 'description' | 'actors' | 'focal'
  | 'angle' | 'shotSize' | 'dialogue' | 'duration' | 'vfx' | 'fps' | 'notes' | 'custom';

export type TechnicalFilterCombinationMode = 'addition' | 'restriction';
export type TechnicalFilterDisplayMode = 'keep' | 'exclude';
export type TechnicalColumnWidthMode = 'auto' | 'manual';

export interface TechnicalColumn {
  id: string;
  name: string;
  kind: TechnicalColumnKind;
  width: number;
  widthMode: TechnicalColumnWidthMode;
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
  imageFitDisabledCells?: string[];
}

interface StoredSceneBreakdown {
  version: 1;
  columns?: TechnicalColumn[];
  shots?: TechnicalShot[];
  adaptedCells?: string[];
  imageFitDisabledCells?: string[];
}

export const TECHNICAL_COLUMN_RESIZE_MIN = 40;
export const TECHNICAL_COLUMN_RESIZE_MAX = 2000;
export const TECHNICAL_ROW_TOOLS_WIDTH = 44;

export const DEFAULT_TECHNICAL_COLUMNS: readonly TechnicalColumn[] = [
  { id: 'plan', name: 'Plan', kind: 'plan', width: 66, widthMode: 'auto', hidden: false },
  { id: 'image', name: 'Image', kind: 'image', width: 80, widthMode: 'auto', hidden: false },
  { id: 'description', name: 'Description', kind: 'description', width: 110, widthMode: 'auto', hidden: false },
  { id: 'actors', name: 'Acteurs', kind: 'actors', width: 85, widthMode: 'auto', hidden: false },
  { id: 'focal', name: 'Focale', kind: 'focal', width: 79, widthMode: 'auto', hidden: false },
  { id: 'angle', name: 'Angle', kind: 'angle', width: 72, widthMode: 'auto', hidden: false },
  { id: 'shot-size', name: 'Valeur de plan', kind: 'shotSize', width: 129, widthMode: 'auto', hidden: false },
  { id: 'dialogue', name: 'Dialogue', kind: 'dialogue', width: 91, widthMode: 'auto', hidden: false },
  { id: 'duration', name: 'Durée', kind: 'duration', width: 72, widthMode: 'auto', hidden: false },
  { id: 'vfx', name: 'VFX', kind: 'vfx', width: 60, widthMode: 'auto', hidden: false },
  { id: 'fps', name: 'IPS', kind: 'fps', width: 60, widthMode: 'auto', hidden: false },
  { id: 'notes', name: 'Notes', kind: 'notes', width: 72, widthMode: 'auto', hidden: false },
];

const LEGACY_DEFAULT_COLUMN_WIDTHS: Readonly<Record<string, number>> = {
  plan: 72,
  image: 92,
  description: 132,
  actors: 112,
  focal: 88,
  angle: 142,
  'shot-size': 148,
  dialogue: 156,
  duration: 86,
  vfx: 76,
  fps: 72,
  notes: 116,
};

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

export function createTechnicalCustomColumn(name: string): TechnicalColumn {
  const cleanName = name.trim().replace(/\s+/gu, ' ').slice(0, 80);
  return {
    id: createTechnicalId('column'),
    name: cleanName,
    kind: 'custom',
    width: getTechnicalColumnBaseWidth({ name: cleanName, kind: 'custom' }),
    widthMode: 'auto',
    hidden: false,
  };
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
  const hasWidth = typeof value.width === 'number' && Number.isFinite(value.width);
  const width = Math.max(TECHNICAL_COLUMN_RESIZE_MIN, Math.min(TECHNICAL_COLUMN_RESIZE_MAX, Math.round(hasWidth ? value.width as number : 160)));
  const parsed: TechnicalColumn = {
    id: value.id,
    name: value.name.trim().slice(0, 80),
    kind: value.kind,
    width,
    widthMode: 'auto',
    hidden: value.hidden === true,
  };
  parsed.widthMode = value.widthMode === 'manual'
    ? 'manual'
    : value.widthMode === 'auto' || !hasWidth || isLegacyAutomaticWidth(parsed) ? 'auto' : 'manual';
  return parsed;
}

function parseColumns(value: unknown): TechnicalColumn[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return [];
  const usedIds = new Set<string>();
  const columns = value.flatMap(item => {
    const column = parseColumn(item, usedIds);
    return column ? [column] : [];
  });
  if (!columns.length) return null;
  // La scène est déjà portée par le groupe visuel et par shot.sceneId. Les
  // anciens fichiers peuvent encore contenir cette colonne calculée : elle est
  // retirée à la lecture sans toucher au rattachement réel des plans.
  return columns.filter(column => column.kind !== 'scene');
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
  const storedImageFitDisabledCells = scenes
    .map(scene => readStoredScene(nodes.get(scene.id)!)?.imageFitDisabledCells)
    .find((value): value is string[] => Array.isArray(value)) ?? [];
  const imageColumnIds = new Set(columns.filter(column => column.kind === 'image').map(column => column.id));
  const imageFitDisabledCells = [...new Set(storedImageFitDisabledCells.filter(value => {
    if (typeof value !== 'string' || !validCellKeys.has(value)) return false;
    const separator = value.lastIndexOf(':');
    return separator >= 0 && imageColumnIds.has(value.slice(separator + 1));
  }))];
  return { version: 1, columns, shots, adaptedCells, imageFitDisabledCells };
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
  const imageColumnIds = new Set(columns.filter(column => column.kind === 'image').map(column => column.id));
  const imageFitDisabledCells = [...new Set((value.imageFitDisabledCells ?? []).filter(cellKey => {
    if (!validCellKeys.has(cellKey)) return false;
    const separator = cellKey.lastIndexOf(':');
    return separator >= 0 && imageColumnIds.has(cellKey.slice(separator + 1));
  }))];
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
      imageFitDisabledCells,
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

export interface TechnicalColumnWidthContext {
  /** Values displayed by SmartType but not necessarily stored in a shot yet. */
  smartTypeValues?: readonly string[];
  /** Width occupied by currently visible sort/filter indicators. */
  headerAccessoryWidth?: number;
}

/** Largeur compacte nécessaire au titre, au menu et aux indicateurs du header. */
export function getTechnicalColumnBaseWidth(
  column: Pick<TechnicalColumn, 'name' | 'kind'>,
  headerAccessoryWidth = 0,
): number {
  const titleWidth = Math.ceil([...column.name.trim().toLocaleUpperCase('fr-FR')].length * 6.35 + 48 + headerAccessoryWidth);
  return Math.max(column.kind === 'image' ? 80 : TECHNICAL_COLUMN_RESIZE_MIN, Math.min(TECHNICAL_COLUMN_RESIZE_MAX, titleWidth));
}

function isLegacyAutomaticWidth(column: TechnicalColumn): boolean {
  const currentDefault = DEFAULT_TECHNICAL_COLUMNS.find(candidate => candidate.id === column.id)?.width;
  return column.width === getTechnicalColumnBaseWidth(column)
    || column.width === currentDefault
    || column.width === LEGACY_DEFAULT_COLUMN_WIDTHS[column.id]
    || (column.kind === 'custom' && column.width === 180);
}

/**
 * Les anciennes largeurs par défaut restent reconnues comme automatiques afin
 * que les projets existants profitent du nouveau calcul sans écraser une
 * largeur réellement choisie par l'utilisateur.
 */
export function isTechnicalColumnWidthAutomatic(column: TechnicalColumn): boolean {
  return column.widthMode === 'auto';
}

/**
 * Largeur initiale automatique : juste assez pour le titre et les contenus
 * présents. Les contenus textuels peuvent utiliser les deux lignes déjà
 * prévues par le tableau. Cette valeur n'est jamais une limite de resize.
 */
export function getTechnicalColumnInitialWidth(
  breakdown: TechnicalBreakdown,
  column: TechnicalColumn,
  context: TechnicalColumnWidthContext = {},
): number {
  let width = getTechnicalColumnBaseWidth(column, context.headerAccessoryWidth);
  if (column.kind === 'image') return width;
  const values = [
    ...(NATIVE_TECHNICAL_SUGGESTIONS[column.kind] ?? []),
    ...breakdown.shots.map(shot => shot.values[column.id] ?? ''),
    ...(context.smartTypeValues ?? []),
  ];
  const wrapsByDefault = ['description', 'dialogue', 'notes', 'custom', 'actors', 'vfx'].includes(column.kind);
  for (const candidate of values) {
    const value = candidate.trim().replace(/\s+/gu, ' ');
    if (!value) continue;
    const words = value.split(/\s+/u).map(word => [...word].length);
    const totalLength = words.reduce((total, length) => total + length, Math.max(0, words.length - 1));
    let visibleLineLength = totalLength;
    if (wrapsByDefault) {
      let leftLength = 0;
      for (let index = 1; index < words.length; index += 1) {
        leftLength += words[index - 1] + (index > 1 ? 1 : 0);
        const rightLength = totalLength - leftLength - 1;
        visibleLineLength = Math.min(visibleLineLength, Math.max(leftLength, rightLength));
      }
    }
    width = Math.max(width, Math.ceil(visibleLineLength * 6.7 + 26));
  }
  return Math.min(TECHNICAL_COLUMN_RESIZE_MAX, width);
}

/** Manual widths always win; automatic widths continue following their content. */
export function getTechnicalColumnEffectiveWidth(
  breakdown: TechnicalBreakdown,
  column: TechnicalColumn,
  context: TechnicalColumnWidthContext = {},
): number {
  return isTechnicalColumnWidthAutomatic(column)
    ? getTechnicalColumnInitialWidth(breakdown, column, context)
    : column.width;
}

/** Exact table width: row tools plus every currently visible effective column. */
export function getTechnicalTableWidth(columnWidths: readonly number[]): number {
  return TECHNICAL_ROW_TOOLS_WIDTH + columnWidths.reduce((total, width) => total + width, 0);
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

import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { UiIcon } from '../ui/UiIcon';
import { useDismissOnOutsidePointer } from '../ui/useDismissOnOutsidePointer';
import {
  addTechnicalShot, applyTechnicalFilterLogic, createTechnicalId, formatTechnicalDuration, getSceneDuration,
  getTechnicalSuggestions, getVisibleTechnicalColumns, parseTechnicalDuration, reorderTechnicalShots,
  type TechnicalBreakdown as TechnicalBreakdownData,
  type TechnicalColumn, type TechnicalFilterCombinationMode, type TechnicalFilterDisplayMode, type TechnicalShot,
} from './technicalBreakdownModel';
import { getScenarioScenePreviewBlocks, type ScenarioScene } from './sceneTimelineModel';
import { ScenarioScenePreview } from './ScenarioScenePreview';
import './sceneBreakdown.css';
import './technicalBreakdown.css';

interface TechnicalBreakdownProps {
  scenes: ScenarioScene[];
  document: ProseMirrorNode;
  breakdown: TechnicalBreakdownData;
  characters: string[];
  activeSceneId: string | null;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onChange: (value: TechnicalBreakdownData) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface EditingCell {
  shotId: string;
  columnId: string;
  draft: string;
}

interface ShotDropMarker {
  sceneId: string;
  beforeShotId: string | null;
}

interface SceneDialogueSuggestion {
  id: string;
  character: string;
  text: string;
}

interface CellContextMenu {
  cellKey: string;
  x: number;
  y: number;
}

interface CellPosition {
  shotId: string;
  columnId: string;
}

interface ClipboardCell {
  rowOffset: number;
  columnOffset: number;
  columnId: string | null;
  columnName: string | null;
  columnKind: TechnicalColumn['kind'] | null;
  value: string;
  text: string;
}

interface CellClipboardPayload {
  width: number;
  height: number;
  cells: ClipboardCell[];
  sourceCellKeys: string[];
  text: string;
  cut: boolean;
}

interface CellSelectionDrag {
  anchorKey: string;
  additive: boolean;
  base: Set<string>;
  moved: boolean;
}

type SortDirection = 'ascending' | 'descending';

const CLIPBOARD_PREFIX = 'SENARIO_TECHNICAL_SHOTS\n';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const SCENE_PANEL_OPEN_STORAGE_KEY = 'senario-technical-scene-panel-open';
const SCENE_PANEL_WIDTH_STORAGE_KEY = 'senario-technical-scene-panel-width';
const SCENE_PANEL_ACTIVE_SCENE_SESSION_KEY = 'senario-technical-scene-panel-active-scene';
const SCENE_PANEL_DEFAULT_WIDTH = 380;
const SCENE_PANEL_MIN_WIDTH = 280;
const TECHNICAL_TABLE_MIN_WIDTH = 460;

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

function cellValue(shot: TechnicalShot, column: TechnicalColumn, scenes: ScenarioScene[], sceneIndex: number, shotIndex: number): string {
  if (column.kind === 'scene') return scenes.find(scene => scene.id === shot.sceneId)?.title ?? '';
  if (column.kind === 'plan') return `${sceneIndex + 1}.${shotIndex + 1}`;
  return shot.values[column.id] ?? '';
}

function compareValues(left: string, right: string, column: TechnicalColumn): number {
  if (column.kind === 'duration') return parseTechnicalDuration(left) - parseTechnicalDuration(right);
  return left.localeCompare(right, 'fr', { sensitivity: 'base', numeric: true });
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function technicalCellKey(shotId: string, columnId: string): string {
  return `${shotId}:${columnId}`;
}

function parseTechnicalCellKey(key: string): CellPosition | null {
  const separator = key.lastIndexOf(':');
  if (separator <= 0 || separator >= key.length - 1) return null;
  return { shotId: key.slice(0, separator), columnId: key.slice(separator + 1) };
}

function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [[]];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
      continue;
    }
    if (character === '"' && value.length === 0) { quoted = true; continue; }
    if (character === '\t') { rows[rows.length - 1].push(value); value = ''; continue; }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      rows[rows.length - 1].push(value);
      value = '';
      rows.push([]);
      continue;
    }
    value += character;
  }
  rows[rows.length - 1].push(value);
  if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows.length ? rows : [['']];
}

function clipboardTextValue(value: string, column: TechnicalColumn): string {
  if (column.kind === 'image') return value ? '[Image]' : '';
  return value;
}

function encodeClipboardField(value: string): string {
  return /[\t\r\n"]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
}

export function TechnicalBreakdown({
  scenes, document: scenarioDocument, breakdown, characters, activeSceneId, readOnly, canUndo, canRedo, onChange, onUndo, onRedo,
}: TechnicalBreakdownProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectedCellKeys, setSelectedCellKeys] = useState<string[]>([]);
  const [cellSelectionAnchor, setCellSelectionAnchor] = useState<string | null>(null);
  const [activeCellKey, setActiveCellKey] = useState<string | null>(null);
  const [cutCellKeys, setCutCellKeys] = useState<string[]>([]);
  const [clipboardNotice, setClipboardNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);
  const [collapsedScenes, setCollapsedScenes] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [filterCombinationMode, setFilterCombinationMode] = useState<TechnicalFilterCombinationMode>('restriction');
  const [filterDisplayMode, setFilterDisplayMode] = useState<TechnicalFilterDisplayMode>('keep');
  const [sort, setSort] = useState<{ columnId: string; direction: SortDirection } | null>(null);
  const [searchFilterMenuOpen, setSearchFilterMenuOpen] = useState(false);
  const [expandedSearchFilterColumnId, setExpandedSearchFilterColumnId] = useState<string | null>(null);
  const [columnMenuId, setColumnMenuId] = useState<string | null>(null);
  const [columnMenuName, setColumnMenuName] = useState('');
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [editingQuery, setEditingQuery] = useState('');
  const [temporaryAdaptedCellKey, setTemporaryAdaptedCellKey] = useState<string | null>(null);
  const [overflowingCellKeys, setOverflowingCellKeys] = useState<Set<string>>(new Set());
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenu | null>(null);
  const [imagePreview, setImagePreview] = useState<{ src: string; label: string } | null>(null);
  const [draggedShotIds, setDraggedShotIds] = useState<string[]>([]);
  const [shotDropMarker, setShotDropMarker] = useState<ShotDropMarker | null>(null);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [columnDropIndex, setColumnDropIndex] = useState<number | null>(null);
  const [previewWidths, setPreviewWidths] = useState<Record<string, number>>({});
  const [scenePanelOpen, setScenePanelOpen] = useState(() => {
    try { return window.localStorage.getItem(SCENE_PANEL_OPEN_STORAGE_KEY) !== 'false'; } catch { return true; }
  });
  const [scenePanelWidth, setScenePanelWidth] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(SCENE_PANEL_WIDTH_STORAGE_KEY));
      return Number.isFinite(stored) && stored >= SCENE_PANEL_MIN_WIDTH ? stored : SCENE_PANEL_DEFAULT_WIDTH;
    } catch { return SCENE_PANEL_DEFAULT_WIDTH; }
  });
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(() => {
    try {
      const stored = window.sessionStorage.getItem(SCENE_PANEL_ACTIVE_SCENE_SESSION_KEY);
      if (stored && scenes.some(scene => scene.id === stored)) return stored;
    } catch { /* session storage unavailable */ }
    return activeSceneId ?? scenes[0]?.id ?? null;
  });
  const editingRef = useRef<EditingCell | null>(null);
  const copiedShots = useRef<TechnicalShot[]>([]);
  const copiedCells = useRef<CellClipboardPayload | null>(null);
  const cellSelectionDrag = useRef<CellSelectionDrag | null>(null);
  const suppressRowClick = useRef(false);
  const fileInputs = useRef(new Map<string, HTMLInputElement>());
  const cellValueElements = useRef(new Map<string, HTMLElement>());
  const rootRef = useRef<HTMLElement>(null);
  const addCategoryRef = useDismissOnOutsidePointer<HTMLDivElement>(newCategoryOpen, () => {
    setNewCategoryOpen(false);
    setNewCategoryName('');
  });

  const visibleColumns = useMemo(() => getVisibleTechnicalColumns(breakdown), [breakdown]);
  const hiddenColumns = useMemo(() => breakdown.columns.filter(column => column.hidden), [breakdown.columns]);
  const sceneMap = useMemo(() => new Map(scenes.map(scene => [scene.id, scene])), [scenes]);
  const previewScene = sceneMap.get(previewSceneId ?? '') ?? scenes[0] ?? null;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCellSet = useMemo(() => new Set(selectedCellKeys), [selectedCellKeys]);
  const cutCellSet = useMemo(() => new Set(cutCellKeys), [cutCellKeys]);
  const adaptedCellKeys = useMemo(() => new Set(breakdown.adaptedCells ?? []), [breakdown.adaptedCells]);
  const durationColumn = breakdown.columns.find(column => column.kind === 'duration');
  const interactionFiltered = Boolean(query.trim() || Object.values(columnFilters).some(value => value.trim()) || sort);
  const sceneDialogues = useMemo(() => new Map(scenes.map(scene => {
    let character = '';
    const seen = new Set<string>();
    const suggestions: SceneDialogueSuggestion[] = [];
    for (const block of getScenarioScenePreviewBlocks(scenarioDocument, scene.id)) {
      if (block.type === 'CHARACTER') {
        character = block.text.trim().replace(/\s*\([^)]*\)\s*$/u, '').replace(/\s+/gu, ' ');
        continue;
      }
      if (block.type !== 'DIALOGUE') continue;
      const text = block.text.trim().replace(/\s+/gu, ' ');
      const key = normalized(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ id: block.id, character: character || 'Dialogue', text });
    }
    return [scene.id, suggestions] as const;
  })), [scenarioDocument, scenes]);

  useEffect(() => {
    const valid = new Set(breakdown.shots.map(shot => shot.id));
    setSelectedIds(previous => previous.filter(id => valid.has(id)));
    const validColumns = new Set(breakdown.columns.map(column => column.id));
    setSelectedCellKeys(previous => previous.filter(key => {
      const cell = parseTechnicalCellKey(key);
      return Boolean(cell && valid.has(cell.shotId) && validColumns.has(cell.columnId));
    }));
  }, [breakdown.columns, breakdown.shots]);

  useEffect(() => {
    setPreviewSceneId(current => {
      if (current && sceneMap.has(current)) return current;
      return activeSceneId && sceneMap.has(activeSceneId) ? activeSceneId : scenes[0]?.id ?? null;
    });
  }, [activeSceneId, sceneMap, scenes]);

  useEffect(() => {
    if (!previewSceneId) return;
    try { window.sessionStorage.setItem(SCENE_PANEL_ACTIVE_SCENE_SESSION_KEY, previewSceneId); } catch { /* session storage unavailable */ }
  }, [previewSceneId]);

  useEffect(() => {
    const activePosition = activeCellKey ? parseTechnicalCellKey(activeCellKey) : null;
    const activeShotId = activePosition?.shotId ?? selectedIds[selectedIds.length - 1];
    const activeShot = activeShotId ? breakdown.shots.find(shot => shot.id === activeShotId) : null;
    if (activeShot) setPreviewSceneId(activeShot.sceneId);
  }, [activeCellKey, breakdown.shots, selectedIds]);

  useEffect(() => {
    if (!clipboardNotice) return;
    const timeout = window.setTimeout(() => setClipboardNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [clipboardNotice]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest('.technical-column-menu, .technical-header-menu-button')) setColumnMenuId(null);
      if (!target?.closest('.breakdown-filter-wrap')) setSearchFilterMenuOpen(false);
      if (!target?.closest('.technical-cell-context-menu')) setCellContextMenu(null);
      if (!target?.closest('[data-technical-cell-key], .technical-selection-actions, .technical-cell-context-menu')) {
        setSelectedCellKeys([]);
        setCellSelectionAnchor(null);
        setActiveCellKey(null);
        cellSelectionDrag.current = null;
      }
      const targetCellKey = target?.closest<HTMLElement>('[data-technical-cell-key]')?.dataset.technicalCellKey ?? null;
      setTemporaryAdaptedCellKey(current => current && current !== targetCellKey ? null : current);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    const stopCellSelectionDrag = () => {
      if (cellSelectionDrag.current?.moved) {
        suppressRowClick.current = true;
        window.setTimeout(() => { suppressRowClick.current = false; }, 0);
      }
      cellSelectionDrag.current = null;
    };
    window.addEventListener('pointerup', stopCellSelectionDrag);
    window.addEventListener('pointercancel', stopCellSelectionDrag);
    return () => {
      window.removeEventListener('pointerup', stopCellSelectionDrag);
      window.removeEventListener('pointercancel', stopCellSelectionDrag);
    };
  }, []);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const next = new Set<string>();
      for (const [key, element] of cellValueElements.current) {
        if (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1) next.add(key);
      }
      setOverflowingCellKeys(previous => {
        if (previous.size === next.size && [...previous].every(key => next.has(key))) return previous;
        return next;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [breakdown, collapsedScenes, editing, previewWidths, query, sort, columnFilters, adaptedCellKeys, temporaryAdaptedCellKey]);

  const matchingShotsByScene = useMemo(() => {
    const result = new Map<string, TechnicalShot[]>();
    const normalizedQuery = normalized(query);
    for (const scene of scenes) {
      const allSceneShots = breakdown.shots.filter(shot => shot.sceneId === scene.id);
      const sceneMatches = normalizedQuery && normalized(scene.title).includes(normalizedQuery);
      let shots = allSceneShots.filter((shot, shotIndex) => {
        const values = breakdown.columns.map(column => cellValue(shot, column, scenes, scene.index, shotIndex));
        if (normalizedQuery && !sceneMatches && !values.some(value => normalized(value).includes(normalizedQuery))) return false;
        const filterMatches = breakdown.columns.flatMap(column => {
          const filter = columnFilters[column.id] ?? '';
          if (!filter) return [];
          if (column.kind === 'image') {
            const hasImage = Boolean(shot.values[column.id]);
            return [filter === '__with_image__' ? hasImage : filter === '__without_image__' ? !hasImage : true];
          }
          return [normalized(cellValue(shot, column, scenes, scene.index, shotIndex)).includes(normalized(filter))];
        });
        return applyTechnicalFilterLogic(filterMatches, filterCombinationMode, filterDisplayMode);
      });
      if (sort) {
        const column = breakdown.columns.find(candidate => candidate.id === sort.columnId);
        if (column) shots = [...shots].sort((left, right) => {
          const leftIndex = allSceneShots.findIndex(shot => shot.id === left.id);
          const rightIndex = allSceneShots.findIndex(shot => shot.id === right.id);
          const compared = compareValues(
            cellValue(left, column, scenes, scene.index, leftIndex),
            cellValue(right, column, scenes, scene.index, rightIndex),
            column,
          );
          return sort.direction === 'ascending' ? compared : -compared;
        });
      }
      if (shots.length || (!normalizedQuery && !Object.values(columnFilters).some(Boolean))) result.set(scene.id, shots);
    }
    return result;
  }, [breakdown, columnFilters, filterCombinationMode, filterDisplayMode, query, scenes, sort]);

  const displayScenes = useMemo(() => {
    const column = sort ? breakdown.columns.find(candidate => candidate.id === sort.columnId) : null;
    if (column?.kind !== 'scene') return scenes;
    return [...scenes].sort((left, right) => {
      const compared = left.title.localeCompare(right.title, 'fr', { sensitivity: 'base', numeric: true });
      return sort?.direction === 'descending' ? -compared : compared;
    });
  }, [breakdown.columns, scenes, sort]);
  const visibleRowIds = useMemo(() => displayScenes.flatMap(scene => matchingShotsByScene.get(scene.id)?.map(shot => shot.id) ?? []), [displayScenes, matchingShotsByScene]);
  const selectableCellRowIds = useMemo(() => displayScenes.flatMap(scene => collapsedScenes.has(scene.id)
    ? []
    : matchingShotsByScene.get(scene.id)?.map(shot => shot.id) ?? []), [collapsedScenes, displayScenes, matchingShotsByScene]);
  const visibleShotCount = visibleRowIds.length;
  const searchFilterOptions = useMemo(() => {
    const entries: Array<[string, Array<{ value: string; label: string }>]> = breakdown.columns.map(column => {
      const values = new Map<string, string>();
      const append = (value: string, label = value) => {
        const key = normalized(value);
        if (key && !values.has(key)) values.set(key, label);
      };
      if (column.kind === 'image') {
        if (breakdown.shots.some(shot => Boolean(shot.values[column.id]))) values.set('__with_image__', 'Avec image');
        if (breakdown.shots.some(shot => !shot.values[column.id])) values.set('__without_image__', 'Sans image');
      } else {
        for (const scene of scenes) {
          const sceneShots = breakdown.shots.filter(shot => shot.sceneId === scene.id);
          sceneShots.forEach((shot, shotIndex) => {
            const value = cellValue(shot, column, scenes, scene.index, shotIndex);
            if (column.kind === 'actors') value.split(/[,;]+/u).forEach(item => append(item.trim()));
            else append(value);
          });
        }
      }
      return [column.id, [...values.entries()]
        .map(([value, label]) => ({ value: column.kind === 'image' ? value : label, label }))
        .sort((left, right) => left.label.localeCompare(right.label, 'fr', { sensitivity: 'base', numeric: true }))];
    });
    return new Map(entries);
  }, [breakdown.columns, breakdown.shots, scenes]);
  const activeColumnFilters = useMemo(() => breakdown.columns.flatMap(column => {
    const value = columnFilters[column.id];
    if (!value) return [];
    const label = searchFilterOptions.get(column.id)?.find(option => option.value === value)?.label ?? value;
    return [{ column, value, label }];
  }), [breakdown.columns, columnFilters, searchFilterOptions]);
  const activeFilterCount = activeColumnFilters.length;
  const gridTemplate = `44px ${visibleColumns.map(column => `${previewWidths[column.id] ?? column.width}px`).join(' ')}`;

  function emit(next: TechnicalBreakdownData) {
    if (!readOnly) onChange(next);
  }

  function toggleScenePanel(): void {
    setScenePanelOpen(current => {
      const next = !current;
      try { window.localStorage.setItem(SCENE_PANEL_OPEN_STORAGE_KEY, String(next)); } catch { /* local storage unavailable */ }
      return next;
    });
  }

  function startScenePanelResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!scenePanelOpen || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = scenePanelWidth;
    const workspaceWidth = rootRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maximum = Math.max(SCENE_PANEL_MIN_WIDTH, workspaceWidth - TECHNICAL_TABLE_MIN_WIDTH - 6);
    let currentWidth = startWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (pointerEvent: PointerEvent) => {
      currentWidth = Math.max(SCENE_PANEL_MIN_WIDTH, Math.min(maximum, startWidth + pointerEvent.clientX - startX));
      setScenePanelWidth(currentWidth);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      try { window.localStorage.setItem(SCENE_PANEL_WIDTH_STORAGE_KEY, String(Math.round(currentWidth))); } catch { /* local storage unavailable */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }

  function updateColumn(columnId: string, update: (column: TechnicalColumn) => TechnicalColumn) {
    emit({ ...breakdown, columns: breakdown.columns.map(column => column.id === columnId ? update(column) : column) });
  }

  function cellRectangleKeys(fromKey: string, toKey: string): string[] {
    const from = parseTechnicalCellKey(fromKey);
    const to = parseTechnicalCellKey(toKey);
    if (!from || !to) return [];
    const fromRow = selectableCellRowIds.indexOf(from.shotId);
    const toRow = selectableCellRowIds.indexOf(to.shotId);
    const fromColumn = visibleColumns.findIndex(column => column.id === from.columnId);
    const toColumn = visibleColumns.findIndex(column => column.id === to.columnId);
    if (fromRow < 0 || toRow < 0 || fromColumn < 0 || toColumn < 0) return [];
    const keys: string[] = [];
    for (let row = Math.min(fromRow, toRow); row <= Math.max(fromRow, toRow); row += 1) {
      for (let column = Math.min(fromColumn, toColumn); column <= Math.max(fromColumn, toColumn); column += 1) {
        keys.push(technicalCellKey(selectableCellRowIds[row], visibleColumns[column].id));
      }
    }
    return keys;
  }

  function selectCell(event: ReactPointerEvent<HTMLElement>, shotId: string, columnId: string) {
    if (event.button !== 0) return;
    if (!(event.target instanceof Element) || !event.target.closest('button, input, select')) event.preventDefault();
    const key = technicalCellKey(shotId, columnId);
    const additive = event.ctrlKey || event.metaKey;
    setSelectedIds([]);
    setSelectionAnchor(null);
    setActiveCellKey(key);
    if (event.shiftKey && cellSelectionAnchor) {
      const range = cellRectangleKeys(cellSelectionAnchor, key);
      setSelectedCellKeys(additive ? [...new Set([...selectedCellKeys, ...range])] : range);
      cellSelectionDrag.current = { anchorKey: cellSelectionAnchor, additive, base: additive ? new Set(selectedCellKeys) : new Set(), moved: false };
      return;
    }
    setCellSelectionAnchor(key);
    if (additive) {
      setSelectedCellKeys(previous => previous.includes(key) ? previous.filter(candidate => candidate !== key) : [...previous, key]);
      cellSelectionDrag.current = { anchorKey: key, additive: true, base: new Set(selectedCellKeys), moved: false };
      return;
    }
    setSelectedCellKeys([key]);
    cellSelectionDrag.current = { anchorKey: key, additive: false, base: new Set(), moved: false };
  }

  function extendCellSelection(event: ReactPointerEvent<HTMLElement>, shotId: string, columnId: string) {
    const drag = cellSelectionDrag.current;
    if (!drag || !(event.buttons & 1)) return;
    const key = technicalCellKey(shotId, columnId);
    const range = cellRectangleKeys(drag.anchorKey, key);
    if (key !== drag.anchorKey) drag.moved = true;
    setActiveCellKey(key);
    setSelectedCellKeys(drag.additive ? [...new Set([...drag.base, ...range])] : range);
  }

  function selectShot(event: MouseEvent, shotId: string) {
    if (suppressRowClick.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    setSelectedCellKeys([]);
    setCellSelectionAnchor(null);
    setActiveCellKey(null);
    if (event.shiftKey && selectionAnchor) {
      const from = visibleRowIds.indexOf(selectionAnchor);
      const to = visibleRowIds.indexOf(shotId);
      if (from >= 0 && to >= 0) {
        const range = visibleRowIds.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelectedIds(event.ctrlKey || event.metaKey ? [...new Set([...selectedIds, ...range])] : range);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedIds(previous => previous.includes(shotId) ? previous.filter(id => id !== shotId) : [...previous, shotId]);
      setSelectionAnchor(shotId);
      return;
    }
    setSelectedIds([shotId]);
    setSelectionAnchor(shotId);
  }

  function focusCell(shotId: string, columnId: string, rowDelta = 0, columnDelta = 0) {
    const row = selectableCellRowIds.indexOf(shotId);
    const column = visibleColumns.findIndex(candidate => candidate.id === columnId);
    let nextRow = Math.max(0, Math.min(selectableCellRowIds.length - 1, row + rowDelta));
    let nextColumn = column;
    if (columnDelta && visibleColumns.length) {
      const linear = Math.max(0, Math.min(
        selectableCellRowIds.length * visibleColumns.length - 1,
        row * visibleColumns.length + column + columnDelta,
      ));
      nextRow = Math.floor(linear / visibleColumns.length);
      nextColumn = linear % visibleColumns.length;
    }
    const nextShotId = selectableCellRowIds[nextRow] ?? '';
    const nextColumnId = visibleColumns[nextColumn]?.id ?? '';
    const target = rootRef.current?.querySelector<HTMLElement>(`[data-shot-id="${CSS.escape(nextShotId)}"][data-column-id="${CSS.escape(nextColumnId)}"]`);
    requestAnimationFrame(() => {
      target?.focus();
      if (nextShotId && nextColumnId) {
        const key = technicalCellKey(nextShotId, nextColumnId);
        setSelectedCellKeys([key]);
        setCellSelectionAnchor(key);
        setActiveCellKey(key);
      }
    });
  }

  function startEditing(shot: TechnicalShot, column: TechnicalColumn, initial?: string) {
    if (readOnly || ['scene', 'plan', 'image'].includes(column.kind)) return;
    const value = initial ?? shot.values[column.id] ?? '';
    const next = { shotId: shot.id, columnId: column.id, draft: value };
    editingRef.current = next;
    setEditingQuery(value);
    setEditing(next);
  }

  function finishEditing(navigation: 'stay' | 'down' | 'next' | 'previous' = 'stay', override?: string) {
    const current = editingRef.current;
    if (!current) return;
    editingRef.current = null;
    setEditingQuery('');
    setEditing(null);
    const draft = (override ?? current.draft).trim();
    const shot = breakdown.shots.find(candidate => candidate.id === current.shotId);
    if (shot && (shot.values[current.columnId] ?? '') !== draft) {
      const values = { ...shot.values };
      if (draft) values[current.columnId] = draft;
      else delete values[current.columnId];
      emit({ ...breakdown, shots: breakdown.shots.map(candidate => candidate.id === shot.id ? { ...candidate, values } : candidate) });
    }
    if (navigation === 'down') focusCell(current.shotId, current.columnId, 1, 0);
    if (navigation === 'next') focusCell(current.shotId, current.columnId, 0, 1);
    if (navigation === 'previous') focusCell(current.shotId, current.columnId, 0, -1);
  }

  function cancelEditing() {
    editingRef.current = null;
    setEditingQuery('');
    setEditing(null);
  }

  function openCellContextMenu(event: MouseEvent<HTMLElement>, cellKey: string) {
    if (!adaptedCellKeys.has(cellKey) && temporaryAdaptedCellKey !== cellKey && !overflowingCellKeys.has(cellKey)) return;
    event.preventDefault();
    event.stopPropagation();
    setCellContextMenu({
      cellKey,
      x: Math.min(event.clientX, window.innerWidth - 210),
      y: Math.min(event.clientY, window.innerHeight - 54),
    });
  }

  function toggleCellAdaptation(cellKey: string) {
    const next = new Set(breakdown.adaptedCells ?? []);
    next.has(cellKey) ? next.delete(cellKey) : next.add(cellKey);
    emit({ ...breakdown, adaptedCells: [...next] });
    setTemporaryAdaptedCellKey(null);
    setCellContextMenu(null);
  }

  function cellKeyDown(event: KeyboardEvent<HTMLElement>, shot: TechnicalShot, column: TechnicalColumn) {
    if (event.key === 'Tab') {
      event.preventDefault();
      focusCell(shot.id, column.id, 0, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      startEditing(shot, column);
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      startEditing(shot, column, event.key);
    }
  }

  function addShot(sceneId = selectedIds.length ? breakdown.shots.find(shot => shot.id === selectedIds[0])?.sceneId : activeSceneId) {
    const targetScene = sceneId && sceneMap.has(sceneId) ? sceneId : scenes[0]?.id;
    if (!targetScene) return;
    const next = addTechnicalShot(breakdown, targetScene);
    emit(next);
    const id = next.shots.find(shot => !breakdown.shots.some(previous => previous.id === shot.id))?.id;
    if (id) { setSelectedIds([id]); setSelectionAnchor(id); }
  }

  function insertBefore(shot: TechnicalShot) {
    const next = addTechnicalShot(breakdown, shot.sceneId, shot.id);
    emit(next);
    const id = next.shots.find(candidate => !breakdown.shots.some(previous => previous.id === candidate.id))?.id;
    if (id) setSelectedIds([id]);
  }

  function duplicateShots(ids = selectedIds) {
    const originals = breakdown.shots.filter(shot => ids.includes(shot.id));
    if (!originals.length) return;
    const duplicated = originals.map(shot => ({ ...shot, id: createTechnicalId('shot'), values: { ...shot.values } }));
    const lastIndex = Math.max(...originals.map(shot => breakdown.shots.findIndex(candidate => candidate.id === shot.id)));
    const shots = [...breakdown.shots];
    shots.splice(lastIndex + 1, 0, ...duplicated);
    emit({ ...breakdown, shots });
    setSelectedIds(duplicated.map(shot => shot.id));
    setSelectionAnchor(duplicated[0]?.id ?? null);
  }

  function deleteShots(ids = selectedIds) {
    if (!ids.length || !window.confirm(ids.length > 1 ? `Supprimer ces ${ids.length} plans ?` : 'Supprimer ce plan ?')) return;
    const removed = new Set(ids);
    emit({ ...breakdown, shots: breakdown.shots.filter(shot => !removed.has(shot.id)) });
    setSelectedIds([]);
    setSelectionAnchor(null);
  }

  function copyShotSelection() {
    copiedShots.current = breakdown.shots.filter(shot => selectedSet.has(shot.id)).map(shot => structuredClone(shot));
    if (!copiedShots.current.length) return;
    copiedCells.current = null;
    setCutCellKeys([]);
    void navigator.clipboard?.writeText(`${CLIPBOARD_PREFIX}${JSON.stringify(copiedShots.current)}`).catch(() => undefined);
  }

  function displayedCellValue(shot: TechnicalShot, column: TechnicalColumn): string {
    const scene = sceneMap.get(shot.sceneId);
    if (column.kind === 'scene') return scene?.title ?? '';
    if (column.kind === 'plan') {
      const shotIndex = breakdown.shots.filter(candidate => candidate.sceneId === shot.sceneId).findIndex(candidate => candidate.id === shot.id);
      return `${(scene?.index ?? 0) + 1}.${shotIndex + 1}`;
    }
    return shot.values[column.id] ?? '';
  }

  function buildCellClipboard(cut: boolean): CellClipboardPayload | null {
    const selected = selectedCellKeys.flatMap(key => {
      const position = parseTechnicalCellKey(key);
      if (!position) return [];
      const row = selectableCellRowIds.indexOf(position.shotId);
      const column = visibleColumns.findIndex(candidate => candidate.id === position.columnId);
      const shot = breakdown.shots.find(candidate => candidate.id === position.shotId);
      const columnDefinition = visibleColumns[column];
      return row >= 0 && column >= 0 && shot && columnDefinition ? [{ key, row, column, shot, columnDefinition }] : [];
    });
    if (!selected.length) return null;
    if (cut && selected.some(cell => cell.columnDefinition.kind === 'scene' || cell.columnDefinition.kind === 'plan')) {
      setClipboardNotice({ kind: 'error', message: 'Les colonnes Scène et Plan sont calculées ou obligatoires et ne peuvent pas être coupées.' });
      return null;
    }
    const firstRow = Math.min(...selected.map(cell => cell.row));
    const lastRow = Math.max(...selected.map(cell => cell.row));
    const firstColumn = Math.min(...selected.map(cell => cell.column));
    const lastColumn = Math.max(...selected.map(cell => cell.column));
    const cells = selected.map(cell => {
      const displayed = displayedCellValue(cell.shot, cell.columnDefinition);
      return {
        rowOffset: cell.row - firstRow,
        columnOffset: cell.column - firstColumn,
        columnId: cell.columnDefinition.id,
        columnName: cell.columnDefinition.name,
        columnKind: cell.columnDefinition.kind,
        value: cell.columnDefinition.kind === 'scene' ? cell.shot.sceneId : displayed,
        text: clipboardTextValue(displayed, cell.columnDefinition),
      } satisfies ClipboardCell;
    });
    const cellByOffset = new Map(cells.map(cell => [`${cell.rowOffset}:${cell.columnOffset}`, cell]));
    const text = Array.from({ length: lastRow - firstRow + 1 }, (_, rowOffset) =>
      Array.from({ length: lastColumn - firstColumn + 1 }, (_, columnOffset) =>
        encodeClipboardField(cellByOffset.get(`${rowOffset}:${columnOffset}`)?.text ?? '')).join('\t')).join('\n');
    return {
      width: lastColumn - firstColumn + 1,
      height: lastRow - firstRow + 1,
      cells,
      sourceCellKeys: selected.map(cell => cell.key),
      text,
      cut,
    };
  }

  function copyCellSelection(cut = false) {
    const payload = buildCellClipboard(cut);
    if (!payload) return;
    copiedCells.current = payload;
    copiedShots.current = [];
    setCutCellKeys(cut ? payload.sourceCellKeys : []);
    void navigator.clipboard?.writeText(payload.text).catch(() => undefined);
    setClipboardNotice({ kind: 'success', message: `${payload.cells.length} cellule${payload.cells.length > 1 ? 's' : ''} ${cut ? 'prête' : 'copiée'}${payload.cells.length > 1 ? 's' : ''}.` });
  }

  function externalClipboardPayload(text: string): CellClipboardPayload | null {
    if (text.startsWith(CLIPBOARD_PREFIX)) return null;
    const rows = parseClipboardTable(text);
    const width = Math.max(0, ...rows.map(row => row.length));
    if (!rows.length || !width) return null;
    const cells = rows.flatMap((row, rowOffset) => Array.from({ length: width }, (_, columnOffset) => ({
      rowOffset,
      columnOffset,
      columnId: null,
      columnName: null,
      columnKind: null,
      value: row[columnOffset] ?? '',
      text: row[columnOffset] ?? '',
    } satisfies ClipboardCell)));
    return { width, height: rows.length, cells, sourceCellKeys: [], text, cut: false };
  }

  function resolveSceneId(value: string): string | null {
    if (sceneMap.has(value)) return value;
    const clean = normalized(value).replace(/^\d+\s*[.·-]\s*/u, '');
    return scenes.find(scene => normalized(scene.title) === clean)?.id ?? null;
  }

  function compatibleCellValue(source: ClipboardCell, destination: TechnicalColumn): { compatible: boolean; value: string } {
    const value = source.value.trim();
    if (source.columnKind !== null) {
      const sameCustomColumn = source.columnKind === 'custom' && destination.kind === 'custom'
        && (source.columnId === destination.id || normalized(source.columnName ?? '') === normalized(destination.name));
      if (source.columnKind !== destination.kind && !sameCustomColumn) return { compatible: false, value };
    }
    if (destination.kind === 'plan') return { compatible: source.columnKind === 'plan', value };
    if (destination.kind === 'scene') {
      const sceneId = resolveSceneId(value || source.text);
      return { compatible: Boolean(sceneId), value: sceneId ?? value };
    }
    if (destination.kind === 'image') {
      return { compatible: source.columnKind === 'image' && (!value || /^data:image\//u.test(value)), value };
    }
    if (source.columnKind !== null) return { compatible: true, value };
    if (destination.kind === 'focal' && value) {
      if (/^\d+(?:[.,]\d+)?$/u.test(value)) return { compatible: true, value: `${value} mm` };
      if (!/^\d+(?:[.,]\d+)?\s*mm$/iu.test(value)) return { compatible: false, value };
    }
    if (destination.kind === 'fps' && value && !/^\d+(?:[.,]\d+)?$/u.test(value)) return { compatible: false, value };
    if (destination.kind === 'duration' && value && parseTechnicalDuration(value) <= 0 && !/^0+(?::0+){0,2}$/u.test(value)) return { compatible: false, value };
    return { compatible: true, value };
  }

  function applyCellPaste(payload: CellClipboardPayload) {
    if (readOnly || !selectedCellKeys.length) return;
    const destinations = selectedCellKeys.flatMap(key => {
      const position = parseTechnicalCellKey(key);
      if (!position) return [];
      const row = selectableCellRowIds.indexOf(position.shotId);
      const column = visibleColumns.findIndex(candidate => candidate.id === position.columnId);
      return row >= 0 && column >= 0 ? [{ key, row, column }] : [];
    });
    if (!destinations.length) return;
    const firstRow = Math.min(...destinations.map(cell => cell.row));
    const lastRow = Math.max(...destinations.map(cell => cell.row));
    const firstColumn = Math.min(...destinations.map(cell => cell.column));
    const lastColumn = Math.max(...destinations.map(cell => cell.column));
    const selectedWidth = lastColumn - firstColumn + 1;
    const selectedHeight = lastRow - firstRow + 1;
    const destinationSet = new Set(destinations.map(cell => cell.key));
    const selectionIsRectangle = destinationSet.size === selectedWidth * selectedHeight;
    if (payload.cells.length !== 1 && destinations.length > 1
      && (!selectionIsRectangle || selectedWidth % payload.width !== 0 || selectedHeight % payload.height !== 0)) {
      setClipboardNotice({ kind: 'error', message: `La sélection de destination (${selectedWidth} × ${selectedHeight}) n’est pas compatible avec la plage copiée (${payload.width} × ${payload.height}).` });
      return;
    }

    const assignments: Array<{ source: ClipboardCell; row: number; column: number; key: string }> = [];
    if (payload.cells.length === 1) {
      for (const destination of destinations) assignments.push({ source: payload.cells[0], ...destination });
    } else {
      const repeatsDown = destinations.length > 1 ? selectedHeight / payload.height : 1;
      const repeatsAcross = destinations.length > 1 ? selectedWidth / payload.width : 1;
      for (let vertical = 0; vertical < repeatsDown; vertical += 1) {
        for (let horizontal = 0; horizontal < repeatsAcross; horizontal += 1) {
          for (const source of payload.cells) {
            const row = firstRow + vertical * payload.height + source.rowOffset;
            const column = firstColumn + horizontal * payload.width + source.columnOffset;
            const shotId = selectableCellRowIds[row];
            const columnId = visibleColumns[column]?.id;
            if (!shotId || !columnId) {
              setClipboardNotice({ kind: 'error', message: 'La plage copiée dépasse les limites actuelles du tableau.' });
              return;
            }
            assignments.push({ source, row, column, key: technicalCellKey(shotId, columnId) });
          }
        }
      }
    }

    const checked = assignments.map(assignment => {
      const destination = visibleColumns[assignment.column];
      return { ...assignment, destination, result: compatibleCellValue(assignment.source, destination) };
    });
    const incompatible = checked.find(item => !item.result.compatible);
    if (incompatible) {
      setClipboardNotice({
        kind: 'error',
        message: `Collage annulé : « ${incompatible.source.columnName || incompatible.source.text || 'valeur'} » n’est pas compatible avec la colonne « ${incompatible.destination.name} ».`,
      });
      return;
    }

    const shots = new Map(breakdown.shots.map(shot => [shot.id, { ...shot, values: { ...shot.values } }]));
    if (payload.cut) {
      for (const key of payload.sourceCellKeys) {
        const source = parseTechnicalCellKey(key);
        const sourceColumn = source && breakdown.columns.find(column => column.id === source.columnId);
        const sourceShot = source && shots.get(source.shotId);
        if (!sourceColumn || !sourceShot || sourceColumn.kind === 'scene' || sourceColumn.kind === 'plan') continue;
        delete sourceShot.values[sourceColumn.id];
      }
    }
    for (const item of checked) {
      const position = parseTechnicalCellKey(item.key);
      const shot = position && shots.get(position.shotId);
      if (!position || !shot || item.destination.kind === 'plan') continue;
      if (item.destination.kind === 'scene') shot.sceneId = item.result.value;
      else if (item.result.value) shot.values[item.destination.id] = item.result.value;
      else delete shot.values[item.destination.id];
    }
    const orderedShots = scenes.flatMap(scene => breakdown.shots.flatMap(original => {
      const shot = shots.get(original.id);
      return shot?.sceneId === scene.id ? [shot] : [];
    }));
    emit({ ...breakdown, shots: orderedShots });
    const pastedKeys = [...new Set(assignments.map(assignment => assignment.key))];
    setSelectedCellKeys(pastedKeys);
    setCellSelectionAnchor(pastedKeys[0] ?? null);
    setActiveCellKey(pastedKeys[pastedKeys.length - 1] ?? null);
    if (payload.cut) copiedCells.current = null;
    setCutCellKeys([]);
    setClipboardNotice({ kind: 'success', message: `${pastedKeys.length} cellule${pastedKeys.length > 1 ? 's' : ''} collée${pastedKeys.length > 1 ? 's' : ''}.` });
  }

  async function pasteCellSelection() {
    let text = '';
    try { text = await navigator.clipboard?.readText() ?? ''; } catch { /* The in-memory Senario clipboard remains available. */ }
    const internal = copiedCells.current;
    const sameInternalText = internal && (!text || text.replace(/\r\n/gu, '\n') === internal.text.replace(/\r\n/gu, '\n'));
    const payload = sameInternalText ? internal : externalClipboardPayload(text);
    if (!payload) {
      setClipboardNotice({ kind: 'error', message: 'Le presse-papiers ne contient aucune cellule compatible.' });
      return;
    }
    applyCellPaste(payload);
  }

  function clearCellSelection() {
    if (readOnly || !selectedCellKeys.length) return;
    const editable = selectedCellKeys.flatMap(key => {
      const position = parseTechnicalCellKey(key);
      const column = position && breakdown.columns.find(candidate => candidate.id === position.columnId);
      return position && column && column.kind !== 'scene' && column.kind !== 'plan' ? [{ position, column }] : [];
    });
    if (!editable.length) {
      setClipboardNotice({ kind: 'error', message: 'Les cellules sélectionnées sont calculées ou obligatoires et ne peuvent pas être vidées.' });
      return;
    }
    emit({
      ...breakdown,
      shots: breakdown.shots.map(shot => {
        const affected = editable.filter(item => item.position.shotId === shot.id);
        if (!affected.length) return shot;
        const values = { ...shot.values };
        affected.forEach(item => { delete values[item.column.id]; });
        return { ...shot, values };
      }),
    });
    copiedCells.current = copiedCells.current?.cut ? null : copiedCells.current;
    setCutCellKeys([]);
    setClipboardNotice({ kind: 'success', message: `${editable.length} cellule${editable.length > 1 ? 's' : ''} vidée${editable.length > 1 ? 's' : ''}.` });
  }

  function pasteShots(source: TechnicalShot[]) {
    if (!source.length || !scenes.length) return;
    const selected = breakdown.shots.find(shot => selectedSet.has(shot.id));
    const fallbackSceneId = selected?.sceneId ?? activeSceneId ?? scenes[0].id;
    const validColumns = new Set(breakdown.columns.map(column => column.id));
    const clones = source.map(shot => ({
      id: createTechnicalId('shot'),
      sceneId: sceneMap.has(shot.sceneId) ? shot.sceneId : fallbackSceneId,
      values: Object.fromEntries(Object.entries(shot.values).filter(([columnId, value]) => validColumns.has(columnId) && typeof value === 'string')),
    }));
    const lastSelectedIndex = Math.max(-1, ...breakdown.shots.map((shot, index) => selectedSet.has(shot.id) ? index : -1));
    const shots = [...breakdown.shots];
    shots.splice(lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : shots.length, 0, ...clones);
    const ordered = scenes.flatMap(scene => shots.filter(shot => shot.sceneId === scene.id));
    emit({ ...breakdown, shots: ordered });
    setSelectedIds(clones.map(shot => shot.id));
  }

  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const inCell = Boolean(target?.closest('[data-technical-cell-key]'));
      if (isEditableTarget(event.target) && (!inCell || Boolean(target?.closest('.technical-cell-editor')))) return;
      const key = event.key.toLocaleLowerCase();
      if (event.key === 'Escape' && cutCellKeys.length) {
        copiedCells.current = copiedCells.current?.cut ? null : copiedCells.current;
        setCutCellKeys([]);
        setClipboardNotice(null);
        return;
      }
      const command = (event.ctrlKey || event.metaKey) && !event.altKey;
      const tableActive = inCell || selectedCellKeys.length > 0 || Boolean(target?.closest('.technical-table'));
      if (!command && (event.key === 'Delete' || event.key === 'Backspace') && selectedCellKeys.length) {
        event.preventDefault();
        clearCellSelection();
        return;
      }
      if (!command) return;
      if (key === 'c' && selectedCellKeys.length) { event.preventDefault(); copyCellSelection(); return; }
      if (key === 'x' && selectedCellKeys.length && !readOnly) { event.preventDefault(); copyCellSelection(true); return; }
      if (key === 'c' && selectedIds.length) { event.preventDefault(); copyShotSelection(); return; }
      if (key === 'd' && selectedIds.length && !readOnly) { event.preventDefault(); duplicateShots(); return; }
      if (key === 'a' && tableActive) {
        event.preventDefault();
        const keys = selectableCellRowIds.flatMap(shotId => visibleColumns.map(column => technicalCellKey(shotId, column.id)));
        setSelectedIds([]);
        setSelectedCellKeys(keys);
        setCellSelectionAnchor(keys[0] ?? null);
        setActiveCellKey(keys[keys.length - 1] ?? null);
        return;
      }
      if (key === 'z' && tableActive) { event.preventDefault(); event.shiftKey ? onRedo() : onUndo(); return; }
      if (key === 'v' && !readOnly && selectedCellKeys.length) {
        event.preventDefault();
        void pasteCellSelection();
        return;
      }
      if (key === 'v' && !readOnly) {
        event.preventDefault();
        if (copiedShots.current.length) pasteShots(copiedShots.current);
        else void navigator.clipboard?.readText().then(text => {
          if (!text.startsWith(CLIPBOARD_PREFIX)) return;
          try { pasteShots(JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as TechnicalShot[]); } catch { /* Clipboard content is not a Senario plan bundle. */ }
        }).catch(() => undefined);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  function moveShotToScene(shot: TechnicalShot, sceneId: string) {
    if (sceneId === shot.sceneId) return;
    emit(reorderTechnicalShots(breakdown, [shot.id], sceneId, null, scenes));
  }

  function startShotDrag(event: DragEvent, shotId: string) {
    if (readOnly || interactionFiltered) { event.preventDefault(); return; }
    const ids = selectedSet.has(shotId) ? breakdown.shots.filter(shot => selectedSet.has(shot.id)).map(shot => shot.id) : [shotId];
    if (!selectedSet.has(shotId)) setSelectedIds(ids);
    setDraggedShotIds(ids);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', ids.join(','));
  }

  function markShotDrop(event: DragEvent, sceneId: string, shot: TechnicalShot | null, sceneShots: TechnicalShot[]) {
    if (!draggedShotIds.length) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (!shot) { setShotDropMarker({ sceneId, beforeShotId: null }); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < bounds.top + bounds.height / 2;
    const index = sceneShots.findIndex(candidate => candidate.id === shot.id);
    setShotDropMarker({ sceneId, beforeShotId: before ? shot.id : sceneShots[index + 1]?.id ?? null });
  }

  function dropShots(event: DragEvent) {
    event.preventDefault();
    if (shotDropMarker && draggedShotIds.length) emit(reorderTechnicalShots(
      breakdown, draggedShotIds, shotDropMarker.sceneId, shotDropMarker.beforeShotId, scenes,
    ));
    setDraggedShotIds([]);
    setShotDropMarker(null);
  }

  function dropColumn(event: DragEvent) {
    event.preventDefault();
    if (!draggedColumnId || columnDropIndex === null) return;
    const visibleTarget = visibleColumns[columnDropIndex]?.id;
    const sourceIndex = breakdown.columns.findIndex(column => column.id === draggedColumnId);
    if (sourceIndex < 0) return;
    const columns = [...breakdown.columns];
    const [moved] = columns.splice(sourceIndex, 1);
    const targetIndex = visibleTarget ? columns.findIndex(column => column.id === visibleTarget) : columns.length;
    columns.splice(targetIndex < 0 ? columns.length : targetIndex, 0, moved);
    emit({ ...breakdown, columns });
    setDraggedColumnId(null);
    setColumnDropIndex(null);
  }

  function startResize(event: ReactPointerEvent, column: TechnicalColumn) {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originWidth = previewWidths[column.id] ?? column.width;
    let finalWidth = originWidth;
    const move = (pointer: PointerEvent) => {
      finalWidth = Math.max(72, Math.min(640, Math.round(originWidth + pointer.clientX - originX)));
      setPreviewWidths(previous => ({ ...previous, [column.id]: finalWidth }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreviewWidths(previous => { const next = { ...previous }; delete next[column.id]; return next; });
      if (finalWidth !== column.width) updateColumn(column.id, current => ({ ...current, width: finalWidth }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  function addCategory() {
    const name = newCategoryName.trim().replace(/\s+/gu, ' ');
    if (!name) return;
    emit({ ...breakdown, columns: [...breakdown.columns, { id: createTechnicalId('column'), name, kind: 'custom', width: 180, hidden: false }] });
    setNewCategoryName('');
    setNewCategoryOpen(false);
  }

  function deleteColumn(column: TechnicalColumn) {
    if (!window.confirm(`Supprimer la catégorie « ${column.name} » et les valeurs de cette colonne ?`)) return;
    emit({
      ...breakdown,
      columns: breakdown.columns.filter(candidate => candidate.id !== column.id),
      shots: breakdown.shots.map(shot => {
        const values = { ...shot.values }; delete values[column.id]; return { ...shot, values };
      }),
    });
    setColumnFilters(previous => {
      const next = { ...previous };
      delete next[column.id];
      return next;
    });
    setSort(current => current?.columnId === column.id ? null : current);
    setColumnMenuId(null);
  }

  function hideColumn(column: TechnicalColumn) {
    cancelEditing();
    const belongsToColumn = (cellKey: string | null) => parseTechnicalCellKey(cellKey ?? '')?.columnId === column.id;
    setSelectedCellKeys(previous => previous.filter(cellKey => !belongsToColumn(cellKey)));
    setCutCellKeys(previous => previous.filter(cellKey => !belongsToColumn(cellKey)));
    setCellSelectionAnchor(current => belongsToColumn(current) ? null : current);
    setActiveCellKey(current => belongsToColumn(current) ? null : current);
    setTemporaryAdaptedCellKey(current => belongsToColumn(current) ? null : current);
    setCellContextMenu(current => current && belongsToColumn(current.cellKey) ? null : current);
    updateColumn(column.id, current => ({ ...current, hidden: true }));
    setColumnMenuId(null);
  }

  function showColumn(column: TechnicalColumn) {
    updateColumn(column.id, current => ({ ...current, hidden: false }));
  }

  function renameColumn(column: TechnicalColumn) {
    const name = columnMenuName.trim().replace(/\s+/gu, ' ');
    if (name && name !== column.name) updateColumn(column.id, current => ({ ...current, name }));
    setColumnMenuId(null);
  }

  async function setImage(shot: TechnicalShot, column: TechnicalColumn, file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { window.alert('Choisissez un fichier image.'); return; }
    if (file.size > MAX_IMAGE_BYTES) { window.alert('Cette image dépasse 12 Mo. Choisissez une référence plus légère.'); return; }
    const value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    emit({ ...breakdown, shots: breakdown.shots.map(candidate => candidate.id === shot.id
      ? { ...candidate, values: { ...candidate.values, [column.id]: value } } : candidate) });
  }

  function clearImage(shot: TechnicalShot, column: TechnicalColumn) {
    const values = { ...shot.values }; delete values[column.id];
    emit({ ...breakdown, shots: breakdown.shots.map(candidate => candidate.id === shot.id ? { ...candidate, values } : candidate) });
  }

  function renderCell(shot: TechnicalShot, column: TechnicalColumn, scene: ScenarioScene, shotIndex: number) {
    const value = cellValue(shot, column, scenes, scene.index, shotIndex);
    const isEditing = editing?.shotId === shot.id && editing.columnId === column.id;
    const currentCellKey = technicalCellKey(shot.id, column.id);
    if (column.kind === 'scene') return <select
      className="technical-scene-select" value={shot.sceneId} disabled={readOnly}
      aria-label={`Scène du plan ${scene.index + 1}.${shotIndex + 1}`}
      onClick={event => event.stopPropagation()} onChange={event => moveShotToScene(shot, event.target.value)}
    >{scenes.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.index + 1}. {candidate.title}</option>)}</select>;
    if (column.kind === 'plan') return <span className="technical-plan-number">{value}</span>;
    if (column.kind === 'image') {
      const inputKey = `${shot.id}:${column.id}`;
      return <div className="technical-image-cell">
        <input ref={input => { if (input) fileInputs.current.set(inputKey, input); else fileInputs.current.delete(inputKey); }}
          type="file" accept="image/*" hidden onChange={event => { void setImage(shot, column, event.target.files?.[0]); event.currentTarget.value = ''; }} />
        {value ? <>
          <button className="technical-thumbnail" type="button" title="Agrandir l’image" onClick={event => { event.stopPropagation(); setImagePreview({ src: value, label: `Plan ${scene.index + 1}.${shotIndex + 1}` }); }}>
            <img src={value} alt="" />
          </button>
          {!readOnly && <span className="technical-image-actions">
            <button type="button" title="Remplacer l’image" aria-label="Remplacer l’image" onClick={event => { event.stopPropagation(); fileInputs.current.get(inputKey)?.click(); }}><UiIcon name="edit" /></button>
            <button type="button" title="Supprimer l’image" aria-label="Supprimer l’image" onClick={event => { event.stopPropagation(); clearImage(shot, column); }}><UiIcon name="x" /></button>
          </span>}
        </> : <button className="technical-add-image" type="button" disabled={readOnly} onClick={event => { event.stopPropagation(); fileInputs.current.get(inputKey)?.click(); }}><UiIcon name="plus" /> Image</button>}
      </div>;
    }
    if (isEditing) {
      const dialogueSuggestions = column.kind === 'dialogue'
        ? (sceneDialogues.get(shot.sceneId) ?? []).filter(suggestion => !editingQuery.trim() || normalized(suggestion.text).includes(normalized(editingQuery)))
        : [];
      const suggestions = column.kind === 'dialogue'
        ? dialogueSuggestions.map(suggestion => suggestion.text)
        : getTechnicalSuggestions(breakdown, column, characters, editingQuery);
      return <div className="technical-cell-editor">
        <input key={`${shot.id}:${column.id}`} autoFocus defaultValue={editing.draft} aria-label={`Modifier ${column.name}`}
          onFocus={event => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
          onInput={event => setEditingQuery(event.currentTarget.value)}
          onBlur={event => finishEditing('stay', event.currentTarget.value)}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); cancelEditing(); focusCell(shot.id, column.id); }
            else if (event.key === 'Enter') { event.preventDefault(); finishEditing('down', event.currentTarget.value); }
            else if (event.key === 'Tab') {
              event.preventDefault();
              finishEditing(event.shiftKey ? 'previous' : 'next', !event.shiftKey && suggestions[0] ? suggestions[0] : event.currentTarget.value);
            }
          }} />
        {column.kind === 'dialogue' && dialogueSuggestions.length > 0
          ? <div className="technical-smart-type technical-dialogue-smart-type" role="listbox" aria-label="Dialogues de la scène">
            <div className="technical-smart-type-title"><span><UiIcon name="message" /> Dialogues de la scène</span><kbd>Tab</kbd></div>
            {dialogueSuggestions.map(suggestion => <button key={suggestion.id} type="button" role="option"
              onMouseDown={event => { event.preventDefault(); finishEditing('down', suggestion.text); }}>
              <UiIcon name="message" /><span><strong>{suggestion.character}</strong><em>{suggestion.text}</em></span>
            </button>)}
          </div>
          : column.kind !== 'dialogue' && suggestions.length > 0 && <div className="technical-smart-type" role="listbox" aria-label={`Suggestions ${column.name}`}>
            <div className="technical-smart-type-title"><span>SmartType</span><kbd>Tab</kbd></div>
            {suggestions.map(suggestion => <button key={suggestion} type="button" role="option"
              onMouseDown={event => { event.preventDefault(); finishEditing('down', suggestion); }}>{suggestion}</button>)}
          </div>}
      </div>;
    }
    return <span ref={element => { if (element) cellValueElements.current.set(currentCellKey, element); else cellValueElements.current.delete(currentCellKey); }}
      className={`technical-cell-value${value ? '' : ' is-empty'}`} title={value}>{value || (column.kind === 'duration' ? '' : '—')}</span>;
  }

  return <section className="technical-breakdown-workspace" aria-label="Découpage technique" ref={rootRef}>
    <header className="technical-toolbar">
      <button type="button" className={`technical-scene-panel-toggle${scenePanelOpen ? ' is-active' : ''}`}
        aria-label={scenePanelOpen ? 'Masquer le panneau de scène' : 'Afficher le panneau de scène'}
        title={scenePanelOpen ? 'Masquer le panneau de scène' : 'Afficher le panneau de scène'}
        aria-pressed={scenePanelOpen} onClick={toggleScenePanel}><UiIcon name="screenplay" /></button>
      <div className="technical-search-tools">
        <div className="technical-search-field">
          <input id="technical-plan-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher dans tous les plans…" aria-label="Rechercher des plans" />
          {query && <button type="button" aria-label="Effacer la recherche" title="Effacer la recherche" onClick={() => setQuery('')}><UiIcon name="x" /></button>}
        </div>
        <div className="breakdown-filter-wrap">
          <button className={activeFilterCount ? 'is-active' : ''} type="button" aria-label="Filtrer les plans" title="Filtrer les plans"
            aria-expanded={searchFilterMenuOpen} onClick={() => setSearchFilterMenuOpen(previous => !previous)}>
            <UiIcon name="filter" />{activeFilterCount > 0 && <span>{activeFilterCount}</span>}
          </button>
          {searchFilterMenuOpen && <div className="breakdown-filter-panel">
            <section className="technical-filter-logic-section">
              <h3>Combinaison des filtres</h3>
              <div className="technical-filter-toggle-row">
                <span className={filterCombinationMode === 'addition' ? 'is-active' : ''}>Addition <small>OU</small></span>
                <button type="button" role="switch" aria-label="Basculer entre Addition et Restriction"
                  aria-checked={filterCombinationMode === 'restriction'}
                  onClick={() => setFilterCombinationMode(current => current === 'addition' ? 'restriction' : 'addition')}><i /></button>
                <span className={filterCombinationMode === 'restriction' ? 'is-active' : ''}>Restriction <small>ET</small></span>
              </div>
            </section>
            <section className="technical-filter-logic-section">
              <h3>Affichage des résultats</h3>
              <div className="technical-filter-toggle-row">
                <span className={filterDisplayMode === 'keep' ? 'is-active' : ''}>Garder</span>
                <button type="button" role="switch" aria-label="Basculer entre Garder et Exclure"
                  aria-checked={filterDisplayMode === 'exclude'}
                  onClick={() => setFilterDisplayMode(current => current === 'keep' ? 'exclude' : 'keep')}><i /></button>
                <span className={filterDisplayMode === 'exclude' ? 'is-active' : ''}>Exclure</span>
              </div>
            </section>
            <section><h3>Catégories</h3>
              <div className="breakdown-filter-categories">
                {breakdown.columns.map(column => {
                  const open = expandedSearchFilterColumnId === column.id;
                  const options = searchFilterOptions.get(column.id) ?? [];
                  return <div className={open ? 'is-open' : ''} key={column.id}>
                    <button type="button" className="breakdown-filter-category-button" aria-expanded={open}
                      onClick={() => setExpandedSearchFilterColumnId(previous => previous === column.id ? null : column.id)}>
                      <UiIcon name="chevron" /><strong>{column.name}</strong><span>{columnFilters[column.id] ? '1/' : ''}{options.length}</span>
                    </button>
                    {open && (options.length ? <div className="breakdown-filter-elements">
                      {options.map(option => <button type="button" key={option.value}
                        className={columnFilters[column.id] === option.value ? 'is-selected' : ''}
                        onClick={() => setColumnFilters(previous => ({ ...previous, [column.id]: previous[column.id] === option.value ? '' : option.value }))}>
                        <i /><span>{option.label}</span><UiIcon name="check" />
                      </button>)}
                    </div> : <p>Aucune valeur renseignée dans cette catégorie.</p>)}
                  </div>;
                })}
              </div>
            </section>
            {activeFilterCount > 0 && <button className="breakdown-clear-filters" type="button" onClick={() => setColumnFilters({})}>Retirer tous les filtres</button>}
          </div>}
        </div>
        {activeFilterCount > 0 && <div className="breakdown-filter-chips">
          {activeColumnFilters.map(filter => <button type="button" key={filter.column.id}
            onClick={() => setColumnFilters(previous => ({ ...previous, [filter.column.id]: '' }))}>
            {filter.label}<UiIcon name="x" />
          </button>)}
        </div>}
      </div>
      <div className="technical-category-action" ref={addCategoryRef}>
        <button type="button" disabled={readOnly || !scenes.length} onClick={() => setNewCategoryOpen(previous => !previous)}
          aria-label={hiddenColumns.length ? `Ajouter une catégorie ou réafficher ${hiddenColumns.length} colonne${hiddenColumns.length > 1 ? 's' : ''} masquée${hiddenColumns.length > 1 ? 's' : ''}` : 'Ajouter une catégorie'}>
          <UiIcon name="plus" /> Catégorie
          {hiddenColumns.length > 0 && <span className="technical-hidden-column-count" title={`${hiddenColumns.length} colonne${hiddenColumns.length > 1 ? 's' : ''} masquée${hiddenColumns.length > 1 ? 's' : ''}`}>{hiddenColumns.length}</span>}
        </button>
        {newCategoryOpen && <form className="technical-add-category-popover" onSubmit={event => { event.preventDefault(); addCategory(); }}>
          <label>Nom de la catégorie<input autoFocus value={newCategoryName} maxLength={80} onChange={event => setNewCategoryName(event.target.value)} /></label>
          <div className="technical-add-category-actions"><button type="button" onClick={() => setNewCategoryOpen(false)}>Annuler</button><button className="primary-button" type="submit" disabled={!newCategoryName.trim()}>Ajouter</button></div>
          {hiddenColumns.length > 0 && <section className="technical-hidden-columns" aria-label="Colonnes masquées">
            <h3>Colonnes masquées</h3>
            {hiddenColumns.map(column => <button key={column.id} type="button" onClick={() => showColumn(column)}>
              <UiIcon name="eye" /><span>{column.name}</span><small>Afficher</small>
            </button>)}
          </section>}
        </form>}
      </div>
      <span className="technical-selection-summary">{selectedCellKeys.length
        ? `${selectedCellKeys.length} cellule${selectedCellKeys.length > 1 ? 's' : ''} sélectionnée${selectedCellKeys.length > 1 ? 's' : ''}`
        : selectedIds.length ? `${selectedIds.length} sélectionné${selectedIds.length > 1 ? 's' : ''}` : `${visibleShotCount} plan${visibleShotCount > 1 ? 's' : ''}`}</span>
      {selectedCellKeys.length > 0 ? <div className="technical-selection-actions">
        <button type="button" onClick={() => copyCellSelection()}>Copier</button>
        <button type="button" disabled={readOnly} onClick={() => copyCellSelection(true)}>Couper</button>
        <button type="button" disabled={readOnly} onClick={clearCellSelection}>Vider</button>
      </div> : selectedIds.length > 0 && <div className="technical-selection-actions">
        <button type="button" onClick={copyShotSelection}>Copier</button>
        <button type="button" disabled={readOnly} onClick={() => duplicateShots()}>Dupliquer</button>
        <button type="button" disabled={readOnly} onClick={() => deleteShots()}><UiIcon name="trash" /> Supprimer</button>
      </div>}
      <div className="technical-undo-actions"><button type="button" disabled={readOnly || !canUndo} onClick={onUndo}>Annuler</button><button type="button" disabled={readOnly || !canRedo} onClick={onRedo}>Rétablir</button></div>
    </header>

    {!scenes.length ? <div className="technical-empty-state"><UiIcon name="screenplay" /><h2>Créez d’abord une scène</h2><p>Chaque plan du découpage technique doit être rattaché à une scène existante du scénario.</p></div> : <div
      className={`technical-workspace-body${scenePanelOpen ? ' has-scene-panel' : ''}`}
      style={{ '--technical-scene-panel-width': `${scenePanelWidth}px` } as CSSProperties}>
      {scenePanelOpen && <>
        <ScenarioScenePreview document={scenarioDocument} scene={previewScene} readOnly showSceneNumber />
        <div className="technical-scene-panel-resizer" role="separator" aria-orientation="vertical"
          aria-label="Redimensionner le panneau de scène" aria-valuemin={SCENE_PANEL_MIN_WIDTH}
          aria-valuenow={Math.round(scenePanelWidth)} onPointerDown={startScenePanelResize} />
      </>}
      <div className="technical-table-region">
      {clipboardNotice && <div className={`technical-clipboard-notice is-${clipboardNotice.kind}`} role="status">
        <UiIcon name={clipboardNotice.kind === 'error' ? 'error' : 'check'} />
        <span>{clipboardNotice.message}</span>
      </div>}
      {interactionFiltered && <div className="technical-view-notice"><UiIcon name="filter" /><span>Vue filtrée ou triée — l’ordre réel des plans reste inchangé.</span><button type="button" onClick={() => { setQuery(''); setColumnFilters({}); setFilterCombinationMode('restriction'); setFilterDisplayMode('keep'); setSort(null); }}>Réinitialiser</button></div>}
      <div className="technical-table-scroll">
        <div className="technical-table" role="table" aria-rowcount={breakdown.shots.length} style={{ '--technical-grid': gridTemplate } as CSSProperties}>
          <div className="technical-grid-row technical-header-row" role="row">
            <div className="technical-row-tools technical-corner-cell" role="columnheader"><span aria-hidden="true">#</span></div>
            {visibleColumns.map((column, index) => <div key={column.id} role="columnheader"
              className={`technical-column-header${columnDropIndex === index ? ' is-column-drop-target' : ''}${index === visibleColumns.length - 1 && columnDropIndex === visibleColumns.length ? ' is-column-drop-end' : ''}`}
              draggable={!readOnly}
              onDragStart={event => { setDraggedColumnId(column.id); event.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={event => {
                if (!draggedColumnId) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                setColumnDropIndex(index + (event.clientX > bounds.left + bounds.width / 2 ? 1 : 0));
              }}
              onDrop={dropColumn} onDragEnd={() => { setDraggedColumnId(null); setColumnDropIndex(null); }}>
              <span title={column.name}>{column.name}</span>
              {sort?.columnId === column.id && <small>{sort.direction === 'ascending' ? '↑' : '↓'}</small>}
              {columnFilters[column.id] && <UiIcon name="filter" />}
              <button className="technical-header-menu-button" type="button" aria-label={`Options de ${column.name}`} aria-expanded={columnMenuId === column.id}
                onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setColumnMenuId(columnMenuId === column.id ? null : column.id); setColumnMenuName(column.name); }}><UiIcon name="more" /></button>
              <span className="technical-column-resizer" role="separator" aria-label={`Redimensionner ${column.name}`} onPointerDown={event => startResize(event, column)} />
              {columnMenuId === column.id && <div className="technical-column-menu" onPointerDown={event => event.stopPropagation()}>
                <form onSubmit={event => { event.preventDefault(); renameColumn(column); }}><label>Nom<input value={columnMenuName} maxLength={80} onChange={event => setColumnMenuName(event.target.value)} /></label><button type="submit" disabled={!columnMenuName.trim()}>Renommer</button></form>
                <div className="technical-column-menu-row"><button type="button" className={sort?.columnId === column.id && sort.direction === 'ascending' ? 'is-active' : ''} onClick={() => setSort({ columnId: column.id, direction: 'ascending' })}>Tri A → Z</button><button type="button" className={sort?.columnId === column.id && sort.direction === 'descending' ? 'is-active' : ''} onClick={() => setSort({ columnId: column.id, direction: 'descending' })}>Tri Z → A</button></div>
                {sort?.columnId === column.id && <button type="button" onClick={() => setSort(null)}>Effacer le tri</button>}
                {columnFilters[column.id] && <button type="button" onClick={() => setColumnFilters(previous => ({ ...previous, [column.id]: '' }))}>Retirer le filtre</button>}
                <hr />
                <button type="button" onClick={() => hideColumn(column)}><UiIcon name="eye" /> Masquer la colonne</button>
                <button type="button" className="is-danger" onClick={() => deleteColumn(column)}><UiIcon name="trash" /> Supprimer</button>
              </div>}
            </div>)}
          </div>

          {displayScenes.map(scene => {
            const sceneShots = matchingShotsByScene.get(scene.id);
            if (!sceneShots) return null;
              const actualSceneShots = breakdown.shots.filter(shot => shot.sceneId === scene.id);
              const collapsed = collapsedScenes.has(scene.id);
              const sceneDuration = getSceneDuration(breakdown, scene.id);
              return <div className="technical-scene-group" key={scene.id} role="rowgroup">
              <div className={`technical-scene-header${sceneShots.length === 0 && shotDropMarker?.sceneId === scene.id && shotDropMarker.beforeShotId === null ? ' is-shot-drop-end' : ''}`}
                onClick={() => setPreviewSceneId(scene.id)}
                onDragOver={event => markShotDrop(event, scene.id, null, sceneShots)} onDrop={dropShots}>
                <button type="button" aria-expanded={!collapsed} aria-label={`${collapsed ? 'Déplier' : 'Replier'} la scène ${scene.index + 1}`} onClick={() => setCollapsedScenes(previous => { const next = new Set(previous); next.has(scene.id) ? next.delete(scene.id) : next.add(scene.id); return next; })}><UiIcon name="chevron" /></button>
                <strong><span>SCÈNE {scene.index + 1}</span>{scene.title}</strong>
                <span>{actualSceneShots.length} plan{actualSceneShots.length > 1 ? 's' : ''}</span>
                {durationColumn && <span>Durée : <b>{formatTechnicalDuration(sceneDuration)}</b></span>}
                <button type="button" disabled={readOnly} onClick={() => addShot(scene.id)}><UiIcon name="plus" /> Plan</button>
              </div>
              {!collapsed && sceneShots.map(shot => {
                const actualIndex = actualSceneShots.findIndex(candidate => candidate.id === shot.id);
                const isSelected = selectedSet.has(shot.id);
                const dropBefore = shotDropMarker?.sceneId === scene.id && shotDropMarker.beforeShotId === shot.id;
                const dropAfter = shotDropMarker?.sceneId === scene.id && shotDropMarker.beforeShotId === null && shot.id === sceneShots[sceneShots.length - 1]?.id;
                return <div key={shot.id} role="row" aria-selected={isSelected}
                  className={`technical-grid-row technical-shot-row${isSelected ? ' is-selected' : ''}${dropBefore ? ' is-shot-drop-before' : ''}${dropAfter ? ' is-shot-drop-after' : ''}`}
                  onClick={event => selectShot(event, shot.id)}
                  onDragOver={event => markShotDrop(event, scene.id, shot, sceneShots)} onDrop={dropShots}>
                  <div className="technical-row-tools" role="cell">
                    <span className="technical-drag-handle" draggable={!readOnly && !interactionFiltered} title={interactionFiltered ? 'Réinitialisez le tri et les filtres pour déplacer les plans' : 'Déplacer le plan'}
                      onDragStart={event => startShotDrag(event, shot.id)} onDragEnd={() => { setDraggedShotIds([]); setShotDropMarker(null); }}>⠿</span>
                    <div className="technical-row-quick-actions">
                      <button type="button" disabled={readOnly} title="Insérer un plan avant" aria-label="Insérer un plan avant" onClick={event => { event.stopPropagation(); insertBefore(shot); }}><UiIcon name="plus" /></button>
                      <button type="button" disabled={readOnly} title="Dupliquer le plan" aria-label="Dupliquer le plan" onClick={event => { event.stopPropagation(); duplicateShots([shot.id]); }}><UiIcon name="duplicate" /></button>
                      <button type="button" disabled={readOnly} title="Supprimer le plan" aria-label="Supprimer le plan" onClick={event => { event.stopPropagation(); deleteShots([shot.id]); }}><UiIcon name="trash" /></button>
                    </div>
                  </div>
                  {visibleColumns.map(column => {
                    const cellKey = technicalCellKey(shot.id, column.id);
                    const isAdapted = adaptedCellKeys.has(cellKey) || temporaryAdaptedCellKey === cellKey;
                    const canTemporarilyAdapt = overflowingCellKeys.has(cellKey) && !isAdapted;
                    const isCellSelected = selectedCellSet.has(cellKey);
                    return <div key={column.id} role="cell" tabIndex={0}
                      data-shot-id={shot.id} data-column-id={column.id} data-technical-cell-key={cellKey}
                      aria-selected={isCellSelected}
                      className={`technical-cell technical-cell-${column.kind}${editing?.shotId === shot.id && editing.columnId === column.id ? ' is-editing' : ''}${isAdapted ? ' is-content-adapted' : ''}${isCellSelected ? ' is-cell-selected' : ''}${activeCellKey === cellKey ? ' is-active-cell' : ''}${cutCellSet.has(cellKey) ? ' is-cell-cut' : ''}`}
                      onPointerDown={event => selectCell(event, shot.id, column.id)}
                      onPointerEnter={event => extendCellSelection(event, shot.id, column.id)}
                      onClick={event => event.stopPropagation()}
                      onContextMenu={event => openCellContextMenu(event, cellKey)}
                      onDoubleClick={event => { event.stopPropagation(); startEditing(shot, column); }} onKeyDown={event => cellKeyDown(event, shot, column)}>
                      {renderCell(shot, column, scene, actualIndex)}
                      {canTemporarilyAdapt && <button className="technical-cell-expand" type="button" title="Afficher temporairement tout le texte"
                        aria-label={`Afficher temporairement tout le contenu de ${column.name}`}
                        onClick={event => { event.stopPropagation(); setTemporaryAdaptedCellKey(cellKey); }}>↘</button>}
                    </div>;
                  })}
                </div>;
              })}
              {!collapsed && sceneShots.length === 0 && <button className="technical-scene-empty" type="button" disabled={readOnly} onDragOver={event => markShotDrop(event, scene.id, null, sceneShots)} onDrop={dropShots} onClick={() => addShot(scene.id)}><UiIcon name="plus" /> Ajouter le premier plan de cette scène</button>}
            </div>;
          })}
        </div>
      </div>
      </div>
    </div>}

    {imagePreview && <div className="technical-image-modal" role="dialog" aria-modal="true" aria-label={imagePreview.label} onMouseDown={() => setImagePreview(null)}>
      <figure onMouseDown={event => event.stopPropagation()}><img src={imagePreview.src} alt={imagePreview.label} /><figcaption>{imagePreview.label}<button type="button" aria-label="Fermer l’image" onClick={() => setImagePreview(null)}><UiIcon name="x" /></button></figcaption></figure>
    </div>}
    {cellContextMenu && <div className="technical-cell-context-menu" role="menu" style={{ left: cellContextMenu.x, top: cellContextMenu.y }}>
      <button type="button" role="menuitem" onClick={() => toggleCellAdaptation(cellContextMenu.cellKey)}>
        <UiIcon name={adaptedCellKeys.has(cellContextMenu.cellKey) ? 'x' : 'chevron'} />
        {adaptedCellKeys.has(cellContextMenu.cellKey) ? 'Retirer l’adaptation' : 'Adapter la case'}
      </button>
    </div>}
  </section>;
}

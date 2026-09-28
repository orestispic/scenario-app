import {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { UiButton, UiEmptyState, UiInput, UiMenu, UiMenuItem, UiPopover, UiReadOnlyNotice, UiSearchField, UiSwitch } from '../ui';
import { UiIcon } from '../ui/UiIcon';
import { UiIconButton } from '../ui/UiIconButton';
import { useDismissOnOutsidePointer } from '../ui/useDismissOnOutsidePointer';
import {
  applyAutomaticBreakdownColors, createBreakdownId, getBreakdownSuggestionItems,
  getNextAutomaticBreakdownAppearance,
  type BreakdownCategory, type BreakdownItem, type SceneBreakdown,
} from './breakdownModel';
import { ScenarioScenePreview, SCENARIO_PREVIEW_WORD_MIME } from './ScenarioScenePreview';
import type { ScenarioScene } from './sceneTimelineModel';
import './sceneBreakdown.css';

interface SceneBreakdownProps {
  scenes: ScenarioScene[];
  document: ProseMirrorNode;
  breakdowns: Record<string, SceneBreakdown>;
  activeSceneId: string | null;
  readOnly: boolean;
  onOpenScene: (sceneId: string) => void;
  onChange: (sceneId: string, breakdown: SceneBreakdown) => void;
  onChangeMany: (breakdowns: Record<string, SceneBreakdown>) => void;
}

interface ElementFilter {
  key: string;
  category: string;
  item: string;
  hue: number | null;
  secondaryHue: number | null;
}

interface ItemDraft {
  categoryId: string;
  text: string;
  selected: number;
  popupLeft: number;
  popupTop: number | null;
  popupBottom: number | null;
  popupMaxHeight: number;
}

const AUTO_COLOR_STORAGE_KEY = 'senario-breakdown-auto-colors';
const SMART_TYPE_WIDTH = 280;

function smartTypePosition(input: HTMLInputElement): Pick<ItemDraft, 'popupBottom' | 'popupLeft' | 'popupMaxHeight' | 'popupTop'> {
  const bounds = input.getBoundingClientRect();
  const style = window.getComputedStyle(input);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  let caretOffset = 0;
  if (context) {
    context.font = style.font;
    caretOffset = context.measureText(input.value.slice(0, input.selectionStart ?? input.value.length)).width;
  }
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const desiredLeft = bounds.left + paddingLeft + caretOffset - input.scrollLeft;
  const inset = 12;
  const gap = 4;
  const availableBelow = Math.max(0, window.innerHeight - bounds.bottom - gap - inset);
  const availableAbove = Math.max(0, bounds.top - gap - inset);
  const placeAbove = availableAbove > availableBelow;
  return {
    popupLeft: Math.max(12, Math.min(desiredLeft, window.innerWidth - SMART_TYPE_WIDTH - 12)),
    popupTop: placeAbove ? null : bounds.bottom + gap,
    popupBottom: placeAbove ? window.innerHeight - bounds.top + gap : null,
    popupMaxHeight: placeAbove ? availableAbove : availableBelow,
  };
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('fr-FR');
}

function filterKey(category: string, item: string): string {
  return `${normalized(category)}\u0001${normalized(item)}`;
}

function colorStyle(item: Pick<BreakdownItem, 'hue' | 'secondaryHue'>): CSSProperties {
  if (item.hue === null) return {};
  const center = `hsl(${item.hue} 72% 54%)`;
  const outline = `hsl(${item.secondaryHue ?? item.hue} 72% 54%)`;
  return { backgroundColor: center, borderColor: outline };
}

export function SceneBreakdown({ scenes, document: scenarioDocument, breakdowns, activeSceneId, readOnly, onOpenScene, onChange, onChangeMany }: SceneBreakdownProps) {
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(activeSceneId ?? scenes[0]?.id ?? null);
  const [newCategory, setNewCategory] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState<string | null>(null);
  const [dropCategoryIndex, setDropCategoryIndex] = useState<number | null>(null);
  const [draggedPreviewLabel, setDraggedPreviewLabel] = useState('');
  const [previewSelectionVersion, setPreviewSelectionVersion] = useState(0);
  const [wordDropCategoryId, setWordDropCategoryId] = useState<string | null>(null);
  const [categoryCloseMenuId, setCategoryCloseMenuId] = useState<string | null>(null);
  const [colorEditor, setColorEditor] = useState<{ categoryId: string; itemId: string } | null>(null);
  const [sceneQuery, setSceneQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedFilterCategory, setExpandedFilterCategory] = useState<string | null>(null);
  const [actFilter, setActFilter] = useState<number | null>(null);
  const [elementFilters, setElementFilters] = useState<string[]>([]);
  const [autoColorEnabled, setAutoColorEnabled] = useState(() => {
    try { return window.localStorage.getItem(AUTO_COLOR_STORAGE_KEY) === 'true'; } catch { return false; }
  });
  const newCategoryInput = useRef<HTMLInputElement>(null);
  const addCategoryRef = useDismissOnOutsidePointer(addingCategory, () => {
    setAddingCategory(false);
    setNewCategory('');
  });
  const addItemInputs = useRef(new Map<string, HTMLInputElement>());
  const categoryElements = useRef(new Map<string, HTMLElement>());
  const previousCategoryPositions = useRef(new Map<string, DOMRect>());
  const automaticColorsInitialized = useRef(false);

  useEffect(() => {
    if (selectedSceneId && scenes.some(scene => scene.id === selectedSceneId)) return;
    setSelectedSceneId(activeSceneId && scenes.some(scene => scene.id === activeSceneId) ? activeSceneId : scenes[0]?.id ?? null);
  }, [activeSceneId, scenes, selectedSceneId]);

  useEffect(() => { if (addingCategory) newCategoryInput.current?.focus(); }, [addingCategory]);

  useEffect(() => {
    if (!autoColorEnabled) {
      automaticColorsInitialized.current = false;
      return;
    }
    if (automaticColorsInitialized.current) return;
    automaticColorsInitialized.current = true;
    const recolored = applyAutomaticBreakdownColors(breakdowns);
    const changed = Object.keys(recolored).some(sceneId =>
      JSON.stringify(recolored[sceneId]) !== JSON.stringify(breakdowns[sceneId]));
    if (changed) onChangeMany(recolored);
  }, [autoColorEnabled, breakdowns, onChangeMany]);

  const scene = scenes.find(candidate => candidate.id === selectedSceneId) ?? null;
  const breakdown = scene ? breakdowns[scene.id] : null;
  const currentCategory = breakdown?.categories.find(category => category.id === itemDraft?.categoryId) ?? null;
  const suggestions = useMemo(() => currentCategory && itemDraft
    ? getBreakdownSuggestionItems(breakdowns, currentCategory.name, itemDraft.text, currentCategory.items.map(item => item.name))
    : [], [breakdowns, currentCategory, itemDraft]);
  const categoryOrderKey = breakdown?.categories.map(category => category.id).join('|') ?? '';
  const categoryItemCountKey = breakdown?.categories.map(category => `${category.id}:${category.items.length}`).join('|') ?? '';
  const activeDraftCategoryId = itemDraft?.categoryId ?? null;
  const acts = useMemo(() => [...new Set(scenes.map(candidate => candidate.act))].sort((a, b) => a - b), [scenes]);
  const elementFilterOptions = useMemo(() => {
    const options = new Map<string, ElementFilter>();
    for (const value of Object.values(breakdowns)) for (const category of value.categories) for (const item of category.items) {
      const itemKey = filterKey(category.name, item.name);
      if (!options.has(itemKey)) options.set(itemKey, {
        key: itemKey, category: category.name, item: item.name,
        hue: item.hue, secondaryHue: item.secondaryHue,
      });
    }
    return [...options.values()].sort((a, b) => `${a.category} ${a.item}`.localeCompare(`${b.category} ${b.item}`, 'fr'));
  }, [breakdowns]);
  const elementFilterGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; items: ElementFilter[] }>();
    for (const option of elementFilterOptions) {
      const categoryKey = normalized(option.category);
      const group = groups.get(categoryKey) ?? { key: categoryKey, name: option.category, items: [] };
      group.items.push(option);
      groups.set(categoryKey, group);
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, 'fr'));
  }, [elementFilterOptions]);
  const filteredScenes = useMemo(() => {
    const query = normalized(sceneQuery);
    return scenes.filter(candidate => {
      if (query && !normalized(candidate.title).includes(query)) return false;
      if (actFilter !== null && candidate.act !== actFilter) return false;
      if (!elementFilters.length) return true;
      const keys = new Set((breakdowns[candidate.id]?.categories ?? []).flatMap(category =>
        category.items.map(item => filterKey(category.name, item.name))));
      return elementFilters.every(value => keys.has(value));
    });
  }, [actFilter, breakdowns, elementFilters, sceneQuery, scenes]);

  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    for (const [id, element] of categoryElements.current) {
      const bounds = element.getBoundingClientRect();
      next.set(id, bounds);
      const previous = previousCategoryPositions.current.get(id);
      if (!previous) continue;
      const deltaY = previous.top - bounds.top;
      if (Math.abs(deltaY) >= 1) element.animate(
        [{ transform: `translateY(${deltaY}px)` }, { transform: 'translateY(0)' }],
        { duration: 190, easing: 'cubic-bezier(.2,.8,.2,1)' },
      );
    }
    previousCategoryPositions.current = next;
  }, [categoryOrderKey, selectedSceneId]);

  useEffect(() => {
    setDraggedPreviewLabel('');
    setWordDropCategoryId(null);
  }, [selectedSceneId]);

  useLayoutEffect(() => {
    if (!activeDraftCategoryId) return;
    const input = addItemInputs.current.get(activeDraftCategoryId);
    if (!input) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
    const position = smartTypePosition(input);
    setItemDraft(draft => draft && draft.categoryId === activeDraftCategoryId
      && (draft.popupLeft !== position.popupLeft || draft.popupTop !== position.popupTop
        || draft.popupBottom !== position.popupBottom || draft.popupMaxHeight !== position.popupMaxHeight)
      ? { ...draft, ...position }
      : draft);
  }, [activeDraftCategoryId, categoryItemCountKey]);

  useEffect(() => {
    if (!activeDraftCategoryId) return;
    let frame = 0;
    const reposition = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const input = addItemInputs.current.get(activeDraftCategoryId);
        if (!input) return;
        const position = smartTypePosition(input);
        setItemDraft(draft => draft && draft.categoryId === activeDraftCategoryId
          && (draft.popupLeft !== position.popupLeft || draft.popupTop !== position.popupTop
            || draft.popupBottom !== position.popupBottom || draft.popupMaxHeight !== position.popupMaxHeight)
          ? { ...draft, ...position }
          : draft);
      });
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [activeDraftCategoryId]);

  useEffect(() => {
    setItemDraft(draft => draft && draft.selected >= suggestions.length
      ? { ...draft, selected: 0 }
      : draft);
  }, [suggestions.length]);

  function update(categories: BreakdownCategory[]): void {
    if (scene && !readOnly) onChange(scene.id, { categories });
  }

  function replaceCategory(categoryId: string, updater: (category: BreakdownCategory) => BreakdownCategory): void {
    if (breakdown) update(breakdown.categories.map(category => category.id === categoryId ? updater(category) : category));
  }

  function renameCategory(categoryId: string, name: string): void {
    const cleaned = name.trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (cleaned) replaceCategory(categoryId, category => ({ ...category, name: cleaned }));
  }

  function addCategory(scope: 'scene' | 'project'): void {
    if (!breakdown || !scene) return;
    const name = newCategory.trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (!name) return;
    if (scope === 'scene') {
      if (!breakdown.categories.some(category => normalized(category.name) === normalized(name))) {
        update([...breakdown.categories, { id: createBreakdownId('category'), name, items: [] }]);
      }
    } else {
      const changes: Record<string, SceneBreakdown> = {};
      for (const target of scenes) {
        const targetBreakdown = breakdowns[target.id];
        if (!targetBreakdown || targetBreakdown.categories.some(category => normalized(category.name) === normalized(name))) continue;
        changes[target.id] = { categories: [...targetBreakdown.categories, { id: createBreakdownId('category'), name, items: [] }] };
      }
      if (Object.keys(changes).length) onChangeMany(changes);
    }
    setNewCategory('');
    setAddingCategory(false);
  }

  function closeCategory(category: BreakdownCategory, scope: 'scene' | 'project'): void {
    if (!scene || !breakdown) return;
    if (scope === 'scene') update(breakdown.categories.filter(value => value.id !== category.id));
    else {
      const categoryKey = normalized(category.name);
      const changes: Record<string, SceneBreakdown> = {};
      for (const target of scenes) {
        const targetBreakdown = breakdowns[target.id];
        if (!targetBreakdown) continue;
        const categories = targetBreakdown.categories.filter(value => normalized(value.name) !== categoryKey);
        if (categories.length !== targetBreakdown.categories.length) changes[target.id] = { categories };
      }
      if (Object.keys(changes).length) onChangeMany(changes);
    }
    setCategoryCloseMenuId(null);
  }

  function suggestedAppearance(categoryName: string, itemName: string): Pick<BreakdownItem, 'hue' | 'secondaryHue'> {
    const categoryKey = normalized(categoryName);
    const itemKey = normalized(itemName);
    for (const value of Object.values(breakdowns)) {
      const match = value.categories.find(category => normalized(category.name) === categoryKey)?.items
        .find(item => normalized(item.name) === itemKey);
      if (match) return { hue: match.hue, secondaryHue: match.secondaryHue };
    }
    return { hue: null, secondaryHue: null };
  }

  function addItem(category: BreakdownCategory, suggestion?: BreakdownItem, explicitName?: string, continueEditing = true): void {
    if (!scene || !breakdown) {
      if (!continueEditing) setItemDraft(null);
      return;
    }
    const name = (explicitName ?? suggestion?.name ?? itemDraft?.text ?? '').trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (!name || category.items.some(item => normalized(item.name) === normalized(name))) {
      if (!continueEditing) setItemDraft(null);
      return;
    }
    let appearance = suggestion
      ? { hue: suggestion.hue, secondaryHue: suggestion.secondaryHue }
      : suggestedAppearance(category.name, name);
    if (autoColorEnabled && appearance.hue === null) appearance = getNextAutomaticBreakdownAppearance(breakdowns);

    const categoryKey = normalized(category.name);
    const itemKey = normalized(name);
    const changes: Record<string, SceneBreakdown> = {};
    for (const [candidateSceneId, candidateBreakdown] of Object.entries(breakdowns)) {
      let changed = false;
      const categories = candidateBreakdown.categories.map(candidateCategory => {
        let items = candidateCategory.items;
        if (normalized(candidateCategory.name) === categoryKey && appearance.hue !== null) {
          items = items.map(item => {
            if (normalized(item.name) !== itemKey) return item;
            changed = true;
            return { ...item, ...appearance };
          });
        }
        if (candidateSceneId === scene.id && candidateCategory.id === category.id) {
          items = [...items, { id: createBreakdownId('item'), name, ...appearance }];
          changed = true;
        }
        return changed ? { ...candidateCategory, items } : candidateCategory;
      });
      if (changed) changes[candidateSceneId] = { categories };
    }
    if (Object.keys(changes).length) onChangeMany(changes);
    setItemDraft(draft => continueEditing && draft
      ? { ...draft, categoryId: category.id, text: '', selected: 0 }
      : null);
  }

  function validateItemDraftOnBlur(event: React.FocusEvent<HTMLInputElement>, category: BreakdownCategory): void {
    if (event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) return;
    const value = itemDraft?.categoryId === category.id ? itemDraft.text : event.currentTarget.value;
    if (value.trim()) addItem(category, undefined, value, false);
    else setItemDraft(null);
  }

  function updateItemDraft(input: HTMLInputElement, categoryId: string, text: string, selected = 0): void {
    setItemDraft({ categoryId, text, selected, ...smartTypePosition(input) });
  }

  function handleItemKeys(event: KeyboardEvent<HTMLInputElement>, category: BreakdownCategory): void {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setItemDraft(draft => draft ? { ...draft, selected: (draft.selected + 1) % suggestions.length } : draft);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setItemDraft(draft => draft ? { ...draft, selected: (draft.selected - 1 + suggestions.length) % suggestions.length } : draft);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && itemDraft) {
      const suggestion = suggestions[itemDraft.selected];
      if (suggestion || itemDraft.text.trim()) {
        event.preventDefault();
        if (suggestion) addItem(category, suggestion);
        else addItem(category);
      }
    } else if (event.key === 'Escape') setItemDraft(null);
  }

  function renameItem(categoryId: string, itemId: string, name: string): void {
    const cleaned = name.trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (!cleaned) return;
    replaceCategory(categoryId, category => {
      if (category.items.some(item => item.id !== itemId && normalized(item.name) === normalized(cleaned))) return category;
      return { ...category, items: category.items.map(item => item.id === itemId ? { ...item, name: cleaned } : item) };
    });
  }

  function updateItemColor(categoryId: string, itemId: string, changes: Partial<Pick<BreakdownItem, 'hue' | 'secondaryHue'>>): void {
    const sourceCategory = breakdown?.categories.find(category => category.id === categoryId);
    const sourceItem = sourceCategory?.items.find(item => item.id === itemId);
    if (!sourceCategory || !sourceItem) return;
    const categoryKey = normalized(sourceCategory.name);
    const itemKey = normalized(sourceItem.name);
    const projectChanges: Record<string, SceneBreakdown> = {};
    for (const candidate of scenes) {
      const candidateBreakdown = breakdowns[candidate.id];
      if (!candidateBreakdown) continue;
      let changed = false;
      const categories = candidateBreakdown.categories.map(category => {
        if (normalized(category.name) !== categoryKey) return category;
        const items = category.items.map(item => {
          if (normalized(item.name) !== itemKey) return item;
          changed = true;
          return { ...item, ...changes };
        });
        return changed ? { ...category, items } : category;
      });
      if (changed) projectChanges[candidate.id] = { categories };
    }
    if (Object.keys(projectChanges).length) onChangeMany(projectChanges);
  }

  function removeItem(categoryId: string, itemId: string): void {
    replaceCategory(categoryId, category => ({ ...category, items: category.items.filter(item => item.id !== itemId) }));
    setColorEditor(value => value?.itemId === itemId ? null : value);
  }

  function dropCategory(event: DragEvent, boundary: number): void {
    event.preventDefault();
    if (!breakdown || !draggedCategoryId) return;
    const source = breakdown.categories.findIndex(category => category.id === draggedCategoryId);
    if (source < 0) return;
    const categories = [...breakdown.categories];
    const [moved] = categories.splice(source, 1);
    categories.splice(boundary > source ? boundary - 1 : boundary, 0, moved);
    update(categories);
    setDraggedCategoryId(null);
    setDropCategoryIndex(null);
  }

  function dropPreviewWords(event: DragEvent, category: BreakdownCategory): void {
    event.preventDefault();
    const label = (event.dataTransfer.getData('text/plain') || draggedPreviewLabel).trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (label) addItem(category, undefined, label);
    setDraggedPreviewLabel('');
    setPreviewSelectionVersion(version => version + 1);
    setWordDropCategoryId(null);
  }

  function updateAutomaticColors(enabled: boolean): void {
    setAutoColorEnabled(enabled);
    try { window.localStorage.setItem(AUTO_COLOR_STORAGE_KEY, String(enabled)); } catch { /* local storage unavailable */ }
    if (enabled) onChangeMany(applyAutomaticBreakdownColors(breakdowns));
  }

  function toggleElementFilter(value: string): void {
    setElementFilters(current => current.includes(value) ? current.filter(item => item !== value) : [...current, value]);
  }

  if (!scenes.length) return <section className="breakdown-workspace">
    <UiEmptyState className="breakdown-empty" title="Aucune scène à dépouiller"
      description="Crée une scène dans le scénario pour commencer sa préparation." />
  </section>;

  const activeFilters = (actFilter === null ? 0 : 1) + elementFilters.length;
  const bottomActionsTarget = window.document.getElementById('workspace-bottom-actions');

  return <section className="breakdown-workspace" aria-label="Dépouillement du scénario" aria-readonly={readOnly}>
    <aside className="breakdown-scene-list" aria-label="Scènes">
      <header><h2>Scènes</h2>{readOnly && <UiReadOnlyNotice />}<span>{filteredScenes.length}/{scenes.length}</span></header>
      <div className="breakdown-scene-tools">
        <div className="breakdown-scene-search-row">
          <UiSearchField className="breakdown-scene-search" label="Rechercher une scène"
            value={sceneQuery} placeholder="Rechercher…" onChange={event => setSceneQuery(event.target.value)}
            onClear={() => setSceneQuery('')} />
          <UiPopover className="breakdown-filter-wrap" open={filtersOpen} onOpenChange={setFiltersOpen}
            contentClassName="ui-option-popover breakdown-filter-panel" ariaLabel="Filtres des scènes"
            trigger={<UiIconButton className={activeFilters ? 'is-active' : ''} label="Filtrer les scènes"
              aria-pressed={activeFilters > 0}>
              <UiIcon name="filter" />{activeFilters > 0 && <span>{activeFilters}</span>}
            </UiIconButton>}>
            <section><h3>Acte</h3><div className="breakdown-filter-acts">
              <UiButton variant="ghost" className={actFilter === null ? 'is-selected' : ''} aria-pressed={actFilter === null} onClick={() => setActFilter(null)}>Tous</UiButton>
              {acts.map(act => <UiButton variant="ghost" className={actFilter === act ? 'is-selected' : ''} aria-pressed={actFilter === act} key={act} onClick={() => setActFilter(act)}>Acte {act}</UiButton>)}
            </div></section>
            <section><h3>Éléments par catégorie</h3>
              {elementFilterGroups.length ? <div className="breakdown-filter-categories">
                {elementFilterGroups.map(group => {
                  const open = expandedFilterCategory === group.key;
                  const selectedCount = group.items.filter(item => elementFilters.includes(item.key)).length;
                  return <div className={open ? 'is-open' : ''} key={group.key}>
                    <UiButton variant="ghost" className="breakdown-filter-category-button" aria-expanded={open}
                      onClick={() => setExpandedFilterCategory(current => current === group.key ? null : group.key)}>
                      <UiIcon name="chevron" /><strong>{group.name}</strong><span>{selectedCount ? `${selectedCount}/` : ''}{group.items.length}</span>
                    </UiButton>
                    {open && <div className="ui-option-list breakdown-filter-elements">
                      {group.items.map(option => <UiButton variant="ghost" className={elementFilters.includes(option.key) ? 'is-selected' : ''} aria-pressed={elementFilters.includes(option.key)}
                        key={option.key} onClick={() => toggleElementFilter(option.key)}>
                        <i style={colorStyle(option)} /><span>{option.item}</span><UiIcon name="check" />
                      </UiButton>)}
                    </div>}
                  </div>;
                })}
              </div> : <p>Aucun élément à filtrer.</p>}
            </section>
            {activeFilters > 0 && <UiButton variant="ghost" className="breakdown-clear-filters" onClick={() => { setActFilter(null); setElementFilters([]); }}>Retirer tous les filtres</UiButton>}
          </UiPopover>
        </div>
        {activeFilters > 0 && <div className="breakdown-filter-chips">
          {actFilter !== null && <UiButton variant="ghost" onClick={() => setActFilter(null)}>Acte {actFilter}<UiIcon name="x" /></UiButton>}
          {elementFilters.map(value => {
            const option = elementFilterOptions.find(candidate => candidate.key === value);
            return option && <UiButton variant="ghost" key={value} onClick={() => toggleElementFilter(value)}>{option.item}<UiIcon name="x" /></UiButton>;
          })}
        </div>}
      </div>
      <div className="breakdown-scene-rows">
        {filteredScenes.map(candidate => <div key={candidate.id}
          className={candidate.id === scene?.id ? 'breakdown-scene-row is-selected' : 'breakdown-scene-row'}>
          <button type="button" className="breakdown-scene-select"
            aria-current={candidate.id === scene?.id ? 'true' : undefined}
            onClick={() => { setSelectedSceneId(candidate.id); setItemDraft(null); setCategoryCloseMenuId(null); setColorEditor(null); }}
            onDoubleClick={() => onOpenScene(candidate.id)}>
            <span>{String(candidate.index + 1).padStart(2, '0')}</span><strong>{candidate.title}</strong>
            <small>{breakdowns[candidate.id]?.categories.reduce((count, category) => count + category.items.length, 0) ?? 0}</small>
          </button>
          <UiIconButton className="breakdown-scene-open" label={`Ouvrir ${candidate.title} dans Scénario`}
            tooltip="Ouvrir dans Scénario" onClick={() => onOpenScene(candidate.id)}><UiIcon name="eye" /></UiIconButton>
        </div>)}
        {!filteredScenes.length && <p className="breakdown-no-results">Aucune scène trouvée.</p>}
      </div>
    </aside>

    <ScenarioScenePreview
      document={scenarioDocument}
      scene={scene}
      readOnly={readOnly}
      clearSelectionSignal={previewSelectionVersion}
      onWordDragStart={setDraggedPreviewLabel}
      onWordDragEnd={() => { setDraggedPreviewLabel(''); setWordDropCategoryId(null); }}
    />

    <main className="breakdown-sheet">
      <div className="breakdown-categories" role="table" aria-label={`Éléments de la scène ${(scene?.index ?? 0) + 1}`}>
        <div className="breakdown-table-head" role="row"><span role="columnheader">Catégorie</span><span role="columnheader">Éléments nécessaires</span></div>
        {breakdown?.categories.map((category, index) => <div key={category.id}
          ref={element => { if (element) categoryElements.current.set(category.id, element); else categoryElements.current.delete(category.id); }}
          className={['breakdown-category', draggedCategoryId === category.id ? 'is-dragging' : '',
            dropCategoryIndex === index ? 'is-drop-before' : '',
            dropCategoryIndex === breakdown.categories.length && index === breakdown.categories.length - 1 ? 'is-drop-after' : '',
            wordDropCategoryId === category.id ? 'is-word-drop-target' : '',
          ].filter(Boolean).join(' ')} role="row"
          onDragEnd={() => { setDraggedCategoryId(null); setDropCategoryIndex(null); setDraggedPreviewLabel(''); setWordDropCategoryId(null); }}
          onDragOver={event => {
            if (draggedPreviewLabel || event.dataTransfer.types.includes(SCENARIO_PREVIEW_WORD_MIME)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
              setWordDropCategoryId(category.id);
              return;
            }
            if (!draggedCategoryId) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            setDropCategoryIndex(event.clientY >= bounds.top + bounds.height / 2 ? index + 1 : index);
          }} onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setWordDropCategoryId(value => value === category.id ? null : value);
          }} onDrop={event => draggedPreviewLabel || event.dataTransfer.types.includes(SCENARIO_PREVIEW_WORD_MIME)
            ? dropPreviewWords(event, category)
            : dropCategory(event, dropCategoryIndex ?? index)}>
          <header role="rowheader">
            <span className="breakdown-drag-handle" aria-hidden="true" draggable={!readOnly}
              onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', category.id); setDraggedCategoryId(category.id); }}>⠿</span>
            <UiInput aria-label="Nom de la catégorie" defaultValue={category.name} disabled={readOnly}
              key={`${scene?.id}-${category.id}-${category.name}`} onBlur={event => renameCategory(category.id, event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            <span>{category.items.length}</span>
            <UiMenu open={categoryCloseMenuId === category.id}
              onOpenChange={open => setCategoryCloseMenuId(open ? category.id : null)}
              align="end" panelClassName="breakdown-category-close-menu" ariaLabel={`Fermer ${category.name}`}
              trigger={<UiIconButton label={`Fermer ${category.name}`} tooltip="Fermer la catégorie" disabled={readOnly}><UiIcon name="x" /></UiIconButton>}>
              <div><strong>Fermer « {category.name} » ?</strong><small>Choisis où la retirer. Ctrl+Z permet de la restaurer.</small></div>
              <UiMenuItem onClick={() => closeCategory(category, 'scene')}>
                <UiIcon name="file" /><span><strong>Cette scène seulement</strong><small>Les autres scènes ne changent pas.</small></span>
              </UiMenuItem>
              <UiMenuItem onClick={() => closeCategory(category, 'project')}>
                <UiIcon name="list" /><span><strong>Toutes les scènes</strong><small>Une seule action, annulable avec Ctrl+Z.</small></span>
              </UiMenuItem>
              <UiMenuItem className="breakdown-category-close-cancel" onClick={() => setCategoryCloseMenuId(null)}>Annuler</UiMenuItem>
            </UiMenu>
          </header>
          <div className="breakdown-items" role="cell">
            {category.items.map((item: BreakdownItem) => <div className="breakdown-item" key={item.id}>
              <UiPopover className="breakdown-color-wrap" align="start"
                open={colorEditor?.categoryId === category.id && colorEditor.itemId === item.id}
                onOpenChange={open => setColorEditor(open ? { categoryId: category.id, itemId: item.id } : null)}
                contentClassName="breakdown-color-editor" ariaLabel={`Couleurs de ${item.name}`}
                trigger={<UiIconButton className="breakdown-color-marker" label={`Modifier les couleurs de ${item.name}`} disabled={readOnly}>
                  <span className="breakdown-color-marker-swatch" style={colorStyle(item)} aria-hidden="true" />
                </UiIconButton>}>
                  <div className="breakdown-color-preview" style={colorStyle(item)} />
                  <label>Couleur centrale<input type="range" min="0" max="360" value={item.hue ?? 210}
                    onChange={event => updateItemColor(category.id, item.id, { hue: Number(event.target.value) })} /></label>
                  {item.secondaryHue !== null ? <label>Couleur du contour<input type="range" min="0" max="360" value={item.secondaryHue}
                    onChange={event => updateItemColor(category.id, item.id, { secondaryHue: Number(event.target.value) })} /></label>
                    : <UiButton variant="ghost" onClick={() => updateItemColor(category.id, item.id, { hue: item.hue ?? 210, secondaryHue: ((item.hue ?? 210) + 180) % 360 })}>Ajouter une couleur de contour</UiButton>}
                  <div><UiButton variant="ghost" disabled={item.hue === null} onClick={() => updateItemColor(category.id, item.id, { hue: null, secondaryHue: null })}>Sans couleur</UiButton>
                    {item.secondaryHue !== null && <UiButton variant="ghost" onClick={() => updateItemColor(category.id, item.id, { secondaryHue: null })}>Retirer le contour</UiButton>}</div>
              </UiPopover>
              <UiInput aria-label={`Élément de ${category.name}`} defaultValue={item.name} disabled={readOnly}
                key={`${scene?.id}-${category.id}-${item.id}-${item.name}`} onBlur={event => renameItem(category.id, item.id, event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
              <UiIconButton label={`Supprimer ${item.name}`} tooltip="Supprimer l’élément" disabled={readOnly}
                onClick={() => removeItem(category.id, item.id)}><UiIcon name="trash" /></UiIconButton>
            </div>)}
            {!readOnly && <div className="breakdown-add-item">
              <UiInput ref={element => { if (element) addItemInputs.current.set(category.id, element); else addItemInputs.current.delete(category.id); }}
                value={itemDraft?.categoryId === category.id ? itemDraft.text : ''} placeholder={`Ajouter dans ${category.name}…`}
                aria-label={`Ajouter un élément dans ${category.name}`}
                onFocus={event => updateItemDraft(event.currentTarget, category.id, itemDraft?.categoryId === category.id ? itemDraft.text : '')}
                onBlur={event => validateItemDraftOnBlur(event, category)}
                onChange={event => updateItemDraft(event.currentTarget, category.id, event.target.value)}
                onClick={event => updateItemDraft(event.currentTarget, category.id, event.currentTarget.value, itemDraft?.selected ?? 0)}
                onKeyUp={event => {
                  if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
                    updateItemDraft(event.currentTarget, category.id, event.currentTarget.value, itemDraft?.selected ?? 0);
                  }
                }}
                onKeyDown={event => handleItemKeys(event, category)} />
              <UiIconButton label={`Ajouter dans ${category.name}`} tooltip="Ajouter l’élément"
                disabled={!itemDraft?.text.trim() || itemDraft.categoryId !== category.id}
                onClick={() => addItem(category)}><UiIcon name="plus" /></UiIconButton>
              {itemDraft?.categoryId === category.id && <div className="smart-type breakdown-smart-type ui-option-popover" role="listbox" aria-label={`Suggestions pour ${category.name}`}
                style={{ left: itemDraft.popupLeft, top: itemDraft.popupTop ?? undefined, bottom: itemDraft.popupBottom ?? undefined, maxHeight: itemDraft.popupMaxHeight }}>
                <div className="smart-type-heading"><span>SMARTTYPE · {category.name}</span><small>{suggestions.length}</small></div>
                {suggestions.length ? suggestions.map((suggestion, suggestionIndex) => <button type="button" role="option" aria-selected={suggestionIndex === itemDraft.selected}
                  className={suggestionIndex === itemDraft.selected ? 'is-selected' : ''} key={normalized(suggestion.name)}
                  onMouseDown={event => event.preventDefault()} onClick={() => addItem(category, suggestion)}>
                  <i style={colorStyle(suggestion)} /><span>{suggestion.name}</span>
                </button>) : <p className="breakdown-smart-type-empty">Aucune autre suggestion pour cette catégorie.</p>}
              </div>}
            </div>}
          </div>
        </div>)}
      </div>
      <footer className="breakdown-add-category" ref={addCategoryRef}>
        {addingCategory ? <>
          <UiInput ref={newCategoryInput} value={newCategory} placeholder="Nom de la catégorie" onChange={event => setNewCategory(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape') setAddingCategory(false); }} />
          <UiButton variant="primary" disabled={!newCategory.trim()} onClick={() => addCategory('scene')}>Ajouter pour cette scène</UiButton>
          <UiButton disabled={!newCategory.trim()} onClick={() => addCategory('project')}>Ajouter pour toutes les scènes</UiButton>
          <UiButton variant="ghost" onClick={() => { setAddingCategory(false); setNewCategory(''); }}>Annuler</UiButton>
        </> : <UiButton variant="ghost" disabled={readOnly} onClick={() => setAddingCategory(true)}><UiIcon name="plus" /> Nouvelle catégorie</UiButton>}
      </footer>
    </main>
    {bottomActionsTarget && createPortal(
      <UiSwitch className="breakdown-auto-color-toggle" checked={autoColorEnabled}
        title="Attribuer automatiquement une couleur unique aux éléments" disabled={readOnly}
        onCheckedChange={updateAutomaticColors}><span>Couleurs auto</span></UiSwitch>,
      bottomActionsTarget,
    )}
  </section>;
}

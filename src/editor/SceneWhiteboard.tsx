import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { UiIcon } from '../ui/UiIcon';
import { UiSelect } from '../ui/UiSelect';
import { UiTextarea } from '../ui/UiTextarea';
import type {
  ScenarioAct,
  ScenarioScene,
  SceneCardColor,
  SceneWhiteboardMetadata,
} from './sceneTimelineModel';
import './sceneWhiteboard.css';

interface SceneWhiteboardProps {
  scenes: ScenarioScene[];
  actCount: number;
  actDescriptions: string[];
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: (sceneId: string) => void;
  onMove: (sceneIds: string[], act: ScenarioAct, destinationBoundary: number) => void;
  onUpdate: (sceneId: string, metadata: SceneWhiteboardMetadata) => boolean;
  onDuplicate: (sceneId: string) => void;
  onDelete: (scene: ScenarioScene) => void;
  onAddScene: (act: ScenarioAct) => void;
  onDeleteAct: (act: ScenarioAct) => void;
  onUpdateActDescription: (act: ScenarioAct, description: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

interface DropTarget {
  act: ScenarioAct;
  boundary: number;
}

interface ContextMenuState {
  sceneId: string;
  x: number;
  y: number;
}

interface EditState {
  sceneId: string;
  title: string;
  summary: string;
  tag: string;
  color: SceneCardColor;
}

interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const COLOR_OPTIONS: Array<{ value: SceneCardColor; label: string }> = [
  { value: '', label: 'Aucune couleur' },
  { value: 'blue', label: 'Bleu' },
  { value: 'red', label: 'Rouge' },
  { value: 'green', label: 'Vert' },
  { value: 'amber', label: 'Jaune' },
  { value: 'orange', label: 'Orange' },
  { value: 'pink', label: 'Rose' },
  { value: 'violet', label: 'Violet' },
  { value: 'turquoise', label: 'Turquoise' },
];

function intersects(a: DOMRect, b: SelectionBox): boolean {
  return a.right >= b.left && a.left <= b.left + b.width
    && a.bottom >= b.top && a.top <= b.top + b.height;
}

function pageLabel(value: number): string {
  if (value <= 0) return '0 p';
  return `≈ ${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} p`;
}

export function SceneWhiteboard({
  scenes,
  actCount,
  actDescriptions,
  readOnly,
  canUndo,
  canRedo,
  onOpen,
  onMove,
  onUpdate,
  onDuplicate,
  onDelete,
  onAddScene,
  onDeleteAct,
  onUpdateActDescription,
  onUndo,
  onRedo,
}: SceneWhiteboardProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editingAct, setEditingAct] = useState<{ act: ScenarioAct; description: string } | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const cardElements = useRef(new Map<string, HTMLElement>());
  const previousPositions = useRef(new Map<string, { left: number; top: number }>());
  const selectionGesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    initial: Set<string>;
  } | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);

  const sceneById = useMemo(() => new Map(scenes.map(scene => [scene.id, scene])), [scenes]);
  const orderKey = useMemo(() => scenes.map(scene => `${scene.id}:${scene.act}`).join('|'), [scenes]);
  const scenesByAct = useMemo(() => {
    const groups: Record<number, ScenarioScene[]> = {};
    for (let act = 1; act <= actCount; act += 1) groups[act] = [];
    for (const scene of scenes) (groups[scene.act] ?? groups[1]).push(scene);
    return groups;
  }, [actCount, scenes]);

  const saveEditing = () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      setEditing(null);
      return;
    }
    if (onUpdate(editing.sceneId, {
      title: editing.title,
      summary: editing.summary,
      tag: editing.tag,
      color: editing.color,
    })) setEditing(null);
  };

  useEffect(() => {
    const existing = new Set(scenes.map(scene => scene.id));
    setSelectedIds(previous => new Set([...previous].filter(id => existing.has(id))));
    if (editing && !existing.has(editing.sceneId)) setEditing(null);
    if (contextMenu && !existing.has(contextMenu.sceneId)) setContextMenu(null);
  }, [contextMenu, editing, scenes]);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => titleInput.current?.focus());
  }, [editing?.sceneId]);

  useEffect(() => {
    const closeContextMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.whiteboard-context-menu')) {
        setContextMenu(null);
      }
    };
    const saveWhenLeavingCard = (event: MouseEvent) => {
      if (!editing || !(event.target instanceof Element)) return;
      if (event.target.closest('.ui-select-panel')) return;
      const editingCard = titleInput.current?.closest('.whiteboard-scene-card');
      if (!editingCard?.contains(event.target)) saveEditing();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (contextMenu) setContextMenu(null);
        else if (editing) setEditing(null);
        return;
      }
      if (
        !editing
        && (event.ctrlKey || event.metaKey)
        && event.key.toLocaleLowerCase('fr-FR') === 'z'
      ) {
        event.preventDefault();
        if (event.shiftKey) {
          if (canRedo) onRedo();
        } else if (canUndo) onUndo();
      }
    };
    document.addEventListener('mousedown', closeContextMenu);
    document.addEventListener('mousedown', saveWhenLeavingCard);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeContextMenu);
      document.removeEventListener('mousedown', saveWhenLeavingCard);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [canRedo, canUndo, contextMenu, editing, onRedo, onUndo, saveEditing]);

  useLayoutEffect(() => {
    const current = new Map<string, { left: number; top: number }>();
    for (const [id, element] of cardElements.current) {
      const rect = element.getBoundingClientRect();
      current.set(id, { left: rect.left, top: rect.top });
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const [id, position] of current) {
        const previous = previousPositions.current.get(id);
        const element = cardElements.current.get(id);
        if (!previous || !element) continue;
        const x = previous.left - position.left;
        const y = previous.top - position.top;
        if (Math.abs(x) > 1 || Math.abs(y) > 1) {
          element.animate(
            [{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }],
            { duration: 190, easing: 'cubic-bezier(.2,0,0,1)' },
          );
        }
      }
    }
    previousPositions.current = current;
  }, [orderKey]);

  const selectScene = (scene: ScenarioScene, additive: boolean, range: boolean) => {
    if (range && selectionAnchor) {
      const anchorIndex = scenes.findIndex(item => item.id === selectionAnchor);
      const targetIndex = scenes.findIndex(item => item.id === scene.id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [from, to] = anchorIndex < targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
        setSelectedIds(previous => {
          const next = additive ? new Set(previous) : new Set<string>();
          scenes.slice(from, to + 1).forEach(item => next.add(item.id));
          return next;
        });
        return;
      }
    }
    setSelectedIds(previous => {
      if (!additive) return new Set([scene.id]);
      const next = new Set(previous);
      if (next.has(scene.id)) next.delete(scene.id);
      else next.add(scene.id);
      return next;
    });
    setSelectionAnchor(scene.id);
  };

  const startEditing = (scene: ScenarioScene) => {
    setContextMenu(null);
    setEditing({
      sceneId: scene.id,
      title: scene.title === 'Scène sans titre' ? '' : scene.title,
      summary: scene.summary,
      tag: scene.tag,
      color: scene.color,
    });
  };

  const clearDrag = () => {
    setDraggedIds([]);
    setDropTarget(null);
  };

  const commitDrop = (event: DragEvent, act: ScenarioAct, boundary: number) => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedIds.length && !readOnly) onMove(draggedIds, act, boundary);
    clearDrag();
  };

  const updateDropTarget = (
    event: DragEvent<HTMLElement>,
    act: ScenarioAct,
    index: number,
  ) => {
    if (!draggedIds.length || readOnly) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({ act, boundary: event.clientY < bounds.top + bounds.height / 2 ? index : index + 1 });
  };

  const autoScrollColumn = (event: DragEvent<HTMLElement>) => {
    const column = event.currentTarget instanceof HTMLOListElement
      ? event.currentTarget
      : event.currentTarget.closest<HTMLOListElement>('ol');
    if (!column) return;
    const bounds = column.getBoundingClientRect();
    const edge = 56;
    if (event.clientY < bounds.top + edge) column.scrollBy({ top: -18 });
    else if (event.clientY > bounds.bottom - edge) column.scrollBy({ top: 18 });
  };

  const beginRectangleSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest('.whiteboard-scene-card, button, input, textarea, select')) return;
    const initial = event.ctrlKey || event.metaKey ? new Set(selectedIds) : new Set<string>();
    selectionGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initial,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedIds(initial);
    setSelectionBox({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
  };

  const updateRectangleSelection = (event: ReactPointerEvent<HTMLElement>) => {
    const gesture = selectionGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const box = {
      left: Math.min(gesture.startX, event.clientX),
      top: Math.min(gesture.startY, event.clientY),
      width: Math.abs(event.clientX - gesture.startX),
      height: Math.abs(event.clientY - gesture.startY),
    };
    setSelectionBox(box);
    const next = new Set(gesture.initial);
    for (const [id, element] of cardElements.current) {
      if (intersects(element.getBoundingClientRect(), box)) next.add(id);
    }
    setSelectedIds(next);
  };

  const endRectangleSelection = (event: ReactPointerEvent<HTMLElement>) => {
    if (selectionGesture.current?.pointerId !== event.pointerId) return;
    selectionGesture.current = null;
    setSelectionBox(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const acts = useMemo(() => Array.from({ length: actCount }, (_, index) => ({
    id: index + 1,
    label: `Acte ${index + 1}`,
    subtitle: actDescriptions[index] ?? '',
  })), [actCount, actDescriptions]);

  return (
    <main className="whiteboard-workspace" aria-label="Whiteboard du scénario">
      <section
        className="scene-whiteboard"
      >
        <div
          className="whiteboard-canvas"
          style={{ gridTemplateColumns: `repeat(${actCount}, minmax(270px, 1fr))` }}
          onPointerDown={beginRectangleSelection}
          onPointerMove={updateRectangleSelection}
          onPointerUp={endRectangleSelection}
          onPointerCancel={endRectangleSelection}
        >
          {acts.map(act => {
            const actScenes = scenesByAct[act.id] ?? [];
            return <section className="whiteboard-column" key={act.id} aria-label={`${act.label}, ${actScenes.length} scènes`}>
              <header>
                <div>
                  <h3>{act.label}</h3>
                  {editingAct?.act === act.id ? (
                    <input
                      className="whiteboard-act-description-input"
                      autoFocus
                      maxLength={64}
                      aria-label={`Description de ${act.label}`}
                      value={editingAct.description}
                      onChange={event => setEditingAct({ act: act.id, description: event.target.value })}
                      onBlur={event => {
                        onUpdateActDescription(act.id, event.currentTarget.value);
                        setEditingAct(null);
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingAct(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      className="whiteboard-act-description"
                      type="button"
                      disabled={readOnly}
                      title={`Modifier la description de ${act.label}`}
                      onClick={() => setEditingAct({ act: act.id, description: act.subtitle })}
                    >{act.subtitle || 'Ajouter une description'}</button>
                  )}
                </div>
                <div className="whiteboard-column-actions">
                  <strong>{actScenes.length}</strong>
                  <button
                    type="button"
                    title={`Supprimer ${act.label}`}
                    aria-label={`Supprimer ${act.label}`}
                    disabled={readOnly || actCount <= 1}
                    onClick={() => onDeleteAct(act.id)}
                  ><UiIcon name="trash" /></button>
                </div>
              </header>
              <ol
                onDragOver={event => {
                  if (!draggedIds.length || readOnly) return;
                  event.preventDefault();
                  autoScrollColumn(event);
                  if (event.target === event.currentTarget) setDropTarget({ act: act.id, boundary: actScenes.length });
                }}
                onDrop={event => commitDrop(event, act.id, dropTarget?.act === act.id ? dropTarget.boundary : actScenes.length)}
              >
                {actScenes.map((scene, index) => {
                  const isSelected = selectedIds.has(scene.id);
                  const isEditing = editing?.sceneId === scene.id;
                  const dropBefore = dropTarget?.act === act.id && dropTarget.boundary === index;
                  const dropAfter = dropTarget?.act === act.id && dropTarget.boundary === index + 1 && index === actScenes.length - 1;
                  return <Fragment key={scene.id}>
                    <li
                      ref={element => {
                        if (element) cardElements.current.set(scene.id, element);
                        else cardElements.current.delete(scene.id);
                      }}
                      className={[
                        'whiteboard-scene-card',
                        isSelected ? 'is-selected' : '',
                        draggedIds.includes(scene.id) ? 'is-dragging' : '',
                        dropBefore ? 'is-drop-before' : '',
                        dropAfter ? 'is-drop-after' : '',
                        scene.color ? `has-color-${scene.color}` : '',
                      ].filter(Boolean).join(' ')}
                      draggable={!readOnly && !isEditing}
                      onClick={event => {
                        if (isEditing) return;
                        selectScene(scene, event.ctrlKey || event.metaKey, event.shiftKey);
                      }}
                      onDoubleClick={event => {
                        if (isEditing) return;
                        event.preventDefault();
                        onOpen(scene.id);
                      }}
                      onContextMenu={event => {
                        event.preventDefault();
                        if (!isSelected) {
                          setSelectedIds(new Set([scene.id]));
                          setSelectionAnchor(scene.id);
                        }
                        setContextMenu({ sceneId: scene.id, x: event.clientX, y: event.clientY });
                      }}
                      onDragStart={event => {
                        if (readOnly || isEditing) { event.preventDefault(); return; }
                        const ids = isSelected
                          ? scenes.filter(item => selectedIds.has(item.id)).map(item => item.id)
                          : [scene.id];
                        if (!isSelected) {
                          setSelectedIds(new Set([scene.id]));
                          setSelectionAnchor(scene.id);
                        }
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData('text/plain', ids.join(','));
                        setDraggedIds(ids);
                      }}
                      onDragOver={event => {
                        autoScrollColumn(event);
                        updateDropTarget(event, act.id, index);
                      }}
                      onDrop={event => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        commitDrop(event, act.id, event.clientY < bounds.top + bounds.height / 2 ? index : index + 1);
                      }}
                      onDragEnd={clearDrag}
                    >
                      {isEditing && editing ? (
                        <form className="whiteboard-card-editor" onSubmit={event => { event.preventDefault(); saveEditing(); }}>
                          <label>
                            <span>Titre de scène</span>
                            <input
                              ref={titleInput}
                              value={editing.title}
                              onChange={event => setEditing(current => current ? { ...current, title: event.target.value } : current)}
                            />
                          </label>
                          <label>
                            <span>Résumé</span>
                            <UiTextarea
                              rows={3}
                              value={editing.summary}
                              onChange={event => setEditing(current => current ? { ...current, summary: event.target.value } : current)}
                            />
                          </label>
                          <div className="whiteboard-card-editor-row">
                            <label>
                              <span>Tag</span>
                              <input
                                maxLength={28}
                                placeholder="Ex. Intrigue B"
                                value={editing.tag}
                                onChange={event => setEditing(current => current ? { ...current, tag: event.target.value } : current)}
                              />
                            </label>
                            <label>
                              <span>Couleur</span>
                              <UiSelect
                                className="whiteboard-color-select"
                                aria-label="Couleur de la carte"
                                value={editing.color}
                                onChange={event => setEditing(current => current ? { ...current, color: event.target.value as SceneCardColor } : current)}
                              >
                                {COLOR_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </UiSelect>
                            </label>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div className="whiteboard-card-topline">
                            <span className="whiteboard-scene-number">{String(scene.index + 1).padStart(2, '0')}</span>
                            <h4 title={scene.title}>{scene.title}</h4>
                            {scene.tag && <span className="whiteboard-scene-tag">{scene.tag}</span>}
                            <span className="whiteboard-scene-pages">{pageLabel(scene.estimatedPages)}</span>
                          </div>
                          <p className={scene.summary ? '' : 'is-empty'}>{scene.summary || 'Ajouter un résumé…'}</p>
                          <div className="whiteboard-card-actions" aria-label={`Actions pour la scène ${scene.index + 1}`}>
                            <button type="button" title="Ouvrir dans le scénario" aria-label="Ouvrir dans le scénario" onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(scene.id); }}><UiIcon name="eye" /></button>
                            <button type="button" title="Éditer" aria-label="Éditer" disabled={readOnly} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); startEditing(scene); }}><UiIcon name="edit" /></button>
                            <button type="button" title="Dupliquer" aria-label="Dupliquer" disabled={readOnly} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onDuplicate(scene.id); }}><UiIcon name="duplicate" /></button>
                            <button className="is-danger" type="button" title="Supprimer" aria-label="Supprimer" disabled={readOnly} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onDelete(scene); }}><UiIcon name="trash" /></button>
                          </div>
                        </>
                      )}
                    </li>
                  </Fragment>;
                })}
                {actScenes.length === 0 && <li className="whiteboard-column-empty">Glisse une scène dans cet acte.</li>}
                <li className={`whiteboard-drop-tail${dropTarget?.act === act.id && dropTarget.boundary === actScenes.length ? ' is-active' : ''}`} aria-hidden="true" />
              </ol>
              <button className="whiteboard-add-scene" type="button" disabled={readOnly}
                onClick={() => onAddScene(act.id)}><UiIcon name="plus" /> Ajouter une scène</button>
            </section>;
          })}
          {selectionBox && <div className="whiteboard-selection-box" style={selectionBox} aria-hidden="true" />}
        </div>

        {contextMenu && (() => {
          const scene = sceneById.get(contextMenu.sceneId);
          if (!scene) return null;
          return <div
            className="whiteboard-context-menu"
            role="menu"
            aria-label={`Actions pour ${scene.title}`}
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 250) }}
            onMouseDown={event => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => { setContextMenu(null); onOpen(scene.id); }}>Ouvrir dans le scénario</button>
            <button type="button" role="menuitem" disabled={readOnly} onClick={() => startEditing(scene)}>Éditer</button>
            <button type="button" role="menuitem" disabled={readOnly} onClick={() => { setContextMenu(null); onDuplicate(scene.id); }}>Dupliquer</button>
            <hr />
            <button className="is-danger" type="button" role="menuitem" disabled={readOnly} onClick={() => { setContextMenu(null); onDelete(scene); }}>Supprimer la scène</button>
          </div>;
        })()}
      </section>
    </main>
  );
}

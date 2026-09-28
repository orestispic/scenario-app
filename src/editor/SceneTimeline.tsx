import { Fragment, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { UiIcon } from '../ui/UiIcon';
import { UiEmptyState, UiIconButton, UiPanel } from '../ui';
import type { ScenarioScene } from './sceneTimelineModel';

interface SceneTimelineProps {
  scenes: ScenarioScene[];
  activeSceneId: string | null;
  readOnly: boolean;
  onNavigate: (sceneId: string) => void;
  onMove: (sceneId: string, destinationBoundary: number) => void;
  onDelete: (scene: ScenarioScene) => void;
}

export function SceneTimeline({
  scenes,
  activeSceneId,
  readOnly,
  onNavigate,
  onMove,
  onDelete,
}: SceneTimelineProps) {
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);
  const [dropBoundary, setDropBoundary] = useState<number | null>(null);
  const itemElements = useRef(new Map<string, HTMLLIElement>());
  const previousPositions = useRef(new Map<string, number>());
  const orderKey = useMemo(() => scenes.map(scene => scene.id).join('|'), [scenes]);

  useLayoutEffect(() => {
    const current = new Map<string, number>();
    for (const [id, element] of itemElements.current) current.set(id, element.getBoundingClientRect().top);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const [id, top] of current) {
        const previous = previousPositions.current.get(id);
        if (previous !== undefined && Math.abs(previous - top) > 1) {
          itemElements.current.get(id)?.animate(
            [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
            { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' },
          );
        }
      }
    }
    previousPositions.current = current;
  }, [orderKey]);

  const clearDrag = () => {
    setDraggedSceneId(null);
    setDropBoundary(null);
  };

  const updateDropBoundary = (event: DragEvent<HTMLLIElement>, index: number) => {
    if (!draggedSceneId || readOnly) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropBoundary(event.clientY < bounds.top + bounds.height / 2 ? index : index + 1);
  };

  const commitDrop = (event: DragEvent, boundary: number) => {
    event.preventDefault();
    if (draggedSceneId && !readOnly) onMove(draggedSceneId, boundary);
    clearDrag();
  };

  return (
    <UiPanel className="scene-timeline" aria-label="Timeline des scènes" title={<>
      <div><h2>Timeline</h2></div>
      <span className="scene-timeline-count" aria-label={`${scenes.length} scènes`}>{scenes.length}</span>
    </>}>
      {scenes.length === 0 ? (
        <UiEmptyState className="scene-timeline-empty" title="Aucune scène"
          description="Crée un titre de scène pour commencer la timeline." />
      ) : (
        <ol onDragOver={event => {
          if (event.target === event.currentTarget && draggedSceneId) {
            event.preventDefault();
            setDropBoundary(scenes.length);
          }
        }} onDrop={event => commitDrop(event, scenes.length)}>
          {scenes.map((scene, index) => <Fragment key={scene.id}>
            {((index === 0 && scene.act > 1) || (index > 0 && scenes[index - 1].act !== scene.act)) && (
              <li className="scene-timeline-act-separator" aria-label={`Début de l’acte ${scene.act}`}>
                <span>Acte {scene.act}</span>
              </li>
            )}
            <li
              ref={element => {
                if (element) itemElements.current.set(scene.id, element);
                else itemElements.current.delete(scene.id);
              }}
              data-scene-id={scene.id}
              className={[
                activeSceneId === scene.id ? 'is-active' : '',
                draggedSceneId === scene.id ? 'is-dragging' : '',
                dropBoundary === index ? 'is-drop-before' : '',
              ].filter(Boolean).join(' ')}
              draggable={!readOnly}
              onDragStart={event => {
                if (readOnly) { event.preventDefault(); return; }
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', scene.id);
                setDraggedSceneId(scene.id);
                setDropBoundary(null);
              }}
              onDragOver={event => updateDropBoundary(event, index)}
              onDrop={event => {
                event.stopPropagation();
                const bounds = event.currentTarget.getBoundingClientRect();
                commitDrop(event, event.clientY < bounds.top + bounds.height / 2 ? index : index + 1);
              }}
              onDragEnd={clearDrag}
            >
              <span className="scene-timeline-drag" aria-hidden="true"><UiIcon name="list" /></span>
              <button
                className="scene-timeline-jump"
                type="button"
                aria-current={activeSceneId === scene.id ? 'location' : undefined}
                title={`Aller à la scène ${index + 1} : ${scene.title}`}
                onClick={() => onNavigate(scene.id)}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{scene.title}</strong>
              </button>
              <UiIconButton
                className="scene-timeline-delete"
                draggable={false}
                label={`Supprimer la scène ${index + 1} : ${scene.title}`}
                tooltip="Supprimer la scène"
                disabled={readOnly}
                onClick={event => { event.stopPropagation(); onDelete(scene); }}
              >
                <UiIcon name="trash" />
              </UiIconButton>
            </li>
          </Fragment>)}
          <li
            className={`scene-timeline-tail${dropBoundary === scenes.length ? ' is-drop-target' : ''}`}
            aria-hidden="true"
            onDragOver={event => {
              if (!draggedSceneId || readOnly) return;
              event.preventDefault();
              setDropBoundary(scenes.length);
            }}
            onDrop={event => commitDrop(event, scenes.length)}
          />
        </ol>
      )}
      {readOnly && scenes.length > 0 && <p className="scene-timeline-readonly">Lecture seule</p>}
    </UiPanel>
  );
}

import {
  useEffect, useMemo, useRef, useState,
  type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { getScenarioScenePreviewBlocks, type ScenarioScene } from './sceneTimelineModel';
import { UiIconButton } from '../ui';

interface PreviewWord {
  key: string;
  text: string;
  order: number;
}

interface ScenarioScenePreviewProps {
  document: ProseMirrorNode;
  scene: ScenarioScene | null;
  readOnly: boolean;
  showSceneNumber?: boolean;
  clearSelectionSignal?: number;
  onWordDragStart?: (label: string) => void;
  onWordDragEnd?: () => void;
}

export const SCENARIO_PREVIEW_WORD_MIME = 'application/x-senario-breakdown-words';
const PREVIEW_ZOOM_MIN = 60;
const PREVIEW_ZOOM_MAX = 160;
const PREVIEW_ZOOM_STEP = 10;

export function scenarioPreviewZoomAfterWheel(currentZoom: number, deltaY: number): number {
  const direction = deltaY < 0 ? PREVIEW_ZOOM_STEP : deltaY > 0 ? -PREVIEW_ZOOM_STEP : 0;
  return Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, currentZoom + direction));
}

function splitPreviewText(blockId: string, text: string, startOrder: number): Array<PreviewWord & { whitespace: boolean }> {
  let order = startOrder;
  return (text.match(/\s+|[^\s]+/gu) ?? []).map((part, index) => ({
    key: `${blockId}:${index}`,
    text: part,
    whitespace: /^\s+$/u.test(part),
    order: order++,
  }));
}

function cleanDroppedWords(words: PreviewWord[]): string {
  return words
    .sort((left, right) => left.order - right.order)
    .map(word => word.text.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, ''))
    .filter(Boolean)
    .join(' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .slice(0, 120);
}

export function ScenarioScenePreview({
  document: scenarioDocument,
  scene,
  readOnly,
  showSceneNumber = false,
  clearSelectionSignal = 0,
  onWordDragStart,
  onWordDragEnd,
}: ScenarioScenePreviewProps) {
  const [selectedPreviewWordKeys, setSelectedPreviewWordKeys] = useState<string[]>([]);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewSweepSelecting, setPreviewSweepSelecting] = useState(false);
  const previewSweepActive = useRef(false);
  const previewBlocks = useMemo(() => scene
    ? getScenarioScenePreviewBlocks(scenarioDocument, scene.id)
    : [], [scenarioDocument, scene]);
  const previewTokens = useMemo(() => {
    let order = 0;
    return previewBlocks.map(block => {
      const tokens = splitPreviewText(block.id, block.text, order);
      order += tokens.length;
      return { ...block, tokens };
    });
  }, [previewBlocks]);
  const previewWords = useMemo(() => previewTokens.flatMap(block => block.tokens)
    .filter(token => !token.whitespace), [previewTokens]);

  useEffect(() => {
    setSelectedPreviewWordKeys([]);
    setPreviewSweepSelecting(false);
    previewSweepActive.current = false;
    onWordDragEnd?.();
  }, [clearSelectionSignal, scene?.id]);

  useEffect(() => {
    const stopSweep = () => {
      previewSweepActive.current = false;
      setPreviewSweepSelecting(false);
    };
    window.addEventListener('pointerup', stopSweep);
    window.addEventListener('blur', stopSweep);
    return () => {
      window.removeEventListener('pointerup', stopSweep);
      window.removeEventListener('blur', stopSweep);
    };
  }, []);

  function changePreviewZoom(delta: number): void {
    setPreviewZoom(value => Math.max(PREVIEW_ZOOM_MIN, Math.min(PREVIEW_ZOOM_MAX, value + delta)));
  }

  function handlePreviewWheel(event: ReactWheelEvent<HTMLElement>): void {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setPreviewZoom(value => scenarioPreviewZoomAfterWheel(value, event.deltaY));
  }

  function handlePreviewWordClick(event: MouseEvent<HTMLSpanElement>, wordKey: string): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      return;
    }
    if (!selectedPreviewWordKeys.includes(wordKey)) setSelectedPreviewWordKeys([]);
  }

  function addPreviewWordToSelection(wordKey: string): void {
    setSelectedPreviewWordKeys(current => current.includes(wordKey) ? current : [...current, wordKey]);
  }

  function beginPreviewWordSweep(event: ReactPointerEvent<HTMLSpanElement>, wordKey: string): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    previewSweepActive.current = true;
    setPreviewSweepSelecting(true);
    addPreviewWordToSelection(wordKey);
  }

  function extendPreviewWordSweep(event: ReactPointerEvent<HTMLSpanElement>, wordKey: string): void {
    if (!previewSweepActive.current || event.buttons !== 1) return;
    event.preventDefault();
    addPreviewWordToSelection(wordKey);
  }

  function startPreviewWordDrag(event: DragEvent<HTMLSpanElement>, wordKey: string): void {
    if (readOnly || event.ctrlKey || event.metaKey || previewSweepActive.current) {
      event.preventDefault();
      return;
    }
    const keys = selectedPreviewWordKeys.includes(wordKey) ? selectedPreviewWordKeys : [wordKey];
    if (!selectedPreviewWordKeys.includes(wordKey)) setSelectedPreviewWordKeys([]);
    const words = previewWords.filter(word => keys.includes(word.key));
    const label = cleanDroppedWords(words);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(SCENARIO_PREVIEW_WORD_MIME, JSON.stringify(keys));
    event.dataTransfer.setData('text/plain', label);
    onWordDragStart?.(label);
  }

  return <section className="breakdown-scene-preview" aria-label={`Aperçu non éditable de ${scene?.title ?? 'la scène'}`}
    onWheel={handlePreviewWheel}>
    {showSceneNumber && scene && <div className="breakdown-preview-scene-number">SCÈNE {scene.index + 1}</div>}
    <div className="breakdown-preview-actions">
      <div className="breakdown-preview-zoom" aria-label="Zoom de la scène">
        <UiIconButton label="Réduire le zoom" tooltip="Réduire le zoom" disabled={previewZoom <= PREVIEW_ZOOM_MIN}
          onClick={() => changePreviewZoom(-PREVIEW_ZOOM_STEP)}>−</UiIconButton>
        <button type="button" className="breakdown-preview-zoom-value" aria-label={`Réinitialiser le zoom, actuellement ${previewZoom} %`}
          title="Réinitialiser le zoom" onClick={() => setPreviewZoom(100)}>{previewZoom}%</button>
        <UiIconButton label="Agrandir le zoom" tooltip="Agrandir le zoom" disabled={previewZoom >= PREVIEW_ZOOM_MAX}
          onClick={() => changePreviewZoom(PREVIEW_ZOOM_STEP)}>+</UiIconButton>
      </div>
    </div>
    <div className="breakdown-preview-scroll">
      <article className="breakdown-preview-page" aria-readonly="true" data-preview-zoom={previewZoom}
        style={{ zoom: previewZoom / 100 } as CSSProperties} onClick={event => {
        if (event.target === event.currentTarget) setSelectedPreviewWordKeys([]);
      }}>
        {previewTokens.length ? previewTokens.map(block => <p
          key={block.id}
          data-scenario-type={block.type}
          data-scenario-ending={block.ending ? 'true' : undefined}
        >{block.tokens.length ? block.tokens.map(token => token.whitespace ? token.text : <span
          key={token.key}
          className={selectedPreviewWordKeys.includes(token.key) ? 'breakdown-preview-word is-selected' : 'breakdown-preview-word'}
          draggable={!readOnly && !previewSweepSelecting}
          onPointerDown={event => beginPreviewWordSweep(event, token.key)}
          onPointerEnter={event => extendPreviewWordSweep(event, token.key)}
          onClick={event => handlePreviewWordClick(event, token.key)}
          onDragStart={event => startPreviewWordDrag(event, token.key)}
          onDragEnd={() => onWordDragEnd?.()}
        >{token.text}</span>) : '\u00a0'}</p>) : <p className="breakdown-preview-empty">Cette scène ne contient encore aucun texte.</p>}
      </article>
    </div>
  </section>;
}

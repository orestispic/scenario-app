import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { UiIcon } from '../ui/UiIcon';
import { UiButton, UiIconButton, UiMenu, UiMenuItem, UiMenuSeparator, UiProgress } from '../ui';
import { showSenarioMessage } from '../ui/SenarioDialog';
import { AudioIcon } from './AudioIcon';
import { SelectionAudioButton } from './SelectionAudioButton';
import { ReadingController, type VoiceStatus } from './controller';
import { nativeAudio } from './native';
import { audioHighlightKey, createAudioHighlight } from './highlight';
import { buildSpeech, DEFAULT_READING_SETTINGS, type ReadingScope, type SpeechSegment } from './text';
import notices from '../../THIRD_PARTY_NOTICES_AUDIO.txt?raw';
import apacheLicense from '../../licenses/audio/Apache-2.0.txt?raw';
import './audio.css';

const DEFAULT_DOWNLOAD_BYTES = 92_883_356;
const settings = DEFAULT_READING_SETTINGS;

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} Mo`;
}

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]',
  ));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function AudioWorkspace({ editor, screenplayVisible, selectionPosition, documentKey, enabled, onLocked }: {
  editor: Editor | null;
  screenplayVisible: boolean;
  selectionPosition: { left: number; top: number } | null;
  documentKey: string;
  enabled: boolean;
  onLocked: () => void;
}) {
  const [controller] = useState(() => new ReadingController(nativeAudio));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [menu, setMenu] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [download, setDownload] = useState({ received: 0, total: DEFAULT_DOWNLOAD_BYTES, phase: 'download' });
  const [error, setError] = useState('');
  const [selection, setSelection] = useState(false);
  const [following, setFollowing] = useState(true);
  const pending = useRef<SpeechSegment[] | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const active = state.segments[state.index];
  const playing = state.phase === 'playing';

  useEffect(() => () => { controller.stop(); }, [controller]);
  useEffect(() => { controller.stop(); pending.current = null; }, [controller, documentKey]);
  useEffect(() => {
    if (enabled) return;
    controller.stop();
    pending.current = null;
    setMenu(false);
  }, [controller, enabled]);
  useEffect(() => {
    if (!editor) return;
    editor.registerPlugin(createAudioHighlight());
    return () => { if (!editor.isDestroyed) editor.unregisterPlugin(audioHighlightKey); };
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const update = () => setSelection(!editor.state.selection.empty
      && !!editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n').trim());
    const changed = () => {
      if (controller.getSnapshot().phase !== 'idle') controller.stop();
      pending.current = null;
      update();
    };
    editor.on('selectionUpdate', update);
    editor.on('update', changed);
    update();
    return () => { editor.off('selectionUpdate', update); editor.off('update', changed); };
  }, [editor, controller]);
  useEffect(() => {
    if (state.phase === 'missing') {
      pending.current = state.segments;
      setDownloadOpen(true);
    }
  }, [state.phase, state.segments]);
  useEffect(() => {
    if (!downloadOpen) return;
    let cancelled = false;
    void nativeAudio.status()
      .then(value => { if (!cancelled) setStatus(value); })
      .catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [downloadOpen]);
  useEffect(() => {
    if (!downloadOpen && !licenseOpen) return;
    const before = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { before?.focus({ preventScroll: true }); };
  }, [downloadOpen, licenseOpen]);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<typeof download>('audio-download', event => setDownload(event.payload));
    return () => { void unlisten.then(dispose => dispose()); };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (licenseOpen) setLicenseOpen(false);
      if (downloadOpen && !installing) {
        setDownloadOpen(false);
        pending.current = null;
        if (state.phase === 'missing') controller.stop();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [downloadOpen, installing, licenseOpen, controller, state.phase]);

  const follow = () => {
    if (!editor || !active?.blockId) return;
    const element = Array.from(editor.view.dom.querySelectorAll<HTMLElement>('[data-block-id]'))
      .find(node => node.dataset.blockId === active.blockId);
    element?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'center',
    });
  };
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(audioHighlightKey, active?.blockId ?? '').setMeta('addToHistory', false));
    if (following && screenplayVisible && active) follow();
    return () => {
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(audioHighlightKey, '').setMeta('addToHistory', false));
    };
  }, [editor, active, following, screenplayVisible]);
  useEffect(() => {
    if (!editor) return;
    const workspace = editor.view.dom.closest('.workspace');
    const manual = () => { if (controller.getSnapshot().phase !== 'idle') setFollowing(false); };
    workspace?.addEventListener('wheel', manual, { passive: true });
    workspace?.addEventListener('pointerdown', manual);
    workspace?.addEventListener('keydown', manual);
    return () => {
      workspace?.removeEventListener('wheel', manual);
      workspace?.removeEventListener('pointerdown', manual);
      workspace?.removeEventListener('keydown', manual);
    };
  }, [editor, controller]);
  useEffect(() => {
    const shell = editor?.view.dom.closest('.app-shell');
    const visible = !['idle', 'missing'].includes(state.phase);
    shell?.classList.toggle('has-audio-player', visible);
    return () => shell?.classList.remove('has-audio-player');
  }, [editor, state.phase]);

  const start = (scope: ReadingScope) => {
    setMenu(false);
    setError('');
    pending.current = null;
    setFollowing(true);
    if (!enabled) {
      onLocked();
      return;
    }
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const segments = buildSpeech(editor.state.doc, scope, from, to, settings);
    if (!segments.length) {
      void showSenarioMessage({ title: 'Lecture impossible', description: 'Aucun texte ne peut être lu à cet emplacement.' });
      return;
    }
    void controller.start(segments, settings);
  };
  const closeDownload = () => {
    if (installing) return;
    setDownloadOpen(false);
    pending.current = null;
    if (state.phase === 'missing') controller.stop();
  };
  const install = async () => {
    setError('');
    setInstalling(true);
    try {
      await invoke('audio_install');
      const nextStatus = await nativeAudio.status();
      setStatus(nextStatus);
      if (!nextStatus.installed) throw new Error('Le modèle vocal n’a pas pu être installé.');
      const segments = pending.current;
      pending.current = null;
      setDownloadOpen(false);
      if (segments) await controller.start(segments, settings);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setInstalling(false);
    }
  };
  const cancelInstall = async () => {
    if (installing) {
      await invoke('audio_cancel_install').catch(reason => setError(String(reason)));
      return;
    }
    closeDownload();
  };
  const toggleSelection = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selected = buildSpeech(editor.state.doc, 'selection', from, to, settings);
    const same = active?.label === 'Texte sélectionné'
      && selected.length === state.segments.length
      && selected.every((segment, index) => segment.text === state.segments[index].text
        && segment.blockId === state.segments[index].blockId);
    if (same && ['playing', 'paused', 'loading'].includes(state.phase)) void controller.toggle();
    else start('selection');
  };

  const selectionButton = enabled && <SelectionAudioButton
    enabled={selection}
    loading={state.phase === 'loading'}
    playing={active?.label === 'Texte sélectionné' && playing}
    onRead={toggleSelection}
  />;
  const menuSlot = document.getElementById('audio-menu-slot');
  const playerSlot = document.getElementById('audio-player-slot');
  const downloadBytes = status?.downloadBytes || download.total || DEFAULT_DOWNLOAD_BYTES;
  const downloadPercent = download.total > 0 ? Math.floor(download.received / download.total * 100) : 0;

  return <>
    {menuSlot && createPortal(<div className="audio-menu-container"><UiMenu
      open={menu}
      onOpenChange={setMenu}
      panelClassName="audio-menu"
      ariaLabel="Lecture vocale"
      trigger={<UiButton variant="ghost" className="menu-button"
        title={!enabled ? 'Lecture vocale — disponible avec l’offre Auteur' : undefined}
        onMouseDown={event => event.preventDefault()}
        onClick={event => {
          if (enabled) return;
          event.preventDefault();
          onLocked();
        }}><AudioIcon name="audio" />Lecture{!enabled && <span className="studio-feature-badge">Auteur</span>}{enabled && <UiIcon name="down" />}</UiButton>}
    >
      <UiMenuItem disabled={!selection} title={!selection ? 'Sélectionnez du texte à lire' : undefined}
        onMouseDown={event => event.preventDefault()} onClick={() => start('selection')}>Lire le texte sélectionné</UiMenuItem>
      <UiMenuItem onMouseDown={event => event.preventDefault()} onClick={() => start('cursor')}>Lire depuis le curseur</UiMenuItem>
      <UiMenuItem onMouseDown={event => event.preventDefault()} onClick={() => start('scene')}>Lire la scène actuelle</UiMenuItem>
      <UiMenuItem onMouseDown={event => event.preventDefault()} onClick={() => start('all')}>Lire tout le scénario</UiMenuItem>
      <UiMenuSeparator />
      <UiMenuItem onClick={() => setLicenseOpen(true)}>Licence Kokoro</UiMenuItem>
    </UiMenu></div>, menuSlot)}

    {screenplayVisible && selectionPosition && selectionButton && <div className="audio-inline-action" style={{ left: selectionPosition.left + 36, top: selectionPosition.top }}>{selectionButton}</div>}

    {playerSlot && !['idle', 'missing'].includes(state.phase) && createPortal(<section className="audio-player" aria-label="Lecteur audio">
      <div className="audio-transport">
        <UiIconButton label="Passage précédent" tooltip="Passage précédent" disabled={state.index === 0} onClick={() => controller.skip(-1)}><AudioIcon name="previous" /></UiIconButton>
        <UiIconButton label={playing ? 'Mettre en pause' : 'Reprendre la lecture'} tooltip={playing ? 'Mettre en pause' : 'Reprendre la lecture'} disabled={state.phase === 'checking' || state.phase === 'error'} onClick={() => void controller.toggle()}><AudioIcon name={playing ? 'pause' : 'play'} /></UiIconButton>
        <UiIconButton label="Passage suivant" tooltip="Passage suivant" disabled={state.index >= state.segments.length - 1} onClick={() => controller.skip(1)}><AudioIcon name="next" /></UiIconButton>
      </div>
      <div className="audio-player-track">
        <span title={active?.label}>{active?.label}</span>
        {state.phase === 'error'
          ? <span role="alert" className="audio-error">{state.error}</span>
          : <input type="range" min="0" max="1000" value={Math.round(state.progress * 1000)} aria-label="Position dans le passage" onChange={event => controller.seek(Number(event.target.value) / 1000)} />}
      </div>
      <span className="audio-player-status" aria-live="polite">{state.phase === 'loading' || state.phase === 'checking' ? 'Préparation…' : state.phase === 'paused' ? 'En pause' : `${state.index + 1} / ${state.segments.length}`}</span>
      {!following && screenplayVisible && <button type="button" className="audio-follow-button" onClick={() => { setFollowing(true); follow(); }}>Revenir au texte</button>}
      <button type="button" className="audio-stop-button" onClick={controller.stop}>Arrêter la lecture</button>
    </section>, playerSlot)}

    {downloadOpen && <div className="modal-backdrop audio-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeDownload(); }}>
      <section ref={dialogRef} className="audio-modal-panel audio-download-panel" role="dialog" aria-modal="true" aria-labelledby="audio-download-title" onKeyDown={trapDialogFocus}>
        <header>
          <div><h2 id="audio-download-title">Télécharger la voix française</h2><p>Une seule installation, puis la lecture fonctionne hors ligne.</p></div>
          <UiIconButton label="Fermer" tooltip="Fermer" disabled={installing} onClick={closeDownload}><UiIcon name="x" /></UiIconButton>
        </header>
        <div className="audio-download-summary"><AudioIcon name="audio" /><div><strong>Modèle vocal Kokoro · Siwis</strong><span>{formatMegabytes(downloadBytes)} à télécharger</span></div></div>
        <p>Senario a besoin de ce modèle vocal avant la première lecture. Il reste stocké uniquement sur cet appareil.</p>
        {status?.supported === false && <p role="status">Le téléchargement est disponible dans l’application Windows installée.</p>}
        {installing && <div className="audio-download"><UiProgress value={download.received} max={download.total || downloadBytes} aria-label="Téléchargement du modèle vocal" valueText={download.phase === 'verify' ? 'Vérification…' : `${downloadPercent} % téléchargés`} indeterminate={download.phase === 'verify'} /><span>{download.phase === 'verify' ? 'Vérification…' : `${downloadPercent} % · ${formatMegabytes(download.received)} / ${formatMegabytes(download.total)}`}</span></div>}
        {error && <p role="alert" className="audio-error">{error}</p>}
        <footer className="audio-modal-actions">
          <button type="button" onClick={() => void cancelInstall()}>{installing ? 'Annuler le téléchargement' : 'Annuler'}</button>
          {!installing && <button type="button" className="primary-button" disabled={status?.supported === false} onClick={() => void install()}>Télécharger</button>}
        </footer>
      </section>
    </div>}

    {licenseOpen && <div className="modal-backdrop audio-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setLicenseOpen(false); }}>
      <section ref={dialogRef} className="audio-modal-panel audio-license-panel" role="dialog" aria-modal="true" aria-labelledby="audio-license-title" onKeyDown={trapDialogFocus}>
        <header>
          <div><h2 id="audio-license-title">Licence Kokoro</h2><p>Informations légales du moteur vocal local.</p></div>
          <UiIconButton label="Fermer la licence" tooltip="Fermer" onClick={() => setLicenseOpen(false)}><UiIcon name="x" /></UiIconButton>
        </header>
        <div className="audio-license-summary"><strong>Kokoro-82M v1.0</strong><span>Modèle sous licence Apache 2.0 · voix française Siwis avec attribution CC BY 4.0.</span></div>
        <pre className="audio-licenses">{notices}</pre>
        <details className="audio-full-license"><summary>Afficher le texte complet de la licence Apache 2.0</summary><pre>{apacheLicense}</pre></details>
        <footer className="audio-modal-actions"><button type="button" className="primary-button" onClick={() => setLicenseOpen(false)}>Fermer</button></footer>
      </section>
    </div>}
  </>;
}

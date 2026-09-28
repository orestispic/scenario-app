import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { UiContextMenu, UiMenu, UiMenuItem } from '../ui';
import { UiIcon } from '../ui/UiIcon';

export interface ProjectVersionChoice {
  id: string;
  name: string;
}

interface ProjectVersionControlProps {
  versions: ProjectVersionChoice[];
  activeId: string;
  disabled?: boolean;
  canCreate: boolean;
  canRename: boolean;
  canDelete: boolean;
  locked?: boolean;
  title?: string;
  onLocked?: () => void;
  onSelect: (id: string) => Promise<boolean>;
  onDuplicate: () => Promise<boolean>;
  onBlank: () => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}

/** Compact version picker. Creation and management deliberately remain separate:
 * + creates, while a context click manages the exact row that was clicked. */
export function ProjectVersionControl({
  versions,
  activeId,
  disabled = false,
  canCreate,
  canRename,
  canDelete,
  locked = false,
  title,
  onLocked,
  onSelect,
  onDuplicate,
  onBlank,
  onRename,
  onDelete,
}: ProjectVersionControlProps) {
  const listId = useId();
  const selector = useRef<HTMLButtonElement>(null);
  const creator = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const active = versions.find(version => version.id === activeId) ?? versions[0];

  const closeList = () => {
    setListOpen(false);
    setContextMenu(null);
    setRenameId(null);
    setDeleteId(null);
  };

  useLayoutEffect(() => {
    if (!listOpen) return;
    const place = () => {
      const rect = selector.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width + (creator.current?.offsetWidth ?? 0), 230), window.innerWidth - 16);
      const maxHeight = Math.min(336, window.innerHeight - 16);
      const estimated = Math.min(maxHeight, Math.max(44, versions.length * 34 + 12));
      const above = rect.top - 8;
      const below = window.innerHeight - rect.bottom - 8;
      const useAbove = below < estimated && above > below;
      setPosition({
        position: 'fixed',
        width,
        maxHeight: Math.max(64, Math.min(maxHeight, useAbove ? above : below)),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: useAbove ? Math.max(8, rect.top - estimated - 4) : rect.bottom + 4,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [listOpen, versions.length]);

  useEffect(() => {
    if (!listOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (selector.current?.contains(target) || creator.current?.contains(target) || list.current?.contains(target)
        || (target instanceof Element && target.closest('.project-version-context-menu'))) return;
      closeList();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [listOpen]);

  useEffect(() => {
    if (disabled) {
      closeList();
      setCreateOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (renameId) {
      renameInput.current?.focus();
      renameInput.current?.select();
    }
  }, [renameId]);

  function openContext(id: string, x: number, y: number) {
    if (!canRename && !canDelete) return;
    setContextMenu({ id, x, y });
    setRenameId(null);
    setDeleteId(null);
  }

  function handleContextKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openContext(id, rect.left + Math.min(rect.width, 48), rect.bottom);
  }

  async function commitRename() {
    if (!renameId) return;
    const name = renameValue.trim();
    if (!name) {
      renameInput.current?.focus();
      return;
    }
    if (await onRename(renameId, name)) {
      setRenameId(null);
      setContextMenu(null);
    }
  }

  async function runCreate(action: 'duplicate' | 'blank') {
    setCreateOpen(false);
    if (action === 'duplicate') await onDuplicate();
    else await onBlank();
  }

  const portalRoot = document.querySelector('.app-shell') ?? document.body;
  const contextVersion = contextMenu ? versions.find(version => version.id === contextMenu.id) : undefined;
  return <div className="project-version-control" title={title}>
    <button ref={selector} type="button" role="combobox" aria-label={locked ? 'Version — disponible avec l’offre Studio' : 'Version'} aria-expanded={listOpen}
      aria-controls={listId} aria-haspopup="listbox" className="ui-select-trigger version-select-trigger" disabled={disabled}
      data-ui-locked={locked || undefined}
      onClick={() => {
        if (locked) { onLocked?.(); return; }
        setCreateOpen(false);
        if (listOpen) closeList();
        else setListOpen(true);
      }}
      onKeyDown={event => {
        if (locked && ['ArrowDown', 'Enter', ' '].includes(event.key)) { event.preventDefault(); onLocked?.(); return; }
        if (event.key === 'Escape') { closeList(); return; }
        if (['ArrowDown', 'Enter', ' '].includes(event.key) && !listOpen) { event.preventDefault(); setCreateOpen(false); setListOpen(true); }
      }}>
      <span className="version-trigger-label">
        <span>Version : {active?.name ?? 'Version 1'}</span>
        {locked && <span className="studio-feature-badge">Studio</span>}
      </span><UiIcon name="down"/>
    </button>
    <UiMenu open={createOpen} onOpenChange={open => { if (open) closeList(); setCreateOpen(open); }} align="end"
      panelClassName="version-create-menu" ariaLabel="Créer une version"
      trigger={<button ref={creator} type="button" className="version-create-trigger" aria-label={locked ? 'Créer une version — disponible avec l’offre Studio' : 'Créer une version'}
        disabled={disabled || (!canCreate && !locked)} title={locked ? 'Disponible avec l’offre Studio' : 'Créer une version'}
        data-ui-locked={locked || undefined}
        onClick={event => { if (locked) { event.preventDefault(); onLocked?.(); } }}
        onKeyDown={event => { if (locked && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); onLocked?.(); } }}><UiIcon name="plus"/></button>}>
      <UiMenuItem onClick={() => void runCreate('duplicate')}>Dupliquer la version actuelle</UiMenuItem>
      <UiMenuItem onClick={() => void runCreate('blank')}>Nouvelle version vierge</UiMenuItem>
    </UiMenu>

    {listOpen && createPortal(<div ref={list} id={listId} role="listbox" aria-label="Versions du projet"
      className="ui-select-panel project-version-list" style={position}>
      {versions.map(version => <div className="project-version-row" key={version.id}>
        {renameId === version.id ? <form className="project-version-inline-rename" onSubmit={event => { event.preventDefault(); void commitRename(); }}>
          <input ref={renameInput} aria-label={`Nouveau nom de ${version.name}`} value={renameValue} maxLength={80}
            onChange={event => setRenameValue(event.target.value)} onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); setRenameId(null); setContextMenu(null); }
            }}/>
          <button type="submit" aria-label="Enregistrer le nom" title="Enregistrer"><UiIcon name="check"/></button>
          <button type="button" aria-label="Annuler le renommage" title="Annuler" onClick={() => { setRenameId(null); setContextMenu(null); }}><UiIcon name="x"/></button>
        </form> : <button type="button" role="option" aria-selected={version.id === activeId} className="ui-select-option"
          onKeyDown={event => handleContextKey(event, version.id)}
          onContextMenu={event => { event.preventDefault(); openContext(version.id, event.clientX, event.clientY); }}
          onClick={() => { closeList(); if (version.id !== activeId) void onSelect(version.id); }}>
          <span>{version.name}</span>{version.id === activeId && <UiIcon name="check"/>}
        </button>}

        {deleteId === version.id && <div className="project-version-delete-confirmation" role="alert">
          <span>Supprimer « {version.name} » définitivement ?</span>
          <div><button type="button" onClick={() => setDeleteId(null)}>Annuler</button>
            <button type="button" className="is-danger" onClick={async () => {
              if (await onDelete(version.id)) closeList();
            }}>Supprimer</button></div>
        </div>}
      </div>)}
    </div>, portalRoot)}

    <UiContextMenu open={Boolean(contextMenu && contextVersion && !renameId && !deleteId)}
      x={contextMenu?.x ?? 0} y={contextMenu?.y ?? 0} className="project-version-context-menu"
      ariaLabel={contextVersion ? `Actions pour ${contextVersion.name}` : 'Actions de version'}
      onOpenChange={open => { if (!open) setContextMenu(null); }}>
      <UiMenuItem disabled={!canRename} onClick={() => {
        if (!contextVersion) return;
        setRenameValue(contextVersion.name);
        setRenameId(contextVersion.id);
        setContextMenu(null);
      }}>Renommer</UiMenuItem>
      <UiMenuItem className="is-danger" disabled={!canDelete} onClick={() => {
        if (!contextVersion) return;
        setDeleteId(contextVersion.id);
        setContextMenu(null);
      }}>Supprimer</UiMenuItem>
    </UiContextMenu>
  </div>;
}

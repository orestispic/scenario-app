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
  const createMenu = useRef<HTMLDivElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const [listOpen, setListOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [contextId, setContextId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  const [createPosition, setCreatePosition] = useState<CSSProperties>({});
  const active = versions.find(version => version.id === activeId) ?? versions[0];

  const closeList = () => {
    setListOpen(false);
    setContextId(null);
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

  useLayoutEffect(() => {
    if (!createOpen) return;
    const place = () => {
      const rect = creator.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(238, window.innerWidth - 16);
      setCreatePosition({
        position: 'fixed',
        width,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
        top: rect.bottom + 4,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [createOpen]);

  useEffect(() => {
    if (!listOpen && !createOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (selector.current?.contains(target) || creator.current?.contains(target) || list.current?.contains(target) || createMenu.current?.contains(target)) return;
      closeList();
      setCreateOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [listOpen, createOpen]);

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

  function openContext(id: string) {
    if (!canRename && !canDelete) return;
    setContextId(id);
    setRenameId(null);
    setDeleteId(null);
  }

  function handleContextKey(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    openContext(id);
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
      setContextId(null);
    }
  }

  async function runCreate(action: 'duplicate' | 'blank') {
    setCreateOpen(false);
    if (action === 'duplicate') await onDuplicate();
    else await onBlank();
  }

  const portalRoot = document.querySelector('.app-shell') ?? document.body;
  return <div className="project-version-control" title={title}>
    <button ref={selector} type="button" role="combobox" aria-label="Version" aria-expanded={listOpen}
      aria-controls={listId} aria-haspopup="listbox" className="ui-select-trigger version-select-trigger" disabled={disabled}
      onClick={() => {
        setCreateOpen(false);
        if (listOpen) closeList();
        else setListOpen(true);
      }}
      onKeyDown={event => {
        if (event.key === 'Escape') { closeList(); return; }
        if (['ArrowDown', 'Enter', ' '].includes(event.key) && !listOpen) { event.preventDefault(); setCreateOpen(false); setListOpen(true); }
      }}>
      <span className="version-trigger-label">
        <span>Version : {active?.name ?? 'Version 1'}</span>
        {locked && <span className="studio-feature-badge">Studio</span>}
      </span><UiIcon name="down"/>
    </button>
    <button ref={creator} type="button" className="version-create-trigger" aria-label="Créer une version"
      aria-haspopup="menu" aria-expanded={createOpen} disabled={disabled || !canCreate} title={locked ? 'Disponible avec l’offre Studio' : 'Créer une version'}
      onClick={() => { closeList(); setCreateOpen(open => !open); }}><UiIcon name="plus"/></button>

    {listOpen && createPortal(<div ref={list} id={listId} role="listbox" aria-label="Versions du projet"
      className="ui-select-panel project-version-list" style={position}>
      {versions.map(version => <div className="project-version-row" key={version.id}>
        {renameId === version.id ? <form className="project-version-inline-rename" onSubmit={event => { event.preventDefault(); void commitRename(); }}>
          <input ref={renameInput} aria-label={`Nouveau nom de ${version.name}`} value={renameValue} maxLength={80}
            onChange={event => setRenameValue(event.target.value)} onKeyDown={event => {
              if (event.key === 'Escape') { event.preventDefault(); setRenameId(null); setContextId(null); }
            }}/>
          <button type="submit" aria-label="Enregistrer le nom" title="Enregistrer"><UiIcon name="check"/></button>
          <button type="button" aria-label="Annuler le renommage" title="Annuler" onClick={() => { setRenameId(null); setContextId(null); }}><UiIcon name="x"/></button>
        </form> : <button type="button" role="option" aria-selected={version.id === activeId} className="ui-select-option"
          onKeyDown={event => handleContextKey(event, version.id)}
          onContextMenu={event => { event.preventDefault(); openContext(version.id); }}
          onClick={() => { closeList(); if (version.id !== activeId) void onSelect(version.id); }}>
          <span>{version.name}</span>{version.id === activeId && <UiIcon name="check"/>}
        </button>}

        {contextId === version.id && renameId !== version.id && !deleteId && <div className="project-version-context-menu" role="menu" aria-label={`Actions pour ${version.name}`}>
          <button type="button" role="menuitem" disabled={!canRename} onClick={() => {
            setRenameValue(version.name);
            setRenameId(version.id);
            setContextId(null);
          }}>Renommer</button>
          <button type="button" role="menuitem" className="is-danger" disabled={!canDelete} onClick={() => {
            setDeleteId(version.id);
            setContextId(null);
          }}>Supprimer</button>
        </div>}

        {deleteId === version.id && <div className="project-version-delete-confirmation" role="alert">
          <span>Supprimer « {version.name} » définitivement ?</span>
          <div><button type="button" onClick={() => setDeleteId(null)}>Annuler</button>
            <button type="button" className="is-danger" onClick={async () => {
              if (await onDelete(version.id)) closeList();
            }}>Supprimer</button></div>
        </div>}
      </div>)}
    </div>, portalRoot)}

    {createOpen && createPortal(<div ref={createMenu} role="menu" aria-label="Créer une version"
      className="ui-select-panel version-create-menu" style={createPosition}>
      <button type="button" role="menuitem" onClick={() => void runCreate('duplicate')}>Dupliquer la version actuelle</button>
      <button type="button" role="menuitem" onClick={() => void runCreate('blank')}>Nouvelle version vierge</button>
    </div>, portalRoot)}
  </div>;
}

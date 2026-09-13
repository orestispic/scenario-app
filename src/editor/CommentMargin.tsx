import { useLayoutEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { findCommentAnchorPosition, type CommentThread } from './comments';
import { placeMarginNotes } from './documentStatistics';

type Draft = { thread: CommentThread; original: string; text: string };
export function CommentMargin({editor, threads, readOnly, activeId, onActivate, onUpdate, onDelete, zoom}: {
  editor: Editor; threads: CommentThread[]; readOnly: boolean; activeId: string | null; zoom: number;
  onActivate(thread: CommentThread): void;
  onUpdate(id: string, update: (thread: CommentThread) => CommentThread): void;
  onDelete(id: string): void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  // Retain a local draft even if its remote comment is deleted while editing.
  const shown = draft && !threads.some(t => t.id === draft.thread.id) ? [...threads, draft.thread] : threads;
  const current = draft && threads.find(t => t.id === draft.thread.id);
  const changed = Boolean(draft && (!current || current.messages[0]?.text !== draft.original));
  useLayoutEffect(() => {
    const stage = rail.current?.parentElement;
    if (!stage) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (editor.isDestroyed) return;
      const origin = stage.getBoundingClientRect().top;
      const canvas = stage.querySelector('.document-canvas');
      const fallback = Math.max(0, (canvas?.getBoundingClientRect().bottom ?? origin) - origin - 80);
      const cards = [...(rail.current?.querySelectorAll<HTMLElement>('[data-comment-card-id]') ?? [])];
      const placed = placeMarginNotes(shown.map(thread => {
        const anchor = !thread.anchor.lost && findCommentAnchorPosition(editor, thread.anchor);
        const card = cards.find(item => item.dataset.commentCardId === thread.id);
        return { id: thread.id, anchor: anchor ? editor.view.coordsAtPos(anchor.from).top - origin : fallback,
          height: card?.getBoundingClientRect().height ?? 64 };
      }));
      const next = Object.fromEntries(placed.map(item => [item.id,item.top]));
      setPositions(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      stage.style.minHeight = `${placed[placed.length - 1]?.bottom ?? 0}px`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    const document = stage.querySelector('.document-zoom');
    if (document) observer.observe(document);
    rail.current?.querySelectorAll('.margin-note').forEach(card => observer.observe(card));
    editor.on('transaction', schedule);
    window.addEventListener('resize', schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); editor.off('transaction', schedule); window.removeEventListener('resize', schedule); stage.style.minHeight = ''; };
  }, [editor, threads, draft, activeId, zoom]);

  function save() {
    if (!draft || changed || readOnly || !draft.text.trim()) return;
    const saved = draft;
    onUpdate(saved.thread.id, thread => thread.messages[0]?.text !== saved.original ? thread : {
      ...thread, messages: [{ ...thread.messages[0], text: saved.text.trim(), editedAt: new Date().toISOString() }, ...thread.messages.slice(1)],
    });
    setDraft(null);
  }
  return <div className="comment-rail" ref={rail} aria-label="Commentaires dans la marge">
    {shown.map(thread => {
      const editing = draft?.thread.id === thread.id;
      const expanded = activeId === thread.id || editing;
      return <article className={`margin-note ${expanded ? 'is-active' : ''}`} key={thread.id}
        data-comment-card-id={thread.id} style={{top: positions[thread.id] ?? 0, visibility: positions[thread.id] === undefined ? 'hidden' : 'visible'}}>
        <button className="margin-note-hitbox" type="button" aria-expanded={expanded}
          onClick={() => onActivate(thread)}>
          {(thread.anchor.lost || thread.status === 'resolved') && <small>{thread.anchor.lost ? 'Passage introuvable' : 'Commentaire résolu'}</small>}
          <span>{thread.messages[0]?.text}</span>
        </button>
        {expanded && <div className="margin-note-details">
          {thread.messages.slice(1).map(message => <p key={message.id} className="margin-note-reply">{message.text}</p>)}
          {readOnly && <small>Lecture seule</small>}
          {editing ? <form onSubmit={event => {event.preventDefault(); save();}}>
            <label>Modifier le commentaire<textarea autoFocus maxLength={16384} value={draft.text} disabled={readOnly}
              onChange={event => setDraft({...draft,text:event.target.value})} /></label>
            {changed && <p role="alert">Ce commentaire a changé ou a été supprimé. Copiez votre brouillon avant d’annuler.</p>}
            <div className="margin-note-actions"><button type="submit" disabled={readOnly || changed || !draft.text.trim()}>Enregistrer</button><button type="button" onClick={() => setDraft(null)}>Annuler</button></div>
          </form> : !readOnly && <div className="margin-note-actions">
            <button type="button" disabled={Boolean(draft)} onClick={() => setDraft({thread,original:thread.messages[0]?.text ?? '',text:thread.messages[0]?.text ?? ''})}>Modifier</button>
            <button type="button" className="margin-note-delete" disabled={Boolean(draft)} onClick={() => onDelete(thread.id)}>Supprimer</button>
          </div>}
        </div>}
      </article>;
    })}
  </div>;
}

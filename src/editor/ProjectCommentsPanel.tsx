import { useEffect, useRef, useState } from "react";
import { createStableId, type CommentThread } from "./comments";
import "./projectComments.css";

/** Drafts stay local until explicitly submitted; remote updates never erase a draft. */
export function ProjectCommentsPanel({
  threads,
  readOnly,
  onClose,
  onNavigate,
  onUpdate,
  onDelete,
}: {
  threads: CommentThread[];
  readOnly: boolean;
  onClose(): void;
  onNavigate(thread: CommentThread): void;
  onUpdate(id: string, update: (thread: CommentThread) => CommentThread): void;
  onDelete(id: string): void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<{
    id: string;
    kind: "edit" | "reply";
    original: string;
    text: string;
  } | null>(null);
  const current = threads.find((t) => t.id === draft?.id);
  const changed = Boolean(
    draft && (!current || (draft.kind === "edit" && current.messages[0]?.text !== draft.original)),
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  function submit() {
    if (!draft || readOnly || changed || !draft.text.trim()) return;
    const saved = draft,
      now = new Date().toISOString(),
      messageId = createStableId("message");
    onUpdate(saved.id, (thread) => {
      // Recheck against the actual React update state, not the rendered preview.
      if (saved.kind === "edit" && thread.messages[0]?.text !== saved.original) return thread;
      return {
        ...thread,
        messages:
          saved.kind === "reply"
            ? [
                ...thread.messages,
                { id: messageId, text: saved.text.trim(), createdAt: now, editedAt: null },
              ]
            : [
                { ...thread.messages[0], text: saved.text.trim(), editedAt: now },
                ...thread.messages.slice(1),
              ],
      };
    });
    setDraft(null);
  }
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={panel}
        tabIndex={-1}
        className="project-comments-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Commentaires du projet"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !draft) onClose();
          if (event.key === "Tab") {
            const focusable = [
              ...panel.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
              ),
            ];
            const first = focusable[0],
              last = focusable[focusable.length - 1];
            if (
              event.shiftKey &&
              (document.activeElement === first || document.activeElement === panel.current)
            ) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <div>
            <h2>Commentaires</h2>
            <p>Discussions, réponses et commentaires résolus du projet.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(draft)}
            aria-label="Fermer les commentaires"
          >
            ×
          </button>
        </header>
        {readOnly && <p role="status">Lecture seule : vous pouvez consulter les discussions.</p>}
        {!threads.length && (
          <p>
            Sélectionnez du texte dans le scénario, puis cliquez sur la bulle pour ajouter un
            commentaire.
          </p>
        )}
        {threads.map((thread) => (
          <article key={thread.id} data-project-comment={thread.id}>
            <header>
              <strong>
                {thread.status === "resolved" ? "Résolu" : "Discussion ouverte"}
                {thread.anchor.lost ? " · Passage introuvable" : ""}
              </strong>
              <button
                type="button"
                disabled={thread.anchor.lost || Boolean(draft)}
                onClick={() => {
                  onClose();
                  onNavigate(thread);
                }}
              >
                Voir le passage
              </button>
            </header>
            <blockquote>{thread.anchor.originalText}</blockquote>
            {thread.messages.map((message, index) => (
              <p className="project-comment-message" key={message.id}>
                <small>
                  {index === 0 ? "Commentaire" : "Réponse"}
                  {message.editedAt ? " · modifié" : ""}
                </small>
                {message.text}
              </p>
            ))}
            {!readOnly && (
              <footer>
                <button
                  type="button"
                  disabled={Boolean(draft)}
                  onClick={() => setDraft({ id: thread.id, kind: "reply", original: "", text: "" })}
                >
                  Répondre
                </button>
                <button
                  type="button"
                  disabled={Boolean(draft)}
                  onClick={() =>
                    setDraft({
                      id: thread.id,
                      kind: "edit",
                      original: thread.messages[0]?.text ?? "",
                      text: thread.messages[0]?.text ?? "",
                    })
                  }
                >
                  Modifier
                </button>
                <button
                  type="button"
                  disabled={Boolean(draft)}
                  onClick={() =>
                    onUpdate(thread.id, (current) => ({
                      ...current,
                      status: current.status === "open" ? "resolved" : "open",
                      resolvedAt: current.status === "open" ? new Date().toISOString() : null,
                    }))
                  }
                >
                  {thread.status === "open" ? "Résoudre" : "Rouvrir"}
                </button>
                <button type="button" disabled={Boolean(draft)} onClick={() => onDelete(thread.id)}>
                  Supprimer
                </button>
              </footer>
            )}
          </article>
        ))}
        {draft && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label>
              {draft.kind === "reply" ? "Votre réponse" : "Modifier le commentaire"}
              <textarea
                autoFocus
                maxLength={16384}
                disabled={readOnly}
                value={draft.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              />
            </label>
            {changed && (
              <p role="alert">
                Ce commentaire a changé ou a été supprimé ailleurs. Copiez votre brouillon avant
                d’annuler ; aucune modification ne sera écrasée.
              </p>
            )}
            <footer>
              <button type="button" onClick={() => setDraft(null)}>
                Annuler le brouillon
              </button>
              <button type="submit" disabled={readOnly || changed || !draft.text.trim()}>
                Enregistrer
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

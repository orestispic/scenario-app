import { UiIcon } from '../ui/UiIcon';
import { UiButton, UiDialog, UiEmptyState, UiFeedback, UiIconButton, UiPanel, UiTextarea } from '../ui';
import { useState } from "react";
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
      <UiDialog
        open
        onOpenChange={(open) => { if (!open && !draft) onClose(); }}
        className="project-comments-panel"
        backdropClassName="theme-dark"
        bodyClassName="project-comments-body"
        title="Commentaires"
        description="Discussions, réponses et commentaires résolus du projet."
        dismissible={!draft}
        headerAction={<UiIconButton label="Fermer les commentaires" tooltip="Fermer" onClick={onClose} disabled={Boolean(draft)}><UiIcon name="x"/></UiIconButton>}
      >
        {readOnly && <UiFeedback>Lecture seule : vous pouvez consulter les discussions.</UiFeedback>}
        {!threads.length && (
          <UiEmptyState title="Aucun commentaire"
            description="Sélectionnez du texte dans le scénario, puis cliquez sur la bulle pour ajouter un commentaire." />
        )}
        {threads.map((thread) => (
          <UiPanel className="project-comment-thread" key={thread.id} data-project-comment={thread.id}>
            <header>
              <strong>
                {thread.status === "resolved" ? "Résolu" : "Discussion ouverte"}
                {thread.anchor.lost ? " · Passage introuvable" : ""}
              </strong>
              <UiButton
                variant="ghost"
                disabled={thread.anchor.lost || Boolean(draft)}
                onClick={() => {
                  onClose();
                  onNavigate(thread);
                }}
              >
                Voir le passage
              </UiButton>
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
                <UiButton
                  disabled={Boolean(draft)}
                  onClick={() => setDraft({ id: thread.id, kind: "reply", original: "", text: "" })}
                >
                  Répondre
                </UiButton>
                <UiButton
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
                </UiButton>
                <UiButton
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
                </UiButton>
                <UiButton variant="danger" disabled={Boolean(draft)} onClick={() => onDelete(thread.id)}>
                  Supprimer
                </UiButton>
              </footer>
            )}
          </UiPanel>
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
              <UiTextarea
                autoGrow
                autoFocus
                maxLength={16384}
                disabled={readOnly}
                value={draft.text}
                onChange={(event) => setDraft({ ...draft, text: event.target.value })}
              />
            </label>
            {changed && (
              <UiFeedback tone="danger">
                Ce commentaire a changé ou a été supprimé ailleurs. Copiez votre brouillon avant
                d’annuler ; aucune modification ne sera écrasée.
              </UiFeedback>
            )}
            <footer>
              <UiButton onClick={() => setDraft(null)}>
                Annuler le brouillon
              </UiButton>
              <UiButton variant="primary" type="submit" disabled={readOnly || changed || !draft.text.trim()}>
                Enregistrer
              </UiButton>
            </footer>
          </form>
        )}
      </UiDialog>
  );
}

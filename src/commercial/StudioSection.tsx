import { UiSelect } from '../ui/UiSelect';
import { useEffect, useState, type FormEvent } from "react";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import type { ScenarioEditorBridge } from "./collaborationClient";
import { loadStudioBase, selectStudioRoot } from './studioBase';
import {
  collaborationRuntime,
  type RuntimeCollaborationState,
} from "./collaborationRuntime";
import type {
  StudioDetailResponse,
  StudioInvitationView,
  StudioRole,
  StudioSpace,
} from "./contractsV7";

const ROLE_LABEL: Record<StudioRole, string> = {
  owner: "Propriétaire",
  editor: "Éditeur",
  viewer: "Lecture seule",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Actif",
  revoked: "Accès retiré",
  pending: "En attente",
  accepted: "Acceptée",
  declined: "Refusée",
  expired: "Expirée",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function StudioSection({
  apiFactory,
  currentProfileId,
  editorBridge,
}: {
  apiFactory: () => AuthenticatedCommercialApi;
  currentProfileId: string;
  editorBridge?: ScenarioEditorBridge;
}) {
  const [api] = useState(() => apiFactory());
  const [studios, setStudios] = useState<StudioSpace[]>([]);
  const [received, setReceived] = useState<StudioInvitationView[]>([]);
  const [detail, setDetail] = useState<StudioDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [joinConfirmation, setJoinConfirmation] = useState(false);
  const [localCopyConfirmed, setLocalCopyConfirmed] = useState(false);
  const [collaboration, setCollaboration] = useState<RuntimeCollaborationState | null>(null);
  const activeCollaboration =
    collaboration?.studioId === detail?.studio.id ? collaboration : null;

  useEffect(() => collaborationRuntime.subscribe(setCollaboration), []);

  useEffect(() => {
    let active = true;
    api
      .listStudios()
      .then(async (value) => {
        if (!active) return;
        setStudios(value.studios);
        setReceived(value.receivedInvitations);
        if (value.studios[0]) {
          const selected = await api.getStudio(value.studios[0].id);
          if (!active) return;
          setDetail(selected);
        }
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Studio indisponible.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  async function connectEditor() {
    if (!detail || !editorBridge) return;
    const joiningDocument = JSON.stringify(editorBridge.read());
    setBusy(true);
    setMessage("");
    try {
      const versions = await api.listCloudVersions(detail.studio.scenarioId);
      const root = selectStudioRoot(versions.versions, detail.studio.scenarioId);
      if (JSON.stringify(editorBridge.read()) !== joiningDocument)
        throw new Error('Le document local a changé pendant la connexion. Conservez sa nouvelle copie puis réessayez.');
      await collaborationRuntime.connect({
        api,
        studioId: detail.studio.id,
        scenarioId: detail.studio.scenarioId,
        baseVersionId: root.id,
        actorId: currentProfileId,
        editor: editorBridge,
        loadBase: (signal) => loadStudioBase(api, root, signal),
      });
      setMessage("Demande de connexion envoyée.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Canal Studio indisponible.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadRecoveryCopy() {
    const copy = await collaborationRuntime.recoveryCopy();
    if (!copy) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scenario-collaboration-recovery-${copy.scenarioId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function refresh(selectedId = detail?.studio.id) {
    const list = await api.listStudios();
    setStudios(list.studios);
    setReceived(list.receivedInvitations);
    if (selectedId) setDetail(await api.getStudio(selectedId));
  }
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
      setMessage(success);
    } catch (error) {
      const code = (error as { code?: string }).code;
      setMessage(
        code === "invitation_expired"
          ? "Invitation expirée."
          : code === "invitation_not_pending"
            ? "Invitation déjà utilisée ou révoquée."
            : code === "studio_idempotency_conflict"
              ? "Conflit déterministe : rechargez l’état Studio."
              : error instanceof Error
                ? error.message
                : "Studio temporairement indisponible.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    await run(
      () =>
        api.inviteStudioMember(
          detail.studio.id,
          String(data.get("email")),
          String(data.get("role")) as "editor" | "viewer",
          crypto.randomUUID(),
        ),
      "Invitation locale enregistrée.",
    );
    form.reset();
  }

  return (
    <section className="account-license-section studio-section" aria-label="Studios">
      <div className="studio-section-heading">
        <div>
          <h3>Votre Studio</h3>
          <p>Travaillez à plusieurs sur les mêmes scénarios.</p>
        </div>
        {detail && <span className="studio-role-badge">{ROLE_LABEL[detail.studio.role]}</span>}
      </div>

      {loading ? (
        <p>Chargement du Studio…</p>
      ) : studios.length === 0 ? (
        <div className="studio-empty-state">
          <strong>Aucun Studio accessible</strong>
          <span>Une invitation acceptée apparaîtra ici.</span>
        </div>
      ) : studios.length > 1 ? (
        <div className="studio-switcher" role="list" aria-label="Choisir un Studio">
          {studios.map((studio) => (
            <button
              key={studio.id}
              type="button"
              role="listitem"
              className={detail?.studio.id === studio.id ? "is-active" : ""}
              disabled={busy}
              onClick={() =>
                void run(
                  async () => setDetail(await api.getStudio(studio.id)),
                  `${studio.name} ouvert.`,
                )
              }
            >
              <strong>{studio.name}</strong>
              <span>{ROLE_LABEL[studio.role]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {received.length > 0 && (
        <div className="studio-invitations-received">
          <h4>Invitations reçues</h4>
          {received.map((invitation) => (
            <div className="studio-invitation-row" key={invitation.id}>
              <div>
                <strong>{invitation.recipient}</strong>
                <span>{ROLE_LABEL[invitation.role]}</span>
              </div>
              {invitation.developmentToken ? (
                <div className="studio-inline-actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api.acceptStudioInvitation(
                            invitation.developmentToken!,
                            crypto.randomUUID(),
                          ),
                        "Invitation acceptée.",
                      )
                    }
                  >
                    Accepter
                  </button>
                  <button
                    className="studio-text-button"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          api.declineStudioInvitation(
                            invitation.developmentToken!,
                            crypto.randomUUID(),
                          ),
                        "Invitation refusée.",
                      )
                    }
                  >
                    Refuser
                  </button>
                </div>
              ) : (
                <span className="studio-muted">Ouvrez le lien sécurisé reçu par e-mail.</span>
              )}
            </div>
          ))}
        </div>
      )}

      {detail && (
        <div className="studio-detail">
          <div className="studio-summary">
            <div>
              <h4>{detail.studio.name}</h4>
              <p>
                {detail.members.filter((member) => member.status === "active").length} membres ·
                vos changements sont protégés par le serveur
              </p>
            </div>
            <span className="studio-active-indicator">Actif</span>
          </div>

          {editorBridge && (
            <div className="studio-live-card" aria-live="polite">
              <div>
                <strong>Collaboration en direct</strong>
                <span>
                  {activeCollaboration?.status === "online"
                    ? `${activeCollaboration.presence.length} membre(s) présent(s)`
                    : activeCollaboration?.status === "reconnecting"
                      ? "Reconnexion en cours…"
                      : activeCollaboration?.status === "connecting"
                        ? "Connexion en cours…"
                      : activeCollaboration?.status === "read_only"
                        ? "Lecture seule"
                      : activeCollaboration?.status === "recovery_required" || activeCollaboration?.status === "conflict"
                        ? "Récupération nécessaire — texte local conservé"
                      : "Non connectée"}
                </span>
              </div>
              <button
                type="button"
                disabled={
                  busy ||
                  Boolean(activeCollaboration && activeCollaboration.status !== "disconnected")
                }
                onClick={() => { setLocalCopyConfirmed(false); setJoinConfirmation(true); }}
              >
                {activeCollaboration?.status === "reconnecting" ? "Reconnexion…" : activeCollaboration?.status === "online" ? "Connectée" : "Démarrer"}
              </button>
              {joinConfirmation && (!activeCollaboration || activeCollaboration.status === 'disconnected') && (
                <div className="studio-conflict" role="group" aria-label="Rejoindre le scénario partagé">
                  <p>Rejoindre charge le même scénario partagé pour tous. Le contenu actuellement ouvert ne sera pas fusionné automatiquement.</p>
                  <button type="button" onClick={() => editorBridge?.saveLocalCopy?.()}>Télécharger une copie locale (.scenario)</button>
                  <label><input type="checkbox" checked={localCopyConfirmed} onChange={(event) => setLocalCopyConfirmed(event.target.checked)} /> J’ai conservé une copie de mon scénario local.</label>
                  <button type="button" disabled={!localCopyConfirmed || busy} onClick={() => { setJoinConfirmation(false); void connectEditor(); }}>Rejoindre le scénario partagé</button>
                  <button type="button" onClick={() => setJoinConfirmation(false)}>Annuler</button>
                </div>
              )}
              {activeCollaboration && activeCollaboration.status !== "disconnected" && (
                <button type="button" onClick={() => void collaborationRuntime.disconnect()}>
                  Arrêter la collaboration
                </button>
              )}
              {activeCollaboration?.lastErrorCode && (
                <p>Diagnostic : {activeCollaboration.lastErrorCode}
                  {activeCollaboration.requestId ? ` · Référence : ${activeCollaboration.requestId}` : ""}
                </p>
              )}
              {activeCollaboration?.status === "online" && activeCollaboration.syncLag > 0 && (
                <p>{activeCollaboration.syncLag} modification(s) en attente de synchronisation.</p>
              )}
              {activeCollaboration?.status === "read_only" && (
                <p>Votre accès distant est désormais en lecture seule. Le fichier local est intact.</p>
              )}
              {(activeCollaboration?.conflict || activeCollaboration?.status === "recovery_required") && (
                <div className="studio-conflict" role="alert">
                  <p>Un conflit doit être résolu avant de poursuivre.</p>
                  <button type="button" onClick={downloadRecoveryCopy}>
                    Télécharger une copie de récupération
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="studio-members-heading">
            <h4>Membres</h4>
            <span>{detail.members.length}</span>
          </div>
          <div className="studio-members-list">
            {detail.members.map((member) => (
              <div className="studio-member" key={member.profileId}>
                <span className="studio-member-avatar" aria-hidden="true">
                  {initials(member.displayName)}
                </span>
                <div className="studio-member-identity">
                  <strong>
                    {member.displayName}
                    {member.profileId === currentProfileId && <span> (vous)</span>}
                  </strong>
                  <span>
                    {ROLE_LABEL[member.role]} · {STATUS_LABEL[member.status] ?? member.status}
                  </span>
                </div>
                {detail.studio.role === "owner" && member.profileId !== currentProfileId && (
                  <details className="studio-member-menu">
                    <summary>Gérer</summary>
                    <div>
                      <label>
                        Accès
                        <UiSelect
                          aria-label={`Rôle de ${member.displayName}`}
                          value={member.role}
                          disabled={busy}
                          onChange={(event) =>
                            void run(
                              () =>
                                api.changeStudioRole(
                                  detail.studio.id,
                                  member.profileId,
                                  event.target.value as StudioRole,
                                  crypto.randomUUID(),
                                ),
                              "Accès du membre mis à jour.",
                            )
                          }
                        >
                          <option value="viewer">Lecture seule</option>
                          <option value="editor">Éditeur</option>
                          <option value="owner">Propriétaire</option>
                        </UiSelect>
                      </label>
                      <button
                        className="studio-danger-button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api.removeStudioMember(
                                detail.studio.id,
                                member.profileId,
                                crypto.randomUUID(),
                              ),
                            "Membre retiré.",
                          )
                        }
                      >
                        Retirer du Studio
                      </button>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>

          {detail.studio.role === "owner" && (
            <details className="studio-management-panel">
              <summary>Inviter une personne</summary>
              <form className="account-auth-form" onSubmit={(event) => void invite(event)}>
                <label>
                  Adresse e-mail
                  <input name="email" type="email" autoComplete="off" required />
                </label>
                <label>
                  Niveau d’accès
                  <UiSelect aria-label="Rôle demandé" name="role" defaultValue="viewer">
                    <option value="viewer">Lecture seule</option>
                    <option value="editor">Peut modifier</option>
                  </UiSelect>
                </label>
                <button type="submit" disabled={busy}>
                  Envoyer l’invitation
                </button>
              </form>
            </details>
          )}

          {detail.invitations.length > 0 && (
            <details className="studio-management-panel">
              <summary>Historique des invitations ({detail.invitations.length})</summary>
              <div className="studio-invitation-history">
                {detail.invitations.map((invitation) => (
                  <div key={invitation.id}>
                    <span>
                      {invitation.recipient} · {ROLE_LABEL[invitation.role]} ·{" "}
                      {Date.parse(invitation.expiresAt) <= Date.now()
                        ? "Expirée"
                        : (STATUS_LABEL[invitation.status] ?? invitation.status)}
                    </span>
                    {invitation.status === "pending" && detail.studio.role === "owner" && (
                      <button
                        className="studio-text-button"
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () =>
                              api.revokeStudioInvitation(
                                detail.studio.id,
                                invitation.id,
                                crypto.randomUUID(),
                              ),
                            "Invitation révoquée.",
                          )
                        }
                      >
                        Annuler
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      {message && (
        <p className="studio-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

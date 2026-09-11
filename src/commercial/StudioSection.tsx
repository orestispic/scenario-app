import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import {
  StudioCollaborationClient,
  type CollaborationViewState,
  type ScenarioEditorBridge,
} from "./collaborationClient";
import type {
  StudioDetailResponse,
  StudioInvitationView,
  StudioRole,
  StudioSpace,
} from "./contractsV7";

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
  const [collaboration, setCollaboration] = useState<CollaborationViewState | null>(null);
  const collaborationClient = useRef<StudioCollaborationClient | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listStudios()
      .then((value) => {
        if (!active) return;
        setStudios(value.studios);
        setReceived(value.receivedInvitations);
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Studio indisponible.");
        setLoading(false);
      });
    return () => {
      active = false;
      void collaborationClient.current?.disconnect();
      collaborationClient.current = null;
    };
  }, [api]);

  async function connectEditor() {
    if (!detail || !editorBridge) return;
    setBusy(true);
    setMessage("");
    try {
      await collaborationClient.current?.disconnect();
      const versions = await api.listCloudVersions(detail.studio.scenarioId);
      const baseVersionId = versions.versions.reduce(
        (latest, candidate) =>
          !latest || candidate.versionNumber > latest.versionNumber ? candidate : latest,
        versions.versions[0],
      )?.id;
      if (!baseVersionId) throw new Error("Aucune version cloud de base n’est disponible.");
      const client = new StudioCollaborationClient(
        api,
        detail.studio.id,
        detail.studio.scenarioId,
        baseVersionId,
        currentProfileId,
        editorBridge,
      );
      collaborationClient.current = client;
      client.subscribe(setCollaboration);
      await client.connect();
      setMessage("Éditeur relié au canal Studio.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Canal Studio indisponible.");
    } finally {
      setBusy(false);
    }
  }

  function downloadRecoveryCopy() {
    const copy = collaborationClient.current?.recoveryCopy();
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
    <section className="account-license-section" aria-label="Studios">
      <h3>Studios</h3>
      {loading ? (
        <p>Chargement des Studios…</p>
      ) : studios.length === 0 ? (
        <p>Aucun Studio accessible.</p>
      ) : (
        <ul>
          {studios.map((studio) => (
            <li key={studio.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(
                    async () => setDetail(await api.getStudio(studio.id)),
                    "Studio actualisé.",
                  )
                }
              >
                {studio.name}
              </button>
              {" — "}
              {studio.role} · révision {studio.revision}
            </li>
          ))}
        </ul>
      )}
      {received.length > 0 && (
        <div>
          <h4>Invitations reçues</h4>
          <ul>
            {received.map((invitation) => (
              <li key={invitation.id}>
                {invitation.recipient} —{" "}
                {Date.parse(invitation.expiresAt) <= Date.now() ? "expirée" : invitation.status}
                {invitation.developmentToken ? (
                  <>
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
                  </>
                ) : (
                  <span> — action disponible depuis la notification sécurisée</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail && (
        <div>
          <h4>{detail.studio.name}</h4>
          <p>
            Rôle courant : {detail.studio.role}. Les changements sont toujours autorisés par le
            serveur.
          </p>
          {editorBridge && (
            <div className="studio-collaboration-status" aria-live="polite">
              <button type="button" disabled={busy || collaboration?.status === "online"} onClick={() => void connectEditor()}>
                {collaboration?.status === "reconnecting" ? "Reconnexion…" : "Relier l’éditeur en temps réel"}
              </button>
              {collaboration && (
                <p>
                  Connexion : {collaboration.status} · membres présents : {collaboration.presence.length} · retard : {collaboration.syncLag} événement(s)
                </p>
              )}
              {collaboration?.status === "read_only" && <p>Accès révoqué : l’éditeur distant est en lecture seule. Le fichier local reste intact.</p>}
              {collaboration?.conflict && (
                <div role="alert">
                  <p>Conflit explicite : {collaboration.conflict.reason}. Aucune version n’a été écrasée silencieusement.</p>
                  <button type="button" onClick={downloadRecoveryCopy}>Télécharger une copie locale de récupération</button>
                </div>
              )}
              {collaboration?.presence.length ? (
                <ul aria-label="Membres présents">
                  {collaboration.presence.map((member) => <li key={member.profileId}>{member.displayName} — {member.role}</li>)}
                </ul>
              ) : null}
            </div>
          )}
          <ul>
            {detail.members.map((member) => (
              <li key={member.profileId}>
                {member.displayName} — {member.role} — {member.status}
                {detail.studio.role === "owner" && member.profileId !== currentProfileId && (
                  <>
                    <select
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
                          "Rôle validé par le serveur.",
                        )
                      }
                    >
                      <option value="viewer">viewer</option>
                      <option value="editor">editor</option>
                      <option value="owner">owner</option>
                    </select>
                    <button
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
                      Retirer
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {detail.studio.role === "owner" && (
            <form className="account-auth-form" onSubmit={(event) => void invite(event)}>
              <label>
                Adresse à inviter
                <input name="email" type="email" autoComplete="off" required />
              </label>
              <label>
                Rôle demandé
                <select name="role" defaultValue="viewer">
                  <option value="viewer">viewer</option>
                  <option value="editor">editor</option>
                </select>
              </label>
              <button type="submit" disabled={busy}>
                Créer l’invitation
              </button>
            </form>
          )}
          {detail.invitations.length > 0 && (
            <ul>
              {detail.invitations.map((invitation) => (
                <li key={invitation.id}>
                  {invitation.recipient} — {invitation.role} —{" "}
                  {Date.parse(invitation.expiresAt) <= Date.now() ? "expirée" : invitation.status}
                  {invitation.status === "pending" && detail.studio.role === "owner" && (
                    <button
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
                      Révoquer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

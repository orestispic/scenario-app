import { useEffect, useState, type FormEvent } from "react";
import { CommercialHttpError } from "./authenticatedApi";
import {
  type LocalTestAuthAdapter,
} from "./auth";
import type { DeviceView, EntitlementsResponse, MeResponse, SessionTokens } from "./contractsV2";
import type { ActivationRedemptionView, BillingState } from "./contractsV3";
import { BOUND_CACHE_KEY, readBoundCache, writeBoundCache } from "./boundEntitlementCache";
import {
  auth,
  browserStorage,
  createRuntimeCommercialApi,
  getClientPlatform,
  getDeviceFingerprint,
  localTestMode,
  offlineTrust,
  sessions,
} from "./runtime";

interface AccountLicensePanelProps {
  onClose(): void;
}
type AuthScreen = "signin" | "signup" | "recover";

export function AccountLicensePanel({ onClose }: AccountLicensePanelProps) {
  const [screen, setScreen] = useState<AuthScreen>("signin");
  const [session, setSession] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [activations, setActivations] = useState<ActivationRedemptionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState("");

  function accountApi() {
    return createRuntimeCommercialApi(async () => {
        setSession(false);
        await sessions.invalidate();
        await offlineTrust.clear();
    });
  }

  useEffect(() => {
    void sessions
      .getAccessToken()
      .then((token) => {
        if (token) return loadAuthenticatedAccount();
      })
      .catch(async (error) => {
        if (!(await restoreOffline(error)))
          setMessage("Session indisponible. Vous pouvez réessayer ou vous reconnecter.");
      });
  }, []);

  async function restoreOffline(error: unknown): Promise<boolean> {
    if (
      !(
        error instanceof TypeError ||
        (error instanceof CommercialHttpError && [502, 503, 504].includes(error.status))
      )
    )
      return false;
    try {
      const trust = await offlineTrust.read();
      if (!trust) return false;
      const snapshot = await readBoundCache(
        browserStorage(),
        trust.publicKey,
        trust.keyId,
        trust.me.account.id,
      );
      if (!snapshot) return false;
      const cached = JSON.parse(browserStorage().getItem(BOUND_CACHE_KEY)!);
      setMe(trust.me);
      setEntitlements({ offlineGrant: cached.grant, snapshot });
      setSession(true);
      setOffline(true);
      setMessage(
        "Connexion indisponible. Les droits affichés proviennent du cache signé encore valide.",
      );
      return true;
    } catch {
      return false;
    }
  }

  async function loadAuthenticatedAccount(nextSession?: SessionTokens) {
    if (nextSession) {
      await offlineTrust.clear();
      await sessions.accept(nextSession);
    }
    const api = accountApi();
    const [configuration, nextMe, nextEntitlements, nextDevices, nextBilling, nextActivations] =
      await Promise.all([
        api.getConfiguration(),
        api.getMe(),
        api.getEntitlements(),
        api.getDevices(),
        api.getBilling(),
        api.getActivationStatus(),
      ]);
    await writeBoundCache(
      browserStorage(),
      nextEntitlements.snapshot,
      nextEntitlements.offlineGrant,
      configuration.offlineGrantPublicKey,
      configuration.offlineGrantKeyId,
      nextMe.account.id,
    );
    await offlineTrust.write({
      schemaVersion: 1,
      me: nextMe,
      publicKey: configuration.offlineGrantPublicKey,
      keyId: configuration.offlineGrantKeyId,
    });
    setOffline(false);
    setSession(true);
    setMe(nextMe);
    setEntitlements(nextEntitlements);
    setDevices(nextDevices);
    setBilling(nextBilling.billing);
    setActivations(nextActivations.activations);
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (error) {
      if (!(await restoreOffline(error)))
        setMessage(error instanceof Error ? error.message : "Demande impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (screen === "signin") {
      await run(
        async () => loadAuthenticatedAccount(await auth.signIn(email, password)),
        "Session ouverte.",
      );
    } else if (screen === "signup") {
      await run(
        () => auth.signUp(email, password, String(data.get("displayName") ?? "")),
        "Vérifiez votre adresse e-mail.",
      );
    } else {
      await run(
        () => auth.requestPasswordReset(email),
        "Si le compte existe, un message a été envoyé.",
      );
    }
  }

  async function activateCurrentDevice() {
    if (!session) return;
    const api = accountApi();
    await api.activateDevice({
      fingerprint: getDeviceFingerprint(),
      label: "Cet appareil",
      platform: getClientPlatform(),
    });
    setDevices(await api.getDevices());
  }

  async function signOut() {
    try {
      await sessions.logout();
    } finally {
      setOffline(false);
      window.localStorage.removeItem("scenario-commercial-signed-entitlements-v2");
      window.localStorage.removeItem(BOUND_CACHE_KEY);
      setSession(false);
      setMe(null);
      setEntitlements(null);
      setDevices([]);
      setBilling(null);
      setActivations([]);
      await offlineTrust.clear();
    }
  }

  async function redeemActivationKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const api = accountApi();
    await api.redeemActivationKey({
      key: String(data.get("activationKey") ?? ""),
      fingerprint: getDeviceFingerprint(),
      label: "Cet appareil",
      platform: getClientPlatform(),
    });
    const [configuration, nextEntitlements, nextBilling, nextActivations, nextDevices] =
      await Promise.all([
        api.getConfiguration(),
        api.getEntitlements(),
        api.getBilling(),
        api.getActivationStatus(),
        api.getDevices(),
      ]);
    await writeBoundCache(
      browserStorage(),
      nextEntitlements.snapshot,
      nextEntitlements.offlineGrant,
      configuration.offlineGrantPublicKey,
      configuration.offlineGrantKeyId,
      me!.account.id,
    );
    setEntitlements(nextEntitlements);
    setBilling(nextBilling.billing);
    setActivations(nextActivations.activations);
    setDevices(nextDevices);
    form.reset();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="account-license-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Compte et licence"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>Compte et licence</h2>
            <p>{localTestMode ? "Serveur local isolé" : "Session Supabase sécurisée"}</p>
          </div>
          <button
            className="panel-close-button"
            type="button"
            aria-label="Fermer"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        {session && me && entitlements ? (
          <div className="account-license-details">
            <dl>
              <div>
                <dt>Compte</dt>
                <dd>{me.account.displayName ?? me.account.email}</dd>
              </div>
              <div>
                <dt>Adresse</dt>
                <dd>{me.account.email}</dd>
              </div>
              <div>
                <dt>Configuration</dt>
                <dd>{entitlements.snapshot.configurationVersion}</dd>
              </div>
              <div>
                <dt>Cache signé jusqu’au</dt>
                <dd>{new Date(entitlements.snapshot.offlineValidUntil).toLocaleString("fr-FR")}</dd>
              </div>
              <div>
                <dt>Abonnement</dt>
                <dd>
                  {billing?.offerDisplayName ?? "Découverte"} — {billing?.status ?? "indisponible"}
                </dd>
              </div>
              {billing?.currentPeriodEndsAt && (
                <div>
                  <dt>Fin de période</dt>
                  <dd>{new Date(billing.currentPeriodEndsAt).toLocaleDateString("fr-FR")}</dd>
                </div>
              )}
            </dl>
            <section className="account-license-section">
              <h3>Clé d’activation</h3>
              <form
                className="account-auth-form"
                onSubmit={(event) =>
                  void run(() => redeemActivationKey(event), "Clé activée et droits actualisés.")
                }
              >
                <label>
                  Clé Scénario
                  <input name="activationKey" autoComplete="off" spellCheck={false} required />
                </label>
                <button type="submit" disabled={busy}>
                  Activer cette clé
                </button>
              </form>
              {activations.length > 0 && (
                <ul>
                  {activations.map((activation) => (
                    <li key={activation.id}>
                      •••• {activation.keySuffix} — {activation.status}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="account-license-section">
              <h3>Droits reçus</h3>
              <ul>
                {entitlements.snapshot.entitlements.map((right) => (
                  <li key={right.code}>
                    {right.code} — {right.enabled ? "actif" : "inactif"}
                  </li>
                ))}
              </ul>
            </section>
            <section className="account-license-section">
              <h3>Appareils</h3>
              {devices.length ? (
                <ul>
                  {devices.map((device) => (
                    <li key={device.id}>
                      {device.label ?? "Sans nom"} — {device.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Aucun appareil actif.</p>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(activateCurrentDevice, "Appareil activé.")}
              >
                Activer cet appareil
              </button>
            </section>
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => loadAuthenticatedAccount(), "Compte actualisé.")}
              >
                {offline ? "Se reconnecter" : "Actualiser"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(signOut, "Session fermée.")}
              >
                Se déconnecter
              </button>
            </footer>
          </div>
        ) : (
          <>
            {localTestMode && (
              <section className="account-local-test">
                <strong>Profils locaux</strong>
                <p>L’identité est choisie ici ; les droits viennent uniquement du Worker local.</p>
                <div>
                  {(["discovery", "author", "studio"] as const).map((profile) => (
                    <button
                      key={profile}
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          async () =>
                            loadAuthenticatedAccount(
                              await (auth as LocalTestAuthAdapter).signInAs(profile),
                            ),
                          "Profil chargé.",
                        )
                      }
                    >
                      {profile}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <nav className="account-auth-tabs" aria-label="Accès au compte">
              {(["signin", "signup", "recover"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={screen === tab ? "is-active" : ""}
                  onClick={() => setScreen(tab)}
                >
                  {tab === "signin"
                    ? "Connexion"
                    : tab === "signup"
                      ? "Inscription"
                      : "Mot de passe"}
                </button>
              ))}
            </nav>
            <form className="account-auth-form" onSubmit={(event) => void submitCredentials(event)}>
              {screen === "signup" && (
                <label>
                  Nom affiché
                  <input name="displayName" autoComplete="name" required />
                </label>
              )}
              <label>
                Adresse e-mail
                <input name="email" type="email" autoComplete="email" required />
              </label>
              {screen !== "recover" && (
                <label>
                  Mot de passe
                  <input
                    name="password"
                    type="password"
                    autoComplete={screen === "signup" ? "new-password" : "current-password"}
                    minLength={8}
                    required
                  />
                </label>
              )}
              <button className="primary-button" type="submit" disabled={busy}>
                {screen === "signin"
                  ? "Se connecter"
                  : screen === "signup"
                    ? "Créer le compte"
                    : "Envoyer le lien"}
              </button>
            </form>
          </>
        )}
        {message && (
          <p className="account-license-message" role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}

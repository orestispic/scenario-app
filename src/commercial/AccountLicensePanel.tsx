import { useEffect, useState, type FormEvent } from "react";
import { UiIcon } from '../ui/UiIcon';
import { CommercialHttpError } from "./authenticatedApi";
import { type LocalTestAuthAdapter } from "./auth";
import type { DeviceView, EntitlementsResponse, MeResponse, SessionTokens } from "./contractsV2";
import type { ActivationRedemptionView, BillingState } from "./contractsV3";
import { BOUND_CACHE_KEY } from "./boundEntitlementCache";
import {
  auth,
  createRuntimeCommercialApi,
  getClientPlatform,
  getDeviceFingerprint,
  localTestMode,
  offlineLicense,
  sessions,
  cloudSyncQueue,
  authenticatedOperations,
} from "./runtime";
import { cloudProjectRuntime } from './cloudProjectRuntime';

interface AccountLicensePanelProps {
  onClose(): void;
  onOpenCloud?(): void;
}
type AuthScreen = "signin" | "signup" | "recover";

export function AccountLicensePanel({ onClose, onOpenCloud }: AccountLicensePanelProps) {
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

  useEffect(() => offlineLicense.subscribe(() => {
    if (offline && offlineLicense.state.kind !== 'valid') {
      setEntitlements(null);
      setMessage('Licence hors ligne indisponible. Vos fichiers locaux restent accessibles ; reconnectez-vous pour actualiser les droits.');
    }
  }), [offline]);

  function accountApi() {
    return createRuntimeCommercialApi(async () => {
      setSession(false);
      await cloudProjectRuntime.close();
      await sessions.invalidate();
      await offlineLicense.clear();
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
      const restored = await offlineLicense.restore();
      if (!restored) return false;
      setMe(restored.me);
      setEntitlements(restored.entitlements);
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
      await cloudProjectRuntime.close();
      authenticatedOperations.reset();
      await offlineLicense.clear();
      await sessions.accept(nextSession);
    }
    const api = accountApi();
    const [nextMe, nextEntitlements, nextDevices, nextBilling, nextActivations] =
      await Promise.all([
        api.getMe(),
        api.getEntitlements(),
        api.getDevices(),
        api.getBilling(),
        api.getActivationStatus(),
      ]);
    await offlineLicense.refresh();
    await cloudSyncQueue.bindAccount(nextMe.account.id);
    void cloudSyncQueue.process();
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
    await offlineLicense.refresh();
  }

  async function signOut() {
    await cloudProjectRuntime.close();
    authenticatedOperations.stop();
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
      await offlineLicense.clear();
      await cloudSyncQueue.pauseAndForgetAccount();
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
    const [nextEntitlements, nextBilling, nextActivations, nextDevices] =
      await Promise.all([
        api.getEntitlements(),
        api.getBilling(),
        api.getActivationStatus(),
        api.getDevices(),
      ]);
    await offlineLicense.refresh();
    setEntitlements(nextEntitlements);
    setBilling(nextBilling.billing);
    setActivations(nextActivations.activations);
    setDevices(nextDevices);
    form.reset();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className={`account-license-panel ${session && me && entitlements ? '' : 'account-signin-panel'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Compte et licence"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{session && me && entitlements ? 'Compte et licence' : screen === 'signin' ? 'Se connecter' : screen === 'signup' ? 'Créer un compte' : 'Réinitialiser le mot de passe'}</h2>
            {session && me && entitlements && localTestMode && <p>Compte de démonstration</p>}
          </div>
          <button
            className="panel-close-button"
            type="button"
            aria-label="Fermer"
            onClick={onClose}
          >
            <UiIcon name="x"/>
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
                  Clé senario
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
            {!offline && (
              <section className="account-license-section"><h3>Vos projets</h3><p>Retrouvez vos scénarios privés, vos projets partagés et leurs membres dans la fenêtre dédiée.</p><button type="button" onClick={onOpenCloud}>Ouvrir les Projets cloud</button></section>
            )}
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
              {screen === "signin" && (
                <button
                  className="account-password-recovery"
                  type="button"
                  disabled={busy}
                  onClick={() => setScreen("recover")}
                >
                  Mot de passe oublié ?
                </button>
              )}
              <button className="primary-button" type="submit" disabled={busy}>
                {screen === "signin"
                  ? "Se connecter"
                  : screen === "signup"
                    ? "Créer le compte"
                    : "Envoyer le lien"}
                <UiIcon name="chevron"/>
              </button>
            </form>
            <div className="account-auth-switch">
              {screen === 'signin' ? <>Pas encore de compte ? <button type="button" disabled={busy} onClick={() => setScreen('signup')}>Créer un compte</button></>
                : <>Déjà un compte ? <button type="button" disabled={busy} onClick={() => setScreen('signin')}>Se connecter</button></>}
            </div>
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

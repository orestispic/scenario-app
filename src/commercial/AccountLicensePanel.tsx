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
  deviceActivation,
} from "./runtime";
import { cloudProjectRuntime } from './cloudProjectRuntime';
import { AiBudgetUsage } from './AiBudgetUsage';
import { presentEntitlements } from './entitlementPresentation';

interface AccountLicensePanelProps {
  onClose(): void;
  onOpenCloud?(): void;
  onAuthenticated?(): void;
  onSignedOut?(): void;
  required?: boolean;
}
type AuthScreen = "signin" | "signup" | "recover";

export function AccountLicensePanel({
  onClose,
  onAuthenticated,
  onSignedOut,
  required = false,
}: AccountLicensePanelProps) {
  const [screen, setScreen] = useState<AuthScreen>("signin");
  const [session, setSession] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
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
      try {
        try {
          await cloudProjectRuntime.close();
        } catch {
          // L'invalidation de sécurité reste prioritaire sur l'arrêt du temps réel.
        }
        await sessions.invalidate();
        await offlineLicense.clear();
      } finally {
        onSignedOut?.();
      }
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
      onAuthenticated?.();
      return true;
    } catch {
      return false;
    }
  }

  async function loadAuthenticatedAccount(nextSession?: SessionTokens): Promise<string | undefined> {
    if (nextSession) {
      await cloudProjectRuntime.close();
      authenticatedOperations.reset();
      await offlineLicense.clear();
      deviceActivation.reset();
      await sessions.accept(nextSession);
    }
    const api = accountApi();
    let activationWarning: string | undefined;
    try {
      const currentDevice = await deviceActivation.ensure();
      setCurrentDeviceId(currentDevice.id);
    } catch (error) {
      if (!(error instanceof CommercialHttpError && error.code === "device_limit_reached")) {
        throw error;
      }
      setCurrentDeviceId(null);
      activationWarning = "Limite d’appareils atteinte. Retirez un ancien appareil pour autoriser automatiquement celui-ci.";
    }
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
    onAuthenticated?.();
    if (activationWarning) setMessage(activationWarning);
    return activationWarning;
  }

  async function run(action: () => Promise<void | string>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await action();
      setMessage(result ?? success);
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

  async function removeRegisteredDevice(deviceId: string) {
    if (!session || deviceId === currentDeviceId) return;
    const api = accountApi();
    await api.deactivateDevice(deviceId);
    deviceActivation.reset();
    const currentDevice = await deviceActivation.ensure();
    setCurrentDeviceId(currentDevice.id);
    setDevices(await api.getDevices());
    await offlineLicense.refresh();
  }

  async function signOut() {
    authenticatedOperations.stop();
    try {
      try {
        await cloudProjectRuntime.close();
      } catch {
        // La déconnexion du compte doit continuer même si une liaison temps réel est déjà rompue.
      }
      try {
        await sessions.logout();
      } finally {
        setOffline(false);
        window.localStorage.removeItem("scenario-commercial-signed-entitlements-v2");
        window.localStorage.removeItem(BOUND_CACHE_KEY);
        setSession(false);
        setCurrentDeviceId(null);
        setMe(null);
        setEntitlements(null);
        setDevices([]);
        setBilling(null);
        setActivations([]);
        await offlineLicense.clear();
        await cloudSyncQueue.pauseAndForgetAccount();
      }
    } finally {
      onSignedOut?.();
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

  const billingStatus = billing
    ? ({
        none: 'Gratuit',
        trialing: 'Essai en cours',
        active: 'Actif',
        past_due: 'Paiement à régulariser',
        paused: 'En pause',
        canceled: 'Résilié',
        expired: 'Expiré',
      } as const)[billing.status]
    : 'Indisponible';
  const displayedRights = entitlements
    ? presentEntitlements(entitlements.snapshot.entitlements)
    : [];
  const activeDevices = devices.filter((device) => device.status === 'active');

  return (
    <div
      className={`modal-backdrop ${required ? "is-auth-required" : ""}`}
      role="presentation"
      onMouseDown={required ? undefined : onClose}
    >
      <section
        className={`account-license-panel ${session && me && entitlements ? 'account-overview-panel' : 'account-signin-panel'}`}
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
          {!required && (
            <button
              className="panel-close-button"
              type="button"
              aria-label="Fermer"
              onClick={onClose}
            >
              <UiIcon name="x"/>
            </button>
          )}
        </header>

        {session && me && entitlements ? (
          <div className="account-license-details">
            <div className="account-overview-grid">
              <section className="account-license-section account-profile-section">
                <div className="account-profile-heading">
                  <span className="account-profile-icon"><UiIcon name="user" /></span>
                  <div>
                    <h3>{me.account.displayName ?? 'Mon compte'}</h3>
                    <p>{me.account.email}</p>
                  </div>
                  <span className={`account-plan-badge ${billingStatus === 'Actif' ? 'is-active' : ''}`}>
                    {billing?.offerDisplayName ?? 'Gratuit'}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Abonnement</dt>
                    <dd>{billingStatus}</dd>
                  </div>
                  {billing?.currentPeriodEndsAt && (
                    <div>
                      <dt>Prochaine échéance</dt>
                      <dd>{new Date(billing.currentPeriodEndsAt).toLocaleDateString('fr-FR')}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Accès hors connexion</dt>
                    <dd>Jusqu’au {new Date(entitlements.snapshot.offlineValidUntil).toLocaleDateString('fr-FR')}</dd>
                  </div>
                </dl>
              </section>
              <AiBudgetUsage />
            </div>

            <section className="account-license-section account-rights-section">
              <div className="account-section-heading">
                <h3>Fonctionnalités de votre offre</h3>
                <span>{displayedRights.filter((right) => right.enabled).length} actives</span>
              </div>
              <ul className="account-rights-grid">
                {displayedRights.map((right) => (
                  <li key={right.id} className={right.enabled ? 'is-enabled' : 'is-disabled'}>
                    <span className="account-right-icon">
                      <UiIcon name={right.enabled ? 'check' : 'x'} />
                    </span>
                    <span>{right.label}</span>
                    <small>{right.enabled ? 'Actif' : 'Inactif'}</small>
                  </li>
                ))}
              </ul>
            </section>

            <div className="account-management-grid">
              <section className="account-license-section account-device-section">
                <div className="account-section-heading">
                  <h3>Appareils</h3>
                  <span>{activeDevices.length} actif(s)</span>
                </div>
                <p className="account-device-help">Cet appareil est autorisé automatiquement après votre connexion.</p>
                {activeDevices.length ? (
                  <ul className="account-device-list">
                    {activeDevices.map((device) => (
                      <li key={device.id}>
                        <span>{device.id === currentDeviceId ? 'Cet appareil' : device.label ?? 'Appareil autorisé'}</span>
                        {device.id === currentDeviceId ? (
                          <small>Actuel</small>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(
                              () => removeRegisteredDevice(device.id),
                              'Ancien appareil retiré. Cet appareil est maintenant autorisé.',
                            )}
                          >
                            Retirer
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Aucun appareil actif.</p>
                )}
              </section>

              <section className="account-license-section account-activation-section">
                <h3>Clé d’activation</h3>
                <form
                  className="account-activation-form"
                  onSubmit={(event) =>
                    void run(() => redeemActivationKey(event), 'Clé activée et droits actualisés.')
                  }
                >
                  <label htmlFor="account-activation-key">Clé Senario</label>
                  <div>
                    <input id="account-activation-key" name="activationKey" autoComplete="off" spellCheck={false} required />
                    <button type="submit" disabled={busy}>Activer</button>
                  </div>
                </form>
                {activations.length > 0 && (
                  <ul className="account-activation-list">
                    {activations.map((activation) => (
                      <li key={activation.id}>
                        •••• {activation.keySuffix} — {activation.status === 'active' ? 'Active' : activation.status === 'revoked' ? 'Révoquée' : 'Expirée'}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
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
            <p className="account-auth-intro">
              Le compte est facultatif pour écrire et enregistrer des fichiers sur cet appareil.
              Connectez-vous seulement pour activer les fonctions Auteur ou Studio.
            </p>
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

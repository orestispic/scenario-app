import { useMemo, useState, type FormEvent } from "react";
import { createAuthenticatedCommercialApi } from "./authenticatedApi";
import { createLocalTestAuthAdapter, createSupabaseAuthAdapter, type AuthAdapter, type LocalTestAuthAdapter } from "./auth";
import type { DeviceView, EntitlementsResponse, MeResponse, SessionTokens } from "./contractsV2";
import type { ActivationRedemptionView, BillingState } from "./contractsV3";
import { writeVerifiedEntitlementCache } from "./signedEntitlementCache";

interface AccountLicensePanelProps { onClose(): void }
type AuthScreen = "signin" | "signup" | "recover";

const localTestMode = import.meta.env.DEV && import.meta.env.VITE_SCENARIO_AUTH_MODE === "local-test";
const apiBaseUrl = import.meta.env.VITE_SCENARIO_API_BASE_URL ?? "http://127.0.0.1:8787";

function browserStorage() {
  return { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) };
}

function getDeviceFingerprint(): string {
  const key = "scenario-local-device-fingerprint";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const fingerprint = crypto.randomUUID() + crypto.randomUUID();
  window.localStorage.setItem(key, fingerprint);
  return fingerprint;
}

function createRuntimeAuthAdapter(): AuthAdapter {
  if (localTestMode) return createLocalTestAuthAdapter();
  return createSupabaseAuthAdapter({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "https://project-ref.supabase.co",
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "not-configured",
  });
}

export function AccountLicensePanel({ onClose }: AccountLicensePanelProps) {
  const auth = useMemo(createRuntimeAuthAdapter, []);
  const [screen, setScreen] = useState<AuthScreen>("signin");
  const [session, setSession] = useState<SessionTokens | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [entitlements, setEntitlements] = useState<EntitlementsResponse | null>(null);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [activations, setActivations] = useState<ActivationRedemptionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadAuthenticatedAccount(nextSession: SessionTokens) {
    const api = createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl, accessToken: nextSession.accessToken });
    const [configuration, nextMe, nextEntitlements, nextDevices, nextBilling, nextActivations] = await Promise.all([
      api.getConfiguration(), api.getMe(), api.getEntitlements(), api.getDevices(), api.getBilling(), api.getActivationStatus(),
    ]);
    await writeVerifiedEntitlementCache(browserStorage(), nextEntitlements.snapshot, nextEntitlements.offlineGrant, configuration.offlineGrantPublicKey, configuration.offlineGrantKeyId);
    setSession(nextSession);
    setMe(nextMe);
    setEntitlements(nextEntitlements);
    setDevices(nextDevices);
    setBilling(nextBilling.billing);
    setActivations(nextActivations.activations);
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setMessage("");
    try { await action(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Demande impossible."); }
    finally { setBusy(false); }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (screen === "signin") {
      await run(async () => loadAuthenticatedAccount(await auth.signIn(email, password)), "Session ouverte.");
    } else if (screen === "signup") {
      await run(() => auth.signUp(email, password, String(data.get("displayName") ?? "")), "Vérifiez votre adresse e-mail.");
    } else {
      await run(() => auth.requestPasswordReset(email), "Si le compte existe, un message a été envoyé.");
    }
  }

  async function activateCurrentDevice() {
    if (!session) return;
    const api = createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl, accessToken: session.accessToken });
    await api.activateDevice({
      fingerprint: getDeviceFingerprint(),
      label: "Cet appareil",
      platform: /mac/i.test(navigator.userAgent) ? "macos" : "windows",
    });
    setDevices(await api.getDevices());
  }

  async function signOut() {
    if (session) await createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl, accessToken: session.accessToken }).logout();
    setSession(null); setMe(null); setEntitlements(null); setDevices([]); setBilling(null); setActivations([]);
  }

  async function redeemActivationKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const data = new FormData(event.currentTarget);
    const api = createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl, accessToken: session.accessToken });
    await api.redeemActivationKey({
      key: String(data.get("activationKey") ?? ""),
      fingerprint: getDeviceFingerprint(),
      label: "Cet appareil",
      platform: /mac/i.test(navigator.userAgent) ? "macos" : "windows",
    });
    const [configuration, nextEntitlements, nextBilling, nextActivations, nextDevices] = await Promise.all([
      api.getConfiguration(), api.getEntitlements(), api.getBilling(), api.getActivationStatus(), api.getDevices(),
    ]);
    await writeVerifiedEntitlementCache(browserStorage(), nextEntitlements.snapshot, nextEntitlements.offlineGrant, configuration.offlineGrantPublicKey, configuration.offlineGrantKeyId);
    setEntitlements(nextEntitlements); setBilling(nextBilling.billing); setActivations(nextActivations.activations); setDevices(nextDevices);
    event.currentTarget.reset();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="account-license-panel" role="dialog" aria-modal="true" aria-label="Compte et licence" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><h2>Compte et licence</h2><p>{localTestMode ? "Serveur local isolé" : "Session Supabase sécurisée"}</p></div>
          <button className="panel-close-button" type="button" aria-label="Fermer" onClick={onClose}>×</button>
        </header>

        {session && me && entitlements ? (
          <div className="account-license-details">
            <dl>
              <div><dt>Compte</dt><dd>{me.account.displayName ?? me.account.email}</dd></div>
              <div><dt>Adresse</dt><dd>{me.account.email}</dd></div>
              <div><dt>Configuration</dt><dd>{entitlements.snapshot.configurationVersion}</dd></div>
              <div><dt>Cache signé jusqu’au</dt><dd>{new Date(entitlements.snapshot.offlineValidUntil).toLocaleString("fr-FR")}</dd></div>
              <div><dt>Abonnement</dt><dd>{billing?.offerDisplayName ?? "Découverte"} — {billing?.status ?? "indisponible"}</dd></div>
              {billing?.currentPeriodEndsAt && <div><dt>Fin de période</dt><dd>{new Date(billing.currentPeriodEndsAt).toLocaleDateString("fr-FR")}</dd></div>}
            </dl>
            <section className="account-license-section"><h3>Clé d’activation</h3><form className="account-auth-form" onSubmit={(event) => void run(() => redeemActivationKey(event), "Clé activée et droits actualisés.")}><label>Clé Scénario<input name="activationKey" autoComplete="off" spellCheck={false} required /></label><button type="submit" disabled={busy}>Activer cette clé</button></form>{activations.length > 0 && <ul>{activations.map((activation) => <li key={activation.id}>•••• {activation.keySuffix} — {activation.status}</li>)}</ul>}</section>
            <section className="account-license-section"><h3>Droits reçus</h3><ul>{entitlements.snapshot.entitlements.map((right) => <li key={right.code}>{right.code} — {right.enabled ? "actif" : "inactif"}</li>)}</ul></section>
            <section className="account-license-section"><h3>Appareils</h3>{devices.length ? <ul>{devices.map((device) => <li key={device.id}>{device.label ?? "Sans nom"} — {device.status}</li>)}</ul> : <p>Aucun appareil actif.</p>}<button type="button" disabled={busy} onClick={() => void run(activateCurrentDevice, "Appareil activé.")}>Activer cet appareil</button></section>
            <footer><button type="button" disabled={busy} onClick={() => void run(signOut, "Session fermée.")}>Se déconnecter</button></footer>
          </div>
        ) : (
          <>
            {localTestMode && <section className="account-local-test"><strong>Profils locaux</strong><p>L’identité est choisie ici ; les droits viennent uniquement du Worker local.</p><div>{(["discovery", "author", "studio"] as const).map((profile) => <button key={profile} type="button" disabled={busy} onClick={() => void run(async () => loadAuthenticatedAccount(await (auth as LocalTestAuthAdapter).signInAs(profile)), "Profil chargé.")}>{profile}</button>)}</div></section>}
            <nav className="account-auth-tabs" aria-label="Accès au compte">{(["signin", "signup", "recover"] as const).map((tab) => <button key={tab} type="button" className={screen === tab ? "is-active" : ""} onClick={() => setScreen(tab)}>{tab === "signin" ? "Connexion" : tab === "signup" ? "Inscription" : "Mot de passe"}</button>)}</nav>
            <form className="account-auth-form" onSubmit={(event) => void submitCredentials(event)}>
              {screen === "signup" && <label>Nom affiché<input name="displayName" autoComplete="name" required /></label>}
              <label>Adresse e-mail<input name="email" type="email" autoComplete="email" required /></label>
              {screen !== "recover" && <label>Mot de passe<input name="password" type="password" autoComplete={screen === "signup" ? "new-password" : "current-password"} minLength={8} required /></label>}
              <button className="primary-button" type="submit" disabled={busy}>{screen === "signin" ? "Se connecter" : screen === "signup" ? "Créer le compte" : "Envoyer le lien"}</button>
            </form>
          </>
        )}
        {message && <p className="account-license-message" role="status">{message}</p>}
      </section>
    </div>
  );
}

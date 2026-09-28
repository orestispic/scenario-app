import { useEffect, useRef, useState, type FormEvent } from "react";
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { UiIcon } from '../ui/UiIcon';
import { UiButton, UiDialog, UiEmptyState, UiFeedback, UiIconButton, type UiFeedbackMessage } from '../ui';
import { showSenarioConfirm } from '../ui/SenarioDialog';
import { CommercialHttpError } from "./authenticatedApi";
import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  ACCOUNT_EMAIL_MAX_LENGTH,
  AuthSessionError,
  type LocalTestAuthAdapter,
  validatePasswordChange,
} from "./auth";
import type { DeviceView, EntitlementsResponse, MeResponse, SessionTokens } from "./contractsV2";
import type { ActivationRedemptionView, BillingOfferView, BillingState } from "./contractsV3";
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
  exclusiveDeviceSession,
  pendingAccountClosure,
} from "./runtime";
import { cloudProjectRuntime } from './cloudProjectRuntime';
import { AiBudgetUsage } from './AiBudgetUsage';
import { presentEntitlements } from './entitlementPresentation';
import { accountOverview } from './accountOverview';
import { CommercialContractError } from './contracts';
import {
  ACCOUNT_CLOSURE_CONFIRMATION,
  AccountClosureUncertainError,
  accountClosureErrorMessage,
  createAccountClosureVerificationToken,
  isAccountClosureResultUncertain,
  runAccountClosure,
} from './accountClosure';
import { AuthenticationAttemptFence } from './authenticationAttempt';
import type { PendingAccountClosure } from './pendingAccountClosure';

interface AccountLicensePanelProps {
  onClose(): void;
  onOpenCloud?(): void;
  onAuthenticated?(): void;
  onSignedOut?(): void;
  required?: boolean;
}
type AuthScreen = "signin" | "signup" | "recover";
type AccountSectionErrors = Partial<Record<'profile' | 'entitlements' | 'devices' | 'billing' | 'activations' | 'device' | 'license' | 'sync', string>>;

function accountErrorMessage(error: unknown, fallback = 'Service temporairement indisponible. Réessayez.'): string {
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError'))
    return 'La demande a expiré. Vérifiez la connexion puis réessayez.';
  if (error instanceof TypeError)
    return 'Connexion au service impossible. Vos fichiers locaux restent accessibles.';
  if (error instanceof AuthSessionError) return error.message;
  if (error instanceof CommercialContractError)
    return 'Le service a renvoyé des informations de compte incomplètes. Réessayez ou contactez le support.';
  if (error instanceof CommercialHttpError) {
    const reference = error.requestId ? ` Référence : ${error.requestId}.` : '';
    if (error.status === 401) return `La session a expiré. Reconnectez-vous.${reference}`;
    if (error.status === 403) return `Cette opération n’est pas autorisée pour ce compte.${reference}`;
    if (error.status === 404) return `L’information demandée n’existe plus.${reference}`;
    if (error.status === 429) return `Trop de demandes ont été envoyées. Réessayez dans un instant.${reference}`;
    if (error.code === 'database_unavailable' || error.status >= 500)
      return `Le service de compte est temporairement indisponible.${reference}`;
    if (error.status === 400 || error.status === 422)
      return `La demande est invalide. Vérifiez les informations saisies.${reference}`;
    if (error.status === 409)
      return `Cette opération ne peut pas être effectuée dans l’état actuel du compte.${reference}`;
    return `La demande a été refusée. Réessayez ou contactez le support.${reference}`;
  }
  return fallback;
}

function isTemporaryAccountFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof AuthSessionError && !error.terminal) ||
    (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) ||
    (error instanceof CommercialHttpError && [502, 503, 504].includes(error.status))
  );
}

function isAuthoritativeAccountFailure(error: unknown): boolean {
  return (
    (error instanceof AuthSessionError && error.terminal) ||
    (error instanceof CommercialHttpError && [401, 403].includes(error.status))
  );
}

function priceLabel(offer: BillingOfferView): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: offer.currency }).format(offer.unitAmountMinor / 100);
}

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
  const [offers, setOffers] = useState<BillingOfferView[]>([]);
  const [activations, setActivations] = useState<ActivationRedemptionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState<UiFeedbackMessage | null>(null);
  const [deviceLimitReached, setDeviceLimitReached] = useState(false);
  const [sessionConflict, setSessionConflict] = useState<{ activeDevice: DeviceView | null; expiresAt: string | null } | null>(null);
  const [emailChangeOpen, setEmailChangeOpen] = useState(false);
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false);
  const [accountClosureOpen, setAccountClosureOpen] = useState(false);
  const [accountClosureUncertain, setAccountClosureUncertain] = useState(false);
  const [sectionErrors, setSectionErrors] = useState<AccountSectionErrors>({});
  const mounted = useRef(true);
  const loadGeneration = useRef(0);
  const authAttemptFence = useRef(new AuthenticationAttemptFence());
  const actionGeneration = useRef(0);
  const authenticatedRef = useRef(false);
  const pendingClosureRef = useRef<PendingAccountClosure | null>(null);

  useEffect(() => {
    // React StrictMode intentionally runs setup -> cleanup -> setup in
    // development. Re-arm the guard on every setup instead of leaving the
    // second mount permanently marked as unmounted.
    mounted.current = true;
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
      authAttemptFence.current.invalidate();
      actionGeneration.current += 1;
    };
  }, []);

  useEffect(() => sessions.subscribe((authenticated) => {
    if (authenticated || !mounted.current) return;
    const shouldNotify = authenticatedRef.current;
    authenticatedRef.current = false;
    loadGeneration.current += 1;
    authAttemptFence.current.invalidate();
    setBusy(false);
    accountOverview.invalidate();
    setSession(false);
    setMe(null);
    setEntitlements(null);
    setDevices([]);
    setBilling(null);
    setOffers([]);
    setActivations([]);
    setCurrentDeviceId(null);
    setSectionErrors({});
    setEmailChangeOpen(false);
    setPasswordChangeOpen(false);
    setAccountClosureOpen(false);
    if (shouldNotify) onSignedOut?.();
  }), [onSignedOut]);

  useEffect(() => {
    let active = true;
    void pendingAccountClosure.read().then((pending) => {
      if (!active || !mounted.current || !pending) return;
      pendingClosureRef.current = pending;
      setAccountClosureUncertain(true);
      setMessage({ text: 'Une clôture précédente doit encore être vérifiée. Ne renvoyez pas la demande.', tone: 'warning' });
    }).catch(() => {
      // A locked OS vault will also prevent a new closure before its POST. It
      // must not prevent local writing or opening the account panel.
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const synchronizeRevocation = () => {
      if (offline && offlineLicense.state.kind !== 'valid') {
        setEntitlements(null);
        setMessage({ text: 'Licence hors ligne indisponible. Vos fichiers locaux restent accessibles ; reconnectez-vous pour actualiser les droits.', tone: 'warning' });
      }
    };
    // Read once during setup as well as on future events. This closes the gap
    // where revocation happened between setOffline(true) and resubscription.
    synchronizeRevocation();
    return offlineLicense.subscribe(synchronizeRevocation);
  }, [offline]);

  function accountApi() {
    return createRuntimeCommercialApi();
  }

  useEffect(() => {
    void (async () => {
      try {
        if (await sessions.getAccessToken()) {
          setSession(true);
          await loadAuthenticatedAccount();
        }
      } catch (error) {
        if (!(await restoreOffline(error)))
          setMessage({ text: "Session indisponible. Vous pouvez réessayer ou vous reconnecter.", tone: 'danger' });
      } finally {
        if (mounted.current) setSessionLoading(false);
      }
    })();
  }, []);

  async function restoreOffline(
    error: unknown,
    expectedGeneration = loadGeneration.current,
  ): Promise<boolean> {
    if (!isTemporaryAccountFailure(error)) return false;
    try {
      const restored = await offlineLicense.restore();
      if (
        !restored ||
        !mounted.current ||
        expectedGeneration !== loadGeneration.current
      ) return false;
      setMe(restored.me);
      setEntitlements(restored.entitlements);
      setSession(true);
      authenticatedRef.current = true;
      setOffline(true);
      setMessage({
        text: "Connexion indisponible. Les droits affichés proviennent du cache signé encore valide.",
        tone: 'warning',
      });
      onAuthenticated?.();
      return true;
    } catch {
      return false;
    }
  }

  async function refreshOfflineRights(
    meHint?: MeResponse,
    expectedGeneration = loadGeneration.current,
  ): Promise<boolean> {
    const result = await offlineLicense.refresh(meHint);
    if (!mounted.current || expectedGeneration !== loadGeneration.current)
      return result.ok;
    setSectionErrors((current) => ({
      ...current,
      license: result.ok || result.reason === 'superseded'
        ? undefined
        : 'La licence hors ligne n’a pas pu être actualisée. Les fichiers locaux restent accessibles.',
    }));
    return result.ok;
  }

  async function revokeOfflineRights(
    expectedGeneration = loadGeneration.current,
  ): Promise<void> {
    try {
      await offlineLicense.clear();
    } catch {
      if (mounted.current && expectedGeneration === loadGeneration.current)
        setSectionErrors((current) => ({
          ...current,
          license: 'Les droits hors ligne ont été désactivés, mais leur cache persistant n’a pas pu être entièrement effacé. Fermez puis relancez Senario.',
        }));
    }
  }

  async function loadAuthenticatedAccount(nextSession?: SessionTokens, force = false): Promise<UiFeedbackMessage | undefined> {
    const generation = ++loadGeneration.current;
    if (nextSession) {
      // Cancel operations from the previous account before persisting the new
      // one. A late 401 or Cloud response must never mutate the new session.
      authenticatedOperations.stop();
      let accepted = false;
      try {
        await cloudProjectRuntime.close();
        await offlineLicense.clear();
        await cloudSyncQueue.pauseAndForgetAccount();
        accountOverview.invalidate();
        deviceActivation.reset();
        deviceActivation.resume();
        if (!mounted.current || generation !== loadGeneration.current) {
          await sessions.discard(nextSession);
          return;
        }
        await sessions.accept(nextSession);
        accepted = true;
      } catch (error) {
        if (!accepted) await sessions.discard(nextSession);
        throw error;
      } finally {
        // Never leave the shared authenticated API scope permanently aborted
        // after a failed account switch. A newer switch owns the scope when
        // the generation changed and will reset it after its own preparation.
        if (generation === loadGeneration.current)
          authenticatedOperations.reset();
      }
      setMe(null);
      setEntitlements(null);
      setDevices([]);
      setCurrentDeviceId(null);
      setBilling(null);
      setActivations([]);
      setOffline(false);
      setSectionErrors({});
    }
    if (!mounted.current || generation !== loadGeneration.current) return;
    setSession(true);
    authenticatedRef.current = true;
    const api = accountApi();
    const activateCurrentDevice = async () => {
      let activationWarning: string | undefined;
      let sessionReady = false;
      try {
        const currentDevice = await deviceActivation.ensure();
        try {
          await exclusiveDeviceSession.ensure(currentDevice.id);
          sessionReady = true;
        } catch (error) {
          if (!(error instanceof CommercialHttpError && error.code === 'device_session_in_use')) throw error;
          const conflict = error.details?.conflict as { activeDevice?: DeviceView; expiresAt?: string } | undefined;
          activationWarning = 'Senario est déjà utilisé sur un autre appareil.';
          return {
            activationWarning,
            sessionReady,
            currentDevice,
            limitReached: false,
            conflict: {
              activeDevice: conflict?.activeDevice ?? null,
              expiresAt: typeof conflict?.expiresAt === 'string' ? conflict.expiresAt : null,
            },
          };
        }
        return { activationWarning, sessionReady, currentDevice, limitReached: false, conflict: null };
      } catch (error) {
        if (error instanceof CommercialHttpError && error.code === "device_limit_reached") {
          return {
            activationWarning: "Deux appareils sont déjà autorisés. Choisissez celui à remplacer.",
            sessionReady: false,
            currentDevice: null,
            limitReached: true,
            conflict: null,
          };
        }
        return {
          activationWarning: accountErrorMessage(error, 'Activation de cet appareil indisponible.'),
          sessionReady: false,
          currentDevice: null,
          limitReached: false,
          conflict: null,
          error,
        };
      }
    };

    const activationPromise = activateCurrentDevice();
    const secondaryPromise = accountOverview.loadSecondary(api, force || Boolean(nextSession));
    const primary = await accountOverview.loadPrimary(api, force || Boolean(nextSession));
    if (!mounted.current || generation !== loadGeneration.current) return;

    if (primary.profile.status === 'error' && primary.entitlements.status === 'error') {
      // Keep the narrowed errors across the awaited offline restore.
      const profileError = primary.profile.error;
      const entitlementsError = primary.entitlements.error;
      const authoritativeFailure = [profileError, entitlementsError]
        .find(isAuthoritativeAccountFailure);
      if (authoritativeFailure) {
        await revokeOfflineRights(generation);
        if (!mounted.current || generation !== loadGeneration.current) return;
        setMe(null);
        setEntitlements(null);
        setOffline(false);
        throw authoritativeFailure;
      }
      const allFailuresAreTemporary = [profileError, entitlementsError]
        .every(isTemporaryAccountFailure);
      const failure = allFailuresAreTemporary
        ? profileError
        : [profileError, entitlementsError].find((error) => !isTemporaryAccountFailure(error))
          ?? profileError;
      if (allFailuresAreTemporary && await restoreOffline(failure, generation)) {
        setSectionErrors((current) => ({
          ...current,
          profile: accountErrorMessage(profileError),
          entitlements: accountErrorMessage(entitlementsError),
        }));
        const warning: UiFeedbackMessage = {
          text: 'Connexion indisponible. Les droits affichés proviennent du cache signé encore valide.',
          tone: 'warning',
        };
        setMessage(warning);
        return warning;
      }
      if (!mounted.current || generation !== loadGeneration.current) return;
      // Keep an already-rendered identity during a short outage, but never
      // claim paid rights unless the signed offline lease could be restored.
      if (me && allFailuresAreTemporary) {
        setEntitlements(null);
        setOffline(false);
        setSectionErrors((current) => ({
          ...current,
          profile: accountErrorMessage(profileError),
          entitlements: accountErrorMessage(entitlementsError),
        }));
        const warning: UiFeedbackMessage = {
          text: 'Le service de compte est temporairement indisponible. Le profil déjà chargé reste affiché ; les droits payants seront confirmés à la reconnexion.',
          tone: 'warning',
        };
        setMessage(warning);
        return warning;
      }
      setMe(null);
      setEntitlements(null);
      setSectionErrors((current) => ({
        ...current,
        profile: accountErrorMessage(profileError),
        entitlements: accountErrorMessage(entitlementsError),
      }));
      throw failure;
    }

    const primaryAuthoritativeFailure = [
      primary.profile.status === 'error' ? primary.profile.error : null,
      primary.entitlements.status === 'error' ? primary.entitlements.error : null,
    ].find((error): error is NonNullable<typeof error> =>
      error !== null && isAuthoritativeAccountFailure(error));
    if (primaryAuthoritativeFailure) {
      await revokeOfflineRights(generation);
      if (!mounted.current || generation !== loadGeneration.current) return;
    }
    const nextMe = primary.profile.status === 'ready' ? primary.profile.value : me;
    const nextEntitlements = !primaryAuthoritativeFailure && primary.entitlements.status === 'ready'
      ? primary.entitlements.value
      : !primaryAuthoritativeFailure &&
          primary.entitlements.status === 'error' &&
          isTemporaryAccountFailure(primary.entitlements.error) &&
          offlineLicense.state.kind === 'valid'
        ? entitlements
        : null;
    setOffline(
      primary.entitlements.status === 'error' &&
      offlineLicense.state.kind === 'valid' &&
      Boolean(nextEntitlements),
    );
    setMe(nextMe);
    setEntitlements(nextEntitlements);
    setSectionErrors(current => ({
      ...current,
      profile: primary.profile.status === 'error' ? accountErrorMessage(primary.profile.error) : undefined,
      entitlements: primary.entitlements.status === 'error' ? accountErrorMessage(primary.entitlements.error) : undefined,
    }));
    if (nextMe || nextEntitlements) onAuthenticated?.();

    void secondaryPromise.then((secondary) => {
      if (!mounted.current || generation !== loadGeneration.current) return;
      if (secondary.devices.status === 'ready')
        setDevices(secondary.devices.value.filter(device => device.status === 'active'));
      if (secondary.billing.status === 'ready') {
        setBilling(secondary.billing.value.billing);
        setOffers(secondary.billing.value.offers);
      }
      if (secondary.activations.status === 'ready') setActivations(secondary.activations.value);
      setSectionErrors(current => ({
        ...current,
        devices: secondary.devices.status === 'error' ? accountErrorMessage(secondary.devices.error) : undefined,
        billing: secondary.billing.status === 'error' ? accountErrorMessage(secondary.billing.error) : undefined,
        activations: secondary.activations.status === 'error' ? accountErrorMessage(secondary.activations.error) : undefined,
      }));
    });

    void activationPromise.then((activation) => {
      if (!mounted.current || generation !== loadGeneration.current) return;
      setCurrentDeviceId(activation.currentDevice?.id ?? null);
      setDeviceLimitReached(activation.limitReached);
      setSessionConflict(activation.conflict);
      setSectionErrors(current => ({
        ...current,
        device: activation.error ? activation.activationWarning : undefined,
      }));
      if (activation.currentDevice)
        setDevices(current => current.some(device => device.id === activation.currentDevice?.id)
          ? current
          : [...current, activation.currentDevice!]);
      if (activation.activationWarning) setMessage({ text: activation.activationWarning, tone: 'warning' });
      if (nextMe) {
        void refreshOfflineRights(nextMe, generation);
        void cloudSyncQueue.bindAccount(nextMe.account.id).then(() => {
          if (mounted.current && generation === loadGeneration.current)
            setSectionErrors((current) => ({ ...current, sync: undefined }));
          if (activation.sessionReady) void cloudSyncQueue.process().catch(() => {
            if (mounted.current && generation === loadGeneration.current)
              setSectionErrors((current) => ({
                ...current,
                sync: 'La synchronisation Cloud est en attente. Vos fichiers locaux restent accessibles.',
              }));
          });
        }).catch(() => {
          if (mounted.current && generation === loadGeneration.current)
            setSectionErrors((current) => ({
              ...current,
              sync: 'Le compte Cloud n’a pas pu être relié à cet appareil. Réessayez lorsque la connexion est stable.',
            }));
        });
      }
    });

    return undefined;
  }

  async function run(action: () => Promise<void | string | UiFeedbackMessage>, success: string) {
    const generation = ++actionGeneration.current;
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (mounted.current && generation === actionGeneration.current)
        setMessage(typeof result === 'object' ? result : { text: result ?? success, tone: 'success' });
    } catch (error) {
      if (mounted.current && generation === actionGeneration.current)
        setMessage({ text: accountErrorMessage(error, "Demande impossible."), tone: 'danger' });
    } finally {
      if (mounted.current && generation === actionGeneration.current)
        setBusy(false);
    }
  }

  function billingReturnUrl(): string {
    if (['http:', 'https:'].includes(window.location.protocol))
      return `${window.location.origin}${window.location.pathname}`;
    return import.meta.env.VITE_SCENARIO_BILLING_RETURN_URL ?? 'https://senario.app/';
  }

  async function openHostedBillingUrl(url: string): Promise<void> {
    if (isTauri()) await openUrl(url);
    else window.location.assign(url);
  }

  async function startSubscription(offer: BillingOfferView): Promise<string> {
    const returnUrl = billingReturnUrl();
    const success = new URL(returnUrl);
    success.searchParams.set('billing', 'success');
    const cancel = new URL(returnUrl);
    cancel.searchParams.set('billing', 'canceled');
    const checkout = await accountApi().createCheckoutSession({
      selectionId: offer.selectionId,
      successUrl: success.toString(),
      cancelUrl: cancel.toString(),
    });
    await openHostedBillingUrl(checkout.checkoutUrl);
    return 'Paiement sécurisé ouvert dans votre navigateur. Revenez ensuite dans Senario et actualisez votre compte.';
  }

  async function manageSubscription(): Promise<string> {
    const portal = await accountApi().createBillingPortal(billingReturnUrl());
    await openHostedBillingUrl(portal.portalUrl);
    return 'La gestion sécurisée de votre abonnement est ouverte dans votre navigateur.';
  }

  async function completeSignIn(
    createSession: () => Promise<SessionTokens>,
  ): Promise<UiFeedbackMessage | undefined> {
    const attempt = authAttemptFence.current.start();
    const nextSession = await createSession();
    if (!mounted.current || !authAttemptFence.current.isCurrent(attempt)) {
      await sessions.discard(nextSession);
      return;
    }
    return loadAuthenticatedAccount(nextSession, true);
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    if (screen === "signin") {
      await run(
        () => completeSignIn(() => auth.signIn(email, password)),
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
    if (!session) return;
    const isCurrent = deviceId === currentDeviceId;
    if (!await showSenarioConfirm({
      title: 'Désactiver l’appareil',
      description: isCurrent
        ? 'Désactiver cet appareil ? Vous resterez connecté, mais les fonctions payantes exigeront une nouvelle activation.'
        : 'Désactiver cet autre appareil ? Sa licence sera révoquée à sa prochaine connexion ou à l’expiration de son accès hors ligne.',
      confirmLabel: 'Désactiver',
      cancelLabel: 'Annuler',
      destructive: true,
      kind: 'warning',
    })) return;
    const api = accountApi();
    accountOverview.invalidate();
    const previousDevices = devices;
    setDevices(current => current.filter(device => device.id !== deviceId));
    try {
      if (isCurrent) await exclusiveDeviceSession.release();
      await api.deactivateDevice(deviceId);
      if (isCurrent) {
        deviceActivation.suspend();
        setCurrentDeviceId(null);
        await offlineLicense.clear();
      } else if (!currentDeviceId) {
        deviceActivation.resume();
        const currentDevice = await deviceActivation.ensure();
        setCurrentDeviceId(currentDevice.id);
        await exclusiveDeviceSession.takeOver(currentDevice.id);
      }
      if (!isCurrent) void refreshOfflineRights(me ?? undefined);
    } catch (error) {
      setDevices(previousDevices);
      throw error;
    }
  }

  async function replaceRegisteredDevice(deviceId: string) {
    const api = accountApi();
    accountOverview.invalidate();
    await api.deactivateDevice(deviceId);
    deviceActivation.resume();
    const currentDevice = await deviceActivation.ensure();
    await exclusiveDeviceSession.takeOver(currentDevice.id);
    setCurrentDeviceId(currentDevice.id);
    setDeviceLimitReached(false);
    setSessionConflict(null);
    setDevices((await api.getDevices()).filter(device => device.status === 'active'));
    await refreshOfflineRights(me ?? undefined);
    void cloudSyncQueue.process().catch(() => {
      setSectionErrors((current) => ({
        ...current,
        sync: 'La synchronisation Cloud est en attente. Vos fichiers locaux restent accessibles.',
      }));
    });
  }

  async function takeOverActiveSession() {
    if (!currentDeviceId) return;
    await exclusiveDeviceSession.takeOver(currentDeviceId);
    setSessionConflict(null);
    setMessage({ text: 'Cet appareil est maintenant la session active.', tone: 'success' });
    void cloudSyncQueue.process().catch(() => {
      setSectionErrors((current) => ({
        ...current,
        sync: 'La synchronisation Cloud est en attente. Vos fichiers locaux restent accessibles.',
      }));
    });
  }

  async function reactivateCurrentDevice() {
    accountOverview.invalidate();
    deviceActivation.resume();
    const currentDevice = await deviceActivation.ensure();
    setCurrentDeviceId(currentDevice.id);
    await exclusiveDeviceSession.ensure(currentDevice.id);
    const api = accountApi();
    setDevices((await api.getDevices()).filter(device => device.status === 'active'));
    await refreshOfflineRights(me ?? undefined);
  }

  async function signOut(): Promise<string | undefined> {
    authAttemptFence.current.invalidate();
    const hadUnsyncedChanges = cloudProjectRuntime.hasUnsyncedChanges();
    try {
      await cloudProjectRuntime.close();
    } catch (error) {
      if (hadUnsyncedChanges) {
        throw new AuthSessionError(
          'La déconnexion est interrompue : la copie locale des modifications Cloud n’a pas pu être sécurisée. Réessayez avant de fermer la session.',
          false,
        );
      }
      // With no pending content, a broken realtime disconnect is harmless:
      // the server lease expires independently and logout may continue.
    }

    let releaseFailed = false;
    await exclusiveDeviceSession.release(true).catch(() => {
      releaseFailed = true;
    });
    authenticatedOperations.stop();
    loadGeneration.current += 1;
    accountOverview.invalidate();
    try {
      await sessions.logout();
    } catch (error) {
      // The vault is the logout commit point. Keep the account visible and
      // retryable instead of claiming success while its refresh token remains.
      authenticatedOperations.reset();
      deviceActivation.resume();
      throw error;
    }

    setOffline(false);
    let browserCacheFailed = false;
    try {
      window.localStorage.removeItem("scenario-commercial-signed-entitlements-v2");
      window.localStorage.removeItem(BOUND_CACHE_KEY);
    } catch {
      browserCacheFailed = true;
    }
    setSession(false);
    setCurrentDeviceId(null);
    setMe(null);
    setEntitlements(null);
    setDevices([]);
    setBilling(null);
    setActivations([]);
    setDeviceLimitReached(false);
    setSessionConflict(null);
    const cleanup = await Promise.allSettled([
      offlineLicense.clear(),
      cloudSyncQueue.pauseAndForgetAccount(),
    ]);
    if (
      browserCacheFailed ||
      cleanup.some((result) => result.status === 'rejected')
    ) {
      throw new AuthSessionError(
        'La session est fermée et les droits sont désactivés, mais le nettoyage persistant est incomplet. Fermez puis relancez Senario avant de vous reconnecter.',
        false,
      );
    }
    if (releaseFailed)
      return 'Session fermée. La réservation de cet appareil expirera automatiquement côté serveur.';
    return undefined;
  }

  async function redeemActivationKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const api = accountApi();
    accountOverview.invalidate();
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
    await refreshOfflineRights(me ?? undefined);
    setEntitlements(nextEntitlements);
    setBilling(nextBilling.billing);
    setOffers(nextBilling.offers);
    setActivations(nextActivations.activations);
    setDevices(nextDevices.filter(device => device.status === 'active'));
    form.reset();
  }

  async function changeAccountEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const newEmail = String(data.get('newEmail') ?? '').trim().toLocaleLowerCase('fr-FR');
    const password = String(data.get('currentPassword') ?? '');
    if (newEmail === me.account.email.toLocaleLowerCase('fr-FR')) throw new AuthSessionError('Saisissez une adresse différente de l’adresse actuelle.', false);
    const nextSession = await auth.changeEmail(me.account.email, password, newEmail);
    await sessions.accept(nextSession);
    form.reset();
    setEmailChangeOpen(false);
    return 'Confirmez le changement depuis les messages envoyés à l’ancienne et à la nouvelle adresse.';
  }

  async function changeAccountPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get('currentPassword') ?? '');
    const newPassword = String(data.get('newPassword') ?? '');
    const confirmation = String(data.get('newPasswordConfirmation') ?? '');
    validatePasswordChange(currentPassword, newPassword, confirmation);
    const nextSession = await auth.updatePassword(me.account.email, currentPassword, newPassword);
    await sessions.accept(nextSession);
    form.reset();
    setPasswordChangeOpen(false);
    return 'Mot de passe modifié. La session de cet appareil reste active.';
  }

  async function purgeClosedAccount(accountId: string): Promise<void> {
    // The remote 202 response is the commit point: no account-derived local
    // state is erased until the service has durably accepted the closure.
    authenticatedOperations.stop();
    loadGeneration.current += 1;
    accountOverview.invalidate();
    deviceActivation.suspend();
    exclusiveDeviceSession.reset();

    const cleanupResults = await Promise.allSettled([
      cloudProjectRuntime.deleteAccount(accountId),
      sessions.invalidate(),
      offlineLicense.clear(),
      cloudSyncQueue.pauseAndForgetAccount(),
    ]);
    let browserCacheFailed = false;
    try {
      window.localStorage.removeItem('scenario-commercial-signed-entitlements-v2');
      window.localStorage.removeItem(BOUND_CACHE_KEY);
    } catch {
      browserCacheFailed = true;
    }

    setOffline(false);
    setSession(false);
    setCurrentDeviceId(null);
    setMe(null);
    setEntitlements(null);
    setDevices([]);
    setBilling(null);
    setActivations([]);
    setDeviceLimitReached(false);
    setSessionConflict(null);
    setSectionErrors({});
    setEmailChangeOpen(false);
    setPasswordChangeOpen(false);
    setAccountClosureOpen(false);

    if (browserCacheFailed || cleanupResults.some((result) => result.status === 'rejected')) {
      throw new AuthSessionError(
        'Le compte est clôturé, mais le nettoyage local est incomplet. Fermez puis relancez Senario.',
        false,
      );
    }
  }

  async function submitAccountClosure(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (localTestMode || !me || accountClosureUncertain) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage(null);
    try {
      const api = accountApi();
      const completed = await runAccountClosure({
        accountId: me.account.id,
        email: me.account.email,
        currentPassword: String(data.get('currentPassword') ?? ''),
        confirmation: String(data.get('confirmation') ?? ''),
        pending: pendingClosureRef.current,
      }, {
        auth,
        checkLocalSafety: async () => {
          if (await cloudProjectRuntime.hasRecoverableUnsyncedCopies(me.account.id)) {
            throw new AuthSessionError(
              'Un projet Cloud contient des modifications locales non synchronisées. Synchronisez-le ou téléchargez sa copie locale avant de clôturer le compte.',
              false,
            );
          }
        },
        acceptSession: (nextSession) => sessions.accept(nextSession),
        confirmIrreversible: () => showSenarioConfirm({
          title: 'Clôturer définitivement le compte',
          description: 'Cette action est irréversible. Les projets récupérables seront préparés selon vos droits, puis le compte et ses accès seront supprimés.',
          confirmLabel: 'Clôturer définitivement',
          cancelLabel: 'Annuler',
          destructive: true,
          kind: 'warning',
        }),
        createVerificationToken: createAccountClosureVerificationToken,
        persistPending: async (pending) => {
          await pendingAccountClosure.write(pending);
          pendingClosureRef.current = pending;
        },
        clearPending: async () => {
          await pendingAccountClosure.clear();
          pendingClosureRef.current = null;
        },
        closeRemote: (verificationToken) => api.closeAccount(verificationToken),
        verifyRemote: (verificationToken) => api.verifyAccountClosure(verificationToken),
        purgeLocal: () => purgeClosedAccount(me.account.id),
      });
      if (!completed) {
        setMessage({ text: 'Clôture annulée. Votre compte reste ouvert.', tone: 'info' });
        return;
      }
      pendingClosureRef.current = null;
      setAccountClosureUncertain(false);
      form.reset();
      setMessage({ text: 'Compte clôturé. Les données de session de cet appareil ont été effacées.', tone: 'success' });
    } catch (error) {
      if (error instanceof AccountClosureUncertainError) {
        pendingClosureRef.current = {
          schemaVersion: 1,
          accountId: error.accountId,
          verificationToken: error.verificationToken,
          createdAt: pendingClosureRef.current?.createdAt ?? new Date().toISOString(),
        };
      }
      setAccountClosureUncertain(isAccountClosureResultUncertain(error));
      setMessage({ text: accountClosureErrorMessage(error), tone: isAccountClosureResultUncertain(error) ? 'warning' : 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function verifyUncertainAccountClosure(): Promise<string> {
    const pending = pendingClosureRef.current ?? await pendingAccountClosure.read();
    if (!pending)
      throw new AuthSessionError('La preuve de cette tentative n’est plus disponible. Consultez le dernier e-mail reçu avant toute nouvelle action.', false);
    try {
      const result = await accountApi().verifyAccountClosure(pending.verificationToken);
      if (result.closed) {
        await purgeClosedAccount(pending.accountId);
        await pendingAccountClosure.clear();
        pendingClosureRef.current = null;
        setAccountClosureUncertain(false);
        return 'La clôture est confirmée. Les données de session de cet appareil ont été effacées.';
      }
      // The exact receipt is not known by the server. Preserve it and allow a
      // deliberate replay with the same receipt after reauthentication. This
      // is idempotent server-side and prevents an ambiguous lost request from
      // blocking account closure forever or creating a second attempt.
      setAccountClosureUncertain(false);
      setAccountClosureOpen(Boolean(me && me.account.id === pending.accountId));
      setScreen('signin');
      return me
        ? 'La demande précédente n’a pas été enregistrée. Saisissez votre mot de passe pour reprendre exactement la même tentative.'
        : 'La demande précédente n’a pas été enregistrée. Reconnectez-vous pour reprendre exactement la même tentative.';
    } catch (error) {
      if (error instanceof AccountClosureUncertainError) throw error;
      throw new AccountClosureUncertainError(pending.verificationToken, pending.accountId);
    }
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
    : sectionErrors.billing ? 'Indisponible' : 'Chargement…';
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
        className={`account-license-panel ${session && (me || entitlements) ? 'account-overview-panel' : 'account-signin-panel'}`}
        role="dialog"
        aria-modal="true"
        aria-label="Compte et licence"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{sessionLoading || session ? 'Compte et licence' : screen === 'signin' ? 'Se connecter' : screen === 'signup' ? 'Créer un compte' : 'Réinitialiser le mot de passe'}</h2>
            {session && (me || entitlements) && localTestMode && <p>Compte de démonstration</p>}
          </div>
          {!required && (
            <UiIconButton
              className="panel-close-button"
              label="Fermer"
              tooltip="Fermer"
              onClick={onClose}
            >
              <UiIcon name="x"/>
            </UiIconButton>
          )}
        </header>

        {accountClosureUncertain && !session ? (
          <UiFeedback className="account-session-loading account-closure-uncertain" tone="warning" role="alert">
            <p>Une demande de clôture a peut-être été acceptée. Ne la renvoyez pas : vérifiez uniquement le reçu enregistré sur cet appareil.</p>
            <UiButton disabled={busy} onClick={() => void run(verifyUncertainAccountClosure, '')}>
              Vérifier l’état du compte
            </UiButton>
          </UiFeedback>
        ) : sessionLoading ? (
          <UiEmptyState className="account-session-loading" title="Ouverture de votre compte…" />
        ) : session && !me && !entitlements ? (
          <UiEmptyState className="account-session-loading"
            title={busy && !sectionErrors.profile && !sectionErrors.entitlements
              ? 'Chargement sécurisé du compte…'
              : sectionErrors.profile ?? sectionErrors.entitlements ?? 'Les informations principales du compte n’ont pas pu être chargées.'}
            action={!busy ? <div className="account-session-recovery-actions">
              <UiButton onClick={() => void run(() => loadAuthenticatedAccount(undefined, true), 'Compte actualisé.')}>Réessayer</UiButton>
              <UiButton variant="ghost" onClick={() => void run(signOut, 'Session fermée.')}>Se déconnecter</UiButton>
            </div> : undefined} />
        ) : session && (me || entitlements) ? (
          <div className="account-license-details">
            <div className="account-overview-grid">
              <section className="account-license-section account-profile-section">
                <div className="account-profile-heading">
                  <span className="account-profile-icon"><UiIcon name="user" /></span>
                  <div>
                    <h3>{me?.account.displayName ?? 'Mon compte'}</h3>
                    <p>{me?.account.email ?? sectionErrors.profile ?? 'Profil temporairement indisponible'}</p>
                  </div>
                  <span className={`account-plan-badge ${billingStatus === 'Actif' ? 'is-active' : ''}`}>
                    {billing?.offerDisplayName ?? (sectionErrors.billing ? 'Indisponible' : 'Chargement…')}
                  </span>
                </div>
                {!localTestMode && me && <div className="account-email-change">
                  <button type="button" disabled={busy} onClick={() => { setPasswordChangeOpen(false); setAccountClosureOpen(false); setEmailChangeOpen(open => !open); }}>{emailChangeOpen ? 'Annuler le changement' : 'Modifier l’adresse e-mail'}</button>
                  {emailChangeOpen && <form onSubmit={event => void run(() => changeAccountEmail(event), '')}>
                    <label>Nouvelle adresse e-mail<input name="newEmail" type="email" required autoComplete="email" /></label>
                    <label>Mot de passe actuel<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
                    <button className="primary-button" type="submit" disabled={busy}>Envoyer les confirmations</button>
                  </form>}
                </div>}
                {!localTestMode && me && <div className="account-email-change account-password-change">
                  <button type="button" disabled={busy} onClick={() => { setEmailChangeOpen(false); setAccountClosureOpen(false); setPasswordChangeOpen(open => !open); }}>{passwordChangeOpen ? 'Annuler le changement' : 'Modifier le mot de passe'}</button>
                  {passwordChangeOpen && <form onSubmit={event => void run(() => changeAccountPassword(event), '')}>
                    <label>Mot de passe actuel<input name="currentPassword" type="password" required autoComplete="current-password" /></label>
                    <label>Nouveau mot de passe ({ACCOUNT_PASSWORD_MIN_LENGTH} caractères minimum)<input name="newPassword" type="password" required minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} autoComplete="new-password" /></label>
                    <label>Confirmer le nouveau mot de passe<input name="newPasswordConfirmation" type="password" required minLength={ACCOUNT_PASSWORD_MIN_LENGTH} maxLength={ACCOUNT_PASSWORD_MAX_LENGTH} autoComplete="new-password" /></label>
                    <button className="primary-button" type="submit" disabled={busy}>Modifier</button>
                  </form>}
                </div>}
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
                  {entitlements ? <div>
                    <dt>Accès hors connexion</dt>
                    <dd>Jusqu’au {new Date(entitlements.snapshot.offlineValidUntil).toLocaleDateString('fr-FR')}</dd>
                  </div> : <div>
                    <dt>Droits</dt>
                    <dd>{sectionErrors.entitlements ?? 'Actualisation nécessaire'}</dd>
                  </div>}
                </dl>
                {(sectionErrors.license || sectionErrors.sync) && <UiFeedback className="account-section-error" tone="danger">
                  {[sectionErrors.license, sectionErrors.sync].filter(Boolean).join(' ')}
                </UiFeedback>}
              </section>
              <AiBudgetUsage />
            </div>

            <section className="account-license-section account-rights-section">
              <div className="account-section-heading">
                <h3>Fonctionnalités de votre offre</h3>
                <span>{displayedRights.filter((right) => right.enabled).length} actives</span>
              </div>
              {!entitlements && <UiFeedback className="account-section-error" tone="danger">
                {sectionErrors.entitlements ?? 'Les fonctionnalités ne peuvent pas être confirmées pour le moment.'}
              </UiFeedback>}
              {(['Gratuite', 'Auteur', 'Studio', undefined] as const).map(offer => {
                const rights = displayedRights.filter(right => right.offer === offer);
                return rights.length > 0 && <div key={offer ?? 'additional'}>
                <h4>{offer ? `Offre ${offer}` : 'Fonctionnalités supplémentaires'}</h4>
                <ul className="account-rights-grid">
                {rights.map((right) => (
                  <li key={right.id} className={right.enabled ? 'is-enabled' : 'is-disabled'}>
                    <span className="account-right-icon">
                      <UiIcon name={right.enabled ? 'check' : 'x'} />
                    </span>
                    <span>{right.label}</span>
                    <small>{right.enabled ? 'Actif' : 'Inactif'}</small>
                  </li>
                ))}
              </ul>
              </div>;
              })}
            </section>

            <section className="account-license-section account-billing-section">
              <div className="account-section-heading">
                <div>
                  <h3>Abonnement et facturation</h3>
                  <p>Le paiement et la gestion de l’abonnement s’effectuent sur la page sécurisée Stripe.</p>
                </div>
                {billing?.testMode && <span className="account-test-mode">Test</span>}
              </div>
              {sectionErrors.billing ? (
                <UiFeedback className="account-section-error" tone="danger">{sectionErrors.billing}</UiFeedback>
              ) : !billing ? (
                <p>Chargement de vos offres…</p>
              ) : (
                <>
                  {billing.status !== 'none' && billing.source === 'stripe' && (
                    <div className="account-billing-current">
                      <span>
                        <strong>{billing.offerDisplayName ?? 'Abonnement Senario'}</strong>
                        <small>{billing.cancelAtPeriodEnd
                          ? 'Annulation prévue à la fin de la période en cours.'
                          : billing.currentPeriodEndsAt
                            ? `Renouvellement le ${new Date(billing.currentPeriodEndsAt).toLocaleDateString('fr-FR')}.`
                            : 'Abonnement géré par Stripe.'}</small>
                      </span>
                      <button type="button" disabled={busy} onClick={() => void run(manageSubscription, '')}>Gérer</button>
                    </div>
                  )}
                  {offers.length > 0 && (
                    <div className="account-offer-list">
                      {offers.map((offer) => (
                        <div key={offer.selectionId} className="account-offer">
                          <div>
                            <strong>{offer.displayName}</strong>
                            <small>{offer.description ?? `${offer.billingInterval === 'year' ? 'Facturation annuelle' : 'Facturation mensuelle'} · ${priceLabel(offer)}`}</small>
                          </div>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={busy || (billing.status === 'active' && billing.offerCode === offer.offerCode && billing.billingInterval === offer.billingInterval)}
                            onClick={() => void run(() => startSubscription(offer), '')}
                          >
                            {billing.status === 'active' && billing.offerCode === offer.offerCode && billing.billingInterval === offer.billingInterval ? 'Offre actuelle' : 'Choisir'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {offers.length === 0 && billing.status === 'none' && <p>Aucune offre n’est disponible pour le moment. Réessayez plus tard.</p>}
                </>
              )}
            </section>

            <div className="account-management-grid">
              <section className="account-license-section account-device-section">
                <div className="account-section-heading">
                  <h3>Appareils</h3>
                  <span>{activeDevices.length} actif(s)</span>
                </div>
                <p className="account-device-help">Cet appareil est autorisé automatiquement après votre connexion.</p>
                {(sectionErrors.device || sectionErrors.devices) && (
                  <UiFeedback className="account-section-error" tone="danger">{sectionErrors.device ?? sectionErrors.devices}</UiFeedback>
                )}
                {activeDevices.length ? (
                  <ul className="account-device-list">
                    {activeDevices.map((device) => (
                      <li key={device.id}>
                        <span>
                          <strong>{device.id === currentDeviceId ? 'Cet appareil' : device.label ?? 'Appareil autorisé'}</strong>
                          <small>
                            {device.platform === 'windows' ? 'Windows' : 'macOS'} · première activation {new Date(device.firstActivatedAt ?? device.lastSeenAt).toLocaleDateString('fr-FR')}
                            {' · '}dernière utilisation {new Date(device.lastSeenAt).toLocaleDateString('fr-FR')}
                            {device.clientVersion ? ` · Senario ${device.clientVersion}` : ''}
                          </small>
                        </span>
                        {device.status === 'active' ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void run(
                              () => removeRegisteredDevice(device.id),
                              'Ancien appareil retiré. Cet appareil est maintenant autorisé.',
                            )}
                          >
                            Désactiver
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Aucun appareil actif.</p>
                )}
                {!currentDeviceId && (
                  <button type="button" disabled={busy} onClick={() => void run(reactivateCurrentDevice, 'Cet appareil est réactivé.')}>Réactiver cet appareil</button>
                )}
              </section>

              <section className="account-license-section account-activation-section">
                <h3>Clé d’activation</h3>
                {sectionErrors.activations && (
                  <UiFeedback className="account-section-error" tone="danger">{sectionErrors.activations}</UiFeedback>
                )}
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
            {!localTestMode && me && <section className="account-license-section account-danger-section">
              <div className="account-danger-heading">
                <div>
                  <h3>Clôture du compte</h3>
                  <p>Supprime définitivement le compte et révoque ses accès. Cette action ne peut pas être annulée.</p>
                </div>
                {!accountClosureUncertain && <button
                  className="is-danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEmailChangeOpen(false);
                    setPasswordChangeOpen(false);
                    setAccountClosureOpen((open) => !open);
                  }}
                >
                  {accountClosureOpen ? 'Annuler' : 'Clôturer le compte'}
                </button>}
              </div>
              {accountClosureOpen && <form className="account-closure-form" onSubmit={(event) => void submitAccountClosure(event)}>
                <p className="account-closure-warning">
                  Après validation, vos sessions et licences locales seront effacées. Les projets éligibles à la récupération seront envoyés par e-mail ; les projets accessibles uniquement en lecture ne seront pas inclus.
                </p>
                <label>
                  Mot de passe actuel
                  <input name="currentPassword" type="password" required autoComplete="current-password" />
                </label>
                <label>
                  Recopiez exactement <code>{ACCOUNT_CLOSURE_CONFIRMATION}</code>
                  <input name="confirmation" required autoComplete="off" spellCheck={false} />
                </label>
                <button className="is-danger" type="submit" disabled={busy}>
                  Clôturer définitivement
                </button>
              </form>}
              {accountClosureUncertain && <UiFeedback className="account-closure-uncertain" tone="warning" role="alert">
                <p>Une demande a peut-être été acceptée, mais sa réponse n’est pas arrivée. Ne la renvoyez pas. Actualisez uniquement l’état du compte et consultez le dernier e-mail reçu.</p>
                <UiButton disabled={busy} onClick={() => void run(verifyUncertainAccountClosure, '')}>
                  Vérifier l’état du compte
                </UiButton>
              </UiFeedback>}
            </section>}
            <footer>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => loadAuthenticatedAccount(undefined, true), "Compte actualisé.")}
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
                            completeSignIn(() =>
                              (auth as LocalTestAuthAdapter).signInAs(profile),
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
                  <input name="displayName" autoComplete="name" required maxLength={ACCOUNT_DISPLAY_NAME_MAX_LENGTH} />
                </label>
              )}
              <label>
                Adresse e-mail
                <input name="email" type="email" autoComplete="email" required maxLength={ACCOUNT_EMAIL_MAX_LENGTH} />
              </label>
              {screen !== "recover" && (
                <label>
                  Mot de passe
                  <input
                    name="password"
                    type="password"
                    autoComplete={screen === "signup" ? "new-password" : "current-password"}
                    minLength={screen === "signup" ? ACCOUNT_PASSWORD_MIN_LENGTH : undefined}
                    maxLength={screen === "signup" ? ACCOUNT_PASSWORD_MAX_LENGTH : undefined}
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
        {message && <UiFeedback className="account-license-message" tone={message.tone}>{message.text}</UiFeedback>}
        <UiDialog
          open={Boolean(session && (me || entitlements) && deviceLimitReached)}
          onOpenChange={(open) => { if (!open && !required && !busy) onClose(); }}
          title="Deux appareils sont déjà autorisés"
          description="Pour utiliser Senario ici, choisissez l’appareil à supprimer. Le nouveau sera ensuite activé automatiquement."
          className="device-access-dialog"
          backdropClassName="theme-dark"
          destructive
          dismissible={!required && !busy}
          footer={!required ? <UiButton disabled={busy} onClick={onClose}>Annuler</UiButton> : undefined}
        >
          <ul>
            {activeDevices.map(device => (
              <li key={device.id}>
                <span>
                  <strong>{device.label ?? (device.platform === 'windows' ? 'PC Windows' : 'Mac')}</strong>
                  <small>{device.platform === 'windows' ? 'Windows' : 'macOS'} · dernière utilisation {new Date(device.lastSeenAt).toLocaleString('fr-FR')}</small>
                </span>
                <UiButton disabled={busy} onClick={() => void run(
                  () => replaceRegisteredDevice(device.id),
                  'Appareil remplacé. Celui-ci est maintenant autorisé.',
                )}>Supprimer et utiliser ici</UiButton>
              </li>
            ))}
          </ul>
        </UiDialog>
        <UiDialog
          open={Boolean(session && me && entitlements && sessionConflict && !deviceLimitReached)}
          onOpenChange={(open) => { if (!open && !required && !busy) onClose(); }}
          title="Senario est déjà ouvert ailleurs"
          description={<>{sessionConflict?.activeDevice?.label ?? 'Un autre appareil'} utilise actuellement ce compte. Vous pouvez reprendre la session ici ; l’autre appareil sera bloqué immédiatement à sa prochaine synchronisation.</>}
          className="device-access-dialog"
          backdropClassName="theme-dark"
          destructive
          dismissible={!required && !busy}
          footer={<>{!required && <UiButton disabled={busy} onClick={onClose}>Annuler</UiButton>}<UiButton variant="primary" disabled={busy} onClick={() => void run(takeOverActiveSession, 'Session reprise sur cet appareil.')}>Utiliser Senario ici</UiButton></>}
        />
      </section>
    </div>
  );
}

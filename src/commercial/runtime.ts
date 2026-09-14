import { createAuthenticatedCommercialApi } from "./authenticatedApi";
import { createLocalTestAuthAdapter, createSupabaseAuthAdapter, type AuthAdapter } from "./auth";
import { createOfflineTrustStore } from "./offlineTrust";
import { SessionManager } from "./session";
import { createRuntimeTokenVault } from "./tokenVault";
import { CloudSyncQueue, createBrowserSyncQueueStorage } from "./syncQueue";
import { readScenario } from "../document/persistence";
import { OfflineLicense } from './offlineLicense';
import { version as clientVersion } from '../../package.json';
import { getDeviceFingerprint, initializeDeviceIdentity } from './deviceIdentity';
import { DeviceActivation } from './deviceActivation';

export const localTestMode =
  import.meta.env.DEV && import.meta.env.VITE_SCENARIO_AUTH_MODE === "local-test";
export const apiBaseUrl = import.meta.env.VITE_SCENARIO_API_BASE_URL ?? "http://127.0.0.1:8787";

class AuthenticatedOperationScope {
  private controller = new AbortController();
  signal = () => this.controller.signal;
  reset(): void {
    if (!this.controller.signal.aborted) return;
    this.controller = new AbortController();
  }
  stop(): void {
    this.controller.abort();
  }
}
export const authenticatedOperations = new AuthenticatedOperationScope();

function createRuntimeAuthAdapter(): AuthAdapter {
  if (localTestMode) return createLocalTestAuthAdapter();
  return createSupabaseAuthAdapter({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "https://project-ref.supabase.co",
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "not-configured",
  });
}

export const auth = createRuntimeAuthAdapter();
const commercialScope = `${apiBaseUrl}|${import.meta.env.VITE_SUPABASE_URL ?? "local"}`;
export const offlineTrust = createOfflineTrustStore(
  commercialScope,
);
export const sessions = new SessionManager(
  auth,
  createRuntimeTokenVault(commercialScope),
  async (accessToken) =>
    createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl, accessToken }).logout(),
);

export function browserStorage() {
  return {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  };
}

export { getDeviceFingerprint };

export function initializeRuntimeDeviceIdentity(): Promise<void> {
  return initializeDeviceIdentity(commercialScope);
}

export function getClientPlatform(): "windows" | "macos" {
  return /mac/i.test(navigator.userAgent) ? "macos" : "windows";
}

export const deviceActivation = new DeviceActivation(async () => {
  const api = createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl,
    accessToken: () => sessions.getAccessToken(), signal: authenticatedOperations.signal });
  return api.activateDevice({ fingerprint: getDeviceFingerprint(), label: "Cet appareil", platform: getClientPlatform() });
});
sessions.subscribe(authenticated => { if (!authenticated) deviceActivation.reset(); });

export function createRuntimeCommercialApi(onUnauthorized?: () => Promise<void>) {
  return createAuthenticatedCommercialApi({
    baseUrl: apiBaseUrl,
    accessToken: () => sessions.getAccessToken(),
    onUnauthorized,
    beforeDeviceRequest: () => deviceActivation.ensure(),
    signal: authenticatedOperations.signal,
    clientContext: {
      // The published artifact must report its own version even without a local .env.
      clientVersion,
      deviceFingerprint: getDeviceFingerprint,
      platform: getClientPlatform,
    },
  });
}

export const cloudSyncQueue = new CloudSyncQueue(
  createBrowserSyncQueueStorage(),
  () => createRuntimeCommercialApi(async () => sessions.invalidate()),
  readScenario,
);

export const offlineLicense = new OfflineLicense(offlineTrust, browserStorage(), getDeviceFingerprint,
  () => createRuntimeCommercialApi(), async () => {
    const token = await sessions.getAccessToken();
    if (token) { authenticatedOperations.reset(); await deviceActivation.ensure(); }
    return token;
  });

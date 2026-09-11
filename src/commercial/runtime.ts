import { createAuthenticatedCommercialApi } from "./authenticatedApi";
import { createLocalTestAuthAdapter, createSupabaseAuthAdapter, type AuthAdapter } from "./auth";
import { createOfflineTrustStore } from "./offlineTrust";
import { SessionManager } from "./session";
import { createRuntimeTokenVault } from "./tokenVault";

export const localTestMode =
  import.meta.env.DEV && import.meta.env.VITE_SCENARIO_AUTH_MODE === "local-test";
export const apiBaseUrl = import.meta.env.VITE_SCENARIO_API_BASE_URL ?? "http://127.0.0.1:8787";

function createRuntimeAuthAdapter(): AuthAdapter {
  if (localTestMode) return createLocalTestAuthAdapter();
  return createSupabaseAuthAdapter({
    supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "https://project-ref.supabase.co",
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "not-configured",
  });
}

export const auth = createRuntimeAuthAdapter();
export const offlineTrust = createOfflineTrustStore(
  `${apiBaseUrl}|${import.meta.env.VITE_SUPABASE_URL ?? "local"}`,
);
export const sessions = new SessionManager(
  auth,
  createRuntimeTokenVault(`${apiBaseUrl}|${import.meta.env.VITE_SUPABASE_URL ?? "local"}`),
  async (accessToken) =>
    createAuthenticatedCommercialApi({ baseUrl: apiBaseUrl, accessToken }).logout(),
);

export function browserStorage() {
  return {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  };
}

export function getDeviceFingerprint(): string {
  const key = "scenario-local-device-fingerprint";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const fingerprint = crypto.randomUUID() + crypto.randomUUID();
  window.localStorage.setItem(key, fingerprint);
  return fingerprint;
}

export function getClientPlatform(): "windows" | "macos" {
  return /mac/i.test(navigator.userAgent) ? "macos" : "windows";
}

export function createRuntimeCommercialApi(onUnauthorized?: () => Promise<void>) {
  return createAuthenticatedCommercialApi({
    baseUrl: apiBaseUrl,
    accessToken: () => sessions.getAccessToken(),
    onUnauthorized,
    clientContext: {
      clientVersion: import.meta.env.VITE_SCENARIO_CLIENT_VERSION ?? "",
      deviceFingerprint: getDeviceFingerprint,
      platform: getClientPlatform,
    },
  });
}

import type {
  DeviceView,
  EntitlementsResponse,
  MeResponse,
  PublicConfiguration,
  UsageView,
} from "./contractsV2";
import type { ActivationRedeemResponse, ActivationStatusResponse, BillingOverviewResponse, BillingPortalResponse, CheckoutSessionRequest, CheckoutSessionResponse } from "./contractsV3";

export interface AuthenticatedCommercialApi {
  getConfiguration(): Promise<PublicConfiguration>;
  getMe(): Promise<MeResponse>;
  getEntitlements(): Promise<EntitlementsResponse>;
  getDevices(): Promise<DeviceView[]>;
  activateDevice(input: { fingerprint: string; label: string; platform: "windows" | "macos" }): Promise<DeviceView>;
  deactivateDevice(deviceId: string): Promise<void>;
  getUsage(): Promise<UsageView[]>;
  logout(): Promise<void>;
  getBilling(): Promise<BillingOverviewResponse>;
  createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSessionResponse>;
  createBillingPortal(returnUrl: string): Promise<BillingPortalResponse>;
  getActivationStatus(): Promise<ActivationStatusResponse>;
  redeemActivationKey(input: { key: string; fingerprint: string; label: string; platform: "windows" | "macos" }): Promise<ActivationRedeemResponse>;
}

export function createAuthenticatedCommercialApi(options: {
  baseUrl: string;
  accessToken: string;
  fetcher?: typeof fetch;
}): AuthenticatedCommercialApi {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${options.accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!response.ok) throw new Error(`API Scénario indisponible (${response.status}).`);
    return (response.status === 204 ? undefined : response.json()) as Promise<T>;
  }

  return {
    getConfiguration: () => request<PublicConfiguration>("/v1/config"),
    getMe: () => request<MeResponse>("/v1/me"),
    getEntitlements: () => request<EntitlementsResponse>("/v1/entitlements"),
    getDevices: async () => (await request<{ devices: DeviceView[] }>("/v1/devices")).devices,
    activateDevice: async (input) => (await request<{ device: DeviceView }>("/v1/devices/activate", { method: "POST", body: JSON.stringify(input) })).device,
    deactivateDevice: (deviceId) => request<void>("/v1/devices/deactivate", { method: "POST", body: JSON.stringify({ deviceId }) }),
    getUsage: async () => (await request<{ usage: UsageView[] }>("/v1/usage")).usage,
    logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),
    getBilling: () => request<BillingOverviewResponse>("/v2/billing"),
    createCheckoutSession: (input) => request<CheckoutSessionResponse>("/v2/checkout/sessions", { method: "POST", body: JSON.stringify(input) }),
    createBillingPortal: (returnUrl) => request<BillingPortalResponse>("/v2/billing/portal-sessions", { method: "POST", body: JSON.stringify({ returnUrl }) }),
    getActivationStatus: () => request<ActivationStatusResponse>("/v2/activation-keys/status"),
    redeemActivationKey: (input) => request<ActivationRedeemResponse>("/v2/activation-keys/redeem", { method: "POST", body: JSON.stringify(input) }),
  };
}

import type {
  DeviceView,
  EntitlementsResponse,
  MeResponse,
  PublicConfiguration,
  UsageView,
} from "./contractsV2";
import type {
  ActivationRedeemResponse,
  ActivationStatusResponse,
  BillingOverviewResponse,
  BillingPortalResponse,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
} from "./contractsV3";
import type {
  AiActionRequest,
  AiActionResult,
  AiExecutionResponse,
  AiPdfImportRequest,
  AiPdfImportResult,
  AiReconcileResponse,
} from "./contractsV5";
import { parseAiExecutionResponse, parseAiReconcileResponse } from "./contractsV5";
import type {
  CloudScenarioListResponse,
  CloudSyncRequest,
  CloudSyncResponse,
  CloudVersionListResponse,
  TemporaryObjectGrant,
} from "./contractsV6";
import {
  parseCloudScenarioListResponse,
  parseCloudSyncResponse,
  parseCloudVersionListResponse,
} from "./contractsV6";

export class CommercialHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code = "commercial_api_error",
    message = `API Scénario indisponible (${status}).`,
    readonly requestId: string | null = null,
    readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "CommercialHttpError";
  }
}

export interface AuthenticatedCommercialApi {
  getConfiguration(): Promise<PublicConfiguration>;
  getMe(): Promise<MeResponse>;
  getEntitlements(): Promise<EntitlementsResponse>;
  getDevices(): Promise<DeviceView[]>;
  activateDevice(input: {
    fingerprint: string;
    label: string;
    platform: "windows" | "macos";
  }): Promise<DeviceView>;
  deactivateDevice(deviceId: string): Promise<void>;
  getUsage(): Promise<UsageView[]>;
  logout(): Promise<void>;
  getBilling(): Promise<BillingOverviewResponse>;
  createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSessionResponse>;
  createBillingPortal(returnUrl: string): Promise<BillingPortalResponse>;
  getActivationStatus(): Promise<ActivationStatusResponse>;
  redeemActivationKey(input: {
    key: string;
    fingerprint: string;
    label: string;
    platform: "windows" | "macos";
  }): Promise<ActivationRedeemResponse>;
  runAiAction(input: AiActionRequest): Promise<AiExecutionResponse<AiActionResult>>;
  runAiPdfImport(input: AiPdfImportRequest): Promise<AiExecutionResponse<AiPdfImportResult>>;
  reconcileAi(idempotencyKey: string): Promise<AiReconcileResponse>;
  listCloudScenarios(): Promise<CloudScenarioListResponse>;
  listCloudVersions(scenarioId: string): Promise<CloudVersionListResponse>;
  syncCloudScenario(input: CloudSyncRequest, idempotencyKey: string): Promise<CloudSyncResponse>;
  restoreCloudVersion(
    scenarioId: string,
    versionId: string,
    idempotencyKey: string,
  ): Promise<CloudSyncResponse>;
  deleteCloudScenario(scenarioId: string, idempotencyKey: string): Promise<void>;
  getCloudDownload(scenarioId: string, versionId: string): Promise<TemporaryObjectGrant>;
}

const pendingAiKeys = new Map<string, string>();

export function createAuthenticatedCommercialApi(options: {
  baseUrl: string;
  accessToken: string | (() => Promise<string | null>);
  onUnauthorized?: () => Promise<void>;
  fetcher?: typeof fetch;
  clientContext?: {
    clientVersion: string;
    deviceFingerprint: string | (() => string);
    platform: "windows" | "macos" | (() => "windows" | "macos");
  };
}): AuthenticatedCommercialApi {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken =
      typeof options.accessToken === "function" ? await options.accessToken() : options.accessToken;
    if (!accessToken) throw new Error("Reconnectez-vous pour continuer.");
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
    if (response.status === 401) await options.onUnauthorized?.();
    if (!response.ok) {
      let error: { code?: unknown; message?: unknown; request_id?: unknown; conflict?: unknown } =
        {};
      try {
        error = (await response.json()) as typeof error;
      } catch {
        /* no error body */
      }
      throw new CommercialHttpError(
        response.status,
        typeof error.code === "string" ? error.code : "commercial_api_error",
        typeof error.message === "string"
          ? error.message
          : `API Scénario indisponible (${response.status}).`,
        typeof error.request_id === "string"
          ? error.request_id
          : response.headers.get("x-request-id"),
        error.conflict && typeof error.conflict === "object" ? { conflict: error.conflict } : null,
      );
    }
    return (response.status === 204 ? undefined : response.json()) as Promise<T>;
  }

  function aiHeaders(idempotencyKey: string): HeadersInit {
    if (!options.clientContext) throw new Error("Configuration IA cliente indisponible.");
    const fingerprint =
      typeof options.clientContext.deviceFingerprint === "function"
        ? options.clientContext.deviceFingerprint()
        : options.clientContext.deviceFingerprint;
    const platform =
      typeof options.clientContext.platform === "function"
        ? options.clientContext.platform()
        : options.clientContext.platform;
    return {
      "Idempotency-Key": idempotencyKey,
      "X-Scenario-Client-Version": options.clientContext.clientVersion,
      "X-Scenario-Device-Fingerprint": fingerprint,
      "X-Scenario-Platform": platform,
    };
  }

  function cloudHeaders(idempotencyKey?: string): HeadersInit {
    if (!options.clientContext) throw new Error("Configuration cloud cliente indisponible.");
    const fingerprint =
      typeof options.clientContext.deviceFingerprint === "function"
        ? options.clientContext.deviceFingerprint()
        : options.clientContext.deviceFingerprint;
    const platform =
      typeof options.clientContext.platform === "function"
        ? options.clientContext.platform()
        : options.clientContext.platform;
    return {
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      "X-Scenario-Client-Version": options.clientContext.clientVersion,
      "X-Scenario-Device-Fingerprint": fingerprint,
      "X-Scenario-Platform": platform,
    };
  }

  async function aiRequest<T>(path: string, input: unknown): Promise<AiExecutionResponse<T>> {
    const serialized = JSON.stringify(input);
    const pendingKey = `${path}:${serialized}`;
    const idempotencyKey = pendingAiKeys.get(pendingKey) ?? crypto.randomUUID();
    pendingAiKeys.set(pendingKey, idempotencyKey);
    try {
      const raw = await request<unknown>(path, {
        method: "POST",
        headers: aiHeaders(idempotencyKey),
        body: serialized,
      });
      const response = parseAiExecutionResponse<T>(
        raw,
        path.endsWith("actions") ? "short_action" : "pdf_import",
      );
      if (response.status === "succeeded" && response.result) {
        pendingAiKeys.delete(pendingKey);
        return response;
      }
      const pending = response.status === "reserved";
      throw new CommercialHttpError(
        response.status === "uncertain" ? 504 : 409,
        response.status === "uncertain"
          ? "ai_result_uncertain"
          : pending
            ? "ai_result_pending"
            : "ai_result_not_replayable",
        response.status === "uncertain"
          ? "Le résultat IA est incertain. Réessaie pour interroger la même demande sans nouveau débit."
          : pending
            ? "Cette demande IA est encore en cours. Réessaie sans modifier son contenu."
            : "Cette demande a déjà été traitée, mais son contenu n’est pas conservé par le serveur.",
        response.request_id,
      );
    } catch (error) {
      if (
        error instanceof CommercialHttpError &&
        error.status !== 504 &&
        error.status !== 503 &&
        error.code !== "ai_result_pending"
      )
        pendingAiKeys.delete(pendingKey);
      throw error;
    }
  }

  return {
    getConfiguration: () => request<PublicConfiguration>("/v1/config"),
    getMe: () => request<MeResponse>("/v1/me"),
    getEntitlements: () => request<EntitlementsResponse>("/v3/entitlements"),
    getDevices: async () => (await request<{ devices: DeviceView[] }>("/v1/devices")).devices,
    activateDevice: async (input) =>
      (
        await request<{ device: DeviceView }>("/v1/devices/activate", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).device,
    deactivateDevice: (deviceId) =>
      request<void>("/v1/devices/deactivate", {
        method: "POST",
        body: JSON.stringify({ deviceId }),
      }),
    getUsage: async () => (await request<{ usage: UsageView[] }>("/v1/usage")).usage,
    logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),
    getBilling: () => request<BillingOverviewResponse>("/v2/billing"),
    createCheckoutSession: (input) =>
      request<CheckoutSessionResponse>("/v2/checkout/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    createBillingPortal: (returnUrl) =>
      request<BillingPortalResponse>("/v2/billing/portal-sessions", {
        method: "POST",
        body: JSON.stringify({ returnUrl }),
      }),
    getActivationStatus: () => request<ActivationStatusResponse>("/v2/activation-keys/status"),
    redeemActivationKey: (input) =>
      request<ActivationRedeemResponse>("/v2/activation-keys/redeem", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    runAiAction: (input) => aiRequest<AiActionResult>("/v4/ai/actions", input),
    runAiPdfImport: (input) => aiRequest<AiPdfImportResult>("/v4/ai/pdf-imports", input),
    reconcileAi: async (idempotencyKey) =>
      parseAiReconcileResponse(
        await request<unknown>("/v4/ai/reconcile", {
          method: "POST",
          body: JSON.stringify({ idempotencyKey }),
        }),
      ),
    listCloudScenarios: async () =>
      parseCloudScenarioListResponse(
        await request<unknown>("/v5/scenarios", { headers: cloudHeaders() }),
      ),
    listCloudVersions: async (scenarioId) =>
      parseCloudVersionListResponse(
        await request<unknown>(`/v5/scenarios/${scenarioId}/versions`, { headers: cloudHeaders() }),
      ),
    syncCloudScenario: async (input, idempotencyKey) =>
      parseCloudSyncResponse(
        await request<unknown>("/v5/scenarios/sync", {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify(input),
        }),
      ),
    restoreCloudVersion: async (scenarioId, versionId, idempotencyKey) =>
      parseCloudSyncResponse(
        await request<unknown>(`/v5/scenarios/${scenarioId}/restore`, {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify({ versionId }),
        }),
      ),
    deleteCloudScenario: async (scenarioId, idempotencyKey) => {
      await request<unknown>(`/v5/scenarios/${scenarioId}/delete`, {
        method: "POST",
        headers: cloudHeaders(idempotencyKey),
        body: "{}",
      });
    },
    getCloudDownload: async (scenarioId, versionId) => {
      const response = await request<{ download: TemporaryObjectGrant }>(
        `/v5/scenarios/${scenarioId}/versions/${versionId}/download`,
        { headers: cloudHeaders() },
      );
      return response.download;
    },
  };
}

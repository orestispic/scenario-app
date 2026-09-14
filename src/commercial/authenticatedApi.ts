import { parseMetadataResponse, type MetadataResponse, type MetadataWrite } from './contractsV10';
import { parseAiTokenBudgets, notifyAiUsageChanged, type AiTokenBudgets } from './aiTokenUsage';
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
import type {
  StudioDetailResponse,
  StudioEventsResponse,
  StudioListResponse,
  StudioMutationResponse,
  StudioRole,
} from "./contractsV7";
import {
  parseStudioDetailResponse,
  parseStudioEventsResponse,
  parseStudioListResponse,
  parseStudioMutationResponse,
} from "./contractsV7";
import {
  parseCloudScenarioListResponse,
  parseCloudSyncResponse,
  parseCloudVersionListResponse,
} from "./contractsV6";
import type {
  CollaborationConnectionResponse,
  CollaborationOperationResponse,
  CollaborationPollResponse,
  CollaborationSnapshotResponse,
  CollaborationTicketResponse,
  CollaborativeOperationRequest,
} from "./contractsV8";
import {
  parseCollaborationConnectionResponse,
  parseCollaborationOperationResponse,
  parseCollaborationPollResponse,
  parseCollaborationSnapshotResponse,
  parseCollaborationTicketResponse,
} from "./contractsV8";

export class CommercialHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code = "commercial_api_error",
    message = `API senario indisponible (${status}).`,
    readonly requestId: string | null = null,
    readonly details: Record<string, unknown> | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "CommercialHttpError";
  }
}

import { parseCloudProjects, parseProjectSharing, parseProjectInvitationResponse, type CloudProjectListResponse, type CloudProjectSharingResponse } from './contractsV9';

export interface AuthenticatedCommercialApi {
  listCloudProjects(): Promise<CloudProjectListResponse>;
  getProjectMetadata(scenarioId:string, signal?:AbortSignal):Promise<MetadataResponse>;
  writeProjectMetadata(scenarioId:string, write:MetadataWrite, signal?:AbortSignal):Promise<MetadataResponse>;
  ensureProjectSharing(scenarioId: string, idempotencyKey: string): Promise<CloudProjectSharingResponse>;
  respondProjectInvitation(invitationId: string, decision: 'accept' | 'decline', idempotencyKey: string): Promise<void>;
  cancelCollaborationRequests?(): void;
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
  getAiTokenUsage(): Promise<AiTokenBudgets>;
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
  getCloudDownload(scenarioId: string, versionId: string, signal?: AbortSignal): Promise<TemporaryObjectGrant>;
  listStudios(): Promise<StudioListResponse>;
  getStudio(studioId: string): Promise<StudioDetailResponse>;
  createStudio(
    scenarioId: string,
    name: string,
    idempotencyKey: string,
  ): Promise<StudioMutationResponse>;
  inviteStudioMember(
    studioId: string,
    email: string,
    role: Exclude<StudioRole, "owner">,
    idempotencyKey: string,
  ): Promise<StudioMutationResponse>;
  acceptStudioInvitation(token: string, idempotencyKey: string): Promise<StudioMutationResponse>;
  declineStudioInvitation(token: string, idempotencyKey: string): Promise<StudioMutationResponse>;
  revokeStudioInvitation(
    studioId: string,
    invitationId: string,
    idempotencyKey: string,
  ): Promise<StudioMutationResponse>;
  changeStudioRole(
    studioId: string,
    profileId: string,
    role: StudioRole,
    idempotencyKey: string,
  ): Promise<StudioMutationResponse>;
  removeStudioMember(
    studioId: string,
    profileId: string,
    idempotencyKey: string,
  ): Promise<StudioMutationResponse>;
  issueCollaborationTicket(studioId: string): Promise<CollaborationTicketResponse>;
  connectCollaboration(studioId: string, ticket: string, afterCursor: number): Promise<CollaborationConnectionResponse>;
  heartbeatCollaboration(studioId: string, connectionId: string): Promise<{ cursor: number; presence: CollaborationConnectionResponse["presence"] }>;
  pollCollaboration(studioId: string, connectionId: string, afterCursor: number): Promise<CollaborationPollResponse>;
  submitCollaborationOperation(studioId: string, connectionId: string, operation: CollaborativeOperationRequest): Promise<CollaborationOperationResponse>;
  compactCollaboration(studioId: string, connectionId: string, parentVersionId: string): Promise<CollaborationSnapshotResponse>;
  disconnectCollaboration(studioId: string, connectionId: string): Promise<void>;
  listStudioEvents(studioId: string, after: number): Promise<StudioEventsResponse>;
}

const pendingAiKeys = new Map<string, string>();

export function createAuthenticatedCommercialApi(options: {
  baseUrl: string;
  accessToken: string | (() => Promise<string | null>);
  onUnauthorized?: () => Promise<void>;
  beforeDeviceRequest?: () => Promise<unknown>;
  fetcher?: typeof fetch;
  signal?: () => AbortSignal;
  clientContext?: {
    clientVersion: string;
    deviceFingerprint: string | (() => string);
    platform: "windows" | "macos" | (() => "windows" | "macos");
  };
}): AuthenticatedCommercialApi {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const collaborationRequests = new Set<AbortController>();

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!path.includes('/realtime/')) {
      // AI imports use the server's longer operation window; the cloud dialog's
      // shorter network timeout must not truncate a previously valid AI request.
      const timeoutMs = path.startsWith('/v4/ai/') ? 120_000 : 15_000;
      const signals = [AbortSignal.timeout(timeoutMs), init.signal, options.signal?.()].filter((s): s is AbortSignal => Boolean(s));
      return requestInner<T>(path, { ...init, signal: AbortSignal.any(signals) });
    }
    const controller = new AbortController();
    const parent = options.signal?.();
    const abort = () => controller.abort();
    parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) abort();
    collaborationRequests.add(controller);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new CommercialHttpError(504, 'request_timeout'));
      }, 8_000);
    });
    try {
      return await Promise.race([requestInner<T>(path, { ...init, signal: controller.signal }), timeout]);
    } catch (error) {
      if (timedOut) throw new CommercialHttpError(504, 'request_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
      collaborationRequests.delete(controller);
    }
  }

  async function requestInner<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken =
      typeof options.accessToken === "function" ? await options.accessToken() : options.accessToken;
    if (!accessToken) throw new CommercialHttpError(401, 'session_expired', "Reconnectez-vous pour continuer.");
    if (new Headers(init.headers).has('X-Scenario-Device-Fingerprint') && !path.startsWith('/v3/entitlements')) {
      await options.beforeDeviceRequest?.();
    }
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? options.signal?.(),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
    if (!response.ok) {
      let error: { code?: unknown; message?: unknown; request_id?: unknown; conflict?: unknown } =
        {};
      try {
        error = (await response.json()) as typeof error;
      } catch {
        /* no error body */
      }
      // A short-lived ticket/channel is not the account session. Its expiry
      // must never erase the refresh token or log out the user.
      if (response.status === 401 && !(
        path.includes('/realtime/') &&
        ['collaboration_connection_closed', 'collaboration_ticket_invalid'].includes(String(error.code))
      ) && !init.signal?.aborted) await options.onUnauthorized?.();
      const retryHeader = response.headers.get('retry-after');
      const retryAfterMs = retryHeader === null ? null : /^\d+$/.test(retryHeader)
        ? Number(retryHeader) * 1_000
        : Math.max(0, Date.parse(retryHeader) - Date.now());
      throw new CommercialHttpError(
        response.status,
        typeof error.code === "string" ? error.code : "commercial_api_error",
        typeof error.message === "string"
          ? error.message
          : `API senario indisponible (${response.status}).`,
        typeof error.request_id === "string"
          ? error.request_id
          : response.headers.get("x-request-id"),
        error.conflict && typeof error.conflict === "object" ? { conflict: error.conflict } : null,
        Number.isFinite(retryAfterMs) ? retryAfterMs : null,
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
    } finally {
      notifyAiUsageChanged();
    }
  }

  return {
    getConfiguration: () => request<PublicConfiguration>("/v1/config"),
    getMe: () => request<MeResponse>("/v1/me"),
    getEntitlements: () => request<EntitlementsResponse>(options.clientContext ? "/v3/entitlements?offline=1" : "/v3/entitlements", options.clientContext ? { headers: cloudHeaders() } : {}),
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
    getAiTokenUsage: async () => parseAiTokenBudgets((await request<{ budgets: unknown }>("/v4/ai/usage")).budgets),
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
    getCloudDownload: async (scenarioId, versionId, signal) => {
      const response = await request<{ download: TemporaryObjectGrant }>(
        `/v5/scenarios/${scenarioId}/versions/${versionId}/download`,
        { headers: cloudHeaders(), signal },
      );
      return response.download;
    },
    listCloudProjects: async () => parseCloudProjects(await request('/v9/projects', { headers: cloudHeaders() })),
    getProjectMetadata: async (id,signal) => parseMetadataResponse(await request(`/v10/projects/${id}/metadata`,{headers:cloudHeaders(),signal})),
    writeProjectMetadata: async (id,write,signal) => parseMetadataResponse(await request(`/v10/projects/${id}/metadata`,{method:'POST',headers:cloudHeaders(write.operationId),body:JSON.stringify(write),signal})),
    ensureProjectSharing: async (scenarioId, key) => parseProjectSharing(await request(`/v9/projects/${scenarioId}/sharing`, { method: 'POST', headers: cloudHeaders(key), body: '{}' })),
    respondProjectInvitation: async (id, decision, key) => parseProjectInvitationResponse(await request(`/v9/project-invitations/${id}/respond`, { method: 'POST', headers: cloudHeaders(key), body: JSON.stringify({ decision }) })),
    listStudios: async () =>
      parseStudioListResponse(await request<unknown>("/v6/studios", { headers: cloudHeaders() })),
    getStudio: async (studioId) =>
      parseStudioDetailResponse(
        await request<unknown>(`/v6/studios/${studioId}`, { headers: cloudHeaders() }),
      ),
    createStudio: async (scenarioId, name, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>("/v6/studios", {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify({ scenarioId, name }),
        }),
      ),
    inviteStudioMember: async (studioId, email, role, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>(`/v6/studios/${studioId}/invitations`, {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify({ email, role }),
        }),
      ),
    acceptStudioInvitation: async (token, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>("/v6/studio-invitations/accept", {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify({ token }),
        }),
      ),
    declineStudioInvitation: async (token, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>("/v6/studio-invitations/decline", {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify({ token }),
        }),
      ),
    revokeStudioInvitation: async (studioId, invitationId, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>(`/v6/studios/${studioId}/invitations/${invitationId}/revoke`, {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: "{}",
        }),
      ),
    changeStudioRole: async (studioId, profileId, role, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>(`/v6/studios/${studioId}/members/${profileId}/role`, {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: JSON.stringify({ role }),
        }),
      ),
    removeStudioMember: async (studioId, profileId, idempotencyKey) =>
      parseStudioMutationResponse(
        await request<unknown>(`/v6/studios/${studioId}/members/${profileId}/remove`, {
          method: "POST",
          headers: cloudHeaders(idempotencyKey),
          body: "{}",
        }),
      ),
    listStudioEvents: async (studioId, after) =>
      parseStudioEventsResponse(
        await request<unknown>(`/v6/studios/${studioId}/events?after=${after}`, {
          headers: cloudHeaders(),
        }),
      ),
    issueCollaborationTicket: async (studioId) =>
      parseCollaborationTicketResponse(
        await request<unknown>(`/v7/studios/${studioId}/realtime/tickets`, {
          method: "POST", headers: cloudHeaders(crypto.randomUUID()), body: "{}",
        }),
      ),
    connectCollaboration: async (studioId, ticket, afterCursor) =>
      parseCollaborationConnectionResponse(
        await request<unknown>(`/v7/studios/${studioId}/realtime/connect`, {
          method: "POST", headers: cloudHeaders(crypto.randomUUID()), body: JSON.stringify({ ticket, afterCursor }),
        }),
      ),
    heartbeatCollaboration: (studioId, connectionId) =>
      request(`/v7/studios/${studioId}/realtime/heartbeat`, {
        method: "POST", headers: cloudHeaders(crypto.randomUUID()), body: JSON.stringify({ connectionId }),
      }),
    pollCollaboration: async (studioId, connectionId, afterCursor) =>
      parseCollaborationPollResponse(
        await request<unknown>(`/v7/studios/${studioId}/realtime/poll`, {
          method: "POST", headers: cloudHeaders(crypto.randomUUID()), body: JSON.stringify({ connectionId, afterCursor }),
        }),
      ),
    submitCollaborationOperation: async (studioId, connectionId, operation) =>
      parseCollaborationOperationResponse(
        await request<unknown>(`/v7/studios/${studioId}/realtime/operations`, {
          method: "POST", headers: cloudHeaders(operation.operationId), body: JSON.stringify({ connectionId, operation }),
        }),
      ),
    compactCollaboration: async (studioId, connectionId, parentVersionId) =>
      parseCollaborationSnapshotResponse(
        await request<unknown>(`/v7/studios/${studioId}/realtime/compact`, {
          method: "POST", headers: cloudHeaders(crypto.randomUUID()), body: JSON.stringify({ connectionId, parentVersionId }),
        }),
      ),
    cancelCollaborationRequests: () => {
      for (const controller of collaborationRequests) controller.abort();
      collaborationRequests.clear();
    },
    disconnectCollaboration: async (studioId, connectionId) => {
      await request<unknown>(`/v7/studios/${studioId}/realtime/disconnect`, {
        method: "POST", headers: cloudHeaders(crypto.randomUUID()), body: JSON.stringify({ connectionId }),
      });
    },
  };
}

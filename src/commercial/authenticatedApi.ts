import { parseMetadataResponse, type MetadataResponse, type MetadataWrite } from './contractsV10';
import { parseAiTokenBudgets, notifyAiUsageChanged, type AiTokenBudgets } from './aiTokenUsage';
import type {
  DeviceView,
  DeviceChallenge,
  DeviceSessionLease,
  EntitlementsResponse,
  MeResponse,
  PublicConfiguration,
  UsageView,
} from "./contractsV2";
import {
  parseDeviceView,
  parseDevicesResponse,
  parseEntitlementsResponse,
  parseMeResponse,
} from './contractsV2';
import type {
  ActivationRedeemResponse,
  ActivationStatusResponse,
  BillingOverviewResponse,
  BillingPortalResponse,
  CheckoutSessionRequest,
  CheckoutSessionResponse,
} from "./contractsV3";
import {
  parseActivationStatusResponse,
  parseBillingOverviewResponse,
  parseBillingPortalResponse,
  parseCheckoutSessionResponse,
} from './contractsV3';
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

/**
 * Turn an HTTP status/code into text that is safe to display in the desktop UI.
 *
 * The Worker response body is deliberately not used here: upstream gateways and
 * providers sometimes put SQL, storage keys or implementation details in their
 * `message` field.  `code`, `requestId` and structured conflict data remain on
 * CommercialHttpError for programmatic handling and support diagnostics.
 */
export function safeCommercialHttpMessage(status: number, code: string): string {
  if (code === 'session_expired' || status === 401) return 'Votre session a expiré. Reconnectez-vous pour continuer.';
  if (status === 403) return 'Votre compte ne permet pas cette action.';
  if (code === 'cloud_storage_quota_exceeded') return 'L’espace Cloud disponible est insuffisant.';
  if (code === 'scenario_parent_conflict') return 'Ce projet a été modifié ailleurs. Rechargez-le avant de réessayer.';
  if (code === 'device_limit_reached') return 'La limite d’appareils de cette offre est atteinte.';
  if (code === 'device_session_in_use') return 'Cette offre est déjà utilisée sur un autre appareil.';
  if (code === 'rate_limited' || status === 429) return 'Trop de demandes ont été envoyées. Réessayez dans un instant.';
  if (code === 'request_timeout' || [502, 503, 504].includes(status))
    return 'Le service Senario est temporairement indisponible. Réessayez dans un instant.';
  if (status === 404) return 'La ressource demandée est introuvable.';
  if (status === 409) return 'Cette action entre en conflit avec une modification plus récente.';
  if (status >= 500) return 'Le service Senario a rencontré une erreur. Réessayez plus tard.';
  return 'La demande n’a pas pu être effectuée.';
}

import { parseCloudProjects, parseProjectSharing, parseProjectInvitationResponse, type CloudProjectListResponse, type CloudProjectSharingResponse } from './contractsV9';
import { parseProjectVersions, type CloudProjectVersion, type VersionCommand } from './contractsV14';
import { parseContacts, parseContactMutation, type ContactListResponse } from './contractsV15';
import { parseCloudStorageStatus, type CloudStorageStatus } from './contractsV18';
import {
  parseCloudImageAssetDownload,
  parseCloudImageAssetView,
  type CloudImageAssetDownload,
  type CloudImageAssetUpload,
  type CloudImageAssetView,
} from './contractsV19';
import { parseScenarioFile, type ScenarioFile } from '../document/scenarioFile';

export interface AuthenticatedCommercialApi {
  ensureCloudImageAsset(scenarioId: string, input: CloudImageAssetUpload, idempotencyKey: string): Promise<CloudImageAssetView>;
  getCloudImageAsset(scenarioId: string, assetId: string, signal?: AbortSignal): Promise<CloudImageAssetDownload>;
  getCloudStorageStatus(): Promise<CloudStorageStatus>;
  createCloudStorageCheckout(successUrl: string, cancelUrl: string): Promise<CheckoutSessionResponse>;
  readCurrentProjectDocument(scenarioId: string, signal?: AbortSignal): Promise<ScenarioFile>;
  listContacts(): Promise<ContactListResponse>;
  requestContact(email: string, idempotencyKey: string): Promise<void>;
  respondContactRequest(requestId: string, decision: 'accept' | 'decline' | 'cancel', idempotencyKey: string): Promise<void>;
  removeContact(profileId: string, idempotencyKey: string): Promise<void>;
  listCloudProjects(): Promise<CloudProjectListResponse>;
  listProjectVersions(projectId: string): Promise<CloudProjectVersion[]>;
  changeProjectVersion(projectId: string, command: VersionCommand): Promise<void>;
  getProjectMetadata(scenarioId:string, signal?:AbortSignal):Promise<MetadataResponse>;
  writeProjectMetadata(scenarioId:string, write:MetadataWrite, signal?:AbortSignal):Promise<MetadataResponse>;
  ensureProjectSharing(scenarioId: string, idempotencyKey: string): Promise<CloudProjectSharingResponse>;
  respondProjectInvitation(invitationId: string, decision: 'accept' | 'decline', idempotencyKey: string): Promise<void>;
  cancelCollaborationRequests?(): void;
  getConfiguration(): Promise<PublicConfiguration>;
  getMe(): Promise<MeResponse>;
  getEntitlements(): Promise<EntitlementsResponse>;
  renewOfflineLicense(deviceId: string): Promise<EntitlementsResponse>;
  getDevices(): Promise<DeviceView[]>;
  activateDevice(input: {
    fingerprint: string;
    label: string;
    platform: "windows" | "macos";
  }): Promise<DeviceView>;
  deactivateDevice(deviceId: string): Promise<void>;
  claimDeviceSession(deviceId: string, force?: boolean): Promise<DeviceSessionLease>;
  heartbeatDeviceSession(deviceId: string, leaseId: string): Promise<DeviceSessionLease>;
  releaseDeviceSession(deviceId: string, leaseId: string): Promise<void>;
  getUsage(): Promise<UsageView[]>;
  getAiTokenUsage(): Promise<AiTokenBudgets>;
  logout(): Promise<void>;
  closeAccount(verificationToken: string): Promise<void>;
  verifyAccountClosure(verificationToken: string): Promise<{
    closed: boolean;
    status: 'pending_auth_deletion' | 'completed' | null;
  }>;
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
  onUnauthorized?: (failedAccessToken: string) => Promise<void>;
  beforeDeviceRequest?: () => Promise<unknown>;
  fetcher?: typeof fetch;
  signal?: () => AbortSignal;
  networkPolicy?: {
    /** Used by tests and by hosts with their own scheduler. */
    sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    /** Returns a number in [0, 1]; injectable so retry timing is deterministic in tests. */
    random?: () => number;
    accountReadTimeoutMs?: number;
    defaultReadTimeoutMs?: number;
  };
  clientContext?: {
    clientVersion: string;
    deviceFingerprint: string | (() => string);
    platform: "windows" | "macos" | (() => "windows" | "macos");
    devicePublicKey?: () => JsonWebKey;
    signDeviceChallenge?: (message: string) => Promise<string>;
    deviceKeyThumbprint?: () => string;
    signDeviceRequest?: (input: { method: string; path: string; timestamp: string; nonce: string; bodyDigest: string }) => Promise<string>;
  };
}): AuthenticatedCommercialApi {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;
  const collaborationRequests = new Set<AbortController>();

  // These are loaded together by the Account page. Retrying every request
  // independently multiplies an outage into a request storm and a 45-second
  // wait. One bounded attempt lets Account render its cached/partial state in
  // at most eight seconds. A later explicit reload is the retry.
  const isAccountRead = (path: string) => [
    '/v1/config',
    '/v1/me',
    '/v3/entitlements',
    '/v1/devices',
    '/v1/usage',
    '/v4/ai/usage',
    '/v2/billing',
    '/v2/activation-keys/status',
    '/v18/cloud/storage',
  ].includes(path);
  const sleep = options.networkPolicy?.sleep ?? ((delayMs: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abortDelay);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    const abortDelay = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) abortDelay();
    else signal?.addEventListener('abort', abortDelay, { once: true });
  }));
  const random = options.networkPolicy?.random ?? Math.random;

  async function request<T>(path: string, init: RequestInit = {}, expectedStatus?: number, allowRetry = true): Promise<T> {
    if (!path.includes('/realtime/')) {
      // AI imports use the server's longer operation window; the cloud dialog's
      // shorter network timeout must not truncate a previously valid AI request.
      const longAiOperation = path === '/v4/ai/actions' || path === '/v4/ai/pdf-imports';
      const accountRead = (!init.method || ['GET', 'HEAD'].includes(init.method.toUpperCase())) && isAccountRead(path);
      const timeoutMs = longAiOperation
        ? 120_000
        : accountRead
          ? options.networkPolicy?.accountReadTimeoutMs ?? 8_000
          : options.networkPolicy?.defaultReadTimeoutMs ?? 15_000;
      const safeToRetry = allowRetry && (!init.method || ['GET', 'HEAD'].includes(init.method.toUpperCase()));
      // Account reads are already issued as a group and deliberately have no
      // internal retry. Other idempotent reads get one jittered retry only.
      const maxAttempts = safeToRetry ? (accountRead ? 1 : 2) : 1;
      for (let attempt = 0; ; attempt += 1) {
        const signals = [AbortSignal.timeout(timeoutMs), init.signal, options.signal?.()].filter((s): s is AbortSignal => Boolean(s));
        try {
          return await requestInner<T>(path, { ...init, signal: AbortSignal.any(signals) }, expectedStatus);
        } catch (error) {
          const retryable = error instanceof TypeError || (
            error instanceof DOMException && error.name === 'TimeoutError'
          ) || (
            error instanceof CommercialHttpError && [502, 503, 504].includes(error.status)
          );
          if (!safeToRetry || !retryable || attempt + 1 >= maxAttempts || init.signal?.aborted || options.signal?.().aborted) throw error;
          const delay = error instanceof CommercialHttpError && error.retryAfterMs !== null
            ? Math.min(error.retryAfterMs, 2_000)
            : Math.round(120 + random() * 180);
          await sleep(delay, init.signal ?? options.signal?.());
        }
      }
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
      return await Promise.race([requestInner<T>(path, { ...init, signal: controller.signal }, expectedStatus), timeout]);
    } catch (error) {
      if (timedOut) throw new CommercialHttpError(504, 'request_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
      collaborationRequests.delete(controller);
    }
  }

  async function requestInner<T>(path: string, init: RequestInit = {}, expectedStatus?: number): Promise<T> {
    const accessToken =
      typeof options.accessToken === "function" ? await options.accessToken() : options.accessToken;
    if (!accessToken) throw new CommercialHttpError(401, 'session_expired', "Reconnectez-vous pour continuer.");
    // Account closure must remain possible even when the subscription/device
    // slot/active lease is broken. It is still authenticated and signed below.
    if (/^\/v(?:4|5|6|7|9|10|14|15|16|18|19)\//.test(path)) {
      await options.beforeDeviceRequest?.();
    }
    let proofHeaders: Record<string, string> = {};
    if (/^\/v(?:4|5|6|7|9|10|14|15|16|17|18|19|22)\//.test(path) && options.clientContext?.deviceKeyThumbprint && options.clientContext.signDeviceRequest) {
      const body = init.body === undefined || init.body === null ? '' : typeof init.body === 'string'
        ? init.body : (() => { throw new Error('Format de requête incompatible avec la preuve appareil.'); })();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
      let binary = '';
      for (const byte of digest) binary += String.fromCharCode(byte);
      const bodyDigest = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const timestamp = String(Date.now());
      const nonce = crypto.randomUUID();
      proofHeaders = {
        'X-Senario-Device-Key': options.clientContext.deviceKeyThumbprint(),
        'X-Senario-Device-Time': timestamp,
        'X-Senario-Device-Nonce': nonce,
        'X-Senario-Device-Body': bodyDigest,
        'X-Senario-Device-Signature': await options.clientContext.signDeviceRequest({
          method: init.method ?? 'GET', path, timestamp, nonce, bodyDigest,
        }),
      };
    }
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? options.signal?.(),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...proofHeaders,
        ...Object.fromEntries(new Headers(init.headers).entries()),
      },
    });
    if (!response.ok || (expectedStatus !== undefined && response.status !== expectedStatus)) {
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
       ) && !init.signal?.aborted) await options.onUnauthorized?.(accessToken);
      const retryHeader = response.headers.get('retry-after');
      const retryAfterMs = retryHeader === null ? null : /^\d+$/.test(retryHeader)
        ? Number(retryHeader) * 1_000
        : Math.max(0, Date.parse(retryHeader) - Date.now());
      const errorCode = typeof error.code === "string"
        ? error.code
        : expectedStatus !== undefined && response.ok
          ? "unexpected_success_status"
          : "commercial_api_error";
      throw new CommercialHttpError(
        response.status,
        errorCode,
        safeCommercialHttpMessage(response.status, errorCode),
        typeof error.request_id === "string"
          ? error.request_id
          : response.headers.get("x-request-id"),
        error.conflict && typeof error.conflict === "object" ? { conflict: error.conflict } : null,
        Number.isFinite(retryAfterMs) ? retryAfterMs : null,
      );
    }
    if (expectedStatus !== undefined || response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async function publicRequest<T>(path: string, body: unknown): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method: 'POST',
      // Receipt verification must survive account-session revocation. It is a
      // capability-scoped public read and has its own bounded lifetime.
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let payload: { code?: unknown; request_id?: unknown } = {};
      try { payload = await response.json() as typeof payload; } catch { /* no body */ }
      const code = typeof payload.code === 'string' ? payload.code : 'commercial_api_error';
      throw new CommercialHttpError(
        response.status,
        code,
        safeCommercialHttpMessage(response.status, code),
        typeof payload.request_id === 'string'
          ? payload.request_id
          : response.headers.get('x-request-id'),
      );
    }
    return response.json() as Promise<T>;
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

  async function createDeviceChallenge(purpose: DeviceChallenge['purpose'], deviceId?: string): Promise<DeviceChallenge> {
    return (await request<{ challenge: DeviceChallenge }>('/v2/devices/challenges', {
      method: 'POST',
      body: JSON.stringify({ purpose, ...(deviceId ? { deviceId } : {}) }),
    })).challenge;
  }

  function proofContext() {
    const context = options.clientContext;
    if (!context?.devicePublicKey || !context.signDeviceChallenge)
      throw new Error('Preuve cryptographique appareil indisponible.');
    return context;
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
    getMe: async () => parseMeResponse(await request<unknown>("/v1/me")),
    getEntitlements: async () => parseEntitlementsResponse(await request<unknown>("/v3/entitlements")),
    renewOfflineLicense: async (deviceId) => {
      const context = proofContext();
      const challenge = await createDeviceChallenge('license_renewal', deviceId);
      return parseEntitlementsResponse(await request<unknown>('/v2/licenses/renew', {
        method: 'POST',
        body: JSON.stringify({
          deviceId,
          challengeId: challenge.id,
          signature: await context.signDeviceChallenge!(challenge.message),
          clientVersion: context.clientVersion,
        }),
      }));
    },
    getDevices: async () => parseDevicesResponse(await request<unknown>("/v1/devices")),
    activateDevice: async (input) => {
      if (!options.clientContext?.devicePublicKey || !options.clientContext.signDeviceChallenge) {
        const response = await request<{ device?: unknown }>("/v1/devices/activate", {
          method: "POST", body: JSON.stringify(input),
        });
        return parseDeviceView(response.device);
      }
      const context = proofContext();
      const challenge = await createDeviceChallenge('activation');
      const response = await request<{ device?: unknown }>('/v2/devices/activate', {
        method: 'POST',
        body: JSON.stringify({
          ...input,
          publicKey: context.devicePublicKey!(),
          clientVersion: context.clientVersion,
          challengeId: challenge.id,
          signature: await context.signDeviceChallenge!(challenge.message),
        }),
      });
      return parseDeviceView(response.device);
    },
    deactivateDevice: (deviceId) =>
      request<void>("/v1/devices/deactivate", {
        method: "POST",
        body: JSON.stringify({ deviceId }),
      }),
    claimDeviceSession: async (deviceId, force = false) =>
      (await request<{ session: DeviceSessionLease }>('/v17/device-session/claim', {
        method: 'POST', body: JSON.stringify({ deviceId, force }),
      })).session,
    heartbeatDeviceSession: async (deviceId, leaseId) =>
      (await request<{ session: DeviceSessionLease }>('/v17/device-session/heartbeat', {
        method: 'POST', body: JSON.stringify({ deviceId, leaseId }),
      })).session,
    releaseDeviceSession: (deviceId, leaseId) =>
      request<void>('/v17/device-session/release', {
        method: 'POST', body: JSON.stringify({ deviceId, leaseId }),
      }),
    getUsage: async () => (await request<{ usage: UsageView[] }>("/v1/usage")).usage,
    getAiTokenUsage: async () => parseAiTokenBudgets((await request<{ budgets: unknown }>("/v4/ai/usage")).budgets),
    logout: () => request<void>("/v1/auth/logout", { method: "POST", body: "{}" }),
    closeAccount: (verificationToken) => request<void>(
      "/v22/account/close",
      { method: "POST", body: JSON.stringify({ confirmation: "CLOSE_MY_ACCOUNT", verificationToken }) },
      202,
    ),
    verifyAccountClosure: async (verificationToken) => {
      const response = await publicRequest<{ closed?: unknown; status?: unknown }>(
        '/v22/account/close/status',
        { verificationToken },
      );
      const validStatus = response.status === null ||
        response.status === 'pending_auth_deletion' ||
        response.status === 'completed';
      if (typeof response.closed !== 'boolean' || !validStatus ||
        response.closed !== (response.status !== null))
        throw new CommercialHttpError(502, 'invalid_response');
      return {
        closed: response.closed,
        status: response.status as 'pending_auth_deletion' | 'completed' | null,
      };
    },
    getBilling: async () => parseBillingOverviewResponse(await request<unknown>("/v2/billing")),
    createCheckoutSession: async (input) =>
      parseCheckoutSessionResponse(await request<unknown>("/v2/checkout/sessions", {
        method: "POST",
        body: JSON.stringify(input),
      })),
    createBillingPortal: async (returnUrl) =>
      parseBillingPortalResponse(await request<unknown>("/v2/billing/portal-sessions", {
        method: "POST",
        body: JSON.stringify({ returnUrl }),
      })),
    getCloudStorageStatus: async () => parseCloudStorageStatus(
      (await request<{ storage: unknown }>('/v18/cloud/storage', { headers: cloudHeaders() })).storage,
    ),
    createCloudStorageCheckout: (successUrl, cancelUrl) =>
      request<CheckoutSessionResponse>('/v18/cloud/storage/checkout', {
        method: 'POST', headers: cloudHeaders(), body: JSON.stringify({ successUrl, cancelUrl }),
      }),
    getActivationStatus: async () => parseActivationStatusResponse(await request<unknown>("/v2/activation-keys/status")),
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
    ensureCloudImageAsset: async (scenarioId, input, idempotencyKey) => parseCloudImageAssetView(
      await request<unknown>(`/v19/scenarios/${encodeURIComponent(scenarioId)}/images`, {
        method: 'POST',
        headers: cloudHeaders(idempotencyKey),
        body: JSON.stringify(input),
      }),
    ),
    getCloudImageAsset: async (scenarioId, assetId, signal) => parseCloudImageAssetDownload(
      await request<unknown>(`/v19/scenarios/${encodeURIComponent(scenarioId)}/images/${encodeURIComponent(assetId)}/download`, {
        headers: cloudHeaders(), signal,
      }),
    ),
    listContacts: async () => parseContacts(await request('/v15/contacts', { headers: cloudHeaders() })),
    requestContact: async (email, key) => parseContactMutation(await request('/v15/contact-requests', { method: 'POST', headers: cloudHeaders(key), body: JSON.stringify({ email }) })),
    respondContactRequest: async (id, decision, key) => parseContactMutation(await request(`/v15/contact-requests/${encodeURIComponent(id)}/respond`, { method: 'POST', headers: cloudHeaders(key), body: JSON.stringify({ decision }) })),
    removeContact: async (id, key) => parseContactMutation(await request(`/v15/contacts/${encodeURIComponent(id)}/remove`, { method: 'POST', headers: cloudHeaders(key), body: '{}' })),
    listCloudProjects: async () => parseCloudProjects(await request('/v9/projects', { headers: cloudHeaders() })),
    listProjectVersions: async (id) => parseProjectVersions(await request(`/v14/projects/${encodeURIComponent(id)}/versions`, { headers: cloudHeaders() }), id),
    readCurrentProjectDocument: async (id, signal) => {
      const result = await request<{ document: unknown }>(`/v16/scenarios/${encodeURIComponent(id)}/document`, {headers:cloudHeaders(),signal});
      if (!result.document) throw new Error('Document cloud incomplet.');
      return parseScenarioFile(JSON.stringify(result.document));
    },
    changeProjectVersion: async (id, command) => { await request(`/v14/projects/${encodeURIComponent(id)}/versions`, { method: 'POST', headers: { ...cloudHeaders(), 'Idempotency-Key': command.operationId }, body: JSON.stringify(command) }); },
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

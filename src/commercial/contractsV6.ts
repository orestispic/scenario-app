export const COMMERCIAL_CONTRACT_VERSION_V6 = "2026-09-v6";

export type ScenarioFormat = "scenario-v1";
export type ScenarioOrigin = "save" | "import" | "offline_replay" | "restore";
export type ScenarioAccessRole = "owner" | "editor" | "viewer";
export type SyncQueueState = "local" | "pending" | "synced" | "conflict" | "failed";

export interface CloudScenarioVersion {
  id: string;
  scenarioId: string;
  authorId: string;
  parentVersionId: string | null;
  versionNumber: number;
  checksum: string;
  sizeBytes: number;
  contentType: "application/vnd.scenario+json";
  format: ScenarioFormat;
  origin: ScenarioOrigin;
  entitlementSnapshotId: string;
  requestId: string;
  createdAt: string;
}
export interface CloudScenario {
  id: string;
  title: string;
  role: ScenarioAccessRole;
  currentVersionId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CloudSyncRequest {
  scenarioId: string;
  title: string;
  parentVersionId: string | null;
  checksum: string;
  sizeBytes: number;
  contentType: "application/vnd.scenario+json";
  format: ScenarioFormat;
  origin: Exclude<ScenarioOrigin, "restore">;
  content: string;
}
export interface TemporaryObjectGrant {
  url: string;
  operation: "download";
  expiresAt: string;
}
export interface CloudSyncResponse {
  contractVersion: "2026-09-v6";
  scenario: CloudScenario;
  version: CloudScenarioVersion;
  replayed: boolean;
  download: TemporaryObjectGrant;
  request_id: string;
}
export interface CloudScenarioListResponse {
  contractVersion: "2026-09-v6";
  scenarios: CloudScenario[];
  request_id: string;
}
export interface CloudVersionListResponse {
  contractVersion: "2026-09-v6";
  versions: CloudScenarioVersion[];
  request_id: string;
}
export interface CloudRestoreRequest {
  versionId: string;
}
export interface CloudConflict {
  code: "scenario_parent_conflict";
  scenarioId: string;
  localParentVersionId: string | null;
  remoteVersionId: string;
  options: readonly ["keep_local", "download_remote", "create_copy"];
}
export interface StudioMembership {
  scenarioId: string;
  profileId: string;
  role: Exclude<ScenarioAccessRole, "owner">;
  status: "invited" | "active" | "revoked";
}
export interface CollaborationNotifier {
  membershipChanged(membership: StudioMembership): Promise<void>;
}
export interface CollaborationChannel {
  publishScenarioVersion(scenarioId: string, versionId: string): Promise<void>;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function scenario(value: unknown): value is CloudScenario {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    ["owner", "editor", "viewer"].includes(String(value.role)) &&
    (value.currentVersionId === null || typeof value.currentVersionId === "string") &&
    (value.deletedAt === null || typeof value.deletedAt === "string") &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}
function version(value: unknown): value is CloudScenarioVersion {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.scenarioId === "string" &&
    typeof value.authorId === "string" &&
    (value.parentVersionId === null || typeof value.parentVersionId === "string") &&
    Number.isSafeInteger(value.versionNumber) &&
    typeof value.checksum === "string" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.contentType === "application/vnd.scenario+json" &&
    value.format === "scenario-v1" &&
    ["save", "import", "offline_replay", "restore"].includes(String(value.origin)) &&
    typeof value.entitlementSnapshotId === "string" &&
    typeof value.requestId === "string" &&
    typeof value.createdAt === "string"
  );
}
function grant(value: unknown): value is TemporaryObjectGrant {
  return (
    record(value) &&
    typeof value.url === "string" &&
    value.operation === "download" &&
    typeof value.expiresAt === "string"
  );
}
export function parseCloudSyncResponse(value: unknown): CloudSyncResponse {
  if (
    !record(value) ||
    value.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V6 ||
    !scenario(value.scenario) ||
    !version(value.version) ||
    !grant(value.download) ||
    typeof value.replayed !== "boolean" ||
    typeof value.request_id !== "string"
  ) {
    throw new Error("Réponse de synchronisation cloud invalide.");
  }
  return value as unknown as CloudSyncResponse;
}
export function parseCloudScenarioListResponse(value: unknown): CloudScenarioListResponse {
  if (
    !record(value) ||
    value.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V6 ||
    !Array.isArray(value.scenarios) ||
    value.scenarios.some((item) => !scenario(item)) ||
    typeof value.request_id !== "string"
  ) {
    throw new Error("Liste de scénarios cloud invalide.");
  }
  return value as unknown as CloudScenarioListResponse;
}
export function parseCloudVersionListResponse(value: unknown): CloudVersionListResponse {
  if (
    !record(value) ||
    value.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V6 ||
    !Array.isArray(value.versions) ||
    value.versions.some((item) => !version(item)) ||
    typeof value.request_id !== "string"
  ) {
    throw new Error("Historique cloud invalide.");
  }
  return value as unknown as CloudVersionListResponse;
}

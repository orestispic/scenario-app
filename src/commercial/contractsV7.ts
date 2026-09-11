export const COMMERCIAL_CONTRACT_VERSION_V7 = "2026-09-v7";
export type StudioRole = "owner" | "editor" | "viewer";
export type StudioMembershipStatus = "active" | "revoked";
export type StudioInvitationStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";
export interface StudioSpace {
  id: string;
  scenarioId: string;
  name: string;
  role: StudioRole;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface StudioMembershipView {
  studioId: string;
  profileId: string;
  displayName: string;
  role: StudioRole;
  status: StudioMembershipStatus;
  revision: number;
  updatedAt: string;
}
export interface StudioInvitationView {
  id: string;
  studioId: string;
  recipient: string;
  role: Exclude<StudioRole, "owner">;
  status: StudioInvitationStatus;
  expiresAt: string;
  createdAt: string;
  developmentToken?: string;
}
export type StudioEventType =
  | "studio.created"
  | "invitation.created"
  | "invitation.accepted"
  | "invitation.declined"
  | "invitation.revoked"
  | "membership.role_changed"
  | "membership.removed"
  | "scenario.version_created";
export interface StudioEventView {
  studioId: string;
  cursor: number;
  revision: number;
  type: StudioEventType;
  entityId: string;
  createdAt: string;
}
export interface StudioListResponse {
  contractVersion: "2026-09-v7";
  studios: StudioSpace[];
  receivedInvitations: StudioInvitationView[];
  request_id: string;
}
export interface StudioDetailResponse {
  contractVersion: "2026-09-v7";
  studio: StudioSpace;
  members: StudioMembershipView[];
  invitations: StudioInvitationView[];
  request_id: string;
}
export interface StudioMutationResponse {
  contractVersion: "2026-09-v7";
  studio?: StudioSpace;
  membership?: StudioMembershipView;
  invitation?: StudioInvitationView;
  replayed: boolean;
  request_id: string;
}
export interface StudioEventsResponse {
  contractVersion: "2026-09-v7";
  events: StudioEventView[];
  nextCursor: number;
  hasMore: boolean;
  request_id: string;
}
export interface StudioPresenceProvider {
  join(studioId: string, profileId: string): Promise<void>;
  leave(studioId: string, profileId: string): Promise<void>;
}
export interface StudioEventChannel {
  publish(event: StudioEventView): Promise<void>;
}
export interface CollaborativeEditEnvelope {
  studioId: string;
  scenarioId: string;
  baseVersionId: string;
  clientOperationId: string;
  strategy: "crdt-v1" | "ot-v1";
  payloadChecksum: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function role(value: unknown): boolean {
  return value === "owner" || value === "editor" || value === "viewer";
}
function studio(value: unknown): value is StudioSpace {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.scenarioId === "string" &&
    typeof value.name === "string" &&
    role(value.role) &&
    Number.isSafeInteger(value.revision) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}
function member(value: unknown): value is StudioMembershipView {
  return (
    record(value) &&
    typeof value.studioId === "string" &&
    typeof value.profileId === "string" &&
    typeof value.displayName === "string" &&
    role(value.role) &&
    (value.status === "active" || value.status === "revoked") &&
    Number.isSafeInteger(value.revision) &&
    typeof value.updatedAt === "string"
  );
}
function invitation(value: unknown): value is StudioInvitationView {
  return (
    record(value) &&
    typeof value.id === "string" &&
    typeof value.studioId === "string" &&
    typeof value.recipient === "string" &&
    (value.role === "editor" || value.role === "viewer") &&
    ["pending", "accepted", "declined", "expired", "revoked"].includes(String(value.status)) &&
    typeof value.expiresAt === "string" &&
    typeof value.createdAt === "string" &&
    (value.developmentToken === undefined || typeof value.developmentToken === "string")
  );
}
function event(value: unknown): value is StudioEventView {
  const types = [
    "studio.created",
    "invitation.created",
    "invitation.accepted",
    "invitation.declined",
    "invitation.revoked",
    "membership.role_changed",
    "membership.removed",
    "scenario.version_created",
  ];
  return (
    record(value) &&
    typeof value.studioId === "string" &&
    Number.isSafeInteger(value.cursor) &&
    Number.isSafeInteger(value.revision) &&
    types.includes(String(value.type)) &&
    typeof value.entityId === "string" &&
    typeof value.createdAt === "string"
  );
}
function envelope(value: unknown): asserts value is Record<string, unknown> {
  if (
    !record(value) ||
    value.contractVersion !== COMMERCIAL_CONTRACT_VERSION_V7 ||
    typeof value.request_id !== "string"
  )
    throw new Error("Réponse Studio v7 invalide.");
}
export function parseStudioListResponse(value: unknown): StudioListResponse {
  envelope(value);
  if (
    !Array.isArray(value.studios) ||
    value.studios.some((item) => !studio(item)) ||
    !Array.isArray(value.receivedInvitations) ||
    value.receivedInvitations.some((item) => !invitation(item))
  )
    throw new Error("Liste Studio invalide.");
  return value as unknown as StudioListResponse;
}
export function parseStudioDetailResponse(value: unknown): StudioDetailResponse {
  envelope(value);
  if (
    !studio(value.studio) ||
    !Array.isArray(value.members) ||
    value.members.some((item) => !member(item)) ||
    !Array.isArray(value.invitations) ||
    value.invitations.some((item) => !invitation(item))
  )
    throw new Error("Détail Studio invalide.");
  return value as unknown as StudioDetailResponse;
}
export function parseStudioMutationResponse(value: unknown): StudioMutationResponse {
  envelope(value);
  if (
    typeof value.replayed !== "boolean" ||
    (value.studio !== undefined && !studio(value.studio)) ||
    (value.membership !== undefined && !member(value.membership)) ||
    (value.invitation !== undefined && !invitation(value.invitation))
  )
    throw new Error("Mutation Studio invalide.");
  return value as unknown as StudioMutationResponse;
}
export function parseStudioEventsResponse(value: unknown): StudioEventsResponse {
  envelope(value);
  if (
    !Array.isArray(value.events) ||
    value.events.some((item) => !event(item)) ||
    !Number.isSafeInteger(value.nextCursor) ||
    typeof value.hasMore !== "boolean"
  )
    throw new Error("Journal Studio invalide.");
  return value as unknown as StudioEventsResponse;
}

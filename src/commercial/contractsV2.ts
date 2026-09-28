import { CommercialContractError, type AccountIdentity, type ClientCompatibility, type EntitlementSnapshot } from "./contracts";

export const COMMERCIAL_CONTRACT_VERSION_V2 = "2026-09-v2";

export interface SignedOfflineGrant {
  format: "scenario.offline-grant.v1";
  algorithm: "ES256";
  keyId: string;
  payload: string;
  signature: string;
}

export interface OfflineGrantPayload {
  userId: string;
  deviceId: string | null;
  snapshotId: string;
  configurationVersion: string;
  issuedAt: string;
  expiresAt: string;
}

export interface PublicConfiguration {
  version: string;
  environment: "test" | "staging" | "production";
  offers: unknown[];
  compatibility: ClientCompatibility[];
  offlineGrantPublicKey: JsonWebKey;
  offlineGrantKeyId: string;
  offlineGrantPublicKeys?: Record<string, JsonWebKey>;
}

export interface MeResponse {
  account: AccountIdentity;
  role: "customer" | "support" | "admin";
}

export interface EntitlementsResponse {
  snapshot: EntitlementSnapshot;
  offlineGrant: SignedOfflineGrant;
}

export interface DeviceView {
  id: string;
  label: string | null;
  platform: "windows" | "macos";
  status: "active" | "revoked";
  lastSeenAt: string;
  firstActivatedAt?: string;
  clientVersion?: string | null;
  hasCryptographicIdentity?: boolean;
}

export interface DeviceChallenge {
  id: string;
  purpose: "activation" | "license_renewal";
  message: string;
  expiresAt: string;
}

export interface DeviceSessionLease {
  leaseId: string;
  deviceId: string;
  expiresAt: string;
}

export interface UsageView {
  quotaCode: string;
  used: number;
  limit: number | null;
  periodEndsAt: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CommercialContractError(`${label} invalide.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim())
    throw new CommercialContractError(`${label} invalide.`);
  return value;
}

function parseSnapshot(value: unknown): EntitlementSnapshot {
  const raw = record(value, 'Snapshot de droits');
  if (!Array.isArray(raw.entitlements))
    throw new CommercialContractError('Liste de droits invalide.');
  return {
    id: text(raw.id, 'Identifiant du snapshot')!,
    configurationVersion: text(raw.configurationVersion, 'Version de configuration')!,
    issuedAt: text(raw.issuedAt, 'Date du snapshot')!,
    offlineValidUntil: text(raw.offlineValidUntil, 'Échéance hors ligne')!,
    entitlements: raw.entitlements.map((entry) => {
      const item = record(entry, 'Droit');
      if (typeof item.enabled !== 'boolean')
        throw new CommercialContractError('État de droit invalide.');
      return { code: text(item.code, 'Code de droit')!, enabled: item.enabled, value: item.value };
    }),
  };
}

export function parseMeResponse(value: unknown): MeResponse {
  const raw = record(value, 'Compte');
  const account = record(raw.account, 'Identité du compte');
  if (!['customer', 'support', 'admin'].includes(String(raw.role)))
    throw new CommercialContractError('Rôle du compte invalide.');
  return {
    account: {
      id: text(account.id, 'Identifiant du compte')!,
      email: text(account.email, 'Adresse e-mail')!,
      displayName: text(account.displayName, 'Nom du compte', true),
    },
    role: raw.role as MeResponse['role'],
  };
}

export function parseEntitlementsResponse(value: unknown): EntitlementsResponse {
  const raw = record(value, 'Droits');
  const grant = record(raw.offlineGrant, 'Licence hors ligne');
  if (grant.format !== 'scenario.offline-grant.v1' || grant.algorithm !== 'ES256')
    throw new CommercialContractError('Format de licence hors ligne invalide.');
  return {
    snapshot: parseSnapshot(raw.snapshot),
    offlineGrant: {
      format: 'scenario.offline-grant.v1',
      algorithm: 'ES256',
      keyId: text(grant.keyId, 'Clé de licence')!,
      payload: text(grant.payload, 'Contenu de licence')!,
      signature: text(grant.signature, 'Signature de licence')!,
    },
  };
}

export function parseDeviceView(value: unknown): DeviceView {
  const raw = record(value, 'Appareil');
  if (!['windows', 'macos'].includes(String(raw.platform)) || !['active', 'revoked'].includes(String(raw.status)))
    throw new CommercialContractError('État de l’appareil invalide.');
  if (raw.hasCryptographicIdentity !== undefined && typeof raw.hasCryptographicIdentity !== 'boolean')
    throw new CommercialContractError('Identité cryptographique invalide.');
  return {
    id: text(raw.id, 'Identifiant de l’appareil')!,
    label: text(raw.label, 'Nom de l’appareil', true),
    platform: raw.platform as DeviceView['platform'],
    status: raw.status as DeviceView['status'],
    lastSeenAt: text(raw.lastSeenAt, 'Dernière activité')!,
    ...(raw.firstActivatedAt === undefined ? {} : { firstActivatedAt: text(raw.firstActivatedAt, 'Première activation')! }),
    ...(raw.clientVersion === undefined ? {} : { clientVersion: text(raw.clientVersion, 'Version cliente', true) }),
    ...(raw.hasCryptographicIdentity === undefined ? {} : { hasCryptographicIdentity: raw.hasCryptographicIdentity }),
  };
}

export function parseDevicesResponse(value: unknown): DeviceView[] {
  const raw = record(value, 'Liste des appareils');
  if (!Array.isArray(raw.devices)) throw new CommercialContractError('Liste des appareils invalide.');
  return raw.devices.map(parseDeviceView);
}

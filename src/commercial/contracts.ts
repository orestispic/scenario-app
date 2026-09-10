/**
 * Contrat API commercial v1. Les codes de droits et leurs valeurs sont des
 * données serveur : le client ne doit ni les inventer ni les compléter.
 */
export const COMMERCIAL_CONTRACT_VERSION = "2026-09-v1";

export interface ClientCompatibility {
  minimumSupportedVersion: string;
  effectiveAt: string;
  message: string | null;
}

export interface AccountIdentity {
  id: string;
  email: string;
  displayName: string | null;
}

export interface Entitlement {
  code: string;
  enabled: boolean;
  value: unknown;
}

export interface EntitlementSnapshot {
  id: string;
  configurationVersion: string;
  issuedAt: string;
  offlineValidUntil: string;
  entitlements: Entitlement[];
}

export interface AccountOverview {
  account: AccountIdentity;
  entitlementSnapshot: EntitlementSnapshot;
  compatibility: ClientCompatibility;
}

export interface CommercialApi {
  getAccountOverview(): Promise<AccountOverview>;
}

export class CommercialContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommercialContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string, nullable = false): string | null {
  const field = value[key];
  if (nullable && field === null) return null;
  if (typeof field !== "string" || !field.trim()) {
    throw new CommercialContractError(`Champ commercial invalide : ${key}`);
  }
  return field;
}

export function parseAccountOverview(value: unknown): AccountOverview {
  if (!isRecord(value) || !isRecord(value.account) || !isRecord(value.entitlementSnapshot) || !isRecord(value.compatibility)) {
    throw new CommercialContractError("Réponse commerciale invalide.");
  }

  const rawEntitlements = value.entitlementSnapshot.entitlements;
  if (!Array.isArray(rawEntitlements)) {
    throw new CommercialContractError("Liste de droits commerciale invalide.");
  }

  const entitlements = rawEntitlements.map((item) => {
    if (!isRecord(item) || typeof item.code !== "string" || !item.code || typeof item.enabled !== "boolean") {
      throw new CommercialContractError("Droit commercial invalide.");
    }
    return { code: item.code, enabled: item.enabled, value: item.value };
  });

  return {
    account: {
      id: readString(value.account, "id")!,
      email: readString(value.account, "email")!,
      displayName: readString(value.account, "displayName", true),
    },
    entitlementSnapshot: {
      id: readString(value.entitlementSnapshot, "id")!,
      configurationVersion: readString(value.entitlementSnapshot, "configurationVersion")!,
      issuedAt: readString(value.entitlementSnapshot, "issuedAt")!,
      offlineValidUntil: readString(value.entitlementSnapshot, "offlineValidUntil")!,
      entitlements,
    },
    compatibility: {
      minimumSupportedVersion: readString(value.compatibility, "minimumSupportedVersion")!,
      effectiveAt: readString(value.compatibility, "effectiveAt")!,
      message: readString(value.compatibility, "message", true),
    },
  };
}

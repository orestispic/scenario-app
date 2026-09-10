import type { EntitlementSnapshot } from "./contracts";

export const ENTITLEMENT_CACHE_SCHEMA_VERSION = 1;

export interface EntitlementCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EntitlementCachePolicy {
  /** Valeur issue du serveur/configuration, jamais d’une constante commerciale cliente. */
  maximumOfflineAgeMs: number;
}

export interface CachedEntitlementSnapshot {
  schemaVersion: number;
  storedAt: string;
  snapshot: EntitlementSnapshot;
}

export type CachedEntitlementState =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "expired"; cache: CachedEntitlementSnapshot }
  | { kind: "valid"; cache: CachedEntitlementSnapshot };

export const ENTITLEMENT_CACHE_KEY = "scenario-commercial-entitlements-v1";

function parseTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function createEntitlementCachePolicy(snapshot: EntitlementSnapshot): EntitlementCachePolicy {
  const issuedAt = parseTime(snapshot.issuedAt);
  const offlineValidUntil = parseTime(snapshot.offlineValidUntil);
  return {
    maximumOfflineAgeMs: issuedAt === null || offlineValidUntil === null
      ? 0
      : Math.max(0, offlineValidUntil - issuedAt),
  };
}

export function writeEntitlementCache(
  storage: EntitlementCacheStorage,
  snapshot: EntitlementSnapshot,
  now: Date,
): void {
  const cache: CachedEntitlementSnapshot = {
    schemaVersion: ENTITLEMENT_CACHE_SCHEMA_VERSION,
    storedAt: now.toISOString(),
    snapshot,
  };
  storage.setItem(ENTITLEMENT_CACHE_KEY, JSON.stringify(cache));
}

export function readEntitlementCache(
  storage: EntitlementCacheStorage,
  policy: EntitlementCachePolicy,
  now: Date,
): CachedEntitlementState {
  const raw = storage.getItem(ENTITLEMENT_CACHE_KEY);
  if (!raw) return { kind: "missing" };

  try {
    const cache = JSON.parse(raw) as CachedEntitlementSnapshot;
    const storedAt = parseTime(cache.storedAt);
    const offlineValidUntil = parseTime(cache.snapshot?.offlineValidUntil);
    if (cache.schemaVersion !== ENTITLEMENT_CACHE_SCHEMA_VERSION || storedAt === null || offlineValidUntil === null) {
      return { kind: "invalid" };
    }
    const cacheExpiresAt = storedAt + Math.max(0, policy.maximumOfflineAgeMs);
    return now.getTime() <= Math.min(cacheExpiresAt, offlineValidUntil)
      ? { kind: "valid", cache }
      : { kind: "expired", cache };
  } catch {
    return { kind: "invalid" };
  }
}

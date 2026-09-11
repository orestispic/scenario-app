import type { EntitlementSnapshot } from "./contracts";
import type { SignedOfflineGrant } from "./contractsV2";
import type { BoundOfflineGrantPayload } from "./contractsV4";
import type { EntitlementCacheStorage } from "./entitlementCache";
import { verifyOfflineGrant } from "./signedEntitlementCache";

export const BOUND_CACHE_KEY = "scenario-commercial-entitlements-v4";
export async function verifyBoundGrant(
  snapshot: EntitlementSnapshot,
  grant: SignedOfflineGrant,
  publicKey: JsonWebKey,
  keyId: string,
  userId: string,
  now = new Date(),
): Promise<void> {
  const payload = (await verifyOfflineGrant(
    grant,
    publicKey,
    keyId,
    snapshot,
    now,
  )) as BoundOfflineGrantPayload;
  const signed = JSON.parse(payload.snapshotJson ?? "null") as EntitlementSnapshot | null;
  if (
    payload.contractVersion !== "2026-09-v4" ||
    payload.userId !== userId ||
    !signed ||
    signed.id !== snapshot.id ||
    signed.configurationVersion !== snapshot.configurationVersion ||
    signed.issuedAt !== snapshot.issuedAt ||
    signed.offlineValidUntil !== snapshot.offlineValidUntil ||
    JSON.stringify(signed.entitlements) !== JSON.stringify(snapshot.entitlements) ||
    snapshot.issuedAt !== payload.issuedAt ||
    snapshot.offlineValidUntil !== payload.expiresAt ||
    !Number.isFinite(Date.parse(payload.issuedAt)) ||
    Date.parse(payload.issuedAt) > now.getTime() ||
    Date.parse(payload.expiresAt) <= now.getTime()
  )
    throw new Error("Cache signé incohérent ou expiré.");
}
export async function writeBoundCache(
  storage: EntitlementCacheStorage,
  snapshot: EntitlementSnapshot,
  grant: SignedOfflineGrant,
  publicKey: JsonWebKey,
  keyId: string,
  userId: string,
  now = new Date(),
): Promise<void> {
  await verifyBoundGrant(snapshot, grant, publicKey, keyId, userId, now);
  storage.setItem(
    BOUND_CACHE_KEY,
    JSON.stringify({ schemaVersion: 4, snapshot, grant, verifiedAt: now.toISOString() }),
  );
}
export async function readBoundCache(
  storage: EntitlementCacheStorage,
  publicKey: JsonWebKey,
  keyId: string,
  userId: string,
  now = new Date(),
): Promise<EntitlementSnapshot | null> {
  try {
    const cache = JSON.parse(storage.getItem(BOUND_CACHE_KEY) ?? "null");
    if (
      !cache ||
      cache.schemaVersion !== 4 ||
      !Number.isFinite(Date.parse(cache.verifiedAt)) ||
      Date.parse(cache.verifiedAt) > now.getTime()
    )
      return null;
    await verifyBoundGrant(cache.snapshot, cache.grant, publicKey, keyId, userId, now);
    return cache.snapshot;
  } catch {
    return null;
  }
}

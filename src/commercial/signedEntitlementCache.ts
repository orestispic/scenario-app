import type { EntitlementSnapshot } from "./contracts";
import type { OfflineGrantPayload, SignedOfflineGrant } from "./contractsV2";
import type { EntitlementCacheStorage } from "./entitlementCache";

export const SIGNED_ENTITLEMENT_CACHE_KEY = "scenario-commercial-signed-entitlements-v2";
export const SIGNED_ENTITLEMENT_CACHE_SCHEMA_VERSION = 2;

export interface SignedEntitlementCache {
  schemaVersion: 2;
  snapshot: EntitlementSnapshot;
  grant: SignedOfflineGrant;
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export async function verifyOfflineGrant(
  grant: SignedOfflineGrant,
  publicKey: JsonWebKey,
  expectedKeyId: string,
  snapshot: EntitlementSnapshot,
  now: Date,
): Promise<OfflineGrantPayload> {
  if (grant.format !== "scenario.offline-grant.v1" || grant.algorithm !== "ES256" || grant.keyId !== expectedKeyId) {
    throw new Error("Format de cache hors ligne invalide.");
  }
  const key = await crypto.subtle.importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    toArrayBuffer(decodeBase64Url(grant.signature)),
    new TextEncoder().encode(grant.payload),
  );
  if (!verified) throw new Error("Signature du cache hors ligne invalide.");
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(grant.payload))) as OfflineGrantPayload;
  if (payload.snapshotId !== snapshot.id || payload.configurationVersion !== snapshot.configurationVersion) {
    throw new Error("Cache hors ligne incohérent.");
  }
  if (!Number.isFinite(Date.parse(payload.expiresAt)) || now.getTime() > Date.parse(payload.expiresAt)) {
    throw new Error("Cache hors ligne expiré.");
  }
  return payload;
}

export async function writeVerifiedEntitlementCache(
  storage: EntitlementCacheStorage,
  snapshot: EntitlementSnapshot,
  grant: SignedOfflineGrant,
  publicKey: JsonWebKey,
  keyId: string,
  now = new Date(),
): Promise<void> {
  await verifyOfflineGrant(grant, publicKey, keyId, snapshot, now);
  const cache: SignedEntitlementCache = { schemaVersion: SIGNED_ENTITLEMENT_CACHE_SCHEMA_VERSION, snapshot, grant };
  storage.setItem(SIGNED_ENTITLEMENT_CACHE_KEY, JSON.stringify(cache));
}

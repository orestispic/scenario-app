import { expect, it } from "vitest";
import { BOUND_CACHE_KEY, readBoundCache, writeBoundCache } from "./boundEntitlementCache";
import type { SignedOfflineGrant } from "./contractsV2";

it("authenticates the complete snapshot, owner, dates, expiration and offline recovery", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const now = new Date("2026-09-11T12:00:00Z");
  const snapshot = {
    id: "snapshot",
    configurationVersion: "version",
    issuedAt: now.toISOString(),
    offlineValidUntil: "2026-09-12T12:00:00Z",
    entitlements: [{ code: "fixture", enabled: false, value: null }],
  };
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const payload = encode(
    new TextEncoder().encode(
      JSON.stringify({
        userId: "owner",
        deviceId: null,
        snapshotId: snapshot.id,
        configurationVersion: snapshot.configurationVersion,
        issuedAt: snapshot.issuedAt,
        expiresAt: snapshot.offlineValidUntil,
        contractVersion: "2026-09-v4",
        snapshotJson: JSON.stringify(snapshot),
      }),
    ),
  );
  const signature = encode(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        pair.privateKey,
        new TextEncoder().encode(payload),
      ),
    ),
  );
  const grant: SignedOfflineGrant = {
    format: "scenario.offline-grant.v1",
    algorithm: "ES256",
    keyId: "fixture",
    payload,
    signature,
  };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  await writeBoundCache(storage, snapshot, grant, publicKey, "fixture", "owner", now);
  expect(await readBoundCache(storage, publicKey, "fixture", "owner", now)).toEqual(snapshot);
  expect(await readBoundCache(storage, publicKey, "fixture", "other", now)).toBeNull();
  expect(
    await readBoundCache(
      storage,
      publicKey,
      "fixture",
      "owner",
      new Date(snapshot.offlineValidUntil),
    ),
  ).toBeNull();
  expect(
    await readBoundCache(storage, publicKey, "fixture", "owner", new Date(now.getTime() - 1)),
  ).toBeNull();
  const cache = JSON.parse(values.get(BOUND_CACHE_KEY)!);
  cache.snapshot.entitlements[0].enabled = true;
  values.set(BOUND_CACHE_KEY, JSON.stringify(cache));
  expect(await readBoundCache(storage, publicKey, "fixture", "owner", now)).toBeNull();
  await writeBoundCache(storage, snapshot, grant, publicKey, "fixture", "owner", now);
  expect(await readBoundCache(storage, publicKey, "fixture", "owner", now)).toEqual(snapshot);
});

import { describe, expect, it } from "vitest";
import { createSupabaseAuthAdapter } from "./auth";
import type { EntitlementSnapshot } from "./contracts";
import type { OfflineGrantPayload, SignedOfflineGrant } from "./contractsV2";
import { verifyOfflineGrant } from "./signedEntitlementCache";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signedFixture(expiresAt: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const payload: OfflineGrantPayload = {
    userId: "user-test",
    deviceId: null,
    snapshotId: "snapshot-test",
    configurationVersion: "configuration-test",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt,
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(encodedPayload));
  const grant: SignedOfflineGrant = {
    format: "scenario.offline-grant.v1",
    algorithm: "ES256",
    keyId: "test-key",
    payload: encodedPayload,
    signature: encodeBase64Url(new Uint8Array(signature)),
  };
  const snapshot: EntitlementSnapshot = {
    id: "snapshot-test",
    configurationVersion: "configuration-test",
    issuedAt: payload.issuedAt,
    offlineValidUntil: expiresAt,
    entitlements: [],
  };
  return { grant, snapshot, publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}

describe("session Supabase", () => {
  it("construit une session courte depuis la réponse authentifiée", async () => {
    const requests: string[] = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_at: 1_900_000_000 }), { status: 200 });
      },
    });
    const session = await adapter.signIn("writer@example.invalid", "not-a-real-password");
    expect(session.accessToken).toBe("access");
    expect(session.refreshToken).toBe("refresh");
    expect(requests[0]).toContain("grant_type=password");
    await adapter.refreshSession(session.refreshToken);
    expect(requests[1]).toContain("grant_type=refresh_token");
  });
});

describe("cache hors ligne signé", () => {
  it("accepte une signature serveur valide", async () => {
    const fixture = await signedFixture("2026-01-08T00:00:00.000Z");
    await expect(verifyOfflineGrant(fixture.grant, fixture.publicKey, "test-key", fixture.snapshot, new Date("2026-01-02T00:00:00.000Z"))).resolves.toMatchObject({ snapshotId: "snapshot-test" });
  });

  it("refuse une charge modifiée ou expirée", async () => {
    const fixture = await signedFixture("2026-01-08T00:00:00.000Z");
    const tampered = { ...fixture.grant, payload: fixture.grant.payload.slice(0, -1) + "A" };
    await expect(verifyOfflineGrant(tampered, fixture.publicKey, "test-key", fixture.snapshot, new Date("2026-01-02T00:00:00.000Z"))).rejects.toThrow("Signature");
    await expect(verifyOfflineGrant(fixture.grant, fixture.publicKey, "test-key", fixture.snapshot, new Date("2026-01-09T00:00:00.000Z"))).rejects.toThrow("expiré");
  });
});

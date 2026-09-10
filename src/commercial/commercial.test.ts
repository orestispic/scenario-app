import { describe, expect, it } from "vitest";
import { createHttpCommercialApi } from "./api";
import { assessClientCompatibility } from "./compatibility";
import type { AccountOverview } from "./contracts";
import {
  ENTITLEMENT_CACHE_KEY,
  createEntitlementCachePolicy,
  readEntitlementCache,
  writeEntitlementCache,
} from "./entitlementCache";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

const accountOverviewFixture: AccountOverview = {
  account: { id: "test-account", email: "test@example.invalid", displayName: "Compte test" },
  entitlementSnapshot: {
    id: "test-snapshot",
    configurationVersion: "test-configuration",
    issuedAt: "2026-01-01T00:00:00.000Z",
    offlineValidUntil: "2026-01-03T00:00:00.000Z",
    entitlements: [],
  },
  compatibility: { minimumSupportedVersion: "1.0.0", effectiveAt: "2026-01-01T00:00:00.000Z", message: null },
};

describe("contrat commercial", () => {
  it("valide la réponse de compte de l’adaptateur injecté", async () => {
    const api = createHttpCommercialApi({
      get: async () => ({ ok: true, status: 200, json: async () => accountOverviewFixture }),
    });
    await expect(api.getAccountOverview()).resolves.toMatchObject({
      account: { id: "test-account" },
      entitlementSnapshot: { configurationVersion: "test-configuration" },
    });
  });

  it("refuse une réponse de compte incomplète", async () => {
    const api = createHttpCommercialApi({
      get: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    });
    await expect(api.getAccountOverview()).rejects.toThrow("Réponse commerciale invalide");
  });
});

describe("cache d’entitlements", () => {
  it("expire selon la tolérance fournie par le serveur", () => {
    const storage = memoryStorage();
    const snapshot = {
      ...accountOverviewFixture.entitlementSnapshot,
      issuedAt: "2026-01-01T00:00:00.000Z",
      offlineValidUntil: "2026-01-03T00:00:00.000Z",
    };
    writeEntitlementCache(storage, snapshot, new Date("2026-01-01T00:00:00.000Z"));
    expect(readEntitlementCache(storage, createEntitlementCachePolicy(snapshot), new Date("2026-01-02T00:00:00.000Z")).kind).toBe("valid");
    expect(readEntitlementCache(storage, createEntitlementCachePolicy(snapshot), new Date("2026-01-04T00:00:00.000Z")).kind).toBe("expired");
    expect(storage.getItem(ENTITLEMENT_CACHE_KEY)).not.toBeNull();
  });
});

describe("compatibilité client", () => {
  const compatibility = { minimumSupportedVersion: "1.2.3", effectiveAt: "2026-01-01T00:00:00.000Z", message: null };

  it("demande une mise à jour sous la version minimale", () => {
    expect(assessClientCompatibility("1.2.2", compatibility)).toBe("update-required");
  });

  it("accepte une version égale ou plus récente", () => {
    expect(assessClientCompatibility("1.3.0", compatibility)).toBe("compatible");
  });
});

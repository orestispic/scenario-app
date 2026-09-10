import { describe, expect, it } from "vitest";
import { createHttpCommercialApi } from "./api";
import { assessClientCompatibility } from "./compatibility";
import { developmentAccountOverview } from "./developmentApi";
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

describe("contrat commercial", () => {
  it("valide la réponse de compte de l’adaptateur injecté", async () => {
    const api = createHttpCommercialApi({
      get: async () => ({ ok: true, status: 200, json: async () => developmentAccountOverview }),
    });
    await expect(api.getAccountOverview()).resolves.toMatchObject({
      account: { id: "development-account" },
      entitlementSnapshot: { configurationVersion: "development-phase-1" },
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
      ...developmentAccountOverview.entitlementSnapshot,
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

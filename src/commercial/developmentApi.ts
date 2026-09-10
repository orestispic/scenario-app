import type { AccountOverview, CommercialApi } from "./contracts";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Faux serveur injectable : réservé à l’interface de développement phase 1. */
export function createDevelopmentCommercialApi(seed: AccountOverview): CommercialApi {
  return {
    async getAccountOverview() {
      return clone(seed);
    },
  };
}

export const developmentAccountOverview: AccountOverview = {
  account: {
    id: "development-account",
    email: "compte@example.invalid",
    displayName: "Compte de démonstration",
  },
  entitlementSnapshot: {
    id: "development-snapshot",
    configurationVersion: "development-phase-1",
    issuedAt: "2026-09-10T00:00:00.000Z",
    offlineValidUntil: "2099-01-01T00:00:00.000Z",
    entitlements: [{ code: "development.read_only", enabled: true, value: null }],
  },
  compatibility: {
    minimumSupportedVersion: "0.1.0",
    effectiveAt: "2026-09-10T00:00:00.000Z",
    message: null,
  },
};

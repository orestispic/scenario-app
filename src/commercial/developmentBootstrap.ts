import { assessClientCompatibility, type ClientCompatibilityState } from "./compatibility";
import type { AccountOverview, CommercialApi } from "./contracts";
import { createDevelopmentCommercialApi, developmentAccountOverview } from "./developmentApi";
import {
  type EntitlementCacheStorage,
  writeEntitlementCache,
} from "./entitlementCache";

export interface DevelopmentAccountState {
  overview: AccountOverview;
  compatibility: ClientCompatibilityState;
}

const developmentApi = createDevelopmentCommercialApi(developmentAccountOverview);

function createBrowserStorage(): EntitlementCacheStorage {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  };
}

export async function loadDevelopmentAccountState(
  clientVersion: string,
  api: CommercialApi = developmentApi,
  storage: EntitlementCacheStorage = createBrowserStorage(),
  now = new Date(),
): Promise<DevelopmentAccountState> {
  const overview = await api.getAccountOverview();
  writeEntitlementCache(storage, overview.entitlementSnapshot, now);
  return {
    overview,
    compatibility: assessClientCompatibility(clientVersion, overview.compatibility),
  };
}

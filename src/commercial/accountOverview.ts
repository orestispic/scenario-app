import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { DeviceView, EntitlementsResponse, MeResponse } from './contractsV2';
import type { ActivationRedemptionView, BillingOverviewResponse } from './contractsV3';

export type AccountSection<T> =
  | { status: 'ready'; value: T }
  | { status: 'error'; error: unknown };

export interface AccountPrimarySections {
  profile: AccountSection<MeResponse>;
  entitlements: AccountSection<EntitlementsResponse>;
}

export interface AccountSecondarySections {
  devices: AccountSection<DeviceView[]>;
  billing: AccountSection<BillingOverviewResponse>;
  activations: AccountSection<ActivationRedemptionView[]>;
}

type AccountReadApi = Pick<
  AuthenticatedCommercialApi,
  'getMe' | 'getEntitlements' | 'getDevices' | 'getBilling' | 'getActivationStatus'
>;

async function settle<T>(operation: Promise<T>): Promise<AccountSection<T>> {
  try {
    return { status: 'ready', value: await operation };
  } catch (error) {
    return { status: 'error', error };
  }
}

/**
 * Deduplicates the immutable account reads shared by an account-panel opening.
 * Authentication remains owned by SessionManager; this cache never stores a
 * token and is explicitly invalidated on login/logout/session replacement.
 */
export class AccountOverviewLoader {
  private primaryGeneration = 0;
  private secondaryGeneration = 0;
  private primaryCache: { expiresAt: number; value: AccountPrimarySections } | null = null;
  private secondaryCache: { expiresAt: number; value: AccountSecondarySections } | null = null;
  private primaryInFlight: Promise<AccountPrimarySections> | null = null;
  private secondaryInFlight: Promise<AccountSecondarySections> | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly cacheTtlMs = 30_000,
  ) {}

  invalidate(): void {
    this.primaryGeneration += 1;
    this.secondaryGeneration += 1;
    this.primaryCache = null;
    this.secondaryCache = null;
    this.primaryInFlight = null;
    this.secondaryInFlight = null;
  }

  loadPrimary(api: AccountReadApi, force = false): Promise<AccountPrimarySections> {
    if (force) {
      this.primaryGeneration += 1;
      this.primaryCache = null;
      this.primaryInFlight = null;
    }
    if (!force && this.primaryCache && this.primaryCache.expiresAt > this.now())
      return Promise.resolve(this.primaryCache.value);
    if (!force && this.primaryInFlight) return this.primaryInFlight;

    const generation = this.primaryGeneration;
    const task = Promise.all([
      settle(api.getMe()),
      settle(api.getEntitlements()),
    ]).then(([profile, entitlements]) => {
      const value = { profile, entitlements };
      if (generation === this.primaryGeneration)
        this.primaryCache = { expiresAt: this.now() + this.cacheTtlMs, value };
      return value;
    });
    this.primaryInFlight = task;
    void task.finally(() => {
      if (this.primaryInFlight === task) this.primaryInFlight = null;
    });
    return task;
  }

  loadSecondary(api: AccountReadApi, force = false): Promise<AccountSecondarySections> {
    if (force) {
      this.secondaryGeneration += 1;
      this.secondaryCache = null;
      this.secondaryInFlight = null;
    }
    if (!force && this.secondaryCache && this.secondaryCache.expiresAt > this.now())
      return Promise.resolve(this.secondaryCache.value);
    if (!force && this.secondaryInFlight) return this.secondaryInFlight;

    const generation = this.secondaryGeneration;
    const task = Promise.all([
      settle(api.getDevices()),
      settle(api.getBilling()),
      settle(api.getActivationStatus()),
    ]).then(([devices, billing, activationResponse]) => {
      const activations: AccountSection<ActivationRedemptionView[]> = activationResponse.status === 'ready'
        ? { status: 'ready', value: activationResponse.value.activations }
        : activationResponse;
      const value = { devices, billing, activations };
      if (generation === this.secondaryGeneration)
        this.secondaryCache = { expiresAt: this.now() + this.cacheTtlMs, value };
      return value;
    });
    this.secondaryInFlight = task;
    void task.finally(() => {
      if (this.secondaryInFlight === task) this.secondaryInFlight = null;
    });
    return task;
  }
}

export const accountOverview = new AccountOverviewLoader();

export function invalidateAccountOverviewOnSessionChange(
  source: {
    subscribe(listener: (authenticated: boolean) => void): () => void;
    subscribeState?(listener: (snapshot: unknown) => void): () => void;
  },
  loader: Pick<AccountOverviewLoader, 'invalidate'> = accountOverview,
): () => void {
  // SessionManager deliberately does not know about view caches. Keeping the
  // subscription here avoids a dependency cycle while fencing every login,
  // refresh, logout and account replacement.
  // SessionManager's state stream also reports an authenticated account
  // replacement while keeping its boolean authentication stream idempotent.
  return source.subscribeState
    ? source.subscribeState(() => loader.invalidate())
    : source.subscribe(() => loader.invalidate());
}

export interface CloudStorageStatus {
  usedBytes: number;
  limitBytes: number;
  baseLimitBytes: number;
  expandedLimitBytes: number;
  addon: null | {
    status: 'pending' | 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled' | 'expired';
    currentPeriodEndsAt: string | null;
    cancelAtPeriodEnd: boolean;
  };
  upgrade: { currency: 'EUR'; unitAmountMinor: number; billingInterval: 'month' };
}

const finiteBytes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseCloudStorageStatus(value: unknown): CloudStorageStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Quota cloud invalide.');
  const result = value as Partial<CloudStorageStatus>;
  const addon = result.addon;
  const upgrade = result.upgrade;
  if (!finiteBytes(result.usedBytes) || !finiteBytes(result.limitBytes) ||
    !finiteBytes(result.baseLimitBytes) || !finiteBytes(result.expandedLimitBytes) ||
    result.limitBytes < result.baseLimitBytes || result.expandedLimitBytes < result.baseLimitBytes ||
    !upgrade || upgrade.currency !== 'EUR' || upgrade.billingInterval !== 'month' ||
    !Number.isSafeInteger(upgrade.unitAmountMinor) || upgrade.unitAmountMinor < 1 ||
    (addon !== null && (!addon || !['pending','trialing','active','past_due','paused','canceled','expired'].includes(addon.status) ||
      (addon.currentPeriodEndsAt !== null && typeof addon.currentPeriodEndsAt !== 'string') ||
      typeof addon.cancelAtPeriodEnd !== 'boolean')))
    throw new Error('Quota cloud invalide.');
  return result as CloudStorageStatus;
}


import type { Entitlement } from './contracts';
import { canUseFeature, FEATURE_CATALOG, FEATURE_IDS, type OfferLabel } from './featureCatalog';

export interface PresentedEntitlement {
  id: string;
  label: string;
  enabled: boolean;
  offer?: OfferLabel;
}

function humanizeUnknownCode(code: string): string {
  const words = code.replace(/[._-]+/g, ' ').trim();
  if (!words) return 'Fonction supplémentaire';
  return words.charAt(0).toLocaleUpperCase('fr-FR') + words.slice(1);
}

export function presentEntitlements(entitlements: Entitlement[]): PresentedEntitlement[] {
  const knownCodes = new Set(FEATURE_IDS.flatMap((id) => [
    ...FEATURE_CATALOG[id].entitlementGroups.flat(),
    ...(FEATURE_CATALOG[id].knownEntitlementCodes ?? []),
  ]));
  const state = { kind: 'valid' as const, entitlements };
  const known = FEATURE_IDS.map((id) => ({
    id,
    label: FEATURE_CATALOG[id].label,
    enabled: canUseFeature(state, id),
    offer: FEATURE_CATALOG[id].offer,
  }));
  const unknown = entitlements
    .filter((entitlement) => !knownCodes.has(entitlement.code))
    .map((entitlement) => ({
      id: `additional-${entitlement.code}`,
      label: humanizeUnknownCode(entitlement.code),
      enabled: entitlement.enabled,
    }));
  return [...known, ...unknown];
}

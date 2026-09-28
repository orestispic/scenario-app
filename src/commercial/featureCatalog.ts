import type { LicenseState } from './offlineLicense';

/**
 * Référentiel des fonctionnalités visibles dans Senario.
 *
 * Le serveur reste l'autorité : il signe les droits techniques de chaque
 * abonnement. Ce fichier ne contient ni prix ni quota ; il traduit seulement
 * ces droits en fonctionnalités et en messages cohérents dans l'application.
 * Pour faire évoluer une offre, modifier les groupes de droits ici et publier
 * la même configuration versionnée côté catalogue serveur.
 */
export type FeatureId =
  | 'localScenarios'
  | 'scenarioWorkspace'
  | 'compatibleImports'
  | 'pdfAndFountainExport'
  | 'professionalExports'
  | 'personalComments'
  | 'versionHistory'
  | 'voiceReading'
  | 'artificialIntelligence'
  | 'whiteboard'
  | 'timeline'
  | 'breakdownWorkspace'
  | 'technicalBreakdownWorkspace'
  | 'cloudWorkspace'
  | 'sharingAndCollaboration'
  | 'deviceSynchronization'
  | 'cloudBackup';

export type OfferLabel = 'Gratuite' | 'Auteur' | 'Studio';

export type FeatureDefinition = {
  label: string;
  offer: OfferLabel;
  /** Every group must be satisfied; entries within a group are server aliases. */
  entitlementGroups: readonly (readonly string[])[];
  /** Codes that are recognised for presentation but do not gate this feature. */
  knownEntitlementCodes?: readonly string[];
};

export const FEATURE_CATALOG: Record<FeatureId, FeatureDefinition> = {
  localScenarios: {
    label: 'Scénarios locaux et pages illimités', offer: 'Gratuite', entitlementGroups: [],
    knownEntitlementCodes: ['local.edit'],
  },
  scenarioWorkspace: {
    label: 'Workspace Scénario', offer: 'Gratuite', entitlementGroups: [],
  },
  compatibleImports: {
    label: 'Import de tous les formats compatibles', offer: 'Gratuite', entitlementGroups: [],
  },
  pdfAndFountainExport: {
    label: 'Export PDF et Fountain', offer: 'Gratuite', entitlementGroups: [],
  },
  professionalExports: {
    label: 'Formats d’export professionnels', offer: 'Auteur', entitlementGroups: [['pro_formats']],
  },
  personalComments: {
    label: 'Commentaires personnels', offer: 'Auteur', entitlementGroups: [['personal_comments']],
  },
  versionHistory: {
    label: 'Historique et comparaison des versions', offer: 'Auteur',
    entitlementGroups: [['scenario_versions'], ['scenario_compare']],
  },
  voiceReading: {
    label: 'Lecture vocale', offer: 'Auteur', entitlementGroups: [['voice_reading']],
  },
  artificialIntelligence: {
    label: 'Intelligence artificielle', offer: 'Auteur',
    entitlementGroups: [['ai.actions'], ['ai_short_action']],
    knownEntitlementCodes: ['ai_pdf_import'],
  },
  whiteboard: {
    label: 'Workspace Whiteboard', offer: 'Auteur', entitlementGroups: [['scene_cards']],
  },
  timeline: {
    label: 'Timeline', offer: 'Auteur', entitlementGroups: [['scene_cards']],
  },
  breakdownWorkspace: {
    label: 'Workspace Dépouillement', offer: 'Studio', entitlementGroups: [['breakdown']],
  },
  technicalBreakdownWorkspace: {
    label: 'Workspace Découpage technique', offer: 'Studio', entitlementGroups: [['technical_breakdown']],
  },
  cloudWorkspace: {
    label: 'Workspace Cloud', offer: 'Studio',
    entitlementGroups: [['cloud.sync', 'cloud_sync'], ['scenario_versions']],
  },
  sharingAndCollaboration: {
    label: 'Partage et collaboration', offer: 'Studio',
    entitlementGroups: [['studio_collaboration'], ['cloud.sync', 'cloud_sync']],
  },
  deviceSynchronization: {
    label: 'Synchronisation entre appareils', offer: 'Studio',
    entitlementGroups: [['cloud.sync', 'cloud_sync'], ['scenario_versions']],
  },
  cloudBackup: {
    label: 'Sauvegarde Cloud', offer: 'Studio',
    entitlementGroups: [['cloud.sync', 'cloud_sync'], ['scenario_versions']],
  },
};

export const FEATURE_IDS = Object.keys(FEATURE_CATALOG) as FeatureId[];

export function canUseFeature(state: LicenseState, feature: FeatureId): boolean {
  const { entitlementGroups } = FEATURE_CATALOG[feature];
  if (entitlementGroups.length === 0) return true;
  if (state.kind !== 'valid') return false;
  const activeCodes = new Set(
    state.entitlements?.filter((entitlement) => entitlement.enabled).map((entitlement) => entitlement.code),
  );
  return entitlementGroups.every((aliases) => aliases.some((code) => activeCodes.has(code)));
}

export function featureOfferLabel(feature: FeatureId): OfferLabel {
  return FEATURE_CATALOG[feature].offer;
}

export function featureLockedMessage(feature: FeatureId): string {
  const definition = FEATURE_CATALOG[feature];
  return `${definition.label} est disponible avec l’offre ${definition.offer}.`;
}

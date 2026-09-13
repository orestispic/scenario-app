import type { Entitlement } from './contracts';

export interface PresentedEntitlement {
  id: string;
  label: string;
  enabled: boolean;
}

const DISPLAYED_ENTITLEMENTS: Array<{
  id: string;
  label: string;
  codes: string[];
}> = [
  { id: 'local-writing', label: 'Écriture et fichiers locaux', codes: ['local.edit'] },
  { id: 'ai-writing', label: 'Outils d’écriture avec l’IA', codes: ['ai.actions', 'ai_short_action'] },
  { id: 'ai-pdf-import', label: 'Import de scénarios PDF', codes: ['ai_pdf_import'] },
  { id: 'cloud-sync', label: 'Sauvegarde dans le cloud', codes: ['cloud.sync', 'cloud_sync'] },
  { id: 'version-history', label: 'Historique des versions', codes: ['scenario_versions'] },
  { id: 'version-comparison', label: 'Comparaison des versions', codes: ['scenario_compare'] },
  { id: 'colored-revisions', label: 'Révisions en couleur', codes: ['colored_revision'] },
  { id: 'scene-cards', label: 'Cartes de scènes', codes: ['scene_cards'] },
  { id: 'planning', label: 'Outils de planification', codes: ['planning_tools'] },
  { id: 'reports', label: 'Rapports de production', codes: ['reports'] },
  { id: 'professional-formats', label: 'Formats professionnels', codes: ['pro_formats'] },
  { id: 'read-only-share', label: 'Partage en lecture seule', codes: ['read_share'] },
  { id: 'instagram-center', label: 'Centre Instagram', codes: ['instagram_center'] },
  { id: 'live-collaboration', label: 'Collaboration en direct', codes: ['studio_collaboration'] },
];

function humanizeUnknownCode(code: string): string {
  const words = code.replace(/[._-]+/g, ' ').trim();
  if (!words) return 'Fonction supplémentaire';
  return words.charAt(0).toLocaleUpperCase('fr-FR') + words.slice(1);
}

export function presentEntitlements(entitlements: Entitlement[]): PresentedEntitlement[] {
  const activeCodes = new Set(
    entitlements.filter((entitlement) => entitlement.enabled).map((entitlement) => entitlement.code),
  );
  const knownCodes = new Set(DISPLAYED_ENTITLEMENTS.flatMap((entitlement) => entitlement.codes));
  const known = DISPLAYED_ENTITLEMENTS.map((entitlement) => ({
    id: entitlement.id,
    label: entitlement.label,
    enabled: entitlement.codes.some((code) => activeCodes.has(code)),
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

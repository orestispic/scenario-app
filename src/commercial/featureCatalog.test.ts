import { describe, expect, it } from 'vitest';
import { canUseFeature, featureLockedMessage } from './featureCatalog';
import type { LicenseState } from './offlineLicense';

const free: LicenseState = { kind: 'free' };
const author: LicenseState = {
  kind: 'valid',
  entitlements: [
    'pro_formats', 'personal_comments', 'scenario_versions', 'scenario_compare',
    'voice_reading', 'ai.actions', 'ai_short_action', 'scene_cards',
  ].map((code) => ({ code, enabled: true, value: null })),
};
const studio: LicenseState = {
  kind: 'valid',
  entitlements: [
    ...author.entitlements!, 'breakdown', 'technical_breakdown', 'cloud.sync', 'scenario_versions',
    'studio_collaboration',
  ].map((entitlement) => typeof entitlement === 'string'
    ? { code: entitlement, enabled: true, value: null }
    : entitlement),
};

describe('catalogue des fonctionnalités', () => {
  it('laisse les fonctions locales gratuites, sans licence', () => {
    expect(canUseFeature(free, 'localScenarios')).toBe(true);
    expect(canUseFeature(free, 'pdfAndFountainExport')).toBe(true);
    expect(canUseFeature(free, 'professionalExports')).toBe(false);
  });

  it('accorde les fonctions Auteur sans ouvrir les espaces Studio', () => {
    expect(canUseFeature(author, 'personalComments')).toBe(true);
    expect(canUseFeature(author, 'whiteboard')).toBe(true);
    expect(canUseFeature(author, 'timeline')).toBe(true);
    expect(canUseFeature(author, 'breakdownWorkspace')).toBe(false);
    expect(canUseFeature(author, 'cloudWorkspace')).toBe(false);
  });

  it('exige tous les droits nécessaires aux espaces Studio', () => {
    expect(canUseFeature(studio, 'breakdownWorkspace')).toBe(true);
    expect(canUseFeature(studio, 'technicalBreakdownWorkspace')).toBe(true);
    expect(canUseFeature(studio, 'sharingAndCollaboration')).toBe(true);
    expect(featureLockedMessage('voiceReading')).toContain('offre Auteur');
  });
});

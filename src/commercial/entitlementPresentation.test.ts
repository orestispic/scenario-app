import { describe, expect, it } from 'vitest';
import { presentEntitlements } from './entitlementPresentation';

describe('présentation des droits du compte', () => {
  it('regroupe les alias techniques et affiche aussi les fonctions inactives', () => {
    const rights = presentEntitlements([
      { code: 'local.edit', enabled: true, value: null },
      { code: 'cloud_sync', enabled: true, value: null },
      { code: 'ai.actions', enabled: false, value: null },
    ]);

    expect(rights.find((right) => right.id === 'local-writing')).toMatchObject({
      label: 'Écriture et fichiers locaux',
      enabled: true,
    });
    expect(rights.find((right) => right.id === 'cloud-sync')?.enabled).toBe(true);
    expect(rights.find((right) => right.id === 'ai-writing')?.enabled).toBe(false);
    expect(rights.filter((right) => right.id === 'cloud-sync')).toHaveLength(1);
  });

  it('conserve un droit serveur inconnu avec un libellé lisible', () => {
    const rights = presentEntitlements([
      { code: 'future_right', enabled: true, value: null },
    ]);
    expect(rights[rights.length - 1]).toEqual({
      id: 'additional-future_right',
      label: 'Future right',
      enabled: true,
    });
  });
});

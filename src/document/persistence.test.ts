import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
import { writeAutosave, writeBackup, writeScenario, clearRecovery } from './persistence';

describe('Écritures de projet ordonnées', () => {
  beforeEach(() => invoke.mockReset());
  it('une ancienne autosave ne peut pas dépasser la sauvegarde de changement de version', async () => {
    let finish!: () => void;
    invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const old = writeAutosave('ancienne');
    const backup = writeBackup('version sortante');
    const next = writeAutosave('toutes les versions');
    const file = writeScenario('test.scenario', 'toutes les versions');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    finish(); await Promise.all([old, backup, next, file]);
    expect(invoke.mock.calls).toEqual([
      ['write_autosave', { contents: 'ancienne' }], ['write_backup', { contents: 'version sortante' }],
      ['write_autosave', { contents: 'toutes les versions' }], ['write_scenario', { path: 'test.scenario', contents: 'toutes les versions' }],
    ]);
  });
  it('un échec est signalé sans bloquer les sauvegardes suivantes', async () => {
    invoke.mockRejectedValueOnce(new Error('Disque plein')).mockResolvedValue(undefined);
    await expect(writeBackup('sortante')).rejects.toThrow('Disque plein');
    await expect(writeAutosave('nouvelle')).resolves.toBeUndefined();
    await expect(clearRecovery()).resolves.toBeUndefined();
    expect(invoke.mock.calls.map(call => call[0])).toEqual(['write_backup', 'write_autosave', 'clear_recovery']);
  });
});

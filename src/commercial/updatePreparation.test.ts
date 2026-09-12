import { describe, it, expect } from 'vitest';
import { UpdatePreparation, type UpdateProvider } from './updatePreparation';
describe('update preparation with simulated native provider', () => {
  it('does nothing without a provider', async () => {
    const update = new UpdatePreparation();
    await update.check(); await update.prepareAndInstall(async () => { throw new Error('must not run'); });
    expect(update.state).toBe('disabled');
  });
  it('installs once after verification and saving, despite concurrent clicks', async () => {
    const calls: string[] = [];
    const provider: UpdateProvider = { check: async () => ({ version: '0.1.8' }),
      downloadAndVerify: async () => { calls.push('verify'); return {
        install: async () => { calls.push('install'); }, dispose: async () => { calls.push('dispose'); },
      }; } };
    const update = new UpdatePreparation(provider); await update.check();
    const save = async () => { calls.push('save-and-drain'); return true; };
    await Promise.all([update.prepareAndInstall(save), update.prepareAndInstall(save)]);
    expect(calls).toEqual(['verify', 'save-and-drain', 'install', 'dispose']);
    expect(update.state).toBe('finished');
  });
  it('refuses unverified, cancelled downloads and failed saves', async () => {
    for (const failure of ['signature', 'cancel', 'save']) {
      let installs = 0;
      const update = new UpdatePreparation({ check: async () => ({ version: '0.1.8' }),
        downloadAndVerify: async () => {
          if (failure === 'signature') throw new Error('invalid signature');
          if (failure === 'cancel') update.cancel();
          return { install: async () => { installs++; }, dispose: async () => {} };
        } });
      await update.check(); await update.prepareAndInstall(async () => false);
      expect(installs).toBe(0);
      expect(update.state).toBe(failure === 'save' ? 'available' : 'failed');
    }
  });
  it('does not retry an uncertain installation automatically', async () => {
    let installs = 0;
    const update = new UpdatePreparation({ check: async () => ({ version: '0.1.8' }),
      downloadAndVerify: async () => ({ install: async () => { installs++; throw new Error('uncertain'); }, dispose: async () => {} }) });
    await update.check(); await update.prepareAndInstall(async () => true);
    await update.prepareAndInstall(async () => true);
    expect(installs).toBe(1); expect(update.state).toBe('failed');
  });
});

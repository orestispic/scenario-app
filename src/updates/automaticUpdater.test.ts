import { expect, it, vi } from 'vitest';
import type { Update } from '@tauri-apps/plugin-updater';
import { createAutomaticUpdater } from './automaticUpdater';

it('downloads an update but waits for a saved document before installing it', async () => {
  let safe = false;
  const statuses: string[] = [];
  const update = {
    version: '0.1.8',
    download: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } as unknown as Update;
  const updater = createAutomaticUpdater({
    isSafeToInstall: () => safe,
    onStatus: (status) => statuses.push(status),
    checkForUpdate: vi.fn(async () => update),
  });

  await updater.checkNow();
  expect(update.download).toHaveBeenCalledOnce();
  expect(update.install).not.toHaveBeenCalled();
  expect(statuses[statuses.length - 1]).toContain('enregistrez le document');

  safe = true;
  await updater.installWhenSafe();
  expect(update.install).toHaveBeenCalledOnce();
});

it('leaves local writing untouched when the update server is unavailable', async () => {
  const status = vi.fn();
  const updater = createAutomaticUpdater({
    isSafeToInstall: () => true,
    onStatus: status,
    checkForUpdate: vi.fn(async () => {
      throw new TypeError('offline');
    }),
  });

  await expect(updater.checkNow()).resolves.toBeUndefined();
  expect(status).not.toHaveBeenCalled();
});

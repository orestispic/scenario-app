import { isTauri } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';

const INITIAL_DELAY_MS = 8_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60_000;

type UpdaterOptions = {
  isSafeToInstall: () => boolean;
  onStatus: (status: string) => void;
  checkForUpdate?: typeof check;
};

export type AutomaticUpdater = {
  start: () => () => void;
  checkNow: () => Promise<void>;
  installWhenSafe: () => Promise<void>;
};

/**
 * Downloads verified updates in the background, then installs them only when
 * the current document is saved. Tauri verifies the release signature before
 * this code is allowed to install it.
 */
export function createAutomaticUpdater({
  isSafeToInstall,
  onStatus,
  checkForUpdate = check,
}: UpdaterOptions): AutomaticUpdater {
  let stopped = false;
  let checking = false;
  let installing = false;
  let downloaded: Update | null = null;
  let initialTimer: number | undefined;
  let intervalTimer: number | undefined;

  const installWhenSafe = async () => {
    if (stopped || installing || !downloaded) return;
    if (!isSafeToInstall()) {
      onStatus(`Mise à jour ${downloaded.version} prête — enregistrez le document`);
      return;
    }
    installing = true;
    onStatus(`Installation de la mise à jour ${downloaded.version}…`);
    try {
      await downloaded.install();
    } catch {
      onStatus('Mise à jour reportée — elle sera réessayée au prochain démarrage');
      await downloaded.close().catch(() => undefined);
      downloaded = null;
    } finally {
      installing = false;
    }
  };

  const checkNow = async () => {
    if (stopped || checking || installing || downloaded) return;
    checking = true;
    try {
      const update = await checkForUpdate({ timeout: 15_000 });
      if (!update || stopped) {
        await update?.close().catch(() => undefined);
        return;
      }
      onStatus(`Téléchargement de la mise à jour ${update.version}…`);
      await update.download();
      if (stopped) {
        await update.close().catch(() => undefined);
        return;
      }
      downloaded = update;
      await installWhenSafe();
    } catch {
      // An absent network or release server must never interrupt local writing.
    } finally {
      checking = false;
    }
  };

  const start = () => {
    if (!isTauri()) return () => undefined;
    initialTimer = window.setTimeout(() => void checkNow(), INITIAL_DELAY_MS);
    intervalTimer = window.setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
    return () => {
      stopped = true;
      if (initialTimer !== undefined) clearTimeout(initialTimer);
      if (intervalTimer !== undefined) clearInterval(intervalTimer);
      void downloaded?.close().catch(() => undefined);
      downloaded = null;
    };
  };

  return { start, checkNow, installWhenSafe };
}

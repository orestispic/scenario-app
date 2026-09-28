import type { SessionTokens } from './contractsV2';

export interface AccountSessionSwitchDependencies {
  stopAuthenticatedOperations(): void;
  closeCloudProject(): Promise<void>;
  clearOfflineLicense(): Promise<void>;
  forgetCloudSyncQueue(): Promise<void>;
  invalidateAccountOverview(): void;
  resetDeviceActivation(): void;
  resetExclusiveDeviceSession(): void;
  resumeDeviceActivation(): void;
  acceptSession(session: SessionTokens): Promise<unknown>;
  discardSession(session: Pick<SessionTokens, 'accessToken'>): Promise<void>;
  resetAuthenticatedOperations(): void;
}

/**
 * Replaces an authenticated account only after every account-bound runtime has
 * been fenced and cleared. A rejected transition leaves the existing vault
 * session untouched whenever acceptance has not started.
 */
export async function switchAccountSession(
  session: SessionTokens,
  dependencies: AccountSessionSwitchDependencies,
): Promise<void> {
  dependencies.stopAuthenticatedOperations();
  let accepted = false;
  try {
    await dependencies.closeCloudProject();
    await dependencies.clearOfflineLicense();
    await dependencies.forgetCloudSyncQueue();
    dependencies.invalidateAccountOverview();
    dependencies.resetDeviceActivation();
    dependencies.resetExclusiveDeviceSession();
    dependencies.resumeDeviceActivation();
    await dependencies.acceptSession(session);
    accepted = true;
  } catch (error) {
    if (!accepted)
      await dependencies.discardSession(session).catch(() => undefined);
    throw error;
  } finally {
    dependencies.resetAuthenticatedOperations();
  }
}

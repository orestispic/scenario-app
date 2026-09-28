import { describe, expect, it, vi } from 'vitest';
import { switchAccountSession, type AccountSessionSwitchDependencies } from './accountSessionSwitch';
import type { SessionTokens } from './contractsV2';

const session: SessionTokens = {
  accessToken: 'recovery-access',
  refreshToken: 'recovery-refresh',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function dependencies(order: string[]): AccountSessionSwitchDependencies {
  const step = (name: string) => vi.fn(async () => { order.push(name); });
  return {
    stopAuthenticatedOperations: vi.fn(() => { order.push('stop'); }),
    closeCloudProject: step('close-cloud'),
    clearOfflineLicense: step('clear-offline'),
    forgetCloudSyncQueue: step('forget-queue'),
    invalidateAccountOverview: vi.fn(() => { order.push('invalidate-overview'); }),
    resetDeviceActivation: vi.fn(() => { order.push('reset-device'); }),
    resetExclusiveDeviceSession: vi.fn(() => { order.push('reset-device-session'); }),
    resumeDeviceActivation: vi.fn(() => { order.push('resume-device'); }),
    acceptSession: vi.fn(async () => { order.push('accept'); }),
    discardSession: vi.fn(async () => { order.push('discard'); }),
    resetAuthenticatedOperations: vi.fn(() => { order.push('reset-operations'); }),
  };
}

describe('transactional account session replacement', () => {
  it('clears every account-bound runtime before accepting the recovery session', async () => {
    const order: string[] = [];
    const deps = dependencies(order);

    await switchAccountSession(session, deps);

    expect(order).toEqual([
      'stop',
      'close-cloud',
      'clear-offline',
      'forget-queue',
      'invalidate-overview',
      'reset-device',
      'reset-device-session',
      'resume-device',
      'accept',
      'reset-operations',
    ]);
    expect(deps.acceptSession).toHaveBeenCalledWith(session);
    expect(deps.discardSession).not.toHaveBeenCalled();
  });

  it('never accepts after cleanup failure and revokes the unused recovery session', async () => {
    const order: string[] = [];
    const deps = dependencies(order);
    vi.mocked(deps.clearOfflineLicense).mockImplementationOnce(async () => {
      order.push('clear-offline-failed');
      throw new Error('vault locked');
    });

    await expect(switchAccountSession(session, deps)).rejects.toThrow('vault locked');

    expect(deps.acceptSession).not.toHaveBeenCalled();
    expect(deps.forgetCloudSyncQueue).not.toHaveBeenCalled();
    expect(deps.discardSession).toHaveBeenCalledWith(session);
    expect(order[order.length - 1]).toBe('reset-operations');
  });
});

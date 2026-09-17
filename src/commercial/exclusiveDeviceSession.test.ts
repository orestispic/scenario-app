import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExclusiveDeviceSession } from './exclusiveDeviceSession';

describe('ExclusiveDeviceSession', () => {
  afterEach(() => vi.useRealTimers());

  it('deduplicates claims, heartbeats the lease and releases it', async () => {
    vi.useFakeTimers();
    const claimDeviceSession = vi.fn().mockResolvedValue({
      leaseId: '10000000-0000-4000-8000-000000000001',
      deviceId: '20000000-0000-4000-8000-000000000002',
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    });
    const heartbeatDeviceSession = vi.fn().mockResolvedValue({
      leaseId: '10000000-0000-4000-8000-000000000001',
      deviceId: '20000000-0000-4000-8000-000000000002',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const releaseDeviceSession = vi.fn().mockResolvedValue(undefined);
    const manager = new ExclusiveDeviceSession(() => ({
      claimDeviceSession, heartbeatDeviceSession, releaseDeviceSession,
    }));

    await Promise.all([
      manager.ensure('20000000-0000-4000-8000-000000000002'),
      manager.ensure('20000000-0000-4000-8000-000000000002'),
    ]);
    expect(claimDeviceSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeatDeviceSession).toHaveBeenCalledTimes(1);
    await manager.release();
    expect(releaseDeviceSession).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit forced claim when the user takes over', async () => {
    const claimDeviceSession = vi.fn().mockResolvedValue({
      leaseId: '10000000-0000-4000-8000-000000000003',
      deviceId: '20000000-0000-4000-8000-000000000004',
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    });
    const manager = new ExclusiveDeviceSession(() => ({
      claimDeviceSession,
      heartbeatDeviceSession: vi.fn(),
      releaseDeviceSession: vi.fn(),
    }));
    await manager.takeOver('20000000-0000-4000-8000-000000000004');
    expect(claimDeviceSession).toHaveBeenCalledWith('20000000-0000-4000-8000-000000000004', true);
    manager.reset();
  });
});

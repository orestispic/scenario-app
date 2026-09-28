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

  it('can report a failed release to logout after clearing the local lease', async () => {
    const deviceId = '20000000-0000-4000-8000-000000000009';
    const claimDeviceSession = vi.fn().mockResolvedValue({
      leaseId: '10000000-0000-4000-8000-000000000009',
      deviceId,
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
    });
    const releaseDeviceSession = vi.fn().mockRejectedValue(new TypeError('offline'));
    const manager = new ExclusiveDeviceSession(() => ({
      claimDeviceSession,
      heartbeatDeviceSession: vi.fn(),
      releaseDeviceSession,
    }));

    await manager.ensure(deviceId);
    await expect(manager.release(true)).rejects.toThrow('offline');
    await manager.ensure(deviceId);

    expect(claimDeviceSession).toHaveBeenCalledTimes(2);
  });

  it('never reuses or installs a pending lease for another device', async () => {
    const resolvers = new Map<string, (lease: { leaseId: string; deviceId: string; expiresAt: string }) => void>();
    const claimDeviceSession = vi.fn((deviceId: string) => new Promise<{
      leaseId: string;
      deviceId: string;
      expiresAt: string;
    }>(resolve => {
      resolvers.set(deviceId, resolve);
    }));
    const manager = new ExclusiveDeviceSession(() => ({
      claimDeviceSession,
      heartbeatDeviceSession: vi.fn(),
      releaseDeviceSession: vi.fn(),
    }));

    const first = manager.ensure('device-a');
    const second = manager.ensure('device-b');
    resolvers.get('device-b')?.({
      leaseId: 'lease-b', deviceId: 'device-b', expiresAt: new Date(Date.now() + 90_000).toISOString(),
    });
    await expect(second).resolves.toMatchObject({ deviceId: 'device-b' });
    resolvers.get('device-a')?.({
      leaseId: 'lease-a', deviceId: 'device-a', expiresAt: new Date(Date.now() + 90_000).toISOString(),
    });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(manager.ensure('device-b')).resolves.toMatchObject({ deviceId: 'device-b' });
    expect(claimDeviceSession).toHaveBeenCalledTimes(2);
    manager.reset();
  });

  it('serializes slow heartbeats and ignores a completion from a reset lease', async () => {
    vi.useFakeTimers();
    const deviceId = '20000000-0000-4000-8000-000000000006';
    const claimDeviceSession = vi.fn()
      .mockResolvedValueOnce({
        leaseId: '10000000-0000-4000-8000-000000000005',
        deviceId,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      })
      .mockResolvedValueOnce({
        leaseId: '10000000-0000-4000-8000-000000000006',
        deviceId,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      });
    let finishHeartbeat!: (lease: {
      leaseId: string;
      deviceId: string;
      expiresAt: string;
    }) => void;
    const heartbeatDeviceSession = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { finishHeartbeat = resolve; }))
      .mockResolvedValue({
        leaseId: '10000000-0000-4000-8000-000000000006',
        deviceId,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
    const manager = new ExclusiveDeviceSession(() => ({
      claimDeviceSession,
      heartbeatDeviceSession,
      releaseDeviceSession: vi.fn(),
    }));

    await manager.ensure(deviceId);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeatDeviceSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(heartbeatDeviceSession).toHaveBeenCalledTimes(1);

    manager.reset();
    finishHeartbeat({
      leaseId: '10000000-0000-4000-8000-000000000005',
      deviceId,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    await Promise.resolve();
    await Promise.resolve();

    await manager.ensure(deviceId);
    expect(claimDeviceSession).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(heartbeatDeviceSession).toHaveBeenCalledTimes(2);
    manager.reset();
  });
});

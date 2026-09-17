import type { DeviceSessionLease } from './contractsV2';

interface DeviceSessionApi {
  claimDeviceSession(deviceId: string, force?: boolean): Promise<DeviceSessionLease>;
  heartbeatDeviceSession(deviceId: string, leaseId: string): Promise<DeviceSessionLease>;
  releaseDeviceSession(deviceId: string, leaseId: string): Promise<void>;
}

/**
 * Maintains the short server lease that makes one registered device usable at
 * a time. The server remains authoritative; this class only keeps it alive.
 */
export class ExclusiveDeviceSession {
  private lease: DeviceSessionLease | null = null;
  private pending: Promise<DeviceSessionLease> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly api: () => DeviceSessionApi) {}

  ensure(deviceId: string): Promise<DeviceSessionLease> {
    if (this.lease?.deviceId === deviceId && Date.parse(this.lease.expiresAt) > Date.now() + 15_000)
      return Promise.resolve(this.lease);
    if (this.pending) return this.pending;
    return this.claim(deviceId, false);
  }

  takeOver(deviceId: string): Promise<DeviceSessionLease> {
    this.clearLocal();
    return this.claim(deviceId, true);
  }

  async release(): Promise<void> {
    const lease = this.lease;
    this.clearLocal();
    if (!lease) return;
    try { await this.api().releaseDeviceSession(lease.deviceId, lease.leaseId); }
    catch { /* The lease expires by itself if the network is already gone. */ }
  }

  reset(): void { this.clearLocal(); }

  private claim(deviceId: string, force: boolean): Promise<DeviceSessionLease> {
    const pending = this.api().claimDeviceSession(deviceId, force).then(lease => {
      this.lease = lease;
      this.startHeartbeat();
      return lease;
    }).catch(error => {
      this.clearLocal();
      throw error;
    }).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 30_000);
  }

  private async heartbeat(): Promise<void> {
    const lease = this.lease;
    if (!lease) return;
    try {
      this.lease = await this.api().heartbeatDeviceSession(lease.deviceId, lease.leaseId);
    } catch {
      if (this.lease?.leaseId === lease.leaseId) this.clearLocal();
    }
  }

  private clearLocal(): void {
    this.lease = null;
    this.pending = null;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

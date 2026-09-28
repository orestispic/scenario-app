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
  private pendingDeviceId: string | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(private readonly api: () => DeviceSessionApi) {}

  ensure(deviceId: string): Promise<DeviceSessionLease> {
    if (this.lease?.deviceId === deviceId && Date.parse(this.lease.expiresAt) > Date.now() + 15_000)
      return Promise.resolve(this.lease);
    if (this.pending && this.pendingDeviceId === deviceId) return this.pending;
    if (this.pending) this.clearLocal();
    return this.claim(deviceId, false);
  }

  takeOver(deviceId: string): Promise<DeviceSessionLease> {
    this.clearLocal();
    return this.claim(deviceId, true);
  }

  async release(reportFailure = false): Promise<void> {
    const lease = this.lease;
    this.clearLocal();
    if (!lease) return;
    try { await this.api().releaseDeviceSession(lease.deviceId, lease.leaseId); }
    catch (error) {
      // Most callers can rely on natural lease expiry. Logout asks for the
      // failure explicitly so it can explain that short server-side delay.
      if (reportFailure) throw error;
    }
  }

  reset(): void { this.clearLocal(); }

  private claim(deviceId: string, force: boolean): Promise<DeviceSessionLease> {
    const generation = this.generation;
    const pending = this.api().claimDeviceSession(deviceId, force).then(lease => {
      if (generation !== this.generation)
        throw new DOMException('Device session claim superseded.', 'AbortError');
      this.lease = lease;
      this.startHeartbeat();
      return lease;
    }).catch(error => {
      if (generation === this.generation) this.clearLocal();
      throw error;
    }).finally(() => {
      if (this.pending === pending) {
        this.pending = null;
        this.pendingDeviceId = null;
      }
    });
    this.pending = pending;
    this.pendingDeviceId = deviceId;
    return pending;
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    const generation = this.generation;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      void this.heartbeat(generation);
    }, 30_000);
  }

  private async heartbeat(generation: number): Promise<void> {
    const lease = this.lease;
    if (!lease || generation !== this.generation) return;
    try {
      const renewed = await this.api().heartbeatDeviceSession(lease.deviceId, lease.leaseId);
      if (generation !== this.generation || this.lease?.leaseId !== lease.leaseId) return;
      this.lease = renewed;
      this.startHeartbeat();
    } catch {
      if (generation === this.generation && this.lease?.leaseId === lease.leaseId)
        this.clearLocal();
    }
  }

  private clearLocal(): void {
    this.generation += 1;
    this.lease = null;
    this.pending = null;
    this.pendingDeviceId = null;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

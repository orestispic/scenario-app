import type { DeviceView } from './contractsV2';

/** One activation per signed-in lifecycle, shared by account, cloud and AI. */
export class DeviceActivation {
  private pending: Promise<DeviceView> | null = null;
  private suspended = false;
  constructor(private activate: () => Promise<DeviceView>) {}

  ensure(): Promise<DeviceView> {
    if (this.suspended) return Promise.reject(new Error('Cet appareil a été désactivé. Réactivez-le depuis la page Appareils.'));
    if (this.pending) return this.pending;
    const pending = this.activate().catch(error => {
      if (this.pending === pending) this.pending = null;
      throw error;
    });
    this.pending = pending;
    return pending;
  }

  reset(): void { this.pending = null; }
  suspend(): void { this.pending = null; this.suspended = true; }
  resume(): void { this.suspended = false; this.pending = null; }
}

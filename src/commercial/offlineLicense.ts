import type { AuthenticatedCommercialApi } from './authenticatedApi';
import { CommercialHttpError } from './authenticatedApi';
import { AuthSessionError } from './auth';
import type { OfflineTrustStore } from './offlineTrust';
import type { EntitlementCacheStorage } from './entitlementCache';
import { BOUND_CACHE_KEY, verifyBoundGrant } from './boundEntitlementCache';
import type { EntitlementsResponse, MeResponse } from './contractsV2';

export type LicenseState = { kind: 'free' | 'valid' | 'expired' | 'clock-error'; expiresAt?: string };
export async function licenseDigest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
export function trustedTime(lastSeen: number, serverTime: number, wall: number): number {
  if (![lastSeen, serverTime, wall].every(Number.isFinite) || wall + 60_000 < lastSeen) throw new Error('Horloge modifiée. Reconnectez-vous pour vérifier la licence.');
  return Math.max(lastSeen, serverTime, wall);
}

/** No local file is gated here: only a verified lease can report paid offline rights. */
export class OfflineLicense {
  state: LicenseState = { kind: 'free' };
  private pending: Promise<void> | null = null;
  private epoch = 0;
  private listeners = new Set<() => void>();
  private anchor = { wall: Date.now(), monotonic: performance.now() };
  constructor(private trust: OfflineTrustStore, private storage: EntitlementCacheStorage,
    private fingerprint: () => string, private api: () => AuthenticatedCommercialApi,
    private token: () => Promise<string | null>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: LicenseState) { this.state = state; this.listeners.forEach(fn => fn()); }
  async clear() {
    this.epoch++;
    await this.trust.clear();
    this.storage.setItem(BOUND_CACHE_KEY, 'null');
    this.publish({ kind: 'free' });
  }
  async restore(): Promise<{ me: MeResponse; entitlements: EntitlementsResponse } | null> {
    const epoch = this.epoch;
    try {
      const trust = await this.trust.read();
      const raw = this.storage.getItem(BOUND_CACHE_KEY);
      if (!trust?.lease || !raw || trust.lease.deviceFingerprint !== this.fingerprint() || await licenseDigest(raw) !== trust.lease.digest) {
        this.publish({ kind: 'free' }); return null;
      }
      const cache = JSON.parse(raw);
      const wall = Date.now();
      let now: number;
      try { now = trustedTime(trust.lease.lastSeen, trust.lease.serverTime, wall); }
      catch { this.publish({ kind: 'clock-error' }); return null; }
      now = Math.max(now, this.anchor.wall + performance.now() - this.anchor.monotonic);
      await verifyBoundGrant(cache.snapshot, cache.grant, trust.publicKey, trust.keyId, trust.me.account.id, new Date(now));
      if (epoch !== this.epoch) return null;
      await this.trust.write({ ...trust, lease: { ...trust.lease, lastSeen: now } });
      if (epoch !== this.epoch) { await this.trust.clear(); return null; }
      this.publish({ kind: 'valid', expiresAt: cache.snapshot.offlineValidUntil });
      return { me: trust.me, entitlements: { snapshot: cache.snapshot, offlineGrant: cache.grant } };
    } catch { this.publish({ kind: 'expired' }); return null; }
  }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    this.pending = (async () => {
      try {
        // A missing online session is not a revocation of a still-valid offline lease.
        // Explicit logout and authoritative 401/403 responses clear it separately.
        if (!await this.token()) { await this.restore(); return; }
        const api = this.api();
        const [config, me, entitlements] = await Promise.all([api.getConfiguration(), api.getMe(), api.getEntitlements()]);
        const { offlineGrant: grant, snapshot } = entitlements;
        const payload = JSON.parse(atob(grant.payload.replace(/-/g, '+').replace(/_/g, '/')));
        const serverTime = Date.parse(payload.serverTime);
        if (!payload.deviceId || payload.deviceFingerprint !== this.fingerprint() || !Number.isFinite(serverTime)) {
          await this.clear(); return;
        }
        await verifyBoundGrant(snapshot, grant, config.offlineGrantPublicKey, config.offlineGrantKeyId, me.account.id, new Date(serverTime));
        if (epoch !== this.epoch) return;
        const raw = JSON.stringify({ schemaVersion: 4, snapshot, grant, verifiedAt: new Date(serverTime).toISOString() });
        this.storage.setItem(BOUND_CACHE_KEY, raw);
        await this.trust.write({ schemaVersion: 1, me, publicKey: config.offlineGrantPublicKey, keyId: config.offlineGrantKeyId,
          lease: { digest: await licenseDigest(raw), deviceFingerprint: this.fingerprint(), lastSeen: Date.now(), serverTime } });
        if (epoch !== this.epoch) { await this.trust.clear(); return; }
        this.anchor = { wall: serverTime, monotonic: performance.now() };
        this.publish({ kind: 'valid', expiresAt: snapshot.offlineValidUntil });
      } catch (error) {
        if (epoch !== this.epoch) return;
        if (error instanceof AuthSessionError && error.terminal || error instanceof CommercialHttpError && [401,403].includes(error.status)) await this.clear();
        else await this.restore();
      }
    })().finally(() => { this.pending = null; });
    return this.pending;
  }
  start(): () => void {
    void this.restore().then(() => this.refresh());
    const refresh = () => { void this.refresh(); };
    const timer = window.setInterval(refresh, 15 * 60_000);
    const expiry = window.setInterval(() => { if (!this.pending) void this.restore(); }, 60_000);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); clearInterval(expiry); window.removeEventListener('online', refresh); };
  }
}

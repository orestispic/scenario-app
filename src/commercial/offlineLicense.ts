import type { AuthenticatedCommercialApi } from './authenticatedApi';
import { CommercialHttpError } from './authenticatedApi';
import { AuthSessionError } from './auth';
import type { OfflineTrustStore } from './offlineTrust';
import type { EntitlementCacheStorage } from './entitlementCache';
import { BOUND_CACHE_KEY, verifyBoundGrant } from './boundEntitlementCache';
import type { EntitlementsResponse, MeResponse } from './contractsV2';
import type { Entitlement } from './contracts';

export type LicenseState = {
  kind: 'free' | 'valid' | 'expired' | 'clock-error';
  expiresAt?: string;
  entitlements?: Entitlement[];
};

export type OfflineLicenseRefreshResult =
  | { ok: true; source: 'online' | 'offline'; state: LicenseState }
  | {
      ok: false;
      reason: 'no_session' | 'refresh_failed' | 'unauthorized' | 'invalid_grant' | 'superseded';
      state: LicenseState;
    };

export function hasActiveEntitlement(state: LicenseState, code: string): boolean {
  return state.kind === 'valid' && Boolean(
    state.entitlements?.some(entitlement => entitlement.code === code && entitlement.enabled),
  );
}
export async function licenseDigest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
}
function decodeGrantPayload(value: string): Record<string, unknown> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}
export function trustedTime(lastSeen: number, serverTime: number, wall: number): number {
  if (![lastSeen, serverTime, wall].every(Number.isFinite) || wall + 5 * 60_000 < lastSeen) throw new Error('Horloge modifiée. Reconnectez-vous pour vérifier la licence.');
  return Math.max(lastSeen, serverTime, wall);
}

/** No local file is gated here: only a verified lease can report paid offline rights. */
export class OfflineLicense {
  state: LicenseState = { kind: 'free' };
  private pending: Promise<OfflineLicenseRefreshResult> | null = null;
  private epoch = 0;
  private listeners = new Set<() => void>();
  private anchor = { wall: Date.now(), monotonic: performance.now() };
  constructor(private trust: OfflineTrustStore, private storage: EntitlementCacheStorage,
    private fingerprint: () => string, private api: () => AuthenticatedCommercialApi,
    private token: () => Promise<string | null>,
    private keyThumbprint: () => string = fingerprint,
    private currentDevice?: () => Promise<{ id: string }>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: LicenseState) { this.state = state; this.listeners.forEach(fn => fn()); }
  async clear() {
    this.epoch++;
    // Do not let an in-flight refresh from the previous account become the
    // shared promise for the next account.  The old task is fenced by `epoch`
    // and may finish harmlessly; a new account must be able to refresh now.
    this.pending = null;
    // Revocation is an in-memory security boundary. Apply it before touching
    // either persistence layer so a locked vault/localStorage can never leave
    // paid rights active for the rest of the process.
    this.publish({ kind: 'free' });
    const trustClear = Promise.resolve().then(() => this.trust.clear());
    let storageError: unknown;
    try {
      this.storage.setItem(BOUND_CACHE_KEY, 'null');
    } catch (error) {
      storageError = error;
    }
    const [trustResult] = await Promise.allSettled([trustClear]);
    if (storageError || trustResult.status === 'rejected')
      throw new Error('Le cache local de licence n’a pas pu être entièrement effacé.');
  }
  async restore(): Promise<{ me: MeResponse; entitlements: EntitlementsResponse } | null> {
    const epoch = this.epoch;
    try {
      const trust = await this.trust.read();
      const raw = this.storage.getItem(BOUND_CACHE_KEY);
      const sameDevice = trust?.lease?.deviceKeyThumbprint
        ? trust.lease.deviceKeyThumbprint === this.keyThumbprint()
        : trust?.lease?.deviceFingerprint === this.fingerprint();
      if (!trust?.lease || !raw || !sameDevice || await licenseDigest(raw) !== trust.lease.digest) {
        if (epoch === this.epoch) this.publish({ kind: 'free' });
        return null;
      }
      const cache = JSON.parse(raw);
      const wall = Date.now();
      let now: number;
      try { now = trustedTime(trust.lease.lastSeen, trust.lease.serverTime, wall); }
      catch {
        if (epoch === this.epoch) this.publish({ kind: 'clock-error' });
        return null;
      }
      now = Math.max(now, this.anchor.wall + performance.now() - this.anchor.monotonic);
      await verifyBoundGrant(cache.snapshot, cache.grant, trust.publicKey, trust.keyId, trust.me.account.id, new Date(now));
      if (epoch !== this.epoch) return null;
      await this.trust.write({ ...trust, lease: { ...trust.lease, lastSeen: now } });
      if (epoch !== this.epoch) { await this.trust.clear(); return null; }
      this.publish({
        kind: 'valid',
        expiresAt: cache.snapshot.offlineValidUntil,
        entitlements: cache.snapshot.entitlements,
      });
      return { me: trust.me, entitlements: { snapshot: cache.snapshot, offlineGrant: cache.grant } };
    } catch {
      if (epoch === this.epoch) this.publish({ kind: 'expired' });
      return null;
    }
  }
  refresh(meHint?: MeResponse): Promise<OfflineLicenseRefreshResult> {
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    const pending = (async (): Promise<OfflineLicenseRefreshResult> => {
      try {
        // A missing online session is not a revocation of a still-valid offline lease.
        // Explicit logout and authoritative 401/403 responses clear it separately.
        if (!await this.token()) {
          const restored = await this.restore();
          return restored
            ? { ok: true, source: 'offline', state: this.state }
            : { ok: false, reason: 'no_session', state: this.state };
        }
        const api = this.api();
        const [config, me] = await Promise.all([
          api.getConfiguration(),
          meHint ? Promise.resolve(meHint) : api.getMe(),
        ]);
        const device = this.currentDevice ? await this.currentDevice() : null;
        const entitlements = device ? await api.renewOfflineLicense(device.id) : await api.getEntitlements();
        const { offlineGrant: grant, snapshot } = entitlements;
        const payload = decodeGrantPayload(grant.payload);
        const serverTime = Date.parse(String(payload.serverTime ?? ''));
        const boundToDevice = typeof payload.deviceKeyThumbprint === 'string'
          ? payload.deviceKeyThumbprint === this.keyThumbprint()
          : payload.deviceFingerprint === this.fingerprint();
        if (!payload.deviceId || !boundToDevice || !Number.isFinite(serverTime)) {
          await this.clear();
          return { ok: false, reason: 'invalid_grant', state: this.state };
        }
        const publicKey = config.offlineGrantPublicKeys?.[grant.keyId]
          ?? (grant.keyId === config.offlineGrantKeyId ? config.offlineGrantPublicKey : undefined);
        if (!publicKey) throw new Error('Clé de signature de licence inconnue.');
        await verifyBoundGrant(snapshot, grant, publicKey, grant.keyId, me.account.id, new Date(serverTime));
        if (epoch !== this.epoch) return { ok: false, reason: 'superseded', state: this.state };
        const raw = JSON.stringify({ schemaVersion: 4, snapshot, grant, verifiedAt: new Date(serverTime).toISOString() });
        this.storage.setItem(BOUND_CACHE_KEY, raw);
        await this.trust.write({ schemaVersion: 1, me, publicKey, keyId: grant.keyId,
          lease: { digest: await licenseDigest(raw), deviceKeyThumbprint: this.keyThumbprint(), lastSeen: serverTime, serverTime } });
        if (epoch !== this.epoch) {
          await this.trust.clear();
          return { ok: false, reason: 'superseded', state: this.state };
        }
        this.anchor = { wall: serverTime, monotonic: performance.now() };
        this.publish({
          kind: 'valid',
          expiresAt: snapshot.offlineValidUntil,
          entitlements: snapshot.entitlements,
        });
        return { ok: true, source: 'online', state: this.state };
      } catch (error) {
        if (epoch !== this.epoch) return { ok: false, reason: 'superseded', state: this.state };
        if (error instanceof AuthSessionError && error.terminal || error instanceof CommercialHttpError && [401,403].includes(error.status)) {
          await this.clear();
          return { ok: false, reason: 'unauthorized', state: this.state };
        }
        await this.restore();
        return { ok: false, reason: 'refresh_failed', state: this.state };
      }
    })().finally(() => {
      // A stale account refresh must not clear the newer account's promise.
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }
  start(): () => void {
    void this.restore().then(() => this.refresh());
    const refresh = () => { void this.refresh(); };
    const timer = window.setInterval(refresh, 6 * 60 * 60_000);
    const expiry = window.setInterval(() => { if (!this.pending) void this.restore(); }, 60_000);
    window.addEventListener('online', refresh);
    return () => { clearInterval(timer); clearInterval(expiry); window.removeEventListener('online', refresh); };
  }
}

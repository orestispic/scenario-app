import { expect, it, vi } from 'vitest';
import { hasActiveEntitlement, licenseDigest, OfflineLicense, trustedTime } from './offlineLicense';
import type { OfflineTrust } from './offlineTrust';
import { CommercialHttpError, type AuthenticatedCommercialApi } from './authenticatedApi';
import type { EntitlementsResponse } from './contractsV2';

it('renews a signed device lease, restores offline, expires, and clears on logout', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const now = Date.now();
  const snapshot = { id: 's', configurationVersion: 'v', issuedAt: new Date(now - 1000).toISOString(), offlineValidUntil: new Date(now + 10_000).toISOString(), entitlements: [{ code: 'pro_formats', enabled: true, value: null }] };
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const payload = encode(new TextEncoder().encode(JSON.stringify({ userId: 'u', deviceId: 'd', deviceFingerprint: 'fingerprint', serverTime: new Date(now).toISOString(), snapshotId: 's', configurationVersion: 'v', issuedAt: snapshot.issuedAt, expiresAt: snapshot.offlineValidUntil, contractVersion: '2026-09-v4', snapshotJson: JSON.stringify(snapshot) })));
  const signature = encode(new Uint8Array(await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, pair.privateKey, new TextEncoder().encode(payload))));
  const entitlements: EntitlementsResponse = { snapshot, offlineGrant: { format:'scenario.offline-grant.v1', algorithm:'ES256', keyId:'k', payload, signature } };
  let trust: OfflineTrust | null = null;
  const data = new Map<string,string>();
  const store = { read: async () => trust, write: async (v: OfflineTrust) => { trust = v; }, clear: async () => { trust = null; } };
  const api = { getConfiguration: async () => ({ offlineGrantPublicKey: publicKey, offlineGrantKeyId:'k' }), getMe: async () => ({ account: { id:'u' } }), getEntitlements: async () => entitlements } as unknown as AuthenticatedCommercialApi;
  let session: string | null = 'session';
  const license = new OfflineLicense(store, { getItem: k => data.get(k) ?? null, setItem: (k,v) => { data.set(k,v); } }, () => 'fingerprint', () => api, async () => session);
  await expect(license.refresh()).resolves.toMatchObject({ ok: true, source: 'online' });
  expect(license.state.kind).toBe('valid');
  expect(hasActiveEntitlement(license.state, 'pro_formats')).toBe(true);
  expect(hasActiveEntitlement(license.state, 'scenario_versions')).toBe(false);
  expect((await license.restore())?.entitlements.snapshot).toEqual(snapshot);
  session = null;
  await expect(license.refresh()).resolves.toMatchObject({ ok: true, source: 'offline' });
  expect(license.state.kind).toBe('valid');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
  try { expect(await license.restore()).toBeNull(); expect(license.state.kind).toBe('expired'); }
  finally { clock.mockRestore(); }
  await license.clear(); expect(trust).toBeNull();
  expect(hasActiveEntitlement(license.state, 'pro_formats')).toBe(false);
});

it('detects backward time and never moves the trusted clock backwards', () => {
  expect(trustedTime(100_000, 90_000, 99_000)).toBe(100_000);
  expect(() => trustedTime(1_000_000, 900_000, 600_000)).toThrow();
  expect(() => trustedTime(NaN, 90_000, 1_000)).toThrow();
});

it('rejects copied or replaced offline cache and fails closed without deleting documents', async () => {
  let trust: OfflineTrust | null = { schemaVersion: 1, me: { account: { id: 'user' } } as OfflineTrust['me'], publicKey: {}, keyId: 'test',
    lease: { digest: await licenseDigest('original'), deviceKeyThumbprint: 'device-key-a', lastSeen: Date.now(), serverTime: Date.now() } };
  const store = { read: async () => trust, write: async (v: OfflineTrust) => { trust = v; }, clear: async () => { trust = null; } };
  const cache = new Map([['document', 'user text']]);
  const storage = { getItem: () => 'replaced', setItem: (k: string,v: string) => { cache.set(k,v); } };
  const license = new OfflineLicense(store, storage, () => 'same-copied-fingerprint', () => ({} as AuthenticatedCommercialApi), async () => null, () => 'device-key-b');
  expect(await license.restore()).toBeNull();
  await license.clear();
  expect(cache.get('document')).toBe('user text');
  expect(trust).toBeNull();
});

it('does not let an old account refresh block or clear the new account refresh', async () => {
  let releaseOld!: () => void;
  const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
  let currentAccount: 'old' | 'new' = 'old';
  let newAccountReads = 0;
  const oldApi = {
    getConfiguration: async () => { await oldGate; throw new TypeError('old account offline'); },
    getMe: async () => ({ account: { id: 'old' } }),
  } as unknown as AuthenticatedCommercialApi;
  const newApi = {
    getConfiguration: async () => { newAccountReads += 1; throw new TypeError('new account offline'); },
    getMe: async () => ({ account: { id: 'new' } }),
  } as unknown as AuthenticatedCommercialApi;
  const trustStore = {
    read: async () => null,
    write: async () => undefined,
    clear: async () => undefined,
  };
  const license = new OfflineLicense(
    trustStore,
    { getItem: () => null, setItem: () => undefined },
    () => 'fingerprint',
    () => currentAccount === 'old' ? oldApi : newApi,
    async () => 'session',
  );

  const staleRefresh = license.refresh();
  await Promise.resolve();
  await license.clear();
  currentAccount = 'new';
  const currentRefresh = license.refresh();
  await currentRefresh;
  expect(newAccountReads).toBe(1);

  releaseOld();
  await staleRefresh;
  expect(license.state.kind).toBe('free');
});

it('reports a failed online renewal even when a cached lease is restored', async () => {
  let restored = 0;
  const trustStore = {
    read: async () => null,
    write: async () => undefined,
    clear: async () => undefined,
  };
  const api = {
    getConfiguration: async () => { throw new TypeError('network unavailable'); },
    getMe: async () => ({ account: { id: 'user' } }),
  } as unknown as AuthenticatedCommercialApi;
  const license = new OfflineLicense(
    trustStore,
    { getItem: () => null, setItem: () => undefined },
    () => 'fingerprint',
    () => api,
    async () => 'session',
  );
  const originalRestore = license.restore.bind(license);
  license.restore = async () => { restored += 1; return originalRestore(); };

  await expect(license.refresh()).resolves.toMatchObject({
    ok: false,
    reason: 'refresh_failed',
    state: { kind: 'free' },
  });
  expect(restored).toBe(1);
});

it('reports an authoritative rejection and clears the cached lease', async () => {
  let cleared = 0;
  const trustStore = {
    read: async () => null,
    write: async () => undefined,
    clear: async () => { cleared += 1; },
  };
  const api = {
    getConfiguration: async () => { throw new CommercialHttpError(403, 'license_revoked'); },
    getMe: async () => ({ account: { id: 'user' } }),
  } as unknown as AuthenticatedCommercialApi;
  const license = new OfflineLicense(
    trustStore,
    { getItem: () => null, setItem: () => undefined },
    () => 'fingerprint',
    () => api,
    async () => 'session',
  );

  await expect(license.refresh()).resolves.toMatchObject({
    ok: false,
    reason: 'unauthorized',
    state: { kind: 'free' },
  });
  expect(cleared).toBe(1);
});

it('revokes in-memory rights even when both persistent stores fail to clear', async () => {
  const clearTrust = vi.fn(async () => { throw new Error('vault locked'); });
  const clearStorage = vi.fn(() => { throw new Error('storage locked'); });
  const license = new OfflineLicense(
    { read: async () => null, write: async () => undefined, clear: clearTrust },
    { getItem: () => null, setItem: clearStorage },
    () => 'fingerprint',
    () => ({} as AuthenticatedCommercialApi),
    async () => null,
  );
  license.state = {
    kind: 'valid',
    entitlements: [{ code: 'pro_formats', enabled: true, value: null }],
  };

  await expect(license.clear()).rejects.toThrow('entièrement effacé');

  expect(license.state).toEqual({ kind: 'free' });
  expect(clearTrust).toHaveBeenCalledTimes(1);
  expect(clearStorage).toHaveBeenCalledTimes(1);
});

it('does not let a stale restore overwrite the state of a newer account', async () => {
  const raw = '{';
  let finishRead!: (trust: OfflineTrust | null) => void;
  const read = new Promise<OfflineTrust | null>((resolve) => { finishRead = resolve; });
  const license = new OfflineLicense(
    {
      read: async () => read,
      write: async () => undefined,
      clear: async () => undefined,
    },
    { getItem: () => raw, setItem: () => undefined },
    () => 'fingerprint',
    () => ({} as AuthenticatedCommercialApi),
    async () => null,
  );

  const staleRestore = license.restore();
  await license.clear();
  license.state = { kind: 'valid', entitlements: [] };
  finishRead({
    schemaVersion: 1,
    me: { account: { id: 'old' } } as OfflineTrust['me'],
    publicKey: {},
    keyId: 'old',
    lease: {
      digest: await licenseDigest(raw),
      deviceKeyThumbprint: 'fingerprint',
      lastSeen: Date.now(),
      serverTime: Date.now(),
    },
  });

  await staleRestore;
  expect(license.state.kind).toBe('valid');
});

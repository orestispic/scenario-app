import { expect, it, vi } from 'vitest';
import { licenseDigest, OfflineLicense, trustedTime } from './offlineLicense';
import type { OfflineTrust } from './offlineTrust';
import type { AuthenticatedCommercialApi } from './authenticatedApi';
import type { EntitlementsResponse } from './contractsV2';

it('renews a signed device lease, restores offline, expires, and clears on logout', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const now = Date.now();
  const snapshot = { id: 's', configurationVersion: 'v', issuedAt: new Date(now - 1000).toISOString(), offlineValidUntil: new Date(now + 10_000).toISOString(), entitlements: [] };
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
  await license.refresh();
  expect(license.state.kind).toBe('valid');
  expect((await license.restore())?.entitlements.snapshot).toEqual(snapshot);
  session = null;
  await license.refresh();
  expect(license.state.kind).toBe('valid');
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 20_000);
  try { expect(await license.restore()).toBeNull(); expect(license.state.kind).toBe('expired'); }
  finally { clock.mockRestore(); }
  await license.clear(); expect(trust).toBeNull();
});

it('detects backward time and never moves the trusted clock backwards', () => {
  expect(trustedTime(100_000, 90_000, 99_000)).toBe(100_000);
  expect(() => trustedTime(100_000, 90_000, 1_000)).toThrow();
  expect(() => trustedTime(NaN, 90_000, 1_000)).toThrow();
});

it('rejects copied or replaced offline cache and fails closed without deleting documents', async () => {
  let trust: OfflineTrust | null = { schemaVersion: 1, me: { account: { id: 'user' } } as OfflineTrust['me'], publicKey: {}, keyId: 'test',
    lease: { digest: await licenseDigest('original'), deviceFingerprint: 'device-a', lastSeen: Date.now(), serverTime: Date.now() } };
  const store = { read: async () => trust, write: async (v: OfflineTrust) => { trust = v; }, clear: async () => { trust = null; } };
  const cache = new Map([['document', 'user text']]);
  const storage = { getItem: () => 'replaced', setItem: (k: string,v: string) => { cache.set(k,v); } };
  const license = new OfflineLicense(store, storage, () => 'device-b', () => ({} as AuthenticatedCommercialApi), async () => null);
  expect(await license.restore()).toBeNull();
  await license.clear();
  expect(cache.get('document')).toBe('user text');
  expect(trust).toBeNull();
});

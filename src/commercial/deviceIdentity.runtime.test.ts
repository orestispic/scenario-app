import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => native);
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules(); native.invoke.mockReset(); native.isTauri.mockReturnValue(true);
  storage = new Map();
  vi.stubGlobal('window', { localStorage: { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); } } });
});

it('recovers the same native identity after all web data is erased', async () => {
  const old = 'legacy-legacy-legacy-legacy-legacy';
  storage.set('scenario-local-device-fingerprint', old);
  let durable: string | null = null;
  native.invoke.mockImplementation(async (_command, { candidate }) => durable ??= candidate);
  let identity = await import('./deviceIdentity');
  await identity.initializeDeviceIdentity('test');
  expect(identity.getDeviceFingerprint()).toBe(old);
  storage.clear(); vi.resetModules();
  identity = await import('./deviceIdentity');
  await identity.initializeDeviceIdentity('test');
  expect(identity.getDeviceFingerprint()).toBe(old);
});

it('never makes a replacement device when the system vault is unavailable', async () => {
  native.invoke.mockRejectedValue(new Error('vault unavailable'));
  const identity = await import('./deviceIdentity');
  await identity.initializeDeviceIdentity('test');
  expect(() => identity.getDeviceFingerprint()).toThrow('Impossible de reconnaître');
  expect(storage.size).toBe(0);
});

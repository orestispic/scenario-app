import { expect, it } from 'vitest';
import { deviceKeyThumbprint } from './deviceKey';

it('creates a stable RFC 7638-style thumbprint and refuses private material as a public key', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const first = await deviceKeyThumbprint(publicKey);
  const second = await deviceKeyThumbprint({ y: publicKey.y, x: publicKey.x, crv: publicKey.crv, kty: publicKey.kty });
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second).toBe(first);
  await expect(deviceKeyThumbprint(privateKey)).rejects.toThrow();
});

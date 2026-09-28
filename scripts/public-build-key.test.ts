import { expect, it } from 'vitest';
// @ts-expect-error Standalone build guard.
import { isPublicSupabaseKey } from './public-build-key.mjs';

it('rejects a server-role JWT before Vite can embed it in the Windows binary', () => {
  const token = (role: string) => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture_signature`;
  expect(isPublicSupabaseKey(token('anon'))).toBe(true);
  expect(isPublicSupabaseKey(token('service_role'))).toBe(false);
  expect(isPublicSupabaseKey(token('authenticated'))).toBe(false);
  expect(isPublicSupabaseKey('sb_secret_' + 'a'.repeat(30))).toBe(false);
  expect(isPublicSupabaseKey('sb_publishable_' + 'a'.repeat(30))).toBe(true);
  expect(isPublicSupabaseKey('eyJinvalid.invalid.signature')).toBe(false);
});

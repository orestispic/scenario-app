import { it, expect } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
// @ts-expect-error Standalone verification script.
import { verifyUpdaterSignature } from './updater-signature.mjs';

it('verifies both minisign algorithms and rejects changed artifacts, keys and comments', () => {
  // Ephemeral test keys only. Never used for the candidate or configured updater.
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.alloc(8, 7);
  const rawKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const pubkey = Buffer.from('untrusted comment: fixture\n' + Buffer.concat([Buffer.from('Ed'), keyId, rawKey]).toString('base64')).toString('base64');
  const bytes = Buffer.from('synthetic fixture, never a release installer');
  for (const algorithm of ['Ed', 'ED']) {
    const signature = sign(null, algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes, privateKey);
    const comment = 'timestamp:fixture';
    const lines = ['untrusted comment: fixture', Buffer.concat([Buffer.from(algorithm), keyId, signature]).toString('base64'), `trusted comment: ${comment}`, sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString('base64')];
    const encode = (value: string[]) => Buffer.from(value.join('\n')).toString('base64');
    expect(() => verifyUpdaterSignature(bytes, encode(lines), pubkey)).not.toThrow();
    expect(() => verifyUpdaterSignature(Buffer.from('tampered'), encode(lines), pubkey)).toThrow('Installer signature invalid');
    expect(() => verifyUpdaterSignature(bytes, encode(lines.map((line, i) => i === 2 ? line + 'changed' : line)), pubkey)).toThrow('Signature comment invalid');
    const other = Buffer.from('untrusted comment: fixture\n' + Buffer.concat([Buffer.from('Ed'), Buffer.alloc(8, 8), rawKey]).toString('base64')).toString('base64');
    expect(() => verifyUpdaterSignature(bytes, encode(lines), other)).toThrow();
  }
});

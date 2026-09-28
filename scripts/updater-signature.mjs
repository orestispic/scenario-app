import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';

export function verifyUpdaterSignature(bytes, encodedSignature, encodedPublicKey) {
  const publicLines = Buffer.from(encodedPublicKey, 'base64').toString('utf8').trim().split(/\r?\n/);
  const publicBytes = Buffer.from(publicLines[1], 'base64');
  assert.equal(publicBytes.length, 42);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)]), format: 'der', type: 'spki' });
  const lines = Buffer.from(encodedSignature.trim(), 'base64').toString('utf8').trim().split(/\r?\n/);
  const signature = Buffer.from(lines[1], 'base64');
  assert.equal(signature.length, 74);
  assert.deepEqual(signature.subarray(2, 10), publicBytes.subarray(2, 10));
  assert.ok(lines[2].startsWith('trusted comment: '));
  const algorithm = signature.subarray(0, 2).toString('ascii');
  assert.ok(['ED', 'Ed'].includes(algorithm));
  const message = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes;
  assert.ok(verify(null, message, key, signature.subarray(10)), 'Installer signature invalid');
  const global = Buffer.concat([signature.subarray(10), Buffer.from(lines[2].slice('trusted comment: '.length))]);
  assert.ok(verify(null, global, key, Buffer.from(lines[3], 'base64')), 'Signature comment invalid');
}

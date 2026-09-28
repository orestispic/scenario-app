import { describe, expect, it } from 'vitest';
import {
  createPendingAccountClosureStore,
  parsePendingAccountClosure,
  type PendingAccountClosure,
} from './pendingAccountClosure';

const pending: PendingAccountClosure = {
  schemaVersion: 1,
  accountId: '10000000-0000-4000-8000-000000000002',
  verificationToken: 'V'.repeat(43),
  createdAt: '2026-09-20T12:00:00.000Z',
};

describe('pending account closure receipt', () => {
  it('accepts only the exact versioned receipt contract', () => {
    expect(parsePendingAccountClosure(JSON.stringify(pending))).toEqual(pending);
    expect(parsePendingAccountClosure('{}')).toBeNull();
    expect(parsePendingAccountClosure(JSON.stringify({ ...pending, verificationToken: 'short' }))).toBeNull();
    expect(parsePendingAccountClosure(JSON.stringify({ ...pending, accountId: '../other-account' }))).toBeNull();
    expect(parsePendingAccountClosure('not-json')).toBeNull();
  });

  it('keeps browser previews memory-only and returns defensive copies', async () => {
    const store = createPendingAccountClosureStore('test');
    await store.write(pending);
    const restored = await store.read();
    expect(restored).toEqual(pending);
    if (restored) restored.verificationToken = 'X'.repeat(43);
    expect(await store.read()).toEqual(pending);
    await expect(store.write({ ...pending, verificationToken: 'X'.repeat(43) }))
      .rejects.toThrow('already exists');
    await store.clear();
    expect(await store.read()).toBeNull();
  });
});

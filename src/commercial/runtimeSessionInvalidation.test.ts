import { describe, expect, it, vi } from 'vitest';
import { runSessionInvalidationWithCleanup } from './runtimeSessionInvalidation';

describe('runtime session invalidation cleanup', () => {
  it('cleans the authenticated runtime only for the session actually invalidated', async () => {
    const cleanup = vi.fn(async () => undefined);

    await runSessionInvalidationWithCleanup(async () => false, cleanup);
    expect(cleanup).not.toHaveBeenCalled();

    await runSessionInvalidationWithCleanup(async () => true, cleanup);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('still cleans the runtime when the credential-vault commit fails', async () => {
    const failure = new Error('vault locked');
    const cleanup = vi.fn(async () => undefined);

    await expect(runSessionInvalidationWithCleanup(
      async () => { throw failure; },
      cleanup,
    )).rejects.toBe(failure);

    expect(cleanup).toHaveBeenCalledOnce();
  });
});

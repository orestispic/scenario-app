import { describe, expect, it, vi } from 'vitest';
import { CommercialHttpError, createAuthenticatedCommercialApi } from './authenticatedApi';

describe('authenticated commercial network policy', () => {
  it('bounds grouped Account reads to one short attempt', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const fetcher = vi.fn(async () => { throw new TypeError('offline'); });
    const api = createAuthenticatedCommercialApi({
      baseUrl: 'https://api.example.invalid',
      accessToken: 'synthetic-token',
      networkPolicy: { accountReadTimeoutMs: 4321 },
      fetcher,
    });
    try {
      const results = await Promise.allSettled([
        api.getMe(),
        api.getEntitlements(),
        api.getDevices(),
        api.getBilling(),
        api.getActivationStatus(),
      ]);
      expect(results.every(result => result.status === 'rejected')).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(5);
      expect(timeout).toHaveBeenCalledTimes(5);
      expect(timeout.mock.calls.every(([milliseconds]) => milliseconds === 4321)).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });

  it('retries another idempotent read once with injected jitter and never retries a mutation', async () => {
    const sleeps: number[] = [];
    const readFetcher = vi.fn(async () => { throw new TypeError('offline'); });
    const readApi = createAuthenticatedCommercialApi({
      baseUrl: 'https://api.example.invalid',
      accessToken: 'synthetic-token',
      clientContext: { clientVersion: 'test', deviceFingerprint: 'fingerprint', platform: 'windows' },
      networkPolicy: {
        random: () => 0.5,
        sleep: async delay => { sleeps.push(delay); },
      },
      fetcher: readFetcher,
    });
    await expect(readApi.listCloudProjects()).rejects.toThrow('offline');
    expect(readFetcher).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([210]);

    const mutationFetcher = vi.fn(async () => { throw new TypeError('offline'); });
    const mutationApi = createAuthenticatedCommercialApi({
      baseUrl: 'https://api.example.invalid',
      accessToken: 'synthetic-token',
      fetcher: mutationFetcher,
    });
    await expect(mutationApi.logout()).rejects.toThrow('offline');
    expect(mutationFetcher).toHaveBeenCalledOnce();
  });

  it('never exposes a backend message while preserving code, request id and conflict', async () => {
    const api = createAuthenticatedCommercialApi({
      baseUrl: 'https://api.example.invalid',
      accessToken: 'synthetic-token',
      clientContext: { clientVersion: 'test', deviceFingerprint: 'fingerprint', platform: 'windows' },
      fetcher: async () => Response.json({
        code: 'scenario_parent_conflict',
        message: 'SQLSTATE 42501 storage-secret=do-not-display',
        request_id: 'request-safe-reference',
        conflict: { versionId: 'remote-version' },
      }, { status: 409 }),
    });

    const failure = await api.listCloudProjects().catch(error => error);
    expect(failure).toBeInstanceOf(CommercialHttpError);
    expect(failure).toMatchObject({
      status: 409,
      code: 'scenario_parent_conflict',
      requestId: 'request-safe-reference',
      details: { conflict: { versionId: 'remote-version' } },
    });
    expect((failure as Error).message).toContain('modifié ailleurs');
    expect((failure as Error).message).not.toMatch(/SQLSTATE|storage-secret|do-not-display/i);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthenticatedCommercialApi } from './authenticatedApi';

const context = { clientVersion: '0.1.7', deviceFingerprint: 'synthetic-device', platform: 'windows' as const };
afterEach(() => vi.useRealTimers());
describe('collaboration API session isolation', () => {
  it.each(['collaboration_connection_closed', 'collaboration_ticket_invalid'])('does not invalidate the account for %s', async (code) => {
    const unauthorized = vi.fn();
    const api = createAuthenticatedCommercialApi({
      baseUrl: 'https://test.invalid', accessToken: 'synthetic-access', clientContext: context,
      onUnauthorized: unauthorized,
      fetcher: async () => Response.json({ code }, { status: 401 }),
    });
    await expect(api.pollCollaboration('studio', 'connection', 0)).rejects.toMatchObject({ status: 401, code });
    expect(unauthorized).not.toHaveBeenCalled();
  });
  it('still invalidates a rejected account session', async () => {
    const unauthorized = vi.fn();
    const api = createAuthenticatedCommercialApi({
      baseUrl: 'https://test.invalid', accessToken: 'synthetic-access', clientContext: context,
      onUnauthorized: unauthorized,
      fetcher: async () => Response.json({ code: 'invalid_token' }, { status: 401 }),
    });
    await expect(api.pollCollaboration('studio', 'connection', 0)).rejects.toMatchObject({ code: 'invalid_token' });
    expect(unauthorized).toHaveBeenCalledOnce();
  });
  it('bounds a hanging request and aborts its fetch', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const api = createAuthenticatedCommercialApi({
      baseUrl: 'https://test.invalid', accessToken: 'synthetic-access', clientContext: context,
      fetcher: async (_, init) => { signal = init?.signal; return new Promise(() => {}); },
    });
    const result = expect(api.pollCollaboration('studio', 'connection', 0)).rejects.toMatchObject({ code: 'request_timeout' });
    await vi.advanceTimersByTimeAsync(8_000);
    await result;
    expect(signal?.aborted).toBe(true);
  });
  it('retains a bounded server retry hint without logging response content', async () => {
    const api = createAuthenticatedCommercialApi({
      baseUrl: 'https://test.invalid', accessToken: 'synthetic-access', clientContext: context,
      fetcher: async () => Response.json({ code: 'rate_limited', request_id: 'req-1' }, { status: 429, headers: { 'retry-after': '90' } }),
    });
    await expect(api.pollCollaboration('studio', 'connection', 0)).rejects.toMatchObject({ retryAfterMs: 90_000, requestId: 'req-1' });
  });
});

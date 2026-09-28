import { expect, it, vi } from 'vitest';
import { createAuthenticatedCommercialApi } from './authenticatedApi';

it('signs every hosted cloud mutation over method, path and exact body digest', async () => {
  let request: Request | null = null;
  type SignedRequest = { method: string; path: string; timestamp: string; nonce: string; bodyDigest: string };
  const signDeviceRequest = vi.fn(async (_input: SignedRequest) => 'synthetic-signature');
  const api = createAuthenticatedCommercialApi({
    baseUrl: 'https://api.example.invalid',
    accessToken: 'synthetic-access-token',
    beforeDeviceRequest: async () => undefined,
    clientContext: {
      clientVersion: '0.1.14',
      deviceFingerprint: 'durable-device-fingerprint',
      platform: 'windows',
      deviceKeyThumbprint: () => 'A'.repeat(43),
      signDeviceRequest,
    },
    fetcher: async (input, init) => {
      request = new Request(input, init);
      return new Response(null, { status: 204 });
    },
  });
  const projectId = '10000000-0000-4000-8000-000000000001';
  await api.deleteCloudScenario(projectId, 'proof-test-idempotency-key');
  expect(signDeviceRequest).toHaveBeenCalledOnce();
  const signed = signDeviceRequest.mock.calls[0]?.[0];
  expect(signed).toBeDefined();
  if (!signed) throw new Error('The request was not signed.');
  expect(signed.method).toBe('POST');
  expect(signed.path).toBe(`/v5/scenarios/${projectId}/delete`);
  expect(signed.nonce).toMatch(/^[0-9a-f-]{36}$/i);
  expect(signed.bodyDigest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(request!.headers.get('X-Senario-Device-Key')).toBe('A'.repeat(43));
  expect(request!.headers.get('X-Senario-Device-Signature')).toBe('synthetic-signature');
});

it('prepares and signs Cloud storage and image requests before sending them', async () => {
  const beforeDeviceRequest = vi.fn(async () => undefined);
  const signDeviceRequest = vi.fn(async () => 'synthetic-signature');
  const paths: string[] = [];
  const api = createAuthenticatedCommercialApi({
    baseUrl: 'https://api.example.invalid',
    accessToken: 'synthetic-access-token',
    beforeDeviceRequest,
    clientContext: {
      clientVersion: '0.1.16',
      deviceFingerprint: 'durable-device-fingerprint',
      platform: 'windows',
      deviceKeyThumbprint: () => 'A'.repeat(43),
      signDeviceRequest,
    },
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      paths.push(new URL(request.url).pathname);
      expect(request.headers.get('X-Senario-Device-Key')).toBe('A'.repeat(43));
      if (request.url.endsWith('/v18/cloud/storage')) {
        return Response.json({ storage: {
          usedBytes: 0, limitBytes: 1, baseLimitBytes: 1, expandedLimitBytes: 1,
          addon: null,
          upgrade: { currency: 'EUR', unitAmountMinor: 1, billingInterval: 'month' },
        } });
      }
      return Response.json({
        contractVersion: '2026-10-v19',
        asset: {
          assetId: 'a'.repeat(64), contentType: 'image/png', sizeBytes: 1,
          width: 1, height: 1,
        },
      });
    },
  });

  await api.getCloudStorageStatus();
  await api.ensureCloudImageAsset(
    '10000000-0000-4000-8000-000000000001',
    {
      assetId: 'a'.repeat(64), contentType: 'image/png', sizeBytes: 1,
      width: 1, height: 1, contentBase64: 'AA==',
    },
    'image-proof-test',
  );

  expect(paths).toEqual([
    '/v18/cloud/storage',
    '/v19/scenarios/10000000-0000-4000-8000-000000000001/images',
  ]);
  expect(beforeDeviceRequest).toHaveBeenCalledTimes(2);
  expect(signDeviceRequest).toHaveBeenCalledTimes(2);
});

it('prepares and signs the exact account-closure request and accepts only HTTP 202', async () => {
  const beforeDeviceRequest = vi.fn(async () => undefined);
  type SignedRequest = { method: string; path: string; timestamp: string; nonce: string; bodyDigest: string };
  const signDeviceRequest = vi.fn(async (_input: SignedRequest) => 'closure-signature');
  let sent: Request | null = null;
  const options = {
    baseUrl: 'https://api.example.invalid',
    accessToken: 'synthetic-access-token',
    beforeDeviceRequest,
    clientContext: {
      clientVersion: '0.1.16',
      deviceFingerprint: 'durable-device-fingerprint',
      platform: 'windows' as const,
      deviceKeyThumbprint: () => 'A'.repeat(43),
      signDeviceRequest,
    },
  };
  const api = createAuthenticatedCommercialApi({
    ...options,
    fetcher: async (input, init) => {
      sent = new Request(input, init);
      return new Response(null, { status: 202 });
    },
  });

  await expect(api.closeAccount('V'.repeat(43))).resolves.toBeUndefined();

  // Closing an account must not require a paid device slot or an active
  // exclusive lease. The request remains cryptographically signed below.
  expect(beforeDeviceRequest).not.toHaveBeenCalled();
  expect(signDeviceRequest).toHaveBeenCalledOnce();
  const signed = signDeviceRequest.mock.calls[0]?.[0];
  expect(signed).toMatchObject({ method: 'POST', path: '/v22/account/close' });
  expect(sent).not.toBeNull();
  expect(sent!.method).toBe('POST');
  expect(new URL(sent!.url).pathname).toBe('/v22/account/close');
  expect(await sent!.clone().json()).toEqual({
    confirmation: 'CLOSE_MY_ACCOUNT',
    verificationToken: 'V'.repeat(43),
  });
  expect(sent!.headers.get('X-Senario-Device-Key')).toBe('A'.repeat(43));
  expect(sent!.headers.get('X-Senario-Device-Signature')).toBe('closure-signature');

  const wrongStatusApi = createAuthenticatedCommercialApi({
    ...options,
    fetcher: async () => Response.json({ accepted: true }, { status: 200 }),
  });
  await expect(wrongStatusApi.closeAccount('V'.repeat(43))).rejects.toMatchObject({
    status: 200,
    code: 'unexpected_success_status',
  });
});

it('verifies an uncertain closure with its public one-time receipt, not the account session', async () => {
  const accessToken = vi.fn(async () => { throw new Error('must not read session'); });
  const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(String(init?.body))).toEqual({ verificationToken: 'R'.repeat(43) });
    return Response.json({ closed: true, status: 'completed' });
  });
  const api = createAuthenticatedCommercialApi({
    baseUrl: 'https://api.example.invalid',
    accessToken,
    fetcher,
  });

  await expect(api.verifyAccountClosure('R'.repeat(43))).resolves.toEqual({
    closed: true,
    status: 'completed',
  });
  expect(accessToken).not.toHaveBeenCalled();
});

it.each([
  { closed: true, status: null },
  { closed: false, status: 'completed' },
  { closed: true, status: 'provider-private-state' },
])('rejects a contradictory or unknown closure receipt response: %j', async (payload) => {
  const api = createAuthenticatedCommercialApi({
    baseUrl: 'https://api.example.invalid',
    accessToken: async () => { throw new Error('must not read session'); },
    fetcher: async () => Response.json(payload),
  });
  await expect(api.verifyAccountClosure('R'.repeat(43))).rejects.toMatchObject({
    status: 502,
    code: 'invalid_response',
  });
});

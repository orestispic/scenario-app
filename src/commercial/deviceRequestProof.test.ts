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

import { describe, expect, it } from 'vitest';
import { parseDevicesResponse, parseEntitlementsResponse, parseMeResponse } from './contractsV2';
import { parseActivationStatusResponse, parseBillingOverviewResponse, parseBillingPortalResponse, parseCheckoutSessionResponse } from './contractsV3';

describe('account API response validation', () => {
  it('accepts complete account, rights and device payloads', () => {
    expect(parseMeResponse({
      account: { id: 'profile-1', email: 'author@example.invalid', displayName: null },
      role: 'customer',
    }).account.email).toBe('author@example.invalid');

    expect(parseEntitlementsResponse({
      snapshot: {
        id: 'snapshot-1', configurationVersion: 'catalog-1',
        issuedAt: '2026-09-20T00:00:00.000Z', offlineValidUntil: '2026-10-20T00:00:00.000Z',
        entitlements: [{ code: 'cloud', enabled: true, value: null }],
      },
      offlineGrant: {
        format: 'scenario.offline-grant.v1', algorithm: 'ES256', keyId: 'key-1', payload: 'payload', signature: 'signature',
      },
    }).snapshot.entitlements[0]?.enabled).toBe(true);

    expect(parseDevicesResponse({ devices: [{
      id: 'device-1', label: 'Studio', platform: 'windows', status: 'active',
      lastSeenAt: '2026-09-20T00:00:00.000Z', hasCryptographicIdentity: true,
    }] })[0]?.id).toBe('device-1');
  });

  it('rejects incomplete payloads instead of letting malformed data reach React', () => {
    expect(() => parseMeResponse({ account: { email: 'author@example.invalid' }, role: 'customer' })).toThrow();
    expect(() => parseEntitlementsResponse({ snapshot: { entitlements: [] }, offlineGrant: {} })).toThrow();
    expect(() => parseDevicesResponse({ devices: [{ id: 'device-1', platform: 'linux' }] })).toThrow();
  });

  it('validates billing and activation sections independently', () => {
    const billing = parseBillingOverviewResponse({
      offers: [],
      billing: {
        status: 'active', offerCode: 'studio', offerDisplayName: 'Studio', billingInterval: 'month',
        currentPeriodStartsAt: '2026-09-01T00:00:00.000Z', currentPeriodEndsAt: '2026-10-01T00:00:00.000Z',
        cancelAtPeriodEnd: false, lastPaymentStatus: 'paid', source: 'stripe', testMode: false,
      },
      request_id: 'request-1',
    });
    expect(billing.billing.offerCode).toBe('studio');

    expect(parseActivationStatusResponse({
      activations: [{
        id: 'activation-1', keySuffix: 'ABCD', status: 'active',
        activatedAt: '2026-09-20T00:00:00.000Z', expiresAt: null, deviceId: null,
      }],
      request_id: 'request-2',
    }).activations).toHaveLength(1);

    expect(() => parseBillingOverviewResponse({ offers: [], billing: { status: 'unexpected' }, request_id: 'request' })).toThrow();
    expect(() => parseActivationStatusResponse({ activations: [{ status: 'active' }], request_id: 'request' })).toThrow();
  });

  it('accepts only secure hosted payment links', () => {
    expect(parseCheckoutSessionResponse({
      checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_live_example', expiresAt: '2026-09-22T00:00:00.000Z', testMode: false, request_id: 'request-3',
    }).checkoutUrl).toContain('https://checkout.stripe.com/');
    expect(parseBillingPortalResponse({
      portalUrl: 'https://billing.stripe.com/p/session/example', testMode: false, request_id: 'request-4',
    }).portalUrl).toContain('https://billing.stripe.com/');
    expect(() => parseCheckoutSessionResponse({ checkoutUrl: 'http://example.invalid', expiresAt: 'soon', testMode: false, request_id: 'request' })).toThrow();
  });
});

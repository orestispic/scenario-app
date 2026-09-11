import { describe, expect, it } from "vitest";
import { createAuthenticatedCommercialApi } from "./authenticatedApi";

describe("contrat commercial v3", () => {
  it("lit l’état de facturation sans embarquer de valeur d’offre", async () => {
    const requests: Array<{ url: string; body: string | null }> = [];
    const api = createAuthenticatedCommercialApi({
      baseUrl: "https://api.example.invalid",
      accessToken: "test-access-token",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), body: typeof init?.body === "string" ? init.body : null });
        return Response.json({
          offers: [{ selectionId: "server-selection", offerCode: "author_ai", displayName: "Serveur", description: null, billingInterval: "month", currency: "EUR", unitAmountMinor: 1, testMode: true }],
          billing: { status: "none", offerCode: null, offerDisplayName: null, billingInterval: null, currentPeriodStartsAt: null, currentPeriodEndsAt: null, cancelAtPeriodEnd: false, lastPaymentStatus: null, source: null, testMode: true },
          request_id: "request-test",
        });
      },
    });
    const response = await api.getBilling();
    expect(response.offers[0].selectionId).toBe("server-selection");
    expect(requests[0]).toEqual({ url: "https://api.example.invalid/v2/billing", body: null });
  });

  it("n’envoie à l’activation que la clé et l’identité de l’appareil", async () => {
    let sentBody = "";
    const api = createAuthenticatedCommercialApi({
      baseUrl: "https://api.example.invalid",
      accessToken: "test-access-token",
      fetcher: async (_input, init) => {
        sentBody = String(init?.body ?? "");
        return Response.json({ activation: { id: "activation", keySuffix: "ABC123", status: "active", activatedAt: "2026-01-01T00:00:00Z", expiresAt: null, deviceId: "device" }, snapshot: { id: "snapshot", configurationVersion: "server", issuedAt: "2026-01-01T00:00:00Z", offlineValidUntil: "2026-01-08T00:00:00Z", entitlements: [] }, request_id: "request-test" }, { status: 201 });
      },
    });
    await api.redeemActivationKey({ key: "SCN-TEST", fingerprint: "device-fingerprint", label: "PC", platform: "windows" });
    expect(JSON.parse(sentBody)).toEqual({ key: "SCN-TEST", fingerprint: "device-fingerprint", label: "PC", platform: "windows" });
    expect(sentBody).not.toMatch(/offer|quota|entitlement|deviceLimit|role/i);
  });
});

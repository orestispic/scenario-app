import { describe, expect, it, vi } from "vitest";
import { createAuthenticatedCommercialApi } from "./authenticatedApi";

describe("adaptateur IA commercial", () => {
  it('keeps the long AI operation timeout separate from project listing', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    try {
      const api = createAuthenticatedCommercialApi({baseUrl:'https://api.example.invalid',accessToken:'synthetic',
        clientContext:{clientVersion:'0.1.7',deviceFingerprint:'synthetic-device-fingerprint',platform:'windows'},
        fetcher:async()=>Response.json({code:'isolated_failure'},{status:503})});
      await expect(api.runAiAction({kind:'rewrite',instruction:'test',text:'synthetic'})).rejects.toThrow();
      expect(timeout).toHaveBeenLastCalledWith(120_000);
      await expect(api.listCloudProjects()).rejects.toThrow();
      expect(timeout).toHaveBeenLastCalledWith(15_000);
    } finally { timeout.mockRestore(); }
  });
  it("envoie session, version, appareil et idempotence sans choix fournisseur", async () => {
    const requests: Request[] = [];
    const api = createAuthenticatedCommercialApi({
      baseUrl: "https://api.example.invalid",
      accessToken: "access-fixture",
      clientContext: {
        clientVersion: "0.1.7",
        deviceFingerprint: "device-fingerprint-fixture-0001",
        platform: "windows",
      },
      fetcher: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json({
          contractVersion: "2026-09-v5",
          operation: "short_action",
          status: "succeeded",
          result: { kind: "text", text: "Corrigé" },
          replayed: false,
          quota: {
            used: 1,
            limit: 6,
            periodStartsAt: "2026-09-01T00:00:00.000Z",
            periodEndsAt: "2026-10-01T00:00:00.000Z",
          },
          request_id: "request-fixture",
        });
      },
    });
    await api.runAiAction({ kind: "rewrite", instruction: "Corrige.", text: "Texte." });
    expect(requests[0].headers.get("authorization")).toBe("Bearer access-fixture");
    expect(requests[0].headers.get("x-scenario-client-version")).toBe("0.1.7");
    expect(requests[0].headers.get("x-scenario-device-fingerprint")).toBe(
      "device-fingerprint-fixture-0001",
    );
    expect(requests[0].headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await requests[0].json();
    expect(body).toEqual({ kind: "rewrite", instruction: "Corrige.", text: "Texte." });
    expect(JSON.stringify(body)).not.toMatch(/model|quota|entitlement|apiKey/i);
  });

  it("préserve le code et le request_id d’un refus serveur", async () => {
    const api = createAuthenticatedCommercialApi({
      baseUrl: "https://api.example.invalid",
      accessToken: "access-fixture",
      clientContext: {
        clientVersion: "0.1.7",
        deviceFingerprint: "device-fingerprint-fixture-0001",
        platform: "windows",
      },
      fetcher: async () =>
        Response.json(
          {
            code: "ai_quota_exhausted",
            message: "Quota IA épuisé.",
            request_id: "request-refusal",
          },
          { status: 429 },
        ),
    });
    await expect(
      api.runAiAction({ kind: "rewrite", instruction: "Corrige.", text: "Texte." }),
    ).rejects.toMatchObject({
      status: 429,
      code: "ai_quota_exhausted",
      requestId: "request-refusal",
    });
  });

  it("réutilise la clé tant que la réservation serveur est en cours", async () => {
    const keys: string[] = [];
    let call = 0;
    const api = createAuthenticatedCommercialApi({
      baseUrl: "https://api.example.invalid",
      accessToken: "access-fixture",
      clientContext: {
        clientVersion: "0.1.7",
        deviceFingerprint: "device-fingerprint-fixture-0001",
        platform: "windows",
      },
      fetcher: async (input, init) => {
        keys.push(new Request(input, init).headers.get("idempotency-key")!);
        call += 1;
        return Response.json({
          contractVersion: "2026-09-v5",
          operation: "short_action",
          status: call === 1 ? "reserved" : "succeeded",
          result: call === 1 ? null : { kind: "text", text: "Corrigé" },
          replayed: call === 1,
          quota: {
            used: 1,
            limit: 6,
            periodStartsAt: "2026-09-01T00:00:00.000Z",
            periodEndsAt: "2026-10-01T00:00:00.000Z",
          },
          request_id: `request-${call}`,
        });
      },
    });
    const input = { kind: "rewrite" as const, instruction: "Corrige.", text: "En cours." };
    await expect(api.runAiAction(input)).rejects.toMatchObject({ code: "ai_result_pending" });
    await expect(api.runAiAction(input)).resolves.toMatchObject({ status: "succeeded" });
    expect(keys[1]).toBe(keys[0]);
  });
});

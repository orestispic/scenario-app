import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_CONTRACT_VERSION_V5,
  parseAiExecutionResponse,
  parseAiReconcileResponse,
} from "./contractsV5";

const quota = {
  used: 1,
  limit: 6,
  periodStartsAt: "2026-09-01T00:00:00.000Z",
  periodEndsAt: "2026-10-01T00:00:00.000Z",
};

describe("contrat IA v5", () => {
  it("valide une réponse liée à la bonne opération", () => {
    expect(
      parseAiExecutionResponse(
        {
          contractVersion: COMMERCIAL_CONTRACT_VERSION_V5,
          operation: "short_action",
          status: "succeeded",
          result: { kind: "text", text: "Corrigé" },
          replayed: false,
          quota,
          request_id: "request-test",
        },
        "short_action",
      ),
    ).toMatchObject({ status: "succeeded", quota: { used: 1 } });
  });

  it("refuse version, opération et compteurs altérés", () => {
    expect(() =>
      parseAiExecutionResponse(
        {
          contractVersion: "2026-09-v4",
          operation: "pdf_import",
          status: "succeeded",
          result: null,
          replayed: false,
          quota: { ...quota, used: 1.5 },
          request_id: "request-test",
        },
        "short_action",
      ),
    ).toThrow("invalide");
  });

  it("valide uniquement une réconciliation marquée comme replay", () => {
    expect(() =>
      parseAiReconcileResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V5,
        operation: "short_action",
        status: "uncertain",
        replayed: false,
        quota,
        request_id: "request-test",
      }),
    ).toThrow("invalide");
  });
});

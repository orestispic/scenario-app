import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_CONTRACT_VERSION_V6,
  parseCloudScenarioListResponse,
  parseCloudSyncResponse,
} from "./contractsV6";

describe("contrats commerciaux v6", () => {
  it("accepte uniquement le contrat v6 et les enveloppes attendues", () => {
    const scenario = {
      id: crypto.randomUUID(),
      title: "Test",
      role: "owner",
      currentVersionId: null,
      deletedAt: null,
      createdAt: "2026-09-11T00:00:00Z",
      updatedAt: "2026-09-11T00:00:00Z",
    };
    expect(
      parseCloudScenarioListResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V6,
        scenarios: [scenario],
        request_id: "request",
      }).scenarios,
    ).toHaveLength(1);
    expect(() =>
      parseCloudScenarioListResponse({
        contractVersion: "v5",
        scenarios: [],
        request_id: "request",
      }),
    ).toThrow();
    const version = {
      id: crypto.randomUUID(),
      scenarioId: scenario.id,
      authorId: crypto.randomUUID(),
      parentVersionId: null,
      versionNumber: 1,
      checksum: "0".repeat(64),
      sizeBytes: 10,
      contentType: "application/vnd.scenario+json",
      format: "scenario-v1",
      origin: "save",
      entitlementSnapshotId: crypto.randomUUID(),
      requestId: crypto.randomUUID(),
      createdAt: "2026-09-11T00:00:00Z",
    };
    const download = {
      url: "https://storage.invalid/opaque",
      operation: "download",
      expiresAt: "2026-09-11T00:05:00Z",
    };
    expect(
      parseCloudSyncResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V6,
        scenario,
        version,
        download,
        replayed: false,
        request_id: "request",
      }).replayed,
    ).toBe(false);
    expect(() =>
      parseCloudSyncResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V6,
        scenario,
        version: null,
        download: {},
        replayed: false,
        request_id: "request",
      }),
    ).toThrow();
  });
});

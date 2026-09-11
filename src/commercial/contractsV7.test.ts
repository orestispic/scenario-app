import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_CONTRACT_VERSION_V7,
  parseStudioEventsResponse,
  parseStudioListResponse,
  parseStudioMutationResponse,
} from "./contractsV7";

describe("contrats commerciaux v7", () => {
  const studio = {
    id: crypto.randomUUID(),
    scenarioId: crypto.randomUUID(),
    name: "Écriture",
    role: "owner",
    revision: 1,
    createdAt: "2026-09-11T00:00:00Z",
    updatedAt: "2026-09-11T00:00:00Z",
  };
  it("refuse les enveloppes antérieures et les rôles arbitraires", () => {
    expect(
      parseStudioListResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V7,
        studios: [studio],
        receivedInvitations: [],
        request_id: "req",
      }).studios,
    ).toHaveLength(1);
    expect(() =>
      parseStudioListResponse({
        contractVersion: "2026-09-v6",
        studios: [],
        receivedInvitations: [],
        request_id: "req",
      }),
    ).toThrow();
    expect(() =>
      parseStudioListResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V7,
        studios: [{ ...studio, role: "admin" }],
        receivedInvitations: [],
        request_id: "req",
      }),
    ).toThrow();
  });
  it("valide les mutations et les curseurs monotones", () => {
    expect(
      parseStudioMutationResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V7,
        studio,
        replayed: false,
        request_id: "req",
      }).replayed,
    ).toBe(false);
    expect(
      parseStudioEventsResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V7,
        events: [
          {
            studioId: studio.id,
            cursor: 2,
            revision: 2,
            type: "invitation.created",
            entityId: crypto.randomUUID(),
            createdAt: studio.updatedAt,
          },
        ],
        nextCursor: 2,
        hasMore: false,
        request_id: "req",
      }).nextCursor,
    ).toBe(2);
    expect(() =>
      parseStudioEventsResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V7,
        events: [],
        nextCursor: 0.5,
        hasMore: false,
        request_id: "req",
      }),
    ).toThrow();
    expect(() =>
      parseStudioEventsResponse({
        contractVersion: COMMERCIAL_CONTRACT_VERSION_V7,
        events: [
          {
            studioId: studio.id,
            cursor: 2,
            revision: 2,
            type: "secret.payload",
            entityId: crypto.randomUUID(),
            createdAt: studio.updatedAt,
          },
        ],
        nextCursor: 2,
        hasMore: false,
        request_id: "req",
      }),
    ).toThrow();
  });
});

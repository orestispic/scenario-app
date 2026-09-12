import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import type { CollaborationViewState, ScenarioEditorBridge } from "./collaborationClient";
import { CollaborationRuntime } from "./collaborationRuntime";
import type { CollaborationRecoveryCopy } from "./contractsV8";

function editorBridge(): ScenarioEditorBridge {
  return {
    read: () => ({ type: "doc", content: [] }),
    applyRemote: vi.fn(),
    subscribe: () => () => undefined,
    setReadOnly: vi.fn(),
  };
}

describe("CollaborationRuntime", () => {
  it('cancels a queued replacement when logout happens during disconnect', async () => {
    let release!: () => void;
    let created = 0;
    const runtime = new CollaborationRuntime(() => {
      created += 1;
      return {
        connect: async () => {},
        disconnect: () => new Promise<void>((resolve) => { release = resolve; }),
        recoveryCopy: () => ({}) as CollaborationRecoveryCopy,
        subscribe: () => () => {},
      };
    });
    const options = { api: {} as AuthenticatedCommercialApi, studioId: 'one', scenarioId: 'one', baseVersionId: 'one', actorId: 'one', editor: editorBridge() };
    await runtime.connect(options);
    const replacing = runtime.connect({ ...options, studioId: 'two' });
    await runtime.disconnect();
    release();
    await replacing;
    expect(created).toBe(1);
  });
  it("keeps the channel alive when the account panel unsubscribes", async () => {
    let listener: ((state: CollaborationViewState) => void) | null = null;
    const disconnect = vi.fn(async () => undefined);
    const runtime = new CollaborationRuntime(() => ({
      connect: async () => {
        listener?.({ status: "online", presence: [], syncLag: 0, conflict: null });
      },
      disconnect,
      recoveryCopy: () => ({}) as CollaborationRecoveryCopy,
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    }));
    const states: string[] = [];
    const closePanel = runtime.subscribe((state) => states.push(state.status));

    await runtime.connect({
      api: {} as AuthenticatedCommercialApi,
      studioId: "studio-1",
      scenarioId: "scenario-1",
      baseVersionId: "version-1",
      actorId: "profile-1",
      editor: editorBridge(),
    });
    closePanel();

    expect(disconnect).not.toHaveBeenCalled();
    const reopenedStates: string[] = [];
    runtime.subscribe((state) => reopenedStates.push(state.status));
    expect(reopenedStates).toEqual(["online"]);

    await runtime.disconnect();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(states[states.length - 1]).toBe("online");
  });

  it("disconnects the previous channel before switching accounts", async () => {
    const disconnects: Array<ReturnType<typeof vi.fn>> = [];
    const runtime = new CollaborationRuntime(() => {
      const disconnect = vi.fn(async () => undefined);
      disconnects.push(disconnect);
      return {
        connect: async () => undefined,
        disconnect,
        recoveryCopy: () => ({}) as CollaborationRecoveryCopy,
        subscribe: () => () => undefined,
      };
    });
    const options = {
      api: {} as AuthenticatedCommercialApi,
      studioId: "studio-1",
      scenarioId: "scenario-1",
      baseVersionId: "version-1",
      actorId: "profile-1",
      editor: editorBridge(),
    };

    await runtime.connect(options);
    await runtime.connect({ ...options, actorId: "profile-2" });

    expect(disconnects[0]).toHaveBeenCalledOnce();
    expect(disconnects[1]).not.toHaveBeenCalled();
  });
});

import type { AuthenticatedCommercialApi } from "./authenticatedApi";
import {
  StudioCollaborationClient,
  type CollaborationViewState,
  type ScenarioEditorBridge,
} from "./collaborationClient";
import type { CollaborationRecoveryCopy } from "./contractsV8";

export interface RuntimeCollaborationState extends CollaborationViewState {
  studioId: string | null;
  actorId: string | null;
}

interface CollaborationClientHandle {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  recoveryCopy(): CollaborationRecoveryCopy;
  subscribe(listener: (state: CollaborationViewState) => void): () => void;
}

interface CollaborationConnectionOptions {
  api: AuthenticatedCommercialApi;
  studioId: string;
  scenarioId: string;
  baseVersionId: string;
  actorId: string;
  editor: ScenarioEditorBridge;
}

type CollaborationClientFactory = (
  options: CollaborationConnectionOptions,
) => CollaborationClientHandle;

const DISCONNECTED_STATE: RuntimeCollaborationState = {
  status: "disconnected",
  presence: [],
  syncLag: 0,
  conflict: null,
  studioId: null,
  actorId: null,
};

function cloneState(state: RuntimeCollaborationState): RuntimeCollaborationState {
  return {
    ...state,
    presence: structuredClone(state.presence),
    conflict: state.conflict ? structuredClone(state.conflict) : null,
  };
}

/**
 * Owns the active collaboration channel for the lifetime of the application tab.
 * UI panels only subscribe to this runtime; closing a panel must not end editing.
 */
export class CollaborationRuntime {
  private client: CollaborationClientHandle | null = null;
  private unsubscribeClient: (() => void) | null = null;
  private state = cloneState(DISCONNECTED_STATE);
  private listeners = new Set<(state: RuntimeCollaborationState) => void>();

  constructor(
    private readonly createClient: CollaborationClientFactory = (options) =>
      new StudioCollaborationClient(
        options.api,
        options.studioId,
        options.scenarioId,
        options.baseVersionId,
        options.actorId,
        options.editor,
      ),
  ) {}

  subscribe(listener: (state: RuntimeCollaborationState) => void): () => void {
    this.listeners.add(listener);
    listener(cloneState(this.state));
    return () => this.listeners.delete(listener);
  }

  async connect(options: CollaborationConnectionOptions): Promise<void> {
    await this.disconnect();
    const client = this.createClient(options);
    this.client = client;
    this.unsubscribeClient = client.subscribe((state) => {
      if (this.client !== client) return;
      this.update({ ...state, studioId: options.studioId, actorId: options.actorId });
    });
    try {
      await client.connect();
    } finally {
      // A logout can occur while the ticket or connection request is in flight.
      // Close any late connection instead of letting it outlive the account session.
      if (this.client !== client) await client.disconnect();
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.unsubscribeClient?.();
    this.unsubscribeClient = null;
    this.update(DISCONNECTED_STATE);
    if (client) await client.disconnect();
  }

  recoveryCopy(): CollaborationRecoveryCopy | null {
    return this.client?.recoveryCopy() ?? null;
  }

  private update(state: RuntimeCollaborationState): void {
    this.state = cloneState(state);
    for (const listener of this.listeners) listener(cloneState(this.state));
  }
}

export const collaborationRuntime = new CollaborationRuntime();

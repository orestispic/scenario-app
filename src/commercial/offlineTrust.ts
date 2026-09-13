import { invoke, isTauri } from "@tauri-apps/api/core";
import type { MeResponse } from "./contractsV2";

export interface OfflineTrust {
  schemaVersion: 1;
  me: MeResponse;
  publicKey: JsonWebKey;
  keyId: string;
  lease?: { digest: string; deviceFingerprint: string; lastSeen: number; serverTime: number };
}
export interface OfflineTrustStore {
  read(): Promise<OfflineTrust | null>;
  write(value: OfflineTrust): Promise<void>;
  clear(): Promise<void>;
}
/** A separate OS entry anchors the public verification key across offline restarts. */
export function createOfflineTrustStore(scope: string): OfflineTrustStore {
  if (!isTauri()) {
    let memory: OfflineTrust | null = null;
    return {
      read: async () => memory,
      write: async (value) => {
        memory = structuredClone(value);
      },
      clear: async () => {
        memory = null;
      },
    };
  }
  return {
    read: async () => {
      const raw = await invoke<string | null>("read_offline_trust", { scope });
      if (!raw) return null;
      const value = JSON.parse(raw) as OfflineTrust;
      return value.schemaVersion === 1 && value.me?.account?.id && value.publicKey && value.keyId
        ? value
        : null;
    },
    write: (value) => invoke<void>("write_offline_trust", { scope, value: JSON.stringify(value) }),
    clear: () => invoke<void>("clear_offline_trust", { scope }),
  };
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RefreshTokenVault } from "./session";

export function createSystemTokenVault(scope: string): RefreshTokenVault {
  return {
    read: () => invoke<string | null>("read_refresh_token", { scope }),
    write: (token) => invoke<void>("write_refresh_token", { scope, token }),
    clear: () => invoke<void>("clear_refresh_token", { scope }),
  };
}

/** Browser preview is deliberately nonpersistent, never a fallback for a failed native vault. */
export function createRuntimeTokenVault(scope: string): RefreshTokenVault {
  if (isTauri()) return createSystemTokenVault(scope);
  let token: string | null = null;
  return {
    read: async () => token,
    write: async (value) => {
      token = value;
    },
    clear: async () => {
      token = null;
    },
  };
}

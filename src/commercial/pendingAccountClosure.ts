import { invoke, isTauri } from '@tauri-apps/api/core';

export interface PendingAccountClosure {
  schemaVersion: 1;
  accountId: string;
  verificationToken: string;
  createdAt: string;
}

export interface PendingAccountClosureStore {
  read(): Promise<PendingAccountClosure | null>;
  write(value: PendingAccountClosure): Promise<void>;
  clear(): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RECEIPT = /^[A-Za-z0-9_-]{43}$/u;

export function parsePendingAccountClosure(raw: string): PendingAccountClosure | null {
  try {
    const value = JSON.parse(raw) as Partial<PendingAccountClosure>;
    if (value.schemaVersion !== 1 || typeof value.accountId !== 'string' ||
      !UUID.test(value.accountId) || typeof value.verificationToken !== 'string' ||
      !RECEIPT.test(value.verificationToken) || typeof value.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(value.createdAt))) return null;
    return {
      schemaVersion: 1,
      accountId: value.accountId,
      verificationToken: value.verificationToken,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

/**
 * A lost close-account response can revoke the session before the client knows
 * whether the transaction committed. Keep the random receipt in the operating
 * system credential vault so the exact attempt remains verifiable after a
 * crash/restart. Browser previews deliberately keep it in memory only.
 */
export function createPendingAccountClosureStore(scope: string): PendingAccountClosureStore {
  if (!isTauri()) {
    let pending: PendingAccountClosure | null = null;
    return {
      read: async () => pending ? structuredClone(pending) : null,
      write: async (value) => {
        if (pending) throw new Error('Account closure receipt already exists');
        pending = structuredClone(value);
      },
      clear: async () => { pending = null; },
    };
  }
  return {
    read: async () => {
      const raw = await invoke<string | null>('read_pending_account_closure', { scope });
      if (!raw) return null;
      const parsed = parsePendingAccountClosure(raw);
      if (!parsed) throw new Error('Invalid stored account closure receipt');
      return parsed;
    },
    write: (value) => invoke<void>('write_pending_account_closure', {
      scope,
      value: JSON.stringify(value),
    }),
    clear: () => invoke<void>('clear_pending_account_closure', { scope }),
  };
}

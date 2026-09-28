import type { AuthAdapter } from "./auth";
import { AuthSessionError } from "./auth";
import type { SessionTokens } from "./contractsV2";

export interface RefreshTokenVault {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SessionSnapshot {
  authenticated: boolean;
  /** Changes on login, account replacement and logout, never on token rotation. */
  revision: number;
}

/** Serializes rotation, persistence and logout. Only the refresh token enters the vault. */
export class SessionManager {
  private access: { token: string; expiresAt: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<string | null> | null = null;
  private generation = 0;
  private snapshot: SessionSnapshot = { authenticated: false, revision: 0 };
  private listeners = new Set<(authenticated: boolean) => void>();
  private stateListeners = new Set<(snapshot: SessionSnapshot) => void>();
  constructor(
    private readonly auth: AuthAdapter,
    private readonly vault: RefreshTokenVault,
    private readonly revoke: (accessToken: string) => Promise<void>,
    private readonly now = Date.now,
  ) {}

  subscribe(listener: (authenticated: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A token-free source of truth suitable for stores and cache fencing. */
  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  subscribeState(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private publish(authenticated: boolean, sessionReplaced = false): void {
    const authenticationChanged = this.snapshot.authenticated !== authenticated;
    if (!authenticationChanged && !sessionReplaced) return;
    this.snapshot = {
      authenticated,
      revision: this.snapshot.revision + 1,
    };
    if (authenticationChanged)
      this.listeners.forEach((listener) => listener(authenticated));
    this.stateListeners.forEach((listener) => listener(this.snapshot));
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private validateSession(session: SessionTokens): number {
    const expiresAt = Date.parse(session.expiresAt);
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.now()
    ) {
      throw new AuthSessionError("Session invalide ou expirée.", true);
    }
    return expiresAt;
  }

  private async persist(
    session: SessionTokens,
    generation: number,
    sessionReplaced = false,
  ): Promise<string | null> {
    if (generation !== this.generation) {
      await this.revoke(session.accessToken).catch(() => undefined);
      return null;
    }
    const expiresAt = this.validateSession(session);
    try {
      await this.vault.write(session.refreshToken);
    } catch {
      this.access = null;
      try {
        await this.vault.clear();
      } catch {
        /* Fail closed; never expose access after a vault error. */
      }
      try {
        await this.revoke(session.accessToken);
      } catch {
        /* Remote expiry remains the fallback. */
      }
      this.publish(false);
      throw new Error("Le coffre-fort système est indisponible. Reconnectez-vous.");
    }
    if (generation !== this.generation) {
      await this.vault.clear();
      await this.revoke(session.accessToken).catch(() => undefined);
      return null;
    }
    this.access = { token: session.accessToken, expiresAt };
    this.publish(true, sessionReplaced);
    return session.accessToken;
  }

  async accept(session: SessionTokens): Promise<string> {
    // Reject malformed provider responses before mutating the current account
    // or fencing its usable access token.
    this.validateSession(session);
    // Fence the previous access token immediately. If two account replacements
    // race, only the latest call is allowed to reach persistence.
    const generation = ++this.generation;
    this.access = null;
    return this.serial(async () => {
      const token = await this.persist(session, generation, true);
      if (!token) throw new AuthSessionError("Connexion annulée par la déconnexion.", false);
      return token;
    });
  }

  /** Revokes a freshly-created session that lost an account-switch race. */
  async discard(session: Pick<SessionTokens, 'accessToken'>): Promise<void> {
    await this.revoke(session.accessToken).catch(() => undefined);
  }

  getAccessToken(): Promise<string | null> {
    if (this.access && this.access.expiresAt > this.now() + 30_000)
      return Promise.resolve(this.access.token);
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = this.serial(async () => {
      if (generation !== this.generation) return null;
      const refreshToken = await this.vault.read();
      if (!refreshToken) {
        this.publish(false);
        return null;
      }
      try {
        const session = await this.auth.refreshSession(refreshToken);
        if (generation !== this.generation) {
          try {
            await this.revoke(session.accessToken);
          } catch {
            /* logout clears the vault next */
          }
          return null;
        }
        return await this.persist(session, generation);
      } catch (error) {
        this.access = null;
        if (error instanceof AuthSessionError && error.terminal) {
          await this.vault.clear();
          this.publish(false);
        }
        throw error;
      }
    }).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async invalidate(): Promise<void> {
    this.generation += 1;
    this.access = null;
    this.publish(false);
    await this.serial(() => this.vault.clear());
  }

  /**
   * Invalidates only the session that actually produced a rejected request.
   * A delayed 401 from account A must never clear a newer account B session.
   */
  async invalidateIfCurrent(failedAccessToken: string): Promise<boolean> {
    if (!this.access || this.access.token !== failedAccessToken) return false;
    const generation = this.generation;
    return this.serial(async () => {
      // Rotation or account replacement may have completed while this
      // invalidation was waiting for the serialized vault operation.
      if (
        this.generation !== generation ||
        !this.access ||
        this.access.token !== failedAccessToken
      ) return false;
      try {
        // The durable refresh token is the commit point. Never tell the UI the
        // account is signed out while that credential can still be restored.
        await this.vault.clear();
      } catch {
        // A newer account may have fenced this request while the vault was
        // busy. In that case its queued persistence must proceed untouched.
        if (
          this.generation !== generation ||
          !this.access ||
          this.access.token !== failedAccessToken
        ) return false;
        throw new AuthSessionError(
          "Le coffre-fort système n’a pas pu effacer la session. Réessayez la déconnexion.",
          false,
        );
      }
      if (
        this.generation !== generation ||
        !this.access ||
        this.access.token !== failedAccessToken
      ) return false;
      this.generation += 1;
      this.access = null;
      this.publish(false);
      return true;
    });
  }

  async logout(): Promise<void> {
    const accessToken = this.access?.token;
    this.generation += 1;
    this.access = null;
    try {
      await this.serial(() => this.vault.clear());
    } catch {
      // Do not publish a successful logout while the refresh token may still
      // survive in the OS vault. The user can retry and the UI remains honest.
      throw new AuthSessionError(
        "Le coffre-fort système n’a pas pu effacer la session. Réessayez la déconnexion.",
        false,
      );
    }
    this.publish(false);
    // Clearing the local vault is the logout commit point. A temporary network
    // failure while revoking the access token is harmless: it is short-lived.
    if (accessToken) await this.revoke(accessToken).catch(() => undefined);
  }
}

import type { AuthAdapter } from "./auth";
import { AuthSessionError } from "./auth";
import type { SessionTokens } from "./contractsV2";

export interface RefreshTokenVault {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** Serializes rotation, persistence and logout. Only the refresh token enters the vault. */
export class SessionManager {
  private access: { token: string; expiresAt: number } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<string | null> | null = null;
  private generation = 0;
  constructor(
    private readonly auth: AuthAdapter,
    private readonly vault: RefreshTokenVault,
    private readonly revoke: (accessToken: string) => Promise<void>,
    private readonly now = Date.now,
  ) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async persist(session: SessionTokens): Promise<string> {
    const expiresAt = Date.parse(session.expiresAt);
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.now()
    ) {
      throw new AuthSessionError("Session invalide ou expirée.", true);
    }
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
      throw new Error("Le coffre-fort système est indisponible. Reconnectez-vous.");
    }
    this.access = { token: session.accessToken, expiresAt };
    return session.accessToken;
  }

  accept(session: SessionTokens): Promise<string> {
    return this.serial(() => this.persist(session));
  }

  getAccessToken(): Promise<string | null> {
    if (this.access && this.access.expiresAt > this.now() + 30_000)
      return Promise.resolve(this.access.token);
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = this.serial(async () => {
      if (generation !== this.generation) return null;
      const refreshToken = await this.vault.read();
      if (!refreshToken) return null;
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
        return await this.persist(session);
      } catch (error) {
        this.access = null;
        if (error instanceof AuthSessionError && error.terminal) await this.vault.clear();
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
    await this.serial(() => this.vault.clear());
  }

  async logout(): Promise<void> {
    const accessToken = this.access?.token;
    this.generation += 1;
    this.access = null;
    await this.serial(async () => {
      await this.vault.clear();
      if (accessToken) await this.revoke(accessToken);
    });
  }
}

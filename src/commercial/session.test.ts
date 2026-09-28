import { describe, expect, it, vi } from "vitest";
import { SessionManager, type RefreshTokenVault } from "./session";
import { AuthSessionError, type AuthAdapter } from "./auth";

function setup() {
  let now = 1000;
  let stored: string | null = null;
  const vault: RefreshTokenVault = {
    read: vi.fn(async () => stored),
    write: vi.fn(async (token) => {
      stored = token;
    }),
    clear: vi.fn(async () => {
      stored = null;
    }),
  };
  const session = (token: string) => ({
    accessToken: `access-${token}`,
    refreshToken: `refresh-${token}`,
    expiresAt: new Date(now + 60_000).toISOString(),
  });
  const auth: AuthAdapter = {
    signUp: vi.fn(),
    signIn: vi.fn(),
    requestPasswordReset: vi.fn(),
    sendCloudRecoveryLink: vi.fn(),
    changeEmail: vi.fn(),
    updatePassword: vi.fn(),
    refreshSession: vi.fn(async () => session("rotated")),
  };
  const revoke = vi.fn(async () => {});
  const manager = new SessionManager(auth, vault, revoke, () => now);
  return {
    manager,
    auth,
    vault,
    revoke,
    session,
    advance: () => {
      now += 40_000;
    },
    stored: () => stored,
  };
}

describe("system-vault session lifecycle", () => {
  it("never republishes authentication if logout happens during vault persistence", async () => {
    const s = setup();
    const listener = vi.fn();
    s.manager.subscribe(listener);
    const write = s.vault.write;
    let finish!: () => void;
    vi.mocked(s.vault.write).mockImplementationOnce(async token => {
      await new Promise<void>(resolve => { finish = resolve; });
      await write(token);
    });
    const accepting = s.manager.accept(s.session("late"));
    const rejection = expect(accepting).rejects.toThrow("annulée");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const logout = s.manager.logout();
    finish();
    await rejection;
    await logout;
    expect(listener).not.toHaveBeenCalledWith(true);
    expect(s.stored()).toBeNull();
    expect(s.revoke).toHaveBeenCalledWith("access-late");
    await s.manager.accept(s.session("next"));
    expect(await s.manager.getAccessToken()).toBe("access-next");
  });
  it("persists only refresh, restores after restart and rotates once for concurrent requests", async () => {
    const s = setup();
    await s.manager.accept(s.session("initial"));
    expect(s.stored()).toBe("refresh-initial");
    expect(await s.manager.getAccessToken()).toBe("access-initial");
    s.advance();
    const tokens = await Promise.all(Array.from({ length: 20 }, () => s.manager.getAccessToken()));
    expect(new Set(tokens)).toEqual(new Set(["access-rotated"]));
    expect(s.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(s.stored()).toBe("refresh-rotated");
    const restarted = new SessionManager(s.auth, s.vault, s.revoke, () => 41_000);
    expect(await restarted.getAccessToken()).toBe("access-rotated");
  });
  it("preserves refresh after a network outage, retries, clears a revoked refresh", async () => {
    const s = setup();
    await s.manager.accept(s.session("a"));
    s.advance();
    vi.mocked(s.auth.refreshSession).mockRejectedValueOnce(new TypeError("offline"));
    await expect(s.manager.getAccessToken()).rejects.toThrow("offline");
    expect(s.stored()).toBe("refresh-a");
    expect(await s.manager.getAccessToken()).toBe("access-rotated");
    s.advance();
    vi.mocked(s.auth.refreshSession).mockRejectedValueOnce(new AuthSessionError("revoked", true));
    await expect(s.manager.getAccessToken()).rejects.toThrow("revoked");
    expect(s.stored()).toBeNull();
  });
  it("ne transforme pas une indisponibilité temporaire du coffre-fort en déconnexion", async () => {
    const s = setup();
    await s.manager.accept(s.session("persisted"));
    const restarted = new SessionManager(s.auth, s.vault, s.revoke, () => 1_000);
    const listener = vi.fn();
    restarted.subscribe(listener);
    vi.mocked(s.vault.read).mockRejectedValueOnce(new TypeError("vault unavailable"));

    await expect(restarted.getAccessToken()).rejects.toThrow("vault unavailable");
    expect(listener).not.toHaveBeenCalledWith(false);
    expect(s.stored()).toBe("refresh-persisted");
    await expect(restarted.getAccessToken()).resolves.toBe("access-rotated");
  });
  it("logout wins over a pending rotation, including an unavailable revocation service", async () => {
    const s = setup();
    await s.manager.accept(s.session("a"));
    s.advance();
    let resolve!: (session: ReturnType<typeof s.session>) => void;
    vi.mocked(s.auth.refreshSession).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = s.manager.getAccessToken();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    const logout = s.manager.logout();
    resolve(s.session("late"));
    await pending;
    await logout;
    expect(s.stored()).toBeNull();
    expect(await s.manager.getAccessToken()).toBeNull();
    expect(s.revoke).toHaveBeenCalledWith("access-late");
    await s.manager.accept(s.session("b"));
    s.revoke.mockRejectedValueOnce(new Error("offline"));
    await expect(s.manager.logout()).resolves.toBeUndefined();
    expect(s.stored()).toBeNull();
    expect(await s.manager.getAccessToken()).toBeNull();
  });
  it("does not announce logout when the OS vault failed to erase the refresh token", async () => {
    const s = setup();
    const listener = vi.fn();
    s.manager.subscribe(listener);
    await s.manager.accept(s.session("still-present"));
    listener.mockClear();
    vi.mocked(s.vault.clear).mockRejectedValueOnce(new Error("vault locked"));

    await expect(s.manager.logout()).rejects.toThrow("coffre-fort");

    expect(s.manager.getSnapshot().authenticated).toBe(true);
    expect(listener).not.toHaveBeenCalledWith(false);
    expect(s.stored()).toBe("refresh-still-present");
    await expect(s.manager.getAccessToken()).resolves.toBe("access-rotated");
  });
  it("fails closed on vault write errors and malformed/expired sessions", async () => {
    const s = setup();
    vi.mocked(s.vault.write).mockRejectedValueOnce(new Error("locked"));
    await expect(s.manager.accept(s.session("a"))).rejects.toThrow("coffre-fort");
    expect(await s.manager.getAccessToken()).toBeNull();
    expect(s.revoke).toHaveBeenCalledWith("access-a");
    await expect(s.manager.accept({ ...s.session("b"), expiresAt: "invalid" })).rejects.toThrow();
  });
  it("keeps the current account intact when a replacement session is malformed", async () => {
    const s = setup();
    await s.manager.accept(s.session("current"));
    const snapshot = s.manager.getSnapshot();

    await expect(s.manager.accept({
      ...s.session("malformed"),
      refreshToken: "",
    })).rejects.toThrow("invalide");

    expect(s.manager.getSnapshot()).toEqual(snapshot);
    expect(s.stored()).toBe("refresh-current");
    expect(await s.manager.getAccessToken()).toBe("access-current");
  });
  it("publishes authentication changes for restore, invalidation and logout", async () => {
    const s = setup();
    const listener = vi.fn();
    const unsubscribe = s.manager.subscribe(listener);
    await s.manager.accept(s.session("a"));
    expect(listener).toHaveBeenLastCalledWith(true);
    await s.manager.invalidate();
    expect(listener).toHaveBeenLastCalledWith(false);
    await s.manager.accept(s.session("b"));
    await s.manager.logout();
    expect(listener).toHaveBeenLastCalledWith(false);
    unsubscribe();
    await s.manager.accept(s.session("c"));
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("ignores a late unauthorized response from a replaced access token", async () => {
    const s = setup();
    const listener = vi.fn();
    s.manager.subscribe(listener);
    await s.manager.accept(s.session("old"));
    await s.manager.accept(s.session("new"));

    expect(await s.manager.invalidateIfCurrent("access-old")).toBe(false);
    expect(await s.manager.getAccessToken()).toBe("access-new");
    expect(listener).not.toHaveBeenLastCalledWith(false);

    expect(await s.manager.invalidateIfCurrent("access-new")).toBe(true);
    expect(await s.manager.getAccessToken()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith(false);
  });

  it("commits a current-token invalidation only after the vault is cleared", async () => {
    const s = setup();
    const listener = vi.fn();
    s.manager.subscribe(listener);
    await s.manager.accept(s.session("current"));
    listener.mockClear();
    const clear = s.vault.clear;
    let release!: () => void;
    vi.mocked(s.vault.clear).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      await clear();
    });

    const invalidating = s.manager.invalidateIfCurrent("access-current");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));

    expect(s.manager.getSnapshot().authenticated).toBe(true);
    expect(listener).not.toHaveBeenCalledWith(false);
    expect(s.stored()).toBe("refresh-current");

    release();
    await expect(invalidating).resolves.toBe(true);
    expect(s.manager.getSnapshot().authenticated).toBe(false);
    expect(listener).toHaveBeenLastCalledWith(false);
    expect(s.stored()).toBeNull();
  });

  it("keeps the authenticated snapshot when current-token vault clearing fails", async () => {
    const s = setup();
    const listener = vi.fn();
    s.manager.subscribe(listener);
    await s.manager.accept(s.session("current"));
    listener.mockClear();
    vi.mocked(s.vault.clear).mockRejectedValueOnce(new Error("vault locked"));

    await expect(s.manager.invalidateIfCurrent("access-current"))
      .rejects.toThrow("coffre-fort");

    expect(s.manager.getSnapshot().authenticated).toBe(true);
    expect(listener).not.toHaveBeenCalledWith(false);
    expect(s.stored()).toBe("refresh-current");
    await expect(s.manager.getAccessToken()).resolves.toBe("access-current");
  });

  it("publishes a minimal idempotent state across restore, rotation and account replacement", async () => {
    const s = setup();
    const authentication = vi.fn();
    const states = vi.fn();
    s.manager.subscribe(authentication);
    s.manager.subscribeState(states);

    expect(s.manager.getSnapshot()).toEqual({ authenticated: false, revision: 0 });
    await expect(s.manager.getAccessToken()).resolves.toBeNull();
    await expect(s.manager.getAccessToken()).resolves.toBeNull();
    expect(authentication).not.toHaveBeenCalled();
    expect(states).not.toHaveBeenCalled();

    await s.manager.accept(s.session("account-a"));
    expect(authentication).toHaveBeenCalledTimes(1);
    expect(authentication).toHaveBeenLastCalledWith(true);
    expect(states).toHaveBeenCalledTimes(1);
    expect(s.manager.getSnapshot()).toEqual({ authenticated: true, revision: 1 });

    s.advance();
    await expect(s.manager.getAccessToken()).resolves.toBe("access-rotated");
    expect(authentication).toHaveBeenCalledTimes(1);
    expect(states).toHaveBeenCalledTimes(1);

    await s.manager.accept(s.session("account-b"));
    expect(authentication).toHaveBeenCalledTimes(1);
    expect(states).toHaveBeenCalledTimes(2);
    expect(s.manager.getSnapshot()).toEqual({ authenticated: true, revision: 2 });

    await s.manager.invalidate();
    await s.manager.invalidate();
    expect(authentication).toHaveBeenCalledTimes(2);
    expect(authentication).toHaveBeenLastCalledWith(false);
    expect(states).toHaveBeenCalledTimes(3);
    expect(s.manager.getSnapshot()).toEqual({ authenticated: false, revision: 3 });
  });

  it("lets only the latest of two rapid account logins reach the vault", async () => {
    const s = setup();
    const authentication = vi.fn();
    s.manager.subscribe(authentication);

    const accountA = s.manager.accept(s.session("account-a"));
    const accountB = s.manager.accept(s.session("account-b"));

    await expect(accountA).rejects.toBeInstanceOf(AuthSessionError);
    await expect(accountB).resolves.toBe("access-account-b");
    await expect(s.manager.getAccessToken()).resolves.toBe("access-account-b");
    expect(s.stored()).toBe("refresh-account-b");
    expect(s.revoke).toHaveBeenCalledWith("access-account-a");
    expect(authentication).toHaveBeenCalledTimes(1);
    expect(authentication).toHaveBeenLastCalledWith(true);
  });
});

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
    await expect(s.manager.logout()).rejects.toThrow();
    expect(s.stored()).toBeNull();
    expect(await s.manager.getAccessToken()).toBeNull();
  });
  it("fails closed on vault write errors and malformed/expired sessions", async () => {
    const s = setup();
    vi.mocked(s.vault.write).mockRejectedValueOnce(new Error("locked"));
    await expect(s.manager.accept(s.session("a"))).rejects.toThrow("coffre-fort");
    expect(await s.manager.getAccessToken()).toBeNull();
    expect(s.revoke).toHaveBeenCalledWith("access-a");
    await expect(s.manager.accept({ ...s.session("b"), expiresAt: "invalid" })).rejects.toThrow();
  });
});

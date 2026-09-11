import { beforeEach, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  native: true,
  values: new Map<string, string>(),
  fail: false,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => runtime.native,
  invoke: async (command: string, args: { scope: string; token?: string; value?: string }) => {
    if (runtime.fail) throw new Error("vault locked");
    const key = `${command.includes("offline_trust") ? "trust" : "session"}:${args.scope}`;
    if (command.startsWith("read_")) return runtime.values.get(key) ?? null;
    if (command.startsWith("write_")) runtime.values.set(key, args.token ?? args.value!);
    if (command.startsWith("clear_")) runtime.values.delete(key);
  },
}));
import { createRuntimeTokenVault } from "./tokenVault";
import { createOfflineTrustStore } from "./offlineTrust";

beforeEach(() => {
  runtime.native = true;
  runtime.values.clear();
  runtime.fail = false;
});
it("keeps refresh and offline trust in separate native entries across a restart", async () => {
  const vault = createRuntimeTokenVault("staging");
  await vault.write("synthetic-refresh");
  const trust = {
    schemaVersion: 1 as const,
    me: {
      account: { id: "owner", email: "owner@example.invalid", displayName: null },
      role: "customer" as const,
    },
    publicKey: { kty: "EC" },
    keyId: "key",
  };
  await createOfflineTrustStore("staging").write(trust);
  expect(await createRuntimeTokenVault("staging").read()).toBe("synthetic-refresh");
  expect(await createOfflineTrustStore("staging").read()).toEqual(trust);
  expect(await createRuntimeTokenVault("other-environment").read()).toBeNull();
  await vault.clear();
  await createOfflineTrustStore("staging").clear();
  expect(runtime.values.size).toBe(0);
});
it("does not fall back to insecure persistence when native storage fails", async () => {
  runtime.fail = true;
  await expect(createRuntimeTokenVault("staging").write("synthetic-refresh")).rejects.toThrow(
    "locked",
  );
  await expect(createOfflineTrustStore("staging").read()).rejects.toThrow("locked");
  expect(runtime.values.size).toBe(0);
  runtime.native = false;
  const browser = createRuntimeTokenVault("preview");
  await browser.write("temporary");
  expect(await browser.read()).toBe("temporary");
  expect(await createRuntimeTokenVault("preview").read()).toBeNull();
});

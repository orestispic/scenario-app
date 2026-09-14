import { describe, expect, it, vi } from "vitest";
import { selectDeviceFingerprint } from "./deviceIdentity";

describe("device identity migration", () => {
  it("keeps the identity already stored in the system vault", () => {
    const generate = vi.fn(() => "generated-generated-generated-generated");
    expect(selectDeviceFingerprint("vault-vault-vault-vault-vault-vault", "legacy-legacy-legacy-legacy-legacy", generate))
      .toBe("vault-vault-vault-vault-vault-vault");
    expect(generate).not.toHaveBeenCalled();
  });

  it("migrates the previous browser identity instead of creating a new device", () => {
    const generate = vi.fn(() => "generated-generated-generated-generated");
    expect(selectDeviceFingerprint(null, "legacy-legacy-legacy-legacy-legacy", generate))
      .toBe("legacy-legacy-legacy-legacy-legacy");
    expect(generate).not.toHaveBeenCalled();
  });

  it("creates a new identity only when no valid identity exists", () => {
    expect(selectDeviceFingerprint(null, "too-short", () => "generated-generated-generated-generated"))
      .toBe("generated-generated-generated-generated");
  });
});

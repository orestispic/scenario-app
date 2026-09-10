import type { ClientCompatibility } from "./contracts";

export type ClientCompatibilityState = "compatible" | "update-required" | "invalid-version";

function parseVersion(value: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function assessClientCompatibility(
  currentVersion: string,
  compatibility: ClientCompatibility,
): ClientCompatibilityState {
  const current = parseVersion(currentVersion);
  const minimum = parseVersion(compatibility.minimumSupportedVersion);
  if (!current || !minimum) return "invalid-version";
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return "compatible";
    if (current[index] < minimum[index]) return "update-required";
  }
  return "compatible";
}

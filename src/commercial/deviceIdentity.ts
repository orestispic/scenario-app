import { invoke, isTauri } from "@tauri-apps/api/core";

const LEGACY_STORAGE_KEY = "scenario-local-device-fingerprint";
let fingerprint: string | null = null;
let nativeUnavailable = false;

function validFingerprint(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function selectDeviceFingerprint(
  stored: string | null | undefined,
  legacy: string | null | undefined,
  generate: () => string,
): string {
  if (validFingerprint(stored)) return stored;
  if (validFingerprint(legacy)) return legacy;
  return generate();
}

function generatedFingerprint(): string {
  return crypto.randomUUID() + crypto.randomUUID();
}

/**
 * Loads the installation identity before React starts. Native builds keep it in
 * the operating-system credential vault, which is not removed by reinstalling
 * Senario. The previous localStorage value is migrated to avoid consuming a new
 * device slot during the update.
 */
export async function initializeDeviceIdentity(scope: string): Promise<void> {
  let legacy: string | null = null;
  try { legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY); } catch { /* Local editing remains available. */ }

  if (!isTauri()) {
    fingerprint = selectDeviceFingerprint(null, legacy, generatedFingerprint);
    try { window.localStorage.setItem(LEGACY_STORAGE_KEY, fingerprint); } catch { /* Private preview. */ }
    return;
  }

  try {
    const candidate = selectDeviceFingerprint(null, legacy, generatedFingerprint);
    fingerprint = await invoke<string>("get_or_create_device_identity", { scope, candidate });
    nativeUnavailable = false;
  } catch {
    // Never activate a replacement identity when the durable vault cannot be read.
    // Free local writing does not need a fingerprint and remains available.
    fingerprint = null;
    nativeUnavailable = true;
    return;
  }

  try { window.localStorage.setItem(LEGACY_STORAGE_KEY, fingerprint); } catch { /* The system vault is authoritative. */ }
}

export function getDeviceFingerprint(): string {
  if (nativeUnavailable || (isTauri() && !fingerprint)) {
    throw new Error("Impossible de reconnaître cet appareil. Relancez Senario pour réessayer. L’écriture locale reste disponible.");
  }
  if (fingerprint) return fingerprint;

  // Browser tests and previews do not run the asynchronous native bootstrap.
  const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
  fingerprint = selectDeviceFingerprint(null, legacy, generatedFingerprint);
  window.localStorage.setItem(LEGACY_STORAGE_KEY, fingerprint);
  return fingerprint;
}

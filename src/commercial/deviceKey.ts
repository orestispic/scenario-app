import { invoke, isTauri } from '@tauri-apps/api/core';

type StoredDeviceKey = {
  schemaVersion: 1;
  privateKey: JsonWebKey;
  publicKey: JsonWebKey;
  thumbprint: string;
};
type BrowserStoredDeviceKey = {
  schemaVersion: 1;
  privateKey: CryptoKey;
  publicKey: JsonWebKey;
  thumbprint: string;
};

let current: { privateKey: CryptoKey; publicKey: JsonWebKey; thumbprint: string } | null = null;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function validPublicKey(key: JsonWebKey): boolean {
  return key.kty === 'EC' && key.crv === 'P-256' &&
    typeof key.x === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key.x) &&
    typeof key.y === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key.y) && !key.d;
}

export async function deviceKeyThumbprint(publicKey: JsonWebKey): Promise<string> {
  if (!validPublicKey(publicKey)) throw new Error('Clé publique appareil invalide.');
  const canonical = JSON.stringify({ crv: publicKey.crv, kty: publicKey.kty, x: publicKey.x, y: publicKey.y });
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))));
}

async function generate(): Promise<StoredDeviceKey> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { schemaVersion: 1, privateKey, publicKey, thumbprint: await deviceKeyThumbprint(publicKey) };
}

function parseStored(raw: string): StoredDeviceKey {
  const value = JSON.parse(raw) as StoredDeviceKey;
  if (value.schemaVersion !== 1 || !value.privateKey?.d || !validPublicKey(value.publicKey)) {
    throw new Error('Identité cryptographique appareil invalide.');
  }
  return value;
}

function openBrowserVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('senario-secure-device-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Stockage cryptographique navigateur indisponible.'));
  });
}

async function readBrowserKey(scope: string): Promise<BrowserStoredDeviceKey | null> {
  const database = await openBrowserVault();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction('keys', 'readonly').objectStore('keys').get(scope);
      request.onsuccess = () => resolve((request.result as BrowserStoredDeviceKey | undefined) ?? null);
      request.onerror = () => reject(new Error('Lecture de l’identité appareil impossible.'));
    });
  } finally { database.close(); }
}

async function writeBrowserKey(scope: string, value: BrowserStoredDeviceKey): Promise<void> {
  const database = await openBrowserVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite');
      transaction.objectStore('keys').put(value, scope);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('Enregistrement de l’identité appareil impossible.'));
    });
  } finally { database.close(); }
}

export async function initializeDeviceKey(scope: string): Promise<void> {
  let privateKey: CryptoKey;
  let publicKey: JsonWebKey;
  let thumbprint: string;
  if (isTauri()) {
    const raw = await invoke<string | null>('read_device_keypair', { scope });
    let stored: StoredDeviceKey;
    if (raw) stored = parseStored(raw);
    else {
      stored = await generate();
      try { await invoke<void>('write_device_keypair', { scope, value: JSON.stringify(stored) }); }
      catch {
        // Another Senario instance may have won the first-install race.
        const winner = await invoke<string | null>('read_device_keypair', { scope });
        if (!winner) throw new Error('Enregistrement de la clé appareil impossible.');
        stored = parseStored(winner);
      }
    }
    privateKey = await crypto.subtle.importKey(
      'jwk', stored.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
    );
    publicKey = stored.publicKey;
    thumbprint = stored.thumbprint;
  } else {
    let stored = await readBrowserKey(scope);
    if (!stored) {
      // Migrate the brief preproduction fallback that stored JWK data in web
      // storage, then erase it. New browser keys are persisted non-extractable.
      const legacyKey = `scenario-device-key-v1:${scope}`;
      const legacyRaw = window.localStorage.getItem(legacyKey);
      const generated = legacyRaw ? parseStored(legacyRaw) : await generate();
      privateKey = await crypto.subtle.importKey(
        'jwk', generated.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
      );
      stored = { schemaVersion: 1, privateKey, publicKey: generated.publicKey, thumbprint: generated.thumbprint };
      await writeBrowserKey(scope, stored);
      window.localStorage.removeItem(legacyKey);
    }
    privateKey = stored.privateKey;
    publicKey = stored.publicKey;
    thumbprint = stored.thumbprint;
  }
  const expected = await deviceKeyThumbprint(publicKey);
  if (expected !== thumbprint || privateKey.algorithm.name !== 'ECDSA' || !privateKey.usages.includes('sign'))
    throw new Error('Empreinte de clé appareil incohérente.');
  current = {
    privateKey,
    publicKey: { ...publicKey, d: undefined },
    thumbprint,
  };
}

function requireKey() {
  if (!current) throw new Error('Identité cryptographique appareil indisponible. Relancez Senario.');
  return current;
}

export function getDevicePublicKey(): JsonWebKey {
  return structuredClone(requireKey().publicKey);
}

export function getDeviceKeyThumbprint(): string {
  return requireKey().thumbprint;
}

export async function signDeviceChallenge(message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, requireKey().privateKey,
    new TextEncoder().encode(message),
  );
  return base64Url(new Uint8Array(signature));
}

export async function signDeviceRequest(input: {
  method: string; path: string; timestamp: string; nonce: string; bodyDigest: string;
}): Promise<string> {
  return signDeviceChallenge([
    'senario-request-proof-v1', input.method.toUpperCase(), input.path,
    input.timestamp, input.nonce, input.bodyDigest,
  ].join('\n'));
}

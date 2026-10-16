/**
 * Application-level encryption (Section 18).
 *
 * Envelope design:
 *  - A random 256-bit AES-GCM data key (DEK) encrypts every stored record.
 *  - A key-encryption key (KEK) is derived from the trainee's passphrase with
 *    PBKDF2-HMAC-SHA-256 and a per-install random salt, and wraps the DEK.
 *  - Only the salt, the iteration count and the wrapped DEK are stored. The
 *    passphrase and the unwrapped DEK are never stored; the DEK lives in
 *    memory for the unlocked session only, as a non-extractable CryptoKey.
 *  - Changing the passphrase re-wraps the same DEK, so records need no
 *    re-encryption.
 *
 * Everything here is the Web Crypto API. Nothing is hand-rolled.
 */

export const KDF_ALGORITHM = 'PBKDF2-HMAC-SHA-256' as const;
/** OWASP Password Storage Cheat Sheet recommendation for PBKDF2-HMAC-SHA256. */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 10;

const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface KeyMaterial {
  kdf: typeof KDF_ALGORITHM;
  iterations: number;
  salt: string; // base64
  wrapIv: string; // base64
  wrappedKey: string; // base64, AES-GCM(KEK) of the raw DEK
  createdAt: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('The passphrase is incorrect, or the key material is damaged.');
    this.name = 'WrongPassphraseError';
  }
}

export class DecryptionError extends Error {
  constructor(where: string) {
    super(`A stored record failed its integrity check (${where}). It may have been altered.`);
    this.name = 'DecryptionError';
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('Web Crypto is unavailable. PRECEPTOR requires a secure context (https or localhost).');
  return s;
}

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKek(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

const WRAP_AAD = enc.encode('preceptor:dek:v1');

/** Create a new data key and wrap it under the passphrase. Returns the session key and what to store. */
export async function createKeyMaterial(
  passphrase: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<{ key: CryptoKey; material: KeyMaterial }> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(passphrase, salt, iterations);
  // Generated extractable only so it can be wrapped once; the session copy is re-imported non-extractable.
  const dek = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapIv = randomBytes(IV_BYTES);
  const wrapped = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: wrapIv, additionalData: WRAP_AAD });
  const material: KeyMaterial = {
    kdf: KDF_ALGORITHM,
    iterations,
    salt: toBase64(salt),
    wrapIv: toBase64(wrapIv),
    wrappedKey: toBase64(wrapped),
    createdAt: new Date().toISOString(),
  };
  // Round-trip through unwrap so the session holds a non-extractable copy, and
  // so a material that cannot be unwrapped is never stored.
  const key = await unwrapWithKek(kek, material, false);
  return { key, material };
}

/** Unwrap the data key. Throws WrongPassphraseError if the passphrase does not match. */
export async function unwrapDataKey(passphrase: string, m: KeyMaterial, extractable = false): Promise<CryptoKey> {
  if (m.kdf !== KDF_ALGORITHM) throw new Error(`Unsupported key derivation: ${String(m.kdf)}`);
  const kek = await deriveKek(passphrase, fromBase64(m.salt), m.iterations);
  return unwrapWithKek(kek, m, extractable);
}

async function unwrapWithKek(kek: CryptoKey, m: KeyMaterial, extractable: boolean): Promise<CryptoKey> {
  try {
    return await subtle().unwrapKey(
      'raw',
      fromBase64(m.wrappedKey),
      kek,
      { name: 'AES-GCM', iv: fromBase64(m.wrapIv), additionalData: WRAP_AAD },
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Re-wrap the same data key under a new passphrase (fresh salt). Requires the current passphrase. */
export async function rewrapKeyMaterial(
  currentPassphrase: string,
  newPassphrase: string,
  m: KeyMaterial,
  iterations = m.iterations,
): Promise<KeyMaterial> {
  if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
  }
  const dek = await unwrapDataKey(currentPassphrase, m, true);
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKek(newPassphrase, salt, iterations);
  const wrapIv = randomBytes(IV_BYTES);
  const wrapped = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv: wrapIv, additionalData: WRAP_AAD });
  return {
    kdf: KDF_ALGORITHM,
    iterations,
    salt: toBase64(salt),
    wrapIv: toBase64(wrapIv),
    wrappedKey: toBase64(wrapped),
    createdAt: new Date().toISOString(),
  };
}

export interface Sealed {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

/**
 * Encrypt a JSON-serialisable value. `aad` binds the ciphertext to where it is
 * stored (table, primary key and plaintext index fields), so a ciphertext
 * moved to another row, or a tampered index field, fails to decrypt.
 */
export async function seal(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { iv, ct };
}

export async function open<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  return JSON.parse(dec.decode(await openBytes(key, sealed, aad))) as T;
}

/** Encrypt raw bytes (an image, a text document) without JSON or base64 overhead. Same AAD binding as `seal`. */
export async function sealBytes(key: CryptoKey, bytes: Uint8Array, aad: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, bytes);
  return { iv, ct };
}

/** Decrypt and authenticate. Throws DecryptionError on a wrong key, a moved row or any tampering. */
export async function openBytes(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(
      await subtle().decrypt({ name: 'AES-GCM', iv: sealed.iv, additionalData: enc.encode(aad) }, key, sealed.ct),
    );
  } catch {
    throw new DecryptionError(aad.split('\u0000')[0] ?? 'record');
  }
}

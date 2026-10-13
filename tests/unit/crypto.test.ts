import { describe, expect, it } from 'vitest';
import {
  createKeyMaterial,
  DecryptionError,
  DEFAULT_PBKDF2_ITERATIONS,
  fromBase64,
  open,
  rewrapKeyMaterial,
  seal,
  toBase64,
  unwrapDataKey,
  WrongPassphraseError,
} from '../../src/crypto/crypto';

const FAST = 1_000; // test-only iteration count; the production default is asserted separately
const PASS = 'correct horse battery staple';

describe('key derivation and wrapping', () => {
  it('derives the same data key from the same passphrase (encryption round-trip)', async () => {
    const { key, material } = await createKeyMaterial(PASS, FAST);
    const sealed = await seal(key, { k: 4.1, unit: 'mmol/L' }, 'aad');
    const again = await unwrapDataKey(PASS, material);
    await expect(open(again, sealed, 'aad')).resolves.toEqual({ k: 4.1, unit: 'mmol/L' });
  });

  it('rejects a wrong passphrase', async () => {
    const { material } = await createKeyMaterial(PASS, FAST);
    await expect(unwrapDataKey('wrong passphrase!', material)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('keeps the session key non-extractable', async () => {
    const { key, material } = await createKeyMaterial(PASS, FAST);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toBeTruthy();
    expect((await unwrapDataKey(PASS, material)).extractable).toBe(false);
  });

  it('uses a fresh random salt and data key per installation', async () => {
    const a = await createKeyMaterial(PASS, FAST);
    const b = await createKeyMaterial(PASS, FAST);
    expect(a.material.salt).not.toBe(b.material.salt);
    expect(a.material.wrappedKey).not.toBe(b.material.wrappedKey);
    expect(fromBase64(a.material.salt)).toHaveLength(16);
  });

  it('never stores the passphrase in the key material', async () => {
    const { material } = await createKeyMaterial(PASS, FAST);
    expect(JSON.stringify(material)).not.toContain(PASS);
  });

  it('refuses passphrases shorter than 10 characters', async () => {
    await expect(createKeyMaterial('short', FAST)).rejects.toThrow(/at least 10/);
  });

  it('re-wraps the same data key under a new passphrase', async () => {
    const { key, material } = await createKeyMaterial(PASS, FAST);
    const sealed = await seal(key, 'payload', 'aad');
    const next = await rewrapKeyMaterial(PASS, 'a brand new passphrase', material);
    expect(next.salt).not.toBe(material.salt);
    const k2 = await unwrapDataKey('a brand new passphrase', next);
    await expect(open(k2, sealed, 'aad')).resolves.toBe('payload');
    await expect(unwrapDataKey(PASS, next)).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(rewrapKeyMaterial('not the passphrase', 'x'.repeat(12), material)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it('uses at least 600,000 PBKDF2 iterations by default', async () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const { material } = await createKeyMaterial(PASS);
    expect(material.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);
    expect(material.kdf).toBe('PBKDF2-HMAC-SHA-256');
  });
});

describe('AES-GCM sealing', () => {
  it('uses a fresh 96-bit IV for every encryption', async () => {
    const { key } = await createKeyMaterial(PASS, FAST);
    const a = await seal(key, 'same', 'aad');
    const b = await seal(key, 'same', 'aad');
    expect(a.iv).toHaveLength(12);
    expect(toBase64(a.iv)).not.toBe(toBase64(b.iv));
    expect(toBase64(a.ct)).not.toBe(toBase64(b.ct));
  });

  it('detects a tampered ciphertext', async () => {
    const { key } = await createKeyMaterial(PASS, FAST);
    const s = await seal(key, { drug: 'vancomycin' }, 'aad');
    const bytes = new Uint8Array(s.ct.slice(0));
    bytes[0] = bytes[0]! ^ 0xff;
    await expect(open(key, { iv: s.iv, ct: bytes.buffer }, 'aad')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('detects a record moved to another row (AAD mismatch)', async () => {
    const { key } = await createKeyMaterial(PASS, FAST);
    const s = await seal(key, { drug: 'vancomycin' }, 'timeline\u0000entry-1');
    await expect(open(key, s, 'timeline\u0000entry-2')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('round-trips binary through base64', () => {
    const b = crypto.getRandomValues(new Uint8Array(60_000));
    expect(fromBase64(toBase64(b))).toEqual(b);
  });
});

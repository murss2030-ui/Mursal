/**
 * Key management and the lock (Section 18).
 *
 * - First run: intended-use acknowledgement, then a passphrase is chosen and
 *   the wrapped data key is stored. The passphrase is never stored.
 * - The data key lives in this object's memory only while unlocked.
 * - Locking flushes encrypted working drafts, drops the key and clears every
 *   decrypted cache.
 */
import {
  createKeyMaterial,
  DEFAULT_PBKDF2_ITERATIONS,
  rewrapKeyMaterial,
  unwrapDataKey,
  type KeyMaterial,
} from '../crypto/crypto';
import { INTENDED_USE_VERSION } from '../domain/intendedUse';
import { PreceptorDB } from './db';
import { Store, type StoreOptions } from './store';

export type Language = 'en' | 'ar';
export interface Prefs {
  language: Language;
  idleLockMinutes: number;
}
export const IDLE_LOCK_CHOICES = [1, 2, 5, 10, 15, 30] as const;
export const DEFAULT_PREFS: Prefs = { language: 'en', idleLockMinutes: 5 };

export interface IntendedUseAck {
  version: string;
  at: string;
  /** True until the acknowledgement has been written to the (encrypted) audit log. */
  auditPending: boolean;
}

export type GateState = 'needs_ack' | 'needs_setup' | 'locked' | 'unlocked';

const META_KEY_MATERIAL = 'keyMaterial';
const META_PREFS = 'prefs';
const META_ACK = 'intendedUseAck';

export function isIdleExpired(lastActivityMs: number, nowMs: number, idleMinutes: number): boolean {
  return nowMs - lastActivityMs >= idleMinutes * 60_000;
}

export class Session {
  private key: CryptoKey | null = null;
  readonly store: Store;
  private readonly listeners = new Set<() => void>();
  private readonly flushers = new Set<() => Promise<void>>();

  constructor(
    readonly db: PreceptorDB = new PreceptorDB(),
    storeOptions: StoreOptions = {},
    private readonly iterations: number = DEFAULT_PBKDF2_ITERATIONS,
  ) {
    this.store = new Store(db, () => this.key, storeOptions);
  }

  get isUnlocked(): boolean {
    return this.key !== null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // ------------------------------------------------------------------ plaintext meta

  private async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  private async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  async getPrefs(): Promise<Prefs> {
    return { ...DEFAULT_PREFS, ...((await this.getMeta<Partial<Prefs>>(META_PREFS)) ?? {}) };
  }

  async setPrefs(p: Partial<Prefs>): Promise<Prefs> {
    const next = { ...(await this.getPrefs()), ...p };
    if (!IDLE_LOCK_CHOICES.includes(next.idleLockMinutes as (typeof IDLE_LOCK_CHOICES)[number])) {
      throw new Error('Unsupported idle lock period.');
    }
    await this.setMeta(META_PREFS, next);
    return next;
  }

  getKeyMaterial(): Promise<KeyMaterial | undefined> {
    return this.getMeta<KeyMaterial>(META_KEY_MATERIAL);
  }

  async gateState(): Promise<GateState> {
    const ack = await this.getMeta<IntendedUseAck>(META_ACK);
    if (!ack || ack.version !== INTENDED_USE_VERSION) return 'needs_ack';
    if (!(await this.getKeyMaterial())) return 'needs_setup';
    return this.isUnlocked ? 'unlocked' : 'locked';
  }

  /** Records the acknowledgement. Stored in plain meta because it precedes the passphrase; audited once unlocked. */
  async acknowledgeIntendedUse(now = new Date()): Promise<void> {
    await this.setMeta(META_ACK, { version: INTENDED_USE_VERSION, at: now.toISOString(), auditPending: true });
    if (this.isUnlocked) await this.flushPendingAckAudit();
    this.emit();
  }

  private async flushPendingAckAudit(): Promise<void> {
    const ack = await this.getMeta<IntendedUseAck>(META_ACK);
    if (!ack?.auditPending) return;
    await this.store.appendAudit({
      entity: 'intended_use',
      entityId: ack.version,
      action: 'acknowledge',
      diff: { statementVersion: ack.version, acknowledgedAt: ack.at },
    });
    await this.setMeta(META_ACK, { ...ack, auditPending: false });
  }

  // ------------------------------------------------------------------ key lifecycle

  async setup(passphrase: string): Promise<void> {
    if (await this.getKeyMaterial()) throw new Error('This installation already has a passphrase.');
    const { key, material } = await createKeyMaterial(passphrase, this.iterations);
    await this.setMeta(META_KEY_MATERIAL, material);
    this.key = key;
    await this.store.appendAudit({
      entity: 'key',
      entityId: 'data-key',
      action: 'create',
      actor: 'system',
      diff: { kdf: material.kdf, iterations: material.iterations },
    });
    await this.flushPendingAckAudit();
    this.emit();
  }

  /** Throws WrongPassphraseError on a wrong passphrase. */
  async unlock(passphrase: string): Promise<void> {
    const m = await this.getKeyMaterial();
    if (!m) throw new Error('No passphrase has been set up on this device.');
    this.key = await unwrapDataKey(passphrase, m);
    await this.flushPendingAckAudit();
    this.emit();
  }

  /** Installs an already-unwrapped key (used by backup restore). */
  async adoptKey(key: CryptoKey): Promise<void> {
    this.key = key;
    await this.flushPendingAckAudit();
    this.emit();
  }

  async lock(): Promise<void> {
    if (!this.key) return;
    await Promise.allSettled([...this.flushers].map((f) => f()));
    this.key = null;
    this.store.clearCache();
    this.emit();
  }

  /** Registers a function that saves unsaved work (encrypted) before the key is dropped. */
  registerFlusher(fn: () => Promise<void>): () => void {
    this.flushers.add(fn);
    return () => this.flushers.delete(fn);
  }

  async changePassphrase(current: string, next: string): Promise<void> {
    const m = await this.getKeyMaterial();
    if (!m) throw new Error('No passphrase has been set up on this device.');
    const material = await rewrapKeyMaterial(current, next, m, Math.max(m.iterations, this.iterations));
    await this.setMeta(META_KEY_MATERIAL, material);
    await this.store.appendAudit({
      entity: 'key',
      entityId: 'data-key',
      action: 'change_passphrase',
      diff: { kdf: material.kdf, iterations: material.iterations },
    });
  }

  /** Irreversibly deletes every record on this device. Used when the passphrase is forgotten. */
  async eraseInstallation(): Promise<void> {
    this.key = null;
    this.store.clearCache();
    await this.db.delete();
    await this.db.open();
    this.emit();
  }

  // ------------------------------------------------------------------ used by backup restore

  async setKeyMaterialForRestore(m: KeyMaterial): Promise<void> {
    await this.setMeta(META_KEY_MATERIAL, m);
  }

  async getAckForBackup(): Promise<IntendedUseAck | undefined> {
    return this.getMeta<IntendedUseAck>(META_ACK);
  }
}

/**
 * Encrypted manual backup (Decision 8, Section 18).
 *
 * The backup file contains the rows exactly as stored — already encrypted —
 * plus the wrapped data key. It can be decrypted only with the passphrase in
 * use when it was made. Nothing is uploaded anywhere; the trainee saves the
 * file themselves. The intended-use statement is carried in the file, as on
 * every export.
 */
import { APP_VERSION } from '../config/release';
import { fromBase64, openBytes, toBase64, unwrapDataKey, type KeyMaterial } from '../crypto/crypto';
import { INTENDED_USE_STATEMENT } from '../domain/intendedUse';
import { ENCRYPTED_TABLES, type EncryptedRow, type EncryptedTableName } from './db';
import type { Prefs, Session } from './session';
import { IntegrityError, rowAad } from './store';

export const BACKUP_FORMAT = 'preceptor-backup';
/**
 * Version 2 adds the patient file (attachments, blobs) and the clinical modules (tasks, items); 3 the model's readings and
 * drafts; 4 calculation results; 5 the decisions on Problem Cards. Older files still restore.
 */
export const BACKUP_FORMAT_VERSION = 5;
const READABLE_FORMAT_VERSIONS = [1, 2, 3, 4, 5];

/** Working drafts are transient and not part of the record. */
// Working drafts and the open-data cache are not part of the record.
const BACKED_UP_TABLES = ENCRYPTED_TABLES.filter((t) => t !== 'uiDrafts' && t !== 'lookups');

type SerializedRow = Omit<EncryptedRow, 'iv' | 'ct'> & { iv: string; ct: string };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  appVersion: string;
  createdAt: string;
  intendedUse: string;
  notice: string;
  keyMaterial: KeyMaterial;
  prefs: Prefs;
  intendedUseAck?: unknown;
  tables: Partial<Record<EncryptedTableName, SerializedRow[]>>;
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export async function createBackup(session: Session): Promise<{ filename: string; json: string }> {
  if (!session.isUnlocked) throw new Error('Unlock PRECEPTOR before exporting a backup.');
  const keyMaterial = await session.getKeyMaterial();
  if (!keyMaterial) throw new Error('No key material.');
  const tables: BackupFile['tables'] = {};
  for (const t of BACKED_UP_TABLES) {
    const rows = await session.db.encryptedTable(t).toArray();
    tables[t] = rows.map(({ iv, ct, ...index }) => ({ ...index, iv: toBase64(iv), ct: toBase64(ct) }));
  }
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt: session.store.nowIso(),
    intendedUse: INTENDED_USE_STATEMENT,
    notice:
      'Encrypted PRECEPTOR backup. It can be restored only with the passphrase that was in use when it was created. ' +
      'If that passphrase is lost, this file cannot be decrypted by anyone.',
    keyMaterial,
    prefs: await session.getPrefs(),
    intendedUseAck: await session.getAckForBackup(),
    tables,
  };
  await session.store.appendAudit({
    entity: 'backup',
    entityId: file.createdAt,
    action: 'export',
    diff: { rows: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v?.length ?? 0])) },
  });
  const stamp = file.createdAt.slice(0, 16).replace(/\D/g, '');
  return { filename: `preceptor-backup-${stamp}.json`, json: JSON.stringify(file) };
}

function parseBackup(json: string): BackupFile {
  let f: BackupFile;
  try {
    f = JSON.parse(json) as BackupFile;
  } catch {
    throw new BackupFormatError('This file is not a PRECEPTOR backup (it is not valid JSON).');
  }
  if (f?.format !== BACKUP_FORMAT) throw new BackupFormatError('This file is not a PRECEPTOR backup.');
  if (!READABLE_FORMAT_VERSIONS.includes(f.formatVersion)) {
    throw new BackupFormatError(`Unsupported backup format version ${String(f.formatVersion)}.`);
  }
  if (!f.keyMaterial || typeof f.tables !== 'object') throw new BackupFormatError('The backup is incomplete.');
  return f;
}

async function isEmptyInstallation(session: Session): Promise<boolean> {
  if (await session.getKeyMaterial()) return false;
  for (const t of ENCRYPTED_TABLES) if ((await session.db.encryptedTable(t).count()) > 0) return false;
  return true;
}

/**
 * Restores a backup into an empty installation. Every row is decrypted and
 * integrity-checked before anything is written; a single bad row aborts the
 * whole restore. Throws WrongPassphraseError for a wrong passphrase.
 */
export async function restoreBackup(session: Session, json: string, passphrase: string): Promise<{ rows: number }> {
  if (!(await isEmptyInstallation(session))) {
    throw new IntegrityError('A backup can only be restored into an empty installation.');
  }
  const f = parseBackup(json);
  const key = await unwrapDataKey(passphrase, f.keyMaterial);

  const restored: { table: EncryptedTableName; rows: EncryptedRow[] }[] = [];
  let count = 0;
  for (const t of BACKED_UP_TABLES) {
    const rows = (f.tables[t] ?? []).map(({ iv, ct, ...index }) => ({
      ...index,
      iv: fromBase64(iv),
      ct: fromBase64(ct).buffer as ArrayBuffer,
    }));
    for (const r of rows) {
      const { iv, ct, ...index } = r;
      await openBytes(key, { iv, ct }, rowAad(t, index)); // authenticates every row; throws DecryptionError on any tampering
    }
    restored.push({ table: t, rows });
    count += rows.length;
  }
  await session.db.transaction(
    'rw',
    [session.db.meta, ...BACKED_UP_TABLES.map((t) => session.db.encryptedTable(t))],
    async () => {
      for (const { table, rows } of restored) if (rows.length) await session.db.encryptedTable(table).bulkAdd(rows);
      await session.db.meta.put({ key: 'keyMaterial', value: f.keyMaterial });
      await session.db.meta.put({ key: 'prefs', value: f.prefs });
      // The intended-use acknowledgement given on this device is kept, not replaced by the backup's.
    },
  );
  await session.adoptKey(key);
  await session.store.appendAudit({
    entity: 'backup',
    entityId: f.createdAt,
    action: 'restore',
    diff: { backupCreatedAt: f.createdAt, appVersion: f.appVersion, rows: count },
  });
  return { rows: count };
}

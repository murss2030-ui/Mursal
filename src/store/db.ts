/**
 * IndexedDB schema (Dexie) and the append-only guarantee.
 *
 * Every table except `meta` holds encrypted rows: a few opaque index fields in
 * the clear (random ids, version numbers) and the record itself as AES-GCM
 * ciphertext. `meta` holds only non-secret material: the KDF salt, the wrapped
 * data key, the intended-use acknowledgement and display preferences.
 *
 * Append-only tables reject every write except `add` at the database-core
 * level, so no code path — including a future bug — can overwrite or delete a
 * timeline entry, a record version or an audit event. `add` itself fails on an
 * existing key, so overwriting by re-adding is impossible too.
 */
import Dexie, { type DBCore, type DBCoreMutateRequest, type Middleware, type Table } from 'dexie';

export interface EncryptedRow {
  id: string;
  /** Plain index fields. All of them are bound into the ciphertext's AAD. */
  caseId?: string;
  entityId?: string;
  version?: number;
  supersedesEntryId?: string;
  iv: Uint8Array;
  ct: ArrayBuffer;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export const APPEND_ONLY_TABLES = [
  'rotations',
  'cases',
  'identifiers',
  'timeline',
  'formDrafts',
  'audit',
  'attachments',
  'tasks',
  'items',
  'extractions',
  'analyses',
  'calcResults',
] as const;
/**
 * Source-document content. Rows can be added and, only to purge a document
 * (e.g. a page found to show an identifier), deleted — never overwritten. The
 * attachment's metadata and the removal itself stay in append-only tables.
 */
export const PURGEABLE_TABLES = ['blobs'] as const;
/** `lookups` caches open-data answers (e.g. RxNorm) with their retrieval date (Section 19). */
export const MUTABLE_ENCRYPTED_TABLES = ['settings', 'uiDrafts', 'lookups'] as const;
export const ENCRYPTED_TABLES = [...APPEND_ONLY_TABLES, ...PURGEABLE_TABLES, ...MUTABLE_ENCRYPTED_TABLES] as const;
export type EncryptedTableName = (typeof ENCRYPTED_TABLES)[number];
export type AppendOnlyTableName = (typeof APPEND_ONLY_TABLES)[number];

export class AppendOnlyViolationError extends Error {
  constructor(table: string, op: string) {
    super(`"${table}" is append-only: "${op}" is not permitted. Corrections are new records that supersede old ones.`);
    this.name = 'AppendOnlyViolationError';
  }
}

export class PurgeOnlyViolationError extends Error {
  constructor(table: string, op: string) {
    super(`"${table}" rows can be added or purged, never overwritten: "${op}" is not permitted.`);
    this.name = 'PurgeOnlyViolationError';
  }
}

const appendOnlyMiddleware: Middleware<DBCore> = {
  stack: 'dbcore',
  name: 'preceptor-append-only',
  create(down) {
    const guarded = new Set<string>(APPEND_ONLY_TABLES);
    const purgeable = new Set<string>(PURGEABLE_TABLES);
    return {
      ...down,
      table(name) {
        const table = down.table(name);
        if (guarded.has(name)) {
          return {
            ...table,
            mutate(req: DBCoreMutateRequest) {
              if (req.type !== 'add') return Promise.reject(new AppendOnlyViolationError(name, req.type));
              return table.mutate(req);
            },
          };
        }
        if (purgeable.has(name)) {
          return {
            ...table,
            mutate(req: DBCoreMutateRequest) {
              // Explicit keys only: a range delete (clear) could purge content without its audit record.
              if (req.type === 'add' || req.type === 'delete') return table.mutate(req);
              return Promise.reject(new PurgeOnlyViolationError(name, req.type));
            },
          };
        }
        return table;
      },
    };
  },
};

export class PreceptorDB extends Dexie {
  meta!: Table<MetaRow, string>;
  settings!: Table<EncryptedRow, string>;
  uiDrafts!: Table<EncryptedRow, string>;
  rotations!: Table<EncryptedRow, string>;
  cases!: Table<EncryptedRow, string>;
  identifiers!: Table<EncryptedRow, string>;
  timeline!: Table<EncryptedRow, string>;
  formDrafts!: Table<EncryptedRow, string>;
  audit!: Table<EncryptedRow, string>;
  attachments!: Table<EncryptedRow, string>;
  blobs!: Table<EncryptedRow, string>;
  tasks!: Table<EncryptedRow, string>;
  items!: Table<EncryptedRow, string>;
  extractions!: Table<EncryptedRow, string>;
  analyses!: Table<EncryptedRow, string>;
  lookups!: Table<EncryptedRow, string>;
  calcResults!: Table<EncryptedRow, string>;

  constructor(name = 'preceptor') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      settings: 'id',
      uiDrafts: 'id',
      // Versioned records: id = `${entityId}@${version}`; one row per version.
      rotations: 'id, entityId',
      cases: 'id, entityId',
      identifiers: 'id, entityId',
      formDrafts: 'id, entityId',
      // Unique index: an entry can be superseded at most once, so corrections form a single chain.
      timeline: 'id, caseId, &supersedesEntryId',
      audit: 'id, caseId',
    });
    // Revision 2 of M1 (owner's change request): the patient file and the clinical modules.
    this.version(2).stores({
      attachments: 'id, entityId, caseId',
      blobs: 'id, caseId',
      tasks: 'id, entityId, caseId',
      items: 'id, entityId, caseId',
    });
    // M3: what the model read (extraction runs) and its case analyses, both versioned; the open-data cache.
    this.version(3).stores({
      extractions: 'id, entityId, caseId',
      analyses: 'id, entityId, caseId',
      lookups: 'id',
    });
    // M2: calculation results (append-only; a recomputation is a new row).
    this.version(4).stores({
      calcResults: 'id, caseId',
    });
    this.use(appendOnlyMiddleware);
  }

  encryptedTable(name: EncryptedTableName): Table<EncryptedRow, string> {
    return this.table(name) as Table<EncryptedRow, string>;
  }
}

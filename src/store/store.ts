/**
 * The encrypted repository. Every read decrypts; every write encrypts first
 * and then commits the record and its audit event in one transaction, so a
 * record can never exist without its audit trail (or the reverse).
 *
 * Web Crypto calls are never awaited inside an IndexedDB transaction (that
 * would let the transaction auto-commit early); rows are sealed beforehand
 * and the transaction only performs synchronous-in-spirit Dexie operations.
 */
import { open, seal } from '../crypto/crypto';
import { localToday } from '../domain/dates';
import type { Errors } from '../domain/entries';
import type {
  AuditEvent,
  Case,
  CaseIdentifiers,
  Correction,
  EntryType,
  FormDraft,
  PayloadMap,
  Rotation,
  TimelineEntry,
  TraineeSettings,
  Versioned,
} from '../domain/types';
import { isValidHospitalDay, isValidTimeOfDay } from '../domain/dates';
import { indexTimeline, deriveMedCourses } from '../domain/timeline';
import {
  ValidationError,
  validateDemographics,
  validateNewCase,
  validateRotation,
  type CaseIdentifiersInput,
  type CasePatch,
  type NewCaseInput,
  type RotationInput,
} from '../domain/validation';
import { M1_MANUAL_ENTRY_TYPES } from '../domain/types';
import {
  APPEND_ONLY_TABLES,
  type EncryptedRow,
  type EncryptedTableName,
  type PreceptorDB,
} from './db';

export class LockedError extends Error {
  constructor() {
    super('PRECEPTOR is locked. Unlock with your passphrase to continue.');
    this.name = 'LockedError';
  }
}

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

type RowIndex = Omit<EncryptedRow, 'iv' | 'ct'>;

/** Binds a ciphertext to its table and to every plaintext index field of its row. */
export function rowAad(table: string, r: RowIndex): string {
  return [
    table,
    r.id,
    r.caseId ?? '',
    r.entityId ?? '',
    r.version === undefined ? '' : String(r.version),
    r.supersedesEntryId ?? '',
  ].join('\u0000');
}

function stripUndefined<T extends object>(o: T): T {
  const out = { ...o };
  for (const k of Object.keys(out) as (keyof T)[]) if (out[k] === undefined) delete out[k];
  return out;
}

function isConstraintError(e: unknown): boolean {
  const name = (e as { name?: string; inner?: { name?: string } })?.name;
  const inner = (e as { inner?: { name?: string } })?.inner?.name;
  return name === 'ConstraintError' || inner === 'ConstraintError';
}

export interface NewEntryInput<K extends EntryType = EntryType> {
  type: K;
  hospitalDay: number;
  timeOfDay?: string;
  payload: PayloadMap[K];
}

export type CorrectionInput =
  | { kind: 'amend'; reason: string; hospitalDay: number; timeOfDay?: string; payload: TimelineEntry['payload'] }
  | { kind: 'retract'; reason: string };

export interface StoreOptions {
  now?: () => Date;
  uuid?: () => string;
  random?: () => number;
}

type AuditInput = Omit<AuditEvent, 'id' | 'at' | 'actor'> & { actor?: AuditEvent['actor'] };

const APPEND_ONLY = new Set<string>(APPEND_ONLY_TABLES);

export class Store {
  /** Decrypted immutable rows, keyed `${table}:${id}`. Cleared on lock. */
  private readonly cache = new Map<string, unknown>();
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly random: () => number;

  constructor(
    readonly db: PreceptorDB,
    private readonly getKey: () => CryptoKey | null,
    opts: StoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.uuid = opts.uuid ?? (() => crypto.randomUUID());
    this.random = opts.random ?? Math.random;
  }

  private key(): CryptoKey {
    const k = this.getKey();
    if (!k) throw new LockedError();
    return k;
  }

  clearCache(): void {
    this.cache.clear();
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  today(): string {
    return localToday(this.now());
  }

  // ------------------------------------------------------------------ sealing

  async sealRow(table: EncryptedTableName, index: RowIndex, value: unknown): Promise<EncryptedRow> {
    const clean = stripUndefined(index);
    const s = await seal(this.key(), value, rowAad(table, clean));
    return { ...clean, iv: s.iv, ct: s.ct };
  }

  async openRow<T>(table: EncryptedTableName, row: EncryptedRow): Promise<T> {
    const ck = `${table}:${row.id}`;
    const immutable = APPEND_ONLY.has(table);
    if (immutable && this.cache.has(ck)) return this.cache.get(ck) as T;
    const { iv, ct, ...index } = row;
    const value = await open<T>(this.key(), { iv, ct }, rowAad(table, index));
    if (immutable) this.cache.set(ck, value);
    return value;
  }

  async openRows<T>(table: EncryptedTableName, rows: EncryptedRow[]): Promise<T[]> {
    return Promise.all(rows.map((r) => this.openRow<T>(table, r)));
  }

  private async auditRow(input: AuditInput): Promise<EncryptedRow> {
    const ev: AuditEvent = stripUndefined({ id: this.uuid(), at: this.nowIso(), actor: 'user', ...input });
    return this.sealRow('audit', { id: ev.id, caseId: ev.caseId }, ev);
  }

  /** Append a stand-alone audit event (e.g. intended-use acknowledgement, backup export). */
  async appendAudit(input: AuditInput): Promise<void> {
    const row = await this.auditRow(input);
    await this.db.audit.add(row);
  }

  // ------------------------------------------------------------------ versioned records

  private async versionRows(table: EncryptedTableName, entityId: string): Promise<EncryptedRow[]> {
    const rows = await this.db.encryptedTable(table).where('entityId').equals(entityId).toArray();
    return rows.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
  }

  async history<T extends Versioned>(table: 'rotations' | 'cases' | 'identifiers' | 'formDrafts', entityId: string): Promise<T[]> {
    return this.openRows<T>(table, await this.versionRows(table, entityId));
  }

  async latest<T extends Versioned>(
    table: 'rotations' | 'cases' | 'identifiers' | 'formDrafts',
    entityId: string,
  ): Promise<T | undefined> {
    const rows = await this.versionRows(table, entityId);
    const last = rows[rows.length - 1];
    return last ? this.openRow<T>(table, last) : undefined;
  }

  /** All versions in a set of raw rows, oldest first. */
  async decodeVersions<T extends Versioned>(
    table: 'rotations' | 'cases' | 'identifiers' | 'formDrafts',
    rows: EncryptedRow[],
  ): Promise<T[]> {
    return this.openRows<T>(table, [...rows].sort((a, b) => (a.version ?? 0) - (b.version ?? 0)));
  }

  /** Latest version of every entity in a versioned table. */
  async latestOfAll<T extends Versioned>(table: 'rotations' | 'cases'): Promise<T[]> {
    return this.decodeLatestOfAll<T>(table, await this.db.encryptedTable(table).toArray());
  }

  async decodeLatestOfAll<T extends Versioned>(table: 'rotations' | 'cases', rows: EncryptedRow[]): Promise<T[]> {
    const newest = new Map<string, EncryptedRow>();
    for (const r of rows) {
      const cur = newest.get(r.entityId!);
      if (!cur || (r.version ?? 0) > (cur.version ?? 0)) newest.set(r.entityId!, r);
    }
    return this.openRows<T>(table, [...newest.values()]);
  }

  /**
   * Append version n+1. Optimistic concurrency: the row id embeds the version,
   * so a concurrent writer that took the same number makes `add` fail and we retry.
   */
  private async writeVersion<T extends Versioned>(
    table: 'rotations' | 'cases' | 'identifiers' | 'formDrafts',
    entityId: string,
    build: (prev: T | undefined, version: number, at: string) => T,
    audit: (prev: T | undefined, next: T) => AuditInput,
    extra: EncryptedRow[] = [],
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const prev = await this.latest<T>(table, entityId);
      const version = (prev?.version ?? 0) + 1;
      const next = stripUndefined(build(prev, version, this.nowIso()));
      const row = await this.sealRow(table, { id: `${entityId}@${version}`, entityId, version }, next);
      const auditRow = await this.auditRow(audit(prev, next));
      try {
        await this.db.transaction('rw', [this.db.encryptedTable(table), this.db.audit], async () => {
          await this.db.encryptedTable(table).add(row);
          await this.db.audit.add(auditRow);
          for (const r of extra) await this.db.audit.add(r);
        });
        return next;
      } catch (e) {
        if (isConstraintError(e) && attempt < 2) continue;
        throw e;
      }
    }
  }

  // ------------------------------------------------------------------ rotations

  async createRotation(input: RotationInput): Promise<Rotation> {
    const errors = validateRotation(input);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const id = this.uuid();
    return this.writeVersion<Rotation>(
      'rotations',
      id,
      (_prev, version, at) => ({
        id,
        department: input.department,
        departmentOther: input.department === 'other' ? input.departmentOther?.trim() : undefined,
        startDate: input.startDate,
        endDate: input.endDate,
        competencies: [...input.competencies],
        goals: input.goals?.trim() || undefined,
        createdAt: at,
        version,
        versionCreatedAt: at,
      }),
      (_p, next) => ({ entity: 'rotation', entityId: id, action: 'create', diff: { after: next } }),
    );
  }

  async updateRotation(id: string, input: RotationInput, reason: string): Promise<Rotation> {
    const errors: Errors = validateRotation(input);
    if (!reason.trim()) errors.changeReason = 'required';
    if (Object.keys(errors).length) throw new ValidationError(errors);
    return this.writeVersion<Rotation>(
      'rotations',
      id,
      (prev, version, at) => {
        if (!prev) throw new IntegrityError(`Rotation ${id} does not exist.`);
        return {
          ...prev,
          department: input.department,
          departmentOther: input.department === 'other' ? input.departmentOther?.trim() : undefined,
          startDate: input.startDate,
          endDate: input.endDate,
          competencies: [...input.competencies],
          goals: input.goals?.trim() || undefined,
          version,
          versionCreatedAt: at,
          changeReason: reason.trim(),
        };
      },
      (prev, next) => ({ entity: 'rotation', entityId: id, action: 'update', diff: { before: prev, after: next } }),
    );
  }

  listRotations(): Promise<Rotation[]> {
    return this.latestOfAll<Rotation>('rotations');
  }

  // ------------------------------------------------------------------ cases

  private async newCaseId(): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const digits = i < 100 ? 4 : 6;
      const n = Math.floor(this.random() * 9 * 10 ** (digits - 1)) + 10 ** (digits - 1);
      const id = `CASE-${n}`;
      if ((await this.db.cases.where('entityId').equals(id).count()) === 0) return id;
    }
    throw new Error('Could not allocate a case id.');
  }

  async createCase(input: NewCaseInput): Promise<Case> {
    const errors = validateNewCase(input, this.today());
    if (!errors.rotationId) {
      const rot = await this.latest<Rotation>('rotations', input.rotationId);
      if (!rot) errors.rotationId = 'invalidChoice';
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const id = await this.newCaseId();
    const at = this.nowIso();
    const c: Case = stripUndefined({
      id,
      kind: input.kind,
      rotationId: input.rotationId,
      deidentified: true as const,
      demographics: stripUndefined({ ageYears: input.ageYears, sex: input.sex, heightCm: input.heightCm }),
      admissionDay0: input.admissionDay0,
      status: 'active' as const,
      createdAt: at,
      ward: input.ward?.trim() || undefined,
      syntheticDataAttestedAt: input.syntheticDataAttested ? at : undefined,
      version: 1,
      versionCreatedAt: at,
    });
    const caseRow = await this.sealRow('cases', { id: `${id}@1`, entityId: id, version: 1 }, c);
    const rows: { table: 'cases' | 'identifiers' | 'audit'; row: EncryptedRow }[] = [
      { table: 'cases', row: caseRow },
      { table: 'audit', row: await this.auditRow({ entity: 'case', entityId: id, caseId: id, action: 'create', diff: { after: c } }) },
    ];
    const ids = cleanIdentifiers(input.identifiers);
    if (input.kind === 'clinical' && ids) {
      const idRec: CaseIdentifiers = { caseId: id, ...ids, version: 1, versionCreatedAt: at };
      rows.push({ table: 'identifiers', row: await this.sealRow('identifiers', { id: `${id}@1`, entityId: id, version: 1 }, idRec) });
      rows.push({
        table: 'audit',
        row: await this.auditRow({
          entity: 'identifiers',
          entityId: id,
          caseId: id,
          action: 'create',
          // Identifier values are kept out of the audit log; only which fields were set.
          diff: { fieldsSet: Object.keys(ids) },
        }),
      });
    }
    await this.db.transaction('rw', [this.db.cases, this.db.identifiers, this.db.audit], async () => {
      for (const { table, row } of rows) await this.db.encryptedTable(table).add(row);
    });
    return c;
  }

  async updateCase(caseId: string, patch: CasePatch, reason: string): Promise<Case> {
    const errors: Errors = {};
    if (!reason.trim()) errors.changeReason = 'required';
    Object.assign(
      errors,
      validateDemographics(
        {
          ageYears: patch.ageYears,
          sex: patch.sex,
          heightCm: patch.heightCm,
          admissionDay0: patch.admissionDay0,
        },
        this.today(),
      ),
    );
    if (patch.rotationId !== undefined && !(await this.latest<Rotation>('rotations', patch.rotationId))) {
      errors.rotationId = 'invalidChoice';
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);

    return this.writeVersion<Case>(
      'cases',
      caseId,
      (prev, version, at) => {
        if (!prev) throw new IntegrityError(`Case ${caseId} does not exist.`);
        const next: Case = {
          ...prev,
          demographics: { ...prev.demographics },
          version,
          versionCreatedAt: at,
          changeReason: reason.trim(),
        };
        if (patch.rotationId !== undefined) next.rotationId = patch.rotationId;
        if (patch.ageYears !== undefined) next.demographics.ageYears = patch.ageYears;
        if (patch.sex !== undefined) next.demographics.sex = patch.sex;
        if (patch.heightCm === null) delete next.demographics.heightCm;
        else if (patch.heightCm !== undefined) next.demographics.heightCm = patch.heightCm;
        if (patch.admissionDay0 !== undefined) next.admissionDay0 = patch.admissionDay0;
        if (patch.ward === null) delete next.ward;
        else if (patch.ward !== undefined) next.ward = patch.ward.trim() || undefined;
        if (patch.status !== undefined) next.status = patch.status;
        if (patch.dischargeDate === null) delete next.dischargeDate;
        else if (patch.dischargeDate !== undefined) next.dischargeDate = patch.dischargeDate;

        const e: Errors = {};
        if (next.status === 'discharged') {
          if (!next.dischargeDate) e.dischargeDate = 'required';
          else if (next.dischargeDate < next.admissionDay0) e.dischargeDate = 'range';
          else if (next.dischargeDate > this.today()) e.dischargeDate = 'range';
        }
        if (next.status === 'active') delete next.dischargeDate;
        if (Object.keys(e).length) throw new ValidationError(e);
        return next;
      },
      (prev, next) => ({ entity: 'case', entityId: caseId, caseId, action: 'update', diff: { before: prev, after: next } }),
    );
  }

  getCase(caseId: string): Promise<Case | undefined> {
    return this.latest<Case>('cases', caseId);
  }

  listCases(): Promise<Case[]> {
    return this.latestOfAll<Case>('cases');
  }

  // ------------------------------------------------------------------ identifiers (clinical only)

  async setIdentifiers(caseId: string, input: CaseIdentifiersInput, reason: string): Promise<CaseIdentifiers> {
    const c = await this.getCase(caseId);
    if (!c) throw new IntegrityError(`Case ${caseId} does not exist.`);
    if (c.kind !== 'clinical') {
      throw new IntegrityError('A Teaching Case never has name or MRN fields.');
    }
    const ids = cleanIdentifiers(input) ?? {};
    return this.writeVersion<CaseIdentifiers>(
      'identifiers',
      caseId,
      (prev, version, at) => {
        if (prev && !reason.trim()) throw new ValidationError({ changeReason: 'required' });
        return { caseId, ...ids, version, versionCreatedAt: at, changeReason: prev ? reason.trim() : undefined };
      },
      (prev) => ({
        entity: 'identifiers',
        entityId: caseId,
        caseId,
        action: prev ? 'update' : 'create',
        diff: { fieldsChanged: changedIdentifierFields(prev, ids) },
      }),
    );
  }

  getIdentifiers(caseId: string): Promise<CaseIdentifiers | undefined> {
    return this.latest<CaseIdentifiers>('identifiers', caseId);
  }

  // ------------------------------------------------------------------ timeline

  rawEntries(caseId: string): Promise<EncryptedRow[]> {
    return this.db.timeline.where('caseId').equals(caseId).toArray();
  }

  async listEntries(caseId: string): Promise<TimelineEntry[]> {
    return this.decodeEntries(await this.rawEntries(caseId));
  }

  async decodeEntries(rows: EncryptedRow[]): Promise<TimelineEntry[]> {
    const entries = await this.openRows<TimelineEntry>('timeline', rows);
    return entries.sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
  }

  private assertEntryMeta(hospitalDay: number, timeOfDay: string | undefined): void {
    const e: Errors = {};
    if (!isValidHospitalDay(hospitalDay)) e.hospitalDay = 'hospitalDay';
    if (timeOfDay !== undefined && !isValidTimeOfDay(timeOfDay)) e.timeOfDay = 'time';
    if (Object.keys(e).length) throw new ValidationError(e);
  }

  private async writableCase(caseId: string): Promise<Case> {
    const c = await this.getCase(caseId);
    if (!c) throw new IntegrityError(`Case ${caseId} does not exist.`);
    if (c.status === 'archived') throw new IntegrityError('This case is archived and read-only.');
    return c;
  }

  async addEntry<K extends EntryType>(caseId: string, input: NewEntryInput<K>): Promise<TimelineEntry> {
    await this.writableCase(caseId);
    this.assertEntryMeta(input.hospitalDay, input.timeOfDay);
    const manual = (M1_MANUAL_ENTRY_TYPES as readonly string[]).includes(input.type);
    if (!manual && input.type !== 'med_change' && input.type !== 'med_stop') {
      throw new ValidationError({ type: 'notInM1' });
    }
    if (input.type === 'med_change' || input.type === 'med_stop') {
      const medId = (input.payload as PayloadMap['med_change']).medId;
      const courses = deriveMedCourses(indexTimeline(await this.listEntries(caseId)).current);
      const course = courses.find((c) => c.medId === medId);
      if (!course) throw new IntegrityError('That medication course does not exist in this case.');
      if (course.status !== 'active') throw new IntegrityError('That medication course has already been stopped.');
    }
    const entry = stripUndefined({
      id: this.uuid(),
      caseId,
      hospitalDay: input.hospitalDay,
      timeOfDay: input.timeOfDay,
      recordedAt: this.nowIso(),
      author: 'user' as const,
      type: input.type,
      payload: input.payload,
      unit: unitOf(input.type, input.payload),
      provenance: 'user_entered' as const,
    }) as TimelineEntry;
    const row = await this.sealRow('timeline', { id: entry.id, caseId }, entry);
    const auditRow = await this.auditRow({
      entity: 'timeline_entry',
      entityId: entry.id,
      caseId,
      action: 'create',
      diff: { after: entry },
    });
    await this.db.transaction('rw', [this.db.timeline, this.db.audit], async () => {
      await this.db.timeline.add(row);
      await this.db.audit.add(auditRow);
    });
    return entry;
  }

  /**
   * Record a correction: a new entry that supersedes `originalId`. The original
   * is never modified and stays readable. An entry can be superseded once, so
   * corrections always form a single chain; correct the latest version.
   */
  async correctEntry(caseId: string, originalId: string, input: CorrectionInput): Promise<TimelineEntry> {
    await this.writableCase(caseId);
    if (!input.reason.trim()) throw new ValidationError({ reason: 'required' });
    const origRow = await this.db.timeline.get(originalId);
    if (!origRow || origRow.caseId !== caseId) throw new IntegrityError('The entry to correct does not exist in this case.');
    const original = await this.openRow<TimelineEntry>('timeline', origRow);
    if ((await this.db.timeline.where('supersedesEntryId').equals(originalId).count()) > 0) {
      throw new IntegrityError('This entry has already been corrected. Correct its latest version instead.');
    }

    let hospitalDay = original.hospitalDay;
    let timeOfDay = original.timeOfDay;
    let payload = original.payload;
    if (input.kind === 'amend') {
      this.assertEntryMeta(input.hospitalDay, input.timeOfDay);
      hospitalDay = input.hospitalDay;
      timeOfDay = input.timeOfDay;
      payload = input.payload;
      assertSameThread(original, payload);
    }
    const correction: Correction = { kind: input.kind, reason: input.reason.trim() };
    const entry = stripUndefined({
      id: this.uuid(),
      caseId,
      hospitalDay,
      timeOfDay,
      recordedAt: this.nowIso(),
      author: 'user' as const,
      type: original.type,
      payload,
      unit: unitOf(original.type, payload),
      provenance: 'user_entered' as const,
      supersedesEntryId: originalId,
      correction,
    }) as TimelineEntry;
    const row = await this.sealRow('timeline', { id: entry.id, caseId, supersedesEntryId: originalId }, entry);
    const auditRow = await this.auditRow({
      entity: 'timeline_entry',
      entityId: entry.id,
      caseId,
      action: input.kind === 'retract' ? 'retract' : 'correct',
      diff: {
        supersedesEntryId: originalId,
        reason: correction.reason,
        before: { hospitalDay: original.hospitalDay, timeOfDay: original.timeOfDay, payload: original.payload },
        after: { hospitalDay, timeOfDay, payload },
      },
    });
    try {
      await this.db.transaction('rw', [this.db.timeline, this.db.audit], async () => {
        await this.db.timeline.add(row); // the unique index on supersedesEntryId rejects a second correction
        await this.db.audit.add(auditRow);
      });
    } catch (e) {
      if (isConstraintError(e)) {
        throw new IntegrityError('This entry has already been corrected. Correct its latest version instead.');
      }
      throw e;
    }
    return entry;
  }

  // ------------------------------------------------------------------ department form drafts

  async saveFormDraft(caseId: string, fields: Record<string, string>): Promise<FormDraft> {
    await this.writableCase(caseId);
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      const t = v.trim();
      if (t) clean[k] = t;
    }
    return this.writeVersion<FormDraft>(
      'formDrafts',
      caseId,
      (_prev, version, at) => ({ caseId, fields: clean, version, versionCreatedAt: at }),
      (prev, next) => {
        const changed: Record<string, { before?: string; after?: string }> = {};
        const keys = new Set([...Object.keys(prev?.fields ?? {}), ...Object.keys(next.fields)]);
        for (const k of keys) {
          const b = prev?.fields[k];
          const a = next.fields[k];
          if (a !== b) changed[k] = stripUndefined({ before: b, after: a });
        }
        return { entity: 'form_draft', entityId: caseId, caseId, action: prev ? 'update' : 'create', diff: { changed } };
      },
    );
  }

  getFormDraft(caseId: string): Promise<FormDraft | undefined> {
    return this.latest<FormDraft>('formDrafts', caseId);
  }

  // ------------------------------------------------------------------ settings (mutable, encrypted, audited)

  async getTraineeSettings(): Promise<TraineeSettings> {
    const row = await this.db.settings.get('trainee');
    return row ? this.openRow<TraineeSettings>('settings', row) : {};
  }

  async updateTraineeSettings(next: TraineeSettings): Promise<TraineeSettings> {
    const prev = await this.getTraineeSettings();
    const clean = stripUndefined({ traineeName: next.traineeName?.trim() || undefined, programme: next.programme?.trim() || undefined });
    const row = await this.sealRow('settings', { id: 'trainee' }, clean);
    const auditRow = await this.auditRow({ entity: 'settings', entityId: 'trainee', action: 'update', diff: { before: prev, after: clean } });
    await this.db.transaction('rw', [this.db.settings, this.db.audit], async () => {
      await this.db.settings.put(row);
      await this.db.audit.add(auditRow);
    });
    return clean;
  }

  // ------------------------------------------------------------------ encrypted working drafts (interruption survival)

  async putUiDraft(id: string, values: unknown): Promise<void> {
    await this.db.uiDrafts.put(await this.sealRow('uiDrafts', { id }, values));
  }

  async getUiDraft<T>(id: string): Promise<T | undefined> {
    const row = await this.db.uiDrafts.get(id);
    return row ? this.openRow<T>('uiDrafts', row) : undefined;
  }

  async deleteUiDraft(id: string): Promise<void> {
    await this.db.uiDrafts.delete(id);
  }

  // ------------------------------------------------------------------ audit

  rawAudit(caseId?: string): Promise<EncryptedRow[]> {
    return caseId ? this.db.audit.where('caseId').equals(caseId).toArray() : this.db.audit.toArray();
  }

  async decodeAudit(rows: EncryptedRow[]): Promise<AuditEvent[]> {
    const events = await this.openRows<AuditEvent>('audit', rows);
    return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }

  async listAudit(caseId?: string): Promise<AuditEvent[]> {
    return this.decodeAudit(await this.rawAudit(caseId));
  }
}

// ------------------------------------------------------------------ helpers

function cleanIdentifiers(i: CaseIdentifiersInput | undefined): CaseIdentifiersInput | undefined {
  if (!i) return undefined;
  const out: CaseIdentifiersInput = stripUndefined({
    patientName: i.patientName?.trim() || undefined,
    mrn: i.mrn?.trim() || undefined,
    roomBed: i.roomBed?.trim() || undefined,
    consultantName: i.consultantName?.trim() || undefined,
  });
  return Object.keys(out).length ? out : undefined;
}

function changedIdentifierFields(prev: CaseIdentifiers | undefined, next: CaseIdentifiersInput): string[] {
  const keys: (keyof CaseIdentifiersInput)[] = ['patientName', 'mrn', 'roomBed', 'consultantName'];
  return keys.filter((k) => (prev?.[k] ?? undefined) !== (next[k] ?? undefined));
}

function unitOf(type: EntryType, payload: unknown): string | undefined {
  if (type === 'lab' || type === 'vital') {
    const u = (payload as { unit?: string }).unit;
    return u && u !== 'unitless' ? u : undefined;
  }
  if (type === 'weight') return 'kg';
  return undefined;
}

/** A correction may fix values, but never move an entry to another medication course or problem. */
function assertSameThread(original: TimelineEntry, payload: TimelineEntry['payload']): void {
  const p = payload as { medId?: string; problemId?: string; category?: string };
  switch (original.type) {
    case 'med_start':
    case 'med_change':
    case 'med_stop':
      if (p.medId !== original.payload.medId) throw new IntegrityError('A correction cannot change the medication course.');
      break;
    case 'note': {
      const op = original.payload;
      if (op.category !== p.category && (op.category === 'problem' || p.category === 'problem')) {
        throw new IntegrityError('A correction cannot turn a problem entry into another kind of note.');
      }
      if (op.category === 'problem' && p.problemId !== op.problemId) {
        throw new IntegrityError('A correction cannot change which problem an entry belongs to.');
      }
      break;
    }
    default:
      break;
  }
}


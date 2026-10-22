/**
 * The encrypted repository. Every read decrypts; every write encrypts first
 * and then commits the record and its audit event in one transaction, so a
 * record can never exist without its audit trail (or the reverse).
 *
 * Web Crypto calls are never awaited inside an IndexedDB transaction (that
 * would let the transaction auto-commit early); rows are sealed beforehand
 * and the transaction only performs synchronous-in-spirit Dexie operations.
 */
import { open, openBytes, seal, sealBytes } from '../crypto/crypto';
import { localToday } from '../domain/dates';
import { buildEntryMeta, buildPayload, type Errors } from '../domain/entries';
import type {
  Attachment,
  AttachmentOrigin,
  AuditEvent,
  Case,
  CaseIdentifiers,
  Correction,
  EntryType,
  CaseAnalysis,
  ExtractionRun,
  FieldDecision,
  SuggestionDecision,
  FormDraft,
  PayloadMap,
  RegisterId,
  RegisterItem,
  Rotation,
  SourceDocType,
  TaskRecord,
  TimelineEntry,
  TraineeSettings,
  Versioned,
  AlertAck,
  AlertFiring,
  CausalityAssessment,
  CardDecision,
  CardReview,
} from '../domain/types';
import { CARD_DECISIONS, COMPETENCY_AREAS, DECISIONS_NEEDING_REASON, mustEdit, REGISTER_IDS, SOURCE_DOC_TYPES } from '../domain/types';
import { claimsValue, claimTargets, parseClaims, parseLinks, researchRefOf } from '../domain/card-data';
import { cardStaleness, contentHash, fromModel, markModelClaims, unverifiedModelClaims, type CardContext } from '../domain/problem-card';
import type { CardClaim } from '../domain/card-data';
import { classificationUnanswered } from '../domain/pcne-coherence';
import { indexVerdicts, passesDraftGate, type ClaimVerification } from '../domain/verdicts';
import { LEARNING_MODES, type LearningRecord } from '../domain/learning';
import { addable, problemHash, researchKey, researchStaleness as researchStalenessOf, type ResearchRun } from '../domain/research';
import { sourceCitation } from '../domain/sources';
import { maySend, normalizeDocumentMeta, type ChunkVector, type DocumentMetaInput, type EvidenceChunk, type LibraryDocument } from '../domain/library';
import { chunkDocument, type PageText } from '../library/chunk';
import { resultCurrency } from '../calc/currency';
import { DRP_RECORD_FIELDS, normalizeItemFields, REGISTERS } from '../domain/workflow/registers';
import { normalizeTaskInput, type TaskInput } from '../domain/workflow/tasks';
export type { TaskInput } from '../domain/workflow/tasks';
import { isValidHospitalDay, isValidTimeOfDay } from '../domain/dates';
import { indexTimeline, deriveMedCourses, deriveProblems } from '../domain/timeline';
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
import { auditView, newInstallId, normalizeAiSettings, type AiSettings, type AiSettingsInput } from '../ai/settings';
import { run as runCalculator } from '../calc/engine';
import { pendingFromRuns } from '../calc/currency';
import { newGatedAnswers, renalDoseReviewGate } from '../calc/gate';
import type { GatherContext, GatherRequest } from '../calc/gather';
import { CALC_BY_ID } from '../calc/registry';
import { assessUmc, scoreNaranjo } from '../rules/causality';
import type { Alert } from '../rules/types';
import {
  normalizeAdjustment,
  normalizeFormulary,
  normalizeOnc,
  normalizeThreshold,
  type AdjustmentRule,
  type FormularyItem,
  type LabThreshold,
  type OncPair,
  type OncResolved,
  type ReferenceKind,
} from '../domain/reference';
import type { CalcInputs, CalcResult, Calculator, CalculatorId, Problem } from '../calc/types';
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
  /** The source document this entry was transcribed from (Section 7, sourceAttachmentId). */
  sourceAttachmentId?: string;
}

export type NewExtractionRun = Omit<ExtractionRun, keyof Versioned | 'id' | 'caseId' | 'runAt'>;

export type NewAnalysis = Omit<CaseAnalysis, keyof Versioned | 'id' | 'caseId' | 'createdAt'>;
/** A research run as the app hands it over: the store adds its id, the card's version, the dates and the problem fingerprint. */
export type NewResearchRun = Omit<ResearchRun, keyof Versioned | 'id' | 'caseId' | 'createdAt' | 'itemVersion'>;

export type SuggestionDecisionInput =
  | { kind: 'accept' }
  | { kind: 'edit'; fields?: Record<string, string>; text?: string }
  | { kind: 'reject'; reason: string }
  /** M4, a drafted Problem Card only: kept as a card with this decision and its reason, out of the form until decided. */
  | { kind: 'needs_evidence' | 'needs_senior_review'; reason: string };

/** One decision on one Problem Card. "Edited" is recorded with the edit itself (updateItem). */
export interface CardReviewInput {
  decision: Exclude<CardDecision, 'edited'>;
  reason?: string;
  /** Decided together with the preceptor: required for the trainee's own cards, except to ask for senior review (owner decision D9). */
  withPreceptor?: boolean;
}

const REVIEW_ACTION: Record<CardDecision, AuditEvent['action']> = {
  accepted: 'accept',
  edited: 'edit',
  rejected: 'reject',
  needs_evidence: 'request_evidence',
  needs_senior_review: 'escalate',
};

/** The timeline entries and calculation results a field cites, as `entry:<id>` / `calc:<id>`. */
function citedRefs(kind: 'links' | 'claims', v: string | undefined): string[] {
  if (kind === 'links') return parseLinks(v).map((l) => `${l.kind}:${l.id}`);
  return parseClaims(v).flatMap((c) => claimTargets(c).map((l) => `${l.kind}:${l.id}`));
}

/** The research statements a claims value cites, as `<run id>:<n>`. */
function researchRefsOf(v: string | undefined): string[] {
  return parseClaims(v).flatMap((c) => (researchRefOf(c) ? [c.ref!] : []));
}

/**
 * Stale when the record differs from what was sent: an entry added,
 * corrected or retracted, or a register row added, edited or retracted —
 * except the rows this analysis's own accepted suggestions created.
 */
export function analysisStale(a: CaseAnalysis, entries: readonly TimelineEntry[], items: readonly RegisterItem[]): boolean {
  const current = indexTimeline(entries).current.map((e) => e.id).sort();
  if (current.join() !== [...a.basedOn.entryIds].sort().join()) return true;
  const own = (r: RegisterItem) => r.origin?.kind === 'suggestion' && r.origin.analysisId === a.id;
  const rows = items.filter((r) => r.status === 'active' && !own(r)).map((r) => `${r.id}@${r.version}`).sort();
  return rows.join() !== [...a.basedOn.items].sort().join();
}

export type FieldDecisionInput =
  | { kind: 'confirm' }
  | { kind: 'correct'; values: Record<string, string>; day?: number; timeOfDay?: string }
  | { kind: 'reject'; reason?: string };

export interface NewAttachmentInput {
  kind: 'text' | 'image';
  docType: SourceDocType;
  title?: string;
  hospitalDay?: number;
  origin: AttachmentOrigin;
  groupId?: string;
  page?: number;
  /** The trainee's confirmation that every identifier was removed. Nothing is stored without it. */
  redactionConfirmed: boolean;
  text?: string;
  image?: { bytes: Uint8Array; width: number; height: number; thumb: Uint8Array };
}

export const MAX_SOURCE_TEXT = 200_000;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_THUMB_BYTES = 200 * 1024;

export type CorrectionInput =
  | { kind: 'amend'; reason: string; hospitalDay: number; timeOfDay?: string; payload: TimelineEntry['payload'] }
  | { kind: 'retract'; reason: string };

export interface StoreOptions {
  now?: () => Date;
  uuid?: () => string;
  random?: () => number;
  /** The calculators and whether each passed its tests (tests inject their own). */
  calculators?: ReadonlyMap<CalculatorId, Calculator>;
}

export type CalculateOutcome =
  | { ok: true; results: CalcResult[] }
  | { ok: false; problems: Problem[]; inputs: CalcInputs; pendingKeys: string[] };

type AuditInput = Omit<AuditEvent, 'id' | 'at' | 'actor'> & { actor?: AuditEvent['actor'] };

/** Tables holding versioned records: one row per version, id `${entityId}@${version}`. */
export type VersionedTable =
  | 'rotations'
  | 'cases'
  | 'identifiers'
  | 'formDrafts'
  | 'attachments'
  | 'tasks'
  | 'items'
  | 'extractions'
  | 'analyses'
  | 'formulary'
  | 'adjustments'
  | 'thresholds'
  | 'oncPairs'
  | 'causality'
  | 'documents'
  | 'researchRuns';

/** Rows never overwritten once written, whose decrypted values may be cached: append-only tables, and a library document's passages and vectors (only ever added or purged). */
const CACHEABLE = new Set<string>([...APPEND_ONLY_TABLES, 'chunks', 'embeddings']);

/** M5: the largest guideline file the library takes, and the most pages it reads. */
export const MAX_DOC_BYTES = 60 * 1024 * 1024;
export const MAX_DOC_PAGES = 1500;

const REFERENCE_TABLE = { formulary: 'formulary', adjustment: 'adjustments', threshold: 'thresholds', onc: 'oncPairs' } as const;
type ReferenceRecord = FormularyItem | AdjustmentRule | LabThreshold | OncPair;

export class Store {
  /** Decrypted immutable rows, keyed `${table}:${id}`. Cleared on lock. */
  private readonly cache = new Map<string, unknown>();
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly random: () => number;
  readonly calculators: ReadonlyMap<CalculatorId, Calculator>;

  constructor(
    readonly db: PreceptorDB,
    private readonly getKey: () => CryptoKey | null,
    opts: StoreOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.uuid = opts.uuid ?? (() => crypto.randomUUID());
    this.random = opts.random ?? Math.random;
    this.calculators = opts.calculators ?? CALC_BY_ID;
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
    const immutable = CACHEABLE.has(table);
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

  private async versionRows(table: VersionedTable, entityId: string): Promise<EncryptedRow[]> {
    const rows = await this.db.encryptedTable(table).where('entityId').equals(entityId).toArray();
    return rows.sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
  }

  async history<T extends Versioned>(table: VersionedTable, entityId: string): Promise<T[]> {
    return this.openRows<T>(table, await this.versionRows(table, entityId));
  }

  async latest<T extends Versioned>(table: VersionedTable, entityId: string): Promise<T | undefined> {
    const rows = await this.versionRows(table, entityId);
    const last = rows[rows.length - 1];
    return last ? this.openRow<T>(table, last) : undefined;
  }

  /** All versions in a set of raw rows, oldest first. */
  async decodeVersions<T extends Versioned>(table: VersionedTable, rows: EncryptedRow[]): Promise<T[]> {
    return this.openRows<T>(table, [...rows].sort((a, b) => (a.version ?? 0) - (b.version ?? 0)));
  }

  /** Latest version of every entity in a versioned table. */
  async latestOfAll<T extends Versioned>(table: 'rotations' | 'cases'): Promise<T[]> {
    return this.decodeLatestOfAll<T>(table, await this.db.encryptedTable(table).toArray());
  }

  /** Latest version of every entity among the given raw rows (e.g. all rows of one case). */
  async decodeLatestOfAll<T extends Versioned>(table: VersionedTable, rows: EncryptedRow[]): Promise<T[]> {
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
   * `also` runs inside the same transaction (e.g. purging a document's content).
   */
  private async writeVersion<T extends Versioned>(
    table: VersionedTable,
    entityId: string,
    build: (prev: T | undefined, version: number, at: string) => T,
    audit: (prev: T | undefined, next: T) => AuditInput,
    opts: { caseId?: string; extraAudit?: EncryptedRow[]; also?: { tables: EncryptedTableName[]; run: () => Promise<void> } } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const prev = await this.latest<T>(table, entityId);
      const version = (prev?.version ?? 0) + 1;
      const next = stripUndefined(build(prev, version, this.nowIso()));
      const row = await this.sealRow(table, { id: `${entityId}@${version}`, entityId, version, caseId: opts.caseId }, next);
      const auditRow = await this.auditRow(audit(prev, next));
      const tables = [table, 'audit', ...(opts.also?.tables ?? [])].map((t) => this.db.encryptedTable(t as EncryptedTableName));
      try {
        await this.db.transaction('rw', tables, async () => {
          await this.db.encryptedTable(table).add(row);
          await this.db.audit.add(auditRow);
          for (const r of opts.extraAudit ?? []) await this.db.audit.add(r);
          if (opts.also) await opts.also.run();
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
    if (input.sourceAttachmentId !== undefined) await this.assertActiveAttachment(caseId, input.sourceAttachmentId);
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
      sourceAttachmentId: input.sourceAttachmentId,
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
      sourceAttachmentId: original.sourceAttachmentId,
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

  // ------------------------------------------------------------------ source documents (the patient file)

  private async assertActiveAttachment(caseId: string, id: string): Promise<Attachment> {
    const a = await this.latest<Attachment>('attachments', id);
    if (!a || a.caseId !== caseId) throw new IntegrityError('That source document does not exist in this case.');
    if (a.status !== 'active') throw new IntegrityError('That source document has been removed.');
    return a;
  }

  /**
   * Store a source document. Nothing is stored unless the trainee has confirmed
   * that every identifier was removed (Section 13): for an image the redaction
   * is already burned into the pixels before this is called.
   */
  async addAttachment(caseId: string, input: NewAttachmentInput): Promise<Attachment> {
    await this.writableCase(caseId);
    const e: Errors = {};
    if (!(SOURCE_DOC_TYPES as readonly string[]).includes(input.docType)) e.docType = 'invalidChoice';
    if (input.hospitalDay !== undefined && !isValidHospitalDay(input.hospitalDay)) e.hospitalDay = 'hospitalDay';
    if (input.title !== undefined && input.title.trim().length > 200) e.title = 'tooLong';
    if (input.redactionConfirmed !== true) e.redactionConfirmed = 'required';
    if (input.page !== undefined && (!Number.isInteger(input.page) || input.page < 1 || input.page > 500)) e.page = 'range';
    let bytes: Uint8Array;
    let thumb: Uint8Array | undefined;
    if (input.kind === 'text') {
      const text = input.text ?? '';
      if (!text.trim()) e.text = 'required';
      else if (text.length > MAX_SOURCE_TEXT) e.text = 'tooLong';
      bytes = new TextEncoder().encode(text);
    } else {
      const img = input.image;
      if (!img || img.bytes.byteLength === 0) e.image = 'required';
      else if (img.bytes.byteLength > MAX_IMAGE_BYTES || img.thumb.byteLength > MAX_THUMB_BYTES) e.image = 'tooLarge';
      else if (!isJpeg(img.bytes) || !isJpeg(img.thumb)) e.image = 'invalidChoice';
      bytes = img?.bytes ?? new Uint8Array();
      thumb = img?.thumb;
    }
    if (Object.keys(e).length) throw new ValidationError(e);

    const id = this.uuid();
    const at = this.nowIso();
    const meta: Attachment = stripUndefined({
      id,
      caseId,
      kind: input.kind,
      mime: input.kind === 'text' ? ('text/plain' as const) : ('image/jpeg' as const),
      docType: input.docType,
      title: input.title?.trim() || undefined,
      hospitalDay: input.hospitalDay,
      origin: input.origin,
      groupId: input.groupId,
      page: input.page,
      width: input.image?.width,
      height: input.image?.height,
      byteLength: bytes.byteLength,
      redacted: true as const,
      redactionConfirmedAt: at,
      status: 'active' as const,
      createdAt: at,
      version: 1,
      versionCreatedAt: at,
    });
    const metaRow = await this.sealRow('attachments', { id: `${id}@1`, entityId: id, version: 1, caseId }, meta);
    const blobRows = [await this.sealBlob(caseId, id, bytes)];
    if (thumb) blobRows.push(await this.sealBlob(caseId, `${id}#thumb`, thumb));
    const auditRow = await this.auditRow({
      entity: 'attachment',
      entityId: id,
      caseId,
      action: 'create',
      // The content itself is never written to the audit log.
      diff: { after: meta },
    });
    await this.db.transaction('rw', [this.db.attachments, this.db.blobs, this.db.audit], async () => {
      await this.db.attachments.add(metaRow);
      for (const r of blobRows) await this.db.blobs.add(r);
      await this.db.audit.add(auditRow);
    });
    return meta;
  }

  private async sealBlob(caseId: string, id: string, bytes: Uint8Array): Promise<EncryptedRow> {
    const index = { id, caseId };
    const sealed = await sealBytes(this.key(), bytes, rowAad('blobs', index));
    return { ...index, iv: sealed.iv, ct: sealed.ct };
  }

  rawAttachments(caseId: string): Promise<EncryptedRow[]> {
    return this.db.attachments.where('caseId').equals(caseId).toArray();
  }

  async listAttachments(caseId: string): Promise<Attachment[]> {
    return this.decodeAttachments(await this.rawAttachments(caseId));
  }

  async decodeAttachments(rows: EncryptedRow[]): Promise<Attachment[]> {
    const list = await this.decodeLatestOfAll<Attachment>('attachments', rows);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : (a.page ?? 0) - (b.page ?? 0)));
  }

  /** The decrypted content of a source document (the full image, its thumbnail, or the text as UTF-8). */
  async attachmentBytes(caseId: string, id: string, which: 'content' | 'thumb' = 'content'): Promise<Uint8Array | undefined> {
    const rowId = which === 'thumb' ? `${id}#thumb` : id;
    const row = await this.db.blobs.get(rowId);
    if (!row || row.caseId !== caseId) return undefined;
    return openBytes(this.key(), { iv: row.iv, ct: row.ct }, rowAad('blobs', { id: row.id, caseId: row.caseId }));
  }

  async attachmentText(caseId: string, id: string): Promise<string | undefined> {
    const b = await this.attachmentBytes(caseId, id);
    return b ? new TextDecoder().decode(b) : undefined;
  }

  /**
   * Remove a source document, e.g. a page that still shows an identifier. Its
   * content is purged; its description and the removal stay on record.
   */
  async removeAttachment(caseId: string, id: string, reason: string): Promise<Attachment> {
    await this.writableCase(caseId);
    if (!reason.trim()) throw new ValidationError({ reason: 'required' });
    await this.assertActiveAttachment(caseId, id);
    return this.writeVersion<Attachment>(
      'attachments',
      id,
      (prev, version, at) => {
        if (!prev || prev.status !== 'active') throw new IntegrityError('That source document has been removed.');
        return { ...prev, status: 'removed', removedReason: reason.trim(), version, versionCreatedAt: at, changeReason: reason.trim() };
      },
      (prev) => ({
        entity: 'attachment',
        entityId: id,
        caseId,
        action: 'remove',
        diff: { reason: reason.trim(), docType: prev?.docType, kind: prev?.kind, contentPurged: true },
      }),
      {
        caseId,
        also: {
          tables: ['blobs'],
          run: async () => {
            await this.db.blobs.delete(id);
            await this.db.blobs.delete(`${id}#thumb`);
          },
        },
      },
    );
  }

  // ------------------------------------------------------------------ clinical modules: task worksheets

  rawTasks(caseId: string): Promise<EncryptedRow[]> {
    return this.db.tasks.where('caseId').equals(caseId).toArray();
  }

  async listTasks(caseId: string): Promise<TaskRecord[]> {
    return this.decodeLatestOfAll<TaskRecord>('tasks', await this.rawTasks(caseId));
  }

  taskHistory(caseId: string, taskId: string): Promise<TaskRecord[]> {
    return this.history<TaskRecord>('tasks', `${caseId}:${taskId}`);
  }

  /** Save the worksheet as a new version. Saving an unchanged worksheet writes nothing. */
  async saveTask(caseId: string, taskId: string, input: TaskInput): Promise<TaskRecord> {
    await this.writableCase(caseId);
    const n = normalizeTaskInput(taskId, input);
    if (!n.ok) throw new ValidationError(n.errors);
    const entityId = `${caseId}:${taskId}`;
    const prev = await this.latest<TaskRecord>('tasks', entityId);
    if (prev && sameTask(prev, n.value)) return prev;
    // M2 Verify gate: a renal dose review is not concluded while its required data is missing.
    const gated = newGatedAnswers(taskId, prev?.fields, n.value.fields);
    if (gated.length) {
      const ctx = await this.calculationContext(caseId);
      const courses = deriveMedCourses(ctx.current);
      const errors: Errors = {};
      for (const g of gated) {
        const course = courses.find((c) => c.medId === g.medId);
        if (!course || !renalDoseReviewGate(ctx, course).ok) errors[g.key] = 'gate';
      }
      if (Object.keys(errors).length) throw new ValidationError(errors);
    }
    return this.writeVersion<TaskRecord>(
      'tasks',
      entityId,
      (_p, version, at) => ({ caseId, taskId, ...n.value, version, versionCreatedAt: at }),
      (p, next) => ({
        entity: 'task',
        entityId,
        caseId,
        action: p ? 'update' : 'create',
        diff: {
          task: taskId,
          status: { before: p?.status, after: next.status },
          changed: changedKeys(
            { ...p?.checks, ...prefix(p?.fields, 'field:'), notes: p?.notes ?? '' },
            { ...next.checks, ...prefix(next.fields, 'field:'), notes: next.notes ?? '' },
          ),
        },
      }),
      { caseId },
    );
  }

  // ------------------------------------------------------------------ clinical modules: register rows

  rawItems(caseId: string): Promise<EncryptedRow[]> {
    return this.db.items.where('caseId').equals(caseId).toArray();
  }

  async listItems(caseId: string): Promise<RegisterItem[]> {
    return this.decodeItems(await this.rawItems(caseId));
  }

  async decodeItems(rows: EncryptedRow[]): Promise<RegisterItem[]> {
    const items = await this.decodeLatestOfAll<RegisterItem>('items', rows);
    return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  itemHistory(itemId: string): Promise<RegisterItem[]> {
    return this.history<RegisterItem>('items', itemId);
  }

  /**
   * Checks medication, problem and entry references against the case's
   * current record, and the timeline entries and calculation results a
   * Problem Card links or cites. Of those, only what this save adds is
   * checked: a link kept from an earlier version may point to data corrected
   * since — the card is then shown as stale, not refused.
   */
  private async checkItemRefs(caseId: string, register: RegisterId, fields: Record<string, string>, prev?: Readonly<Record<string, string>>): Promise<void> {
    const kinds = new Set(['medRef', 'problemRef', 'entryRef', 'links', 'claims']);
    const refs = REGISTERS[register].fields.filter((f) => fields[f.id] !== undefined && kinds.has(f.kind));
    if (!refs.length) return;
    const ctx = refs.some((f) => f.kind === 'links' || f.kind === 'claims') ? await this.cardContext(caseId) : undefined;
    const current = indexTimeline(ctx?.entries ?? (await this.listEntries(caseId))).current;
    const e: Errors = {};
    for (const f of refs) {
      const v = fields[f.id]!;
      if (f.kind === 'links' || f.kind === 'claims') {
        const before = new Set(citedRefs(f.kind, prev?.[f.id]));
        const ok = citedRefs(f.kind, v)
          .filter((r) => !before.has(r))
          .every((r) => {
            const [kind, id] = [r.slice(0, r.indexOf(':')), r.slice(r.indexOf(':') + 1)];
            // A result must be current when it is cited: one already out of date would make the card stale at once.
            return kind === 'entry' ? current.some((x) => x.id === id) : ctx!.calcResults.some((x) => x.id === id) && !ctx!.calcOutOfDate.has(id);
          });
        // M5d: a claim from a research run must name a statement that run holds.
        const okResearch =
          f.kind !== 'claims' ||
          (await (async () => {
            const before = new Set(researchRefsOf(prev?.[f.id]));
            const fresh = researchRefsOf(v).filter((r) => !before.has(r));
            if (!fresh.length) return true;
            const runs = await this.listResearchRuns(caseId);
            return fresh.every((r) => {
              const [runId, n] = [r.slice(0, r.lastIndexOf(':')), Number(r.slice(r.lastIndexOf(':') + 1))];
              return runs.find((x) => x.id === runId)?.statements[n] !== undefined;
            });
          })());
        if (!ok || !okResearch) e[f.id] = 'invalidChoice';
        continue;
      }
      const ok =
        f.kind === 'medRef'
          ? deriveMedCourses(current).some((m) => m.medId === v)
          : f.kind === 'problemRef'
            ? deriveProblems(current).some((p) => p.problemId === v)
            : current.some((x) => x.id === v);
      if (!ok) e[f.id] = 'invalidChoice';
    }
    if (Object.keys(e).length) throw new ValidationError(e);
  }

  /** M5: the claims the model drafted for a card that came from a draft (none for the trainee's own card). */
  private async draftedClaims(origin: RegisterItem['origin']): Promise<CardClaim[]> {
    if (origin?.kind !== 'suggestion') return [];
    const a = await this.latest<CaseAnalysis>('analyses', origin.analysisId);
    return parseClaims(a?.suggestions.find((s) => s.id === origin.suggestionId)?.fields?.claims);
  }

  /** M5d: the statements of a research run that a card's claims were added from; a claim with exactly these words stays the model's. */
  private async researchDrafted(caseId: string, fields: Readonly<Record<string, string>>): Promise<CardClaim[]> {
    const refs = parseClaims(fields.claims).flatMap((c) => {
      const r = researchRefOf(c);
      return r ? [r] : [];
    });
    if (!refs.length) return [];
    const runs = await this.listResearchRuns(caseId);
    return refs.flatMap((r) => {
      const st = runs.find((x) => x.id === r.runId)?.statements[r.n];
      return st ? [{ text: st.text, source: 'research' as const, ref: `${r.runId}:${r.n}` }] : [];
    });
  }

  async addItem(caseId: string, register: RegisterId, input: Record<string, string>): Promise<RegisterItem> {
    await this.writableCase(caseId);
    if (!(REGISTER_IDS as readonly string[]).includes(register)) throw new ValidationError({ register: 'invalidChoice' });
    const n = normalizeItemFields(register, input);
    if (!n.ok) throw new ValidationError(n.errors);
    // A card the trainee writes holds no model claims, whatever the input says.
    if (register === 'drp') n.fields = ownedClaims(n.fields, await this.researchDrafted(caseId, n.fields));
    await this.checkItemRefs(caseId, register, n.fields);
    const id = this.uuid();
    return this.writeVersion<RegisterItem>(
      'items',
      id,
      (_p, version, at) => ({ id, caseId, register, fields: n.fields, status: 'active', createdAt: at, version, versionCreatedAt: at, ...(register === 'drp' ? { contentAt: at } : {}) }),
      (_p, next) => ({ entity: 'item', entityId: id, caseId, action: 'create', diff: { register, after: next.fields } }),
      { caseId },
    );
  }

  /**
   * Edit a row: a new version; the previous one stays readable. Saving
   * unchanged values writes nothing. With `decision: 'edited'` (a Problem
   * Card under review, Section 8), the edit is also recorded as the "Edit"
   * decision on the new version, in the same transaction.
   */
  async updateItem(
    caseId: string,
    itemId: string,
    input: Record<string, string>,
    reason?: string,
    opts: { decision?: 'edited'; withPreceptor?: boolean } = {},
  ): Promise<RegisterItem> {
    await this.writableCase(caseId);
    const prev = await this.latest<RegisterItem>('items', itemId);
    if (!prev || prev.caseId !== caseId) throw new IntegrityError('That record does not exist in this case.');
    if (prev.status !== 'active') throw new IntegrityError('That record was retracted and cannot be edited.');
    if (opts.decision && prev.register !== 'drp') throw new IntegrityError('Only a Problem Card is reviewed.');
    const n = normalizeItemFields(prev.register, input);
    if (!n.ok) throw new ValidationError(n.errors);
    // M5: a claim stays the model's only while its words are the model's (markModelClaims).
    if (prev.register === 'drp') n.fields = ownedClaims(n.fields, [...(await this.draftedClaims(prev.origin)), ...(await this.researchDrafted(caseId, n.fields))]);
    await this.checkItemRefs(caseId, prev.register, n.fields, prev.fields);
    if (sameStrings(prev.fields, n.fields)) {
      if (opts.decision) throw new IntegrityError('Nothing was changed. To keep the card as it is, choose Accept.');
      return prev;
    }
    const version = prev.version + 1;
    let also: { tables: EncryptedTableName[]; run: () => Promise<void> } | undefined;
    const extraAudit: EncryptedRow[] = [];
    // A Problem Card: a change of its content is a review on today's data (D8) — on a stale card, only with the reason.
    const contentChanged = prev.register === 'drp' && changedKeys(prev.fields, n.fields).some((k) => !DRP_RECORD_FIELDS.has(k));
    if (contentChanged && !reason?.trim() && cardStaleness(prev, await this.cardContext(caseId)).stale) {
      throw new ValidationError({ reason: 'required' });
    }
    if (opts.decision) {
      const ctx = await this.cardContext(caseId);
      const now = this.nowIso();
      const next: RegisterItem = { ...prev, fields: n.fields, version, versionCreatedAt: now, contentAt: contentChanged ? now : (prev.contentAt ?? prev.versionCreatedAt) };
      if (cardStaleness(next, ctx).stale) throw new IntegrityError('The card still cites data that was corrected or is out of date: link the current values before accepting it.');
      const review = this.newReview(caseId, next, 'edited', reason, opts.withPreceptor);
      const row = await this.sealRow('cardReviews', { id: review.id, caseId }, review);
      extraAudit.push(await this.reviewAudit(review));
      also = { tables: ['cardReviews'], run: async () => void (await this.db.cardReviews.add(row)) };
    }
    return this.writeVersion<RegisterItem>(
      'items',
      itemId,
      (p, v, at) => {
        if (!p || p.status !== 'active') throw new IntegrityError('That record was retracted and cannot be edited.');
        // The decision names this version: if another tab saved first, the decision would name the wrong one.
        if (opts.decision && v !== version) throw new IntegrityError('The card was changed in the meantime. Reopen it and decide again.');
        const contentAt = p.register !== 'drp' ? undefined : contentChanged ? at : (p.contentAt ?? p.versionCreatedAt);
        return { ...p, fields: n.fields, version: v, versionCreatedAt: at, changeReason: reason?.trim() || undefined, ...(contentAt ? { contentAt } : {}) };
      },
      (p, next) => ({
        entity: 'item',
        entityId: itemId,
        caseId,
        action: 'update',
        diff: { register: prev.register, reason: reason?.trim() || undefined, changed: changedKeys(p?.fields ?? {}, next.fields), before: p?.fields, after: next.fields },
      }),
      { caseId, extraAudit, also },
    );
  }

  /** "Entered in error": the row stays readable, marked retracted, with the reason. */
  async retractItem(caseId: string, itemId: string, reason: string): Promise<RegisterItem> {
    await this.writableCase(caseId);
    if (!reason.trim()) throw new ValidationError({ reason: 'required' });
    const prev = await this.latest<RegisterItem>('items', itemId);
    if (!prev || prev.caseId !== caseId) throw new IntegrityError('That record does not exist in this case.');
    if (prev.status !== 'active') throw new IntegrityError('That record has already been retracted.');
    return this.writeVersion<RegisterItem>(
      'items',
      itemId,
      (p, version, at) => {
        if (!p || p.status !== 'active') throw new IntegrityError('That record has already been retracted.');
        return { ...p, status: 'retracted', version, versionCreatedAt: at, changeReason: reason.trim() };
      },
      () => ({ entity: 'item', entityId: itemId, caseId, action: 'retract', diff: { register: prev.register, reason: reason.trim() } }),
      { caseId },
    );
  }

  // ------------------------------------------------------------------ M4: Problem Cards — decisions (Section 8, Review) and staleness

  rawCardReviews(caseId: string): Promise<EncryptedRow[]> {
    return this.db.cardReviews.where('caseId').equals(caseId).toArray();
  }

  async decodeCardReviews(rows: EncryptedRow[]): Promise<CardReview[]> {
    return (await this.openRows<CardReview>('cardReviews', rows)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  }

  async listCardReviews(caseId: string): Promise<CardReview[]> {
    return this.decodeCardReviews(await this.rawCardReviews(caseId));
  }

  // ------------------------------------------------------------------ M5: the evidence library (Section 11)

  rawDocuments(): Promise<EncryptedRow[]> {
    return this.db.documents.toArray();
  }

  async decodeDocuments(rows: EncryptedRow[]): Promise<LibraryDocument[]> {
    return (await this.decodeLatestOfAll<LibraryDocument>('documents', rows)).sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0));
  }

  async listDocuments(): Promise<LibraryDocument[]> {
    return this.decodeDocuments(await this.rawDocuments());
  }

  documentHistory(docId: string): Promise<LibraryDocument[]> {
    return this.history<LibraryDocument>('documents', docId);
  }

  /**
   * Adds a guideline the trainee obtained, with the metadata they typed or
   * confirmed, its file (encrypted, never shared), its SHA-256 and the
   * passages of its text layer (library/chunk.ts). A scanned PDF is kept and
   * listed as not searchable. The same file twice is refused.
   */
  async addDocument(input: { meta: DocumentMetaInput; file: { name: string; bytes: Uint8Array }; pages: readonly PageText[]; pageCount: number; isDrug?: (word: string) => boolean }): Promise<LibraryDocument> {
    const m = normalizeDocumentMeta(input.meta, this.today());
    const e: Errors = m.ok ? {} : { ...(m.errors as Errors) };
    const bytes = input.file.bytes;
    if (!bytes.byteLength) e.file = 'required';
    else if (bytes.byteLength > MAX_DOC_BYTES) e.file = 'tooLarge';
    else if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') e.file = 'invalidChoice';
    if (!Number.isInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > MAX_DOC_PAGES) e.file = e.file ?? 'range';
    if (Object.keys(e).length || !m.ok) throw new ValidationError(e);
    const sha256 = toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    const same = (await this.listDocuments()).find((d) => d.status === 'active' && d.file.sha256 === sha256);
    if (same) throw new IntegrityError(`This file is already in your library: “${same.title}”.`);
    const drafts = chunkDocument(input.pages.filter((p) => p.page <= input.pageCount), input.isDrug ? { isDrug: input.isDrug } : {});
    const id = this.uuid();
    const at = this.nowIso();
    const doc: LibraryDocument = stripUndefined({
      id,
      ...m.value,
      file: { name: input.file.name.slice(0, 200), bytes: bytes.byteLength, sha256, pages: input.pageCount },
      textLayer: drafts.length > 0,
      chunks: drafts.length,
      status: 'active' as const,
      addedAt: at,
      version: 1,
      versionCreatedAt: at,
    });
    const chunks: EvidenceChunk[] = drafts.map((c) => stripUndefined({ id: `${id}:1:${c.n}`, docId: id, docVersion: 1, ...c }));
    const docRow = await this.sealRow('documents', { id: `${id}@1`, entityId: id, version: 1 }, doc);
    const fileIndex = { id: `${id}@file`, entityId: id };
    const sealedFile = await sealBytes(this.key(), bytes, rowAad('docFiles', fileIndex));
    const chunkRows = await Promise.all(chunks.map((c) => this.sealRow('chunks', { id: c.id, entityId: id }, c)));
    // The audit records what was added, never the document's text.
    const audit = await this.auditRow({
      entity: 'library_document',
      entityId: id,
      action: 'create',
      diff: { title: doc.title, publisher: doc.publisher, year: doc.year, role: doc.role, aiUse: doc.aiUse, licence: doc.licence, pages: input.pageCount, chunks: chunks.length, sha256 },
    });
    await this.db.transaction('rw', [this.db.documents, this.db.docFiles, this.db.chunks, this.db.audit], async () => {
      await this.db.documents.add(docRow);
      await this.db.docFiles.add({ ...fileIndex, iv: sealedFile.iv, ct: sealedFile.ct });
      await this.db.chunks.bulkAdd(chunkRows);
      await this.db.audit.add(audit);
    });
    return doc;
  }

  /** The document's file as uploaded, to open at a page (a citation opens its source). */
  async documentFile(docId: string): Promise<Uint8Array | undefined> {
    const row = await this.db.docFiles.get(`${docId}@file`);
    if (!row) return undefined;
    return openBytes(this.key(), { iv: row.iv, ct: row.ct }, rowAad('docFiles', { id: row.id, entityId: row.entityId }));
  }

  rawChunks(docId?: string): Promise<EncryptedRow[]> {
    return docId ? this.db.chunks.where('entityId').equals(docId).toArray() : this.db.chunks.toArray();
  }

  async decodeChunks(rows: EncryptedRow[]): Promise<EvidenceChunk[]> {
    return (await this.openRows<EvidenceChunk>('chunks', rows)).sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : a.n - b.n));
  }

  /** The passages of one document, or of every document in the library. */
  async listChunks(docId?: string): Promise<EvidenceChunk[]> {
    return this.decodeChunks(await this.rawChunks(docId));
  }

  /**
   * Corrects a document's metadata, or changes its licence choice: a new
   * version with the reason. A document no longer allowed to be sent loses
   * its vectors (local documents are searched by words only).
   */
  async updateDocument(docId: string, input: DocumentMetaInput, reason: string): Promise<LibraryDocument> {
    const r = reason.trim();
    if (r.length < 3) throw new ValidationError({ reason: 'required' });
    const m = normalizeDocumentMeta(input, this.today());
    if (!m.ok) throw new ValidationError(m.errors as Errors);
    const prev = await this.latest<LibraryDocument>('documents', docId);
    if (!prev || prev.status !== 'active') throw new IntegrityError('That document is not in your library.');
    const dropVectors = prev.vectors && m.value.aiUse !== 'may_send';
    return this.writeVersion<LibraryDocument>(
      'documents',
      docId,
      (p, version, at) => {
        if (!p || p.status !== 'active') throw new IntegrityError('That document is not in your library.');
        const { vectors: _v, ...rest } = p;
        return { ...(dropVectors ? rest : p), ...m.value, ...(m.value.edition ? {} : { edition: undefined }), ...(m.value.url ? {} : { url: undefined }), ...(m.value.topic ? {} : { topic: undefined }), version, versionCreatedAt: at, changeReason: r };
      },
      (p, next) => ({ entity: 'library_document', entityId: docId, action: 'update', diff: { reason: r, changed: changedMeta(p, next), vectorsRemoved: Boolean(dropVectors) } }),
      dropVectors ? { also: { tables: ['embeddings'], run: async () => void (await this.db.embeddings.where('entityId').equals(docId).delete()) } } : {},
    );
  }

  /** Removes a document: its file, passages and vectors are purged; its record and the removal stay. */
  async removeDocument(docId: string, reason: string): Promise<LibraryDocument> {
    const r = reason.trim();
    if (r.length < 3) throw new ValidationError({ reason: 'required' });
    return this.writeVersion<LibraryDocument>(
      'documents',
      docId,
      (p, version, at) => {
        if (!p || p.status !== 'active') throw new IntegrityError('That document is not in your library.');
        const { vectors: _v, ...rest } = p;
        return { ...rest, status: 'removed', version, versionCreatedAt: at, changeReason: r };
      },
      (p) => ({ entity: 'library_document', entityId: docId, action: 'remove', diff: { reason: r, title: p?.title, contentPurged: true } }),
      {
        also: {
          tables: ['docFiles', 'chunks', 'embeddings'],
          run: async () => {
            await this.db.docFiles.delete(`${docId}@file`);
            await this.db.chunks.bulkDelete(await this.db.chunks.where('entityId').equals(docId).primaryKeys());
            await this.db.embeddings.bulkDelete(await this.db.embeddings.where('entityId').equals(docId).primaryKeys());
          },
        },
      },
    );
  }

  rawVectors(docId?: string): Promise<EncryptedRow[]> {
    return docId ? this.db.embeddings.where('entityId').equals(docId).toArray() : this.db.embeddings.toArray();
  }

  async listVectors(docId?: string): Promise<ChunkVector[]> {
    return this.openRows<ChunkVector>('embeddings', await this.rawVectors(docId));
  }

  /**
   * Stores the vectors of a document's passages, computed once by `model`
   * (only for a document whose licence allows sending its text). Vectors of
   * another model are replaced; the document records the model and the date.
   */
  async addVectors(docId: string, model: string, items: readonly { chunkId: string; vector: number[] }[]): Promise<LibraryDocument> {
    const doc = await this.latest<LibraryDocument>('documents', docId);
    if (!doc || doc.status !== 'active') throw new IntegrityError('That document is not in your library.');
    if (!maySend(doc)) throw new IntegrityError('This document is for local search only: its text is never sent to the AI service.');
    const known = new Set((await this.listChunks(docId)).map((c) => c.id));
    if (items.some((x) => !known.has(x.chunkId))) throw new IntegrityError('A vector names a passage this document does not have.');
    const at = this.nowIso();
    const records: ChunkVector[] = items.map((x) => ({ id: `${x.chunkId}#${model}`, chunkId: x.chunkId, docId, model, vector: x.vector, at }));
    const rows = await Promise.all(records.map((v) => this.sealRow('embeddings', { id: v.id, entityId: docId }, v)));
    const existing = await this.listVectors(docId);
    const stale = existing.filter((v) => v.model !== model || records.some((x) => x.id === v.id)).map((v) => v.id);
    const count = new Set([...existing.filter((v) => v.model === model).map((v) => v.chunkId), ...records.map((v) => v.chunkId)]).size;
    return this.writeVersion<LibraryDocument>(
      'documents',
      docId,
      (p, version, now) => {
        if (!p || p.status !== 'active') throw new IntegrityError('That document is not in your library.');
        return { ...p, vectors: { model, at, chunks: count }, version, versionCreatedAt: now, changeReason: `Search vectors computed (${model})` };
      },
      () => ({ entity: 'library_document', entityId: docId, action: 'update', diff: { vectors: { model, chunks: count } } }),
      {
        also: {
          tables: ['embeddings'],
          run: async () => {
            await this.db.embeddings.bulkDelete(stale);
            await this.db.embeddings.bulkAdd(rows);
          },
        },
      },
    );
  }

  // ------------------------------------------------------------------ M5: the verifier's verdicts (Section 12, check 4)

  rawClaimChecks(caseId: string): Promise<EncryptedRow[]> {
    return this.db.claimChecks.where('caseId').equals(caseId).toArray();
  }

  async decodeClaimChecks(rows: EncryptedRow[]): Promise<ClaimVerification[]> {
    return (await this.openRows<ClaimVerification>('claimChecks', rows)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  }

  async listClaimChecks(caseId: string): Promise<ClaimVerification[]> {
    return this.decodeClaimChecks(await this.rawClaimChecks(caseId));
  }

  /**
   * Records the verdicts of one run of the verifier, append-only: a later check
   * of the same statement is a new record, and the latest one is shown. The
   * audit event records the counts, the model and the prompt — never the text.
   */
  async addClaimChecks(caseId: string, checks: readonly Omit<ClaimVerification, 'id' | 'caseId' | 'at'>[]): Promise<ClaimVerification[]> {
    await this.writableCase(caseId);
    if (!checks.length) return [];
    const at = this.nowIso();
    const records: ClaimVerification[] = checks.map((x) => stripUndefined({ ...x, id: this.uuid(), caseId, at }));
    const rows = await Promise.all(records.map((r) => this.sealRow('claimChecks', { id: r.id, caseId }, r)));
    const count = (v: string) => records.filter((r) => r.verdict === v).length;
    const audit = await this.auditRow({
      entity: 'claim_check',
      entityId: records[0]!.id,
      caseId,
      action: 'create',
      actor: 'model',
      diff: {
        statements: records.length,
        supported: count('supported'),
        partial: count('partial'),
        unsupported: count('unsupported'),
        contradicted: count('contradicted'),
        notChecked: count('not_checked'),
        models: [...new Set(records.flatMap((r) => (r.model ? [r.model] : [])))],
        promptVersion: records[0]!.promptVersion,
        origins: [...new Set(records.map((r) => r.origin.kind))],
      },
    });
    await this.db.transaction('rw', [this.db.claimChecks, this.db.audit], async () => {
      await this.db.claimChecks.bulkAdd(rows);
      await this.db.audit.add(audit);
    });
    return records;
  }

  // ------------------------------------------------------------------ M5d: research runs (Section 11)

  rawResearchRuns(caseId: string): Promise<EncryptedRow[]> {
    return this.db.researchRuns.where('caseId').equals(caseId).toArray();
  }

  async decodeResearchRuns(rows: EncryptedRow[]): Promise<ResearchRun[]> {
    const list = await this.decodeLatestOfAll<ResearchRun>('researchRuns', rows);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async listResearchRuns(caseId: string): Promise<ResearchRun[]> {
    return this.decodeResearchRuns(await this.rawResearchRuns(caseId));
  }

  /**
   * Records what a researched question retrieved and what the model drafted
   * from it. A run is never overwritten: a new research is a new run. The
   * store refuses what would break the rules the checks enforce — a passage of
   * a document kept for local search among those sent, a sent passage that is
   * not one of the retrieved sources, an answer without a statement.
   */
  async addResearchRun(caseId: string, input: NewResearchRun): Promise<ResearchRun> {
    await this.writableCase(caseId);
    const item = (await this.listItems(caseId)).find((i) => i.id === input.itemId && i.register === 'drp' && i.status === 'active');
    if (!item) throw new IntegrityError('That Problem Card does not exist in this case.');
    const byId = new Map(input.sources.map((s) => [s.id, s]));
    for (const p of input.sent) {
      const src = byId.get(p.recordId);
      if (!src) throw new IntegrityError('A passage sent to the model is not among the retrieved sources.');
      if (src.localOnly) throw new IntegrityError('The text of a document kept for local search is never sent to the AI service.');
    }
    if (input.status === 'insufficient' && input.statements.length) throw new IntegrityError('A run with nothing adequate holds no statements.');
    if (input.status === 'answered' && !input.statements.length) throw new IntegrityError('An answer holds at least one statement.');
    const id = this.uuid();
    return this.writeVersion<ResearchRun>(
      'researchRuns',
      id,
      (_p, version, at) => ({ ...input, id, caseId, itemVersion: item.version, createdAt: at, version, versionCreatedAt: at, basedOn: { problemHash: problemHash(item.fields), links: input.basedOn.links } }),
      (_p, next) => ({
        entity: 'research_run',
        entityId: id,
        caseId,
        action: 'create',
        actor: 'model',
        // Counts and ids only: neither the question's words nor any passage's text.
        diff: {
          itemId: next.itemId,
          model: next.model,
          promptVersion: next.promptVersion,
          retrievedChunkIds: next.retrievedChunkIds,
          sources: next.sources.length,
          sent: next.sent.length,
          status: next.status,
          statements: next.statements.length,
          flagged: next.statements.filter((s) => s.flags.length > 0).length,
          dropped: next.dropped,
          notes: next.notes,
          usage: next.usage,
        },
      }),
      { caseId },
    );
  }

  /** Whether a run's card or the data it cites changed since the run (Section 7, staleness). */
  async researchStaleness(run: ResearchRun): Promise<ReturnType<typeof researchStalenessOf>> {
    const [ctx, items] = await Promise.all([this.cardContext(run.caseId), this.listItems(run.caseId)]);
    return researchStalenessOf(run, items.find((i) => i.id === run.itemId), ctx);
  }

  /**
   * Adds one researched statement to a Problem Card's claims, with the source
   * cited from its record and the quote that shows it. One statement at a
   * time (never in bulk), only if the statement passed the gate — supported
   * by the verifier, shown by a literal quote, nothing removed or withheld by
   * the code checks — and its run is not stale.
   */
  async addResearchClaim(caseId: string, itemId: string, runId: string, n: number): Promise<RegisterItem> {
    await this.writableCase(caseId);
    const run = await this.latest<ResearchRun>('researchRuns', runId);
    const st = run?.caseId === caseId ? run.statements[n] : undefined;
    if (!run || !st) throw new IntegrityError('That researched statement does not exist in this case.');
    if (run.itemId !== itemId) throw new IntegrityError('That research was done for another Problem Card.');
    if ((await this.researchStaleness(run)).stale) throw new IntegrityError('The data this research rests on changed. Research the question again before adding from it.');
    const verdict = indexVerdicts(await this.listClaimChecks(caseId)).byKey.get(researchKey(runId, st));
    if (!addable(st, verdict)) throw new IntegrityError('Only a statement the verifier found supported, shown by a quote from its source, with nothing removed by the checks, can be added.');
    const item = (await this.listItems(caseId)).find((i) => i.id === itemId && i.register === 'drp' && i.status === 'active');
    if (!item) throw new IntegrityError('That Problem Card does not exist in this case.');
    const ref = `${runId}:${n}`;
    const claims = parseClaims(item.fields.claims);
    if (claims.some((c) => c.source === 'research' && c.ref === ref)) throw new IntegrityError('That statement is already among the card’s claims.');
    const src = run.sources.find((x) => x.id === st.sourceId);
    if (!src) throw new IntegrityError('Its source is not among those retrieved.');
    const cite = `${sourceCitation(src)}${st.section ? ` [${st.section}]` : ''}`;
    const claim: CardClaim = { text: st.text, source: 'research', ref, title: cite.slice(0, 300), quote: st.quote, by: 'model' };
    return this.updateItem(caseId, itemId, { ...item.fields, claims: claimsValue([...claims, claim]) }, 'Added a researched statement');
  }

  // ------------------------------------------------------------------ M6: export of the department form

  /** Values a model read from the case's documents that the trainee has not yet confirmed, corrected or rejected. */
  async pendingExtractionCount(caseId: string): Promise<number> {
    const [runs, attachments] = await Promise.all([this.listExtractions(caseId), this.listAttachments(caseId)]);
    const active = new Set(attachments.filter((a) => a.status === 'active').map((a) => a.id));
    return runs.filter((r) => active.has(r.attachmentId)).reduce((n, r) => n + r.fields.filter((f) => !f.decision).length, 0);
  }

  /** The audit record of an export: which copy, how many sections and missing items, and the hash of the content — never the content. */
  async recordFormExport(caseId: string, info: { copy: 'teaching' | 'ward'; sections: number; missing: number; hash: string; as: 'pdf' | 'text' }): Promise<void> {
    await this.appendAudit({ entity: 'form_export', entityId: caseId, caseId, action: 'create', diff: info });
  }

  /** The audit record of a presentation: the rotation, how many cases and cards, and the hash of the content — never the content. */
  async recordPresentation(rotationId: string, info: { cases: number; cards: number; slides: number; hash: string; as: 'pdf' | 'text' }): Promise<void> {
    await this.appendAudit({ entity: 'presentation', entityId: rotationId, action: 'create', diff: info });
  }

  // ------------------------------------------------------------------ M8: the learning modes and the portfolio

  async listLearning(caseId: string): Promise<LearningRecord[]> {
    const rows = await this.db.learning.where('caseId').equals(caseId).toArray();
    return (await this.openRows<LearningRecord>('learning', rows)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
  }

  /** Keeps what the trainee did in a learning mode, in their own words; append-only, audited by mode and length only. */
  async recordLearning(caseId: string, input: Omit<LearningRecord, 'id' | 'caseId' | 'at'>): Promise<LearningRecord> {
    await this.writableCase(caseId);
    if (!LEARNING_MODES.includes(input.mode) || !input.prompt.trim() || input.prompt.length > 1200) throw new ValidationError({ prompt: 'invalidChoice' });
    if ((input.answer ?? '').length > 4000) throw new ValidationError({ answer: 'tooLong' });
    if (input.competencies.some((c) => !(COMPETENCY_AREAS as readonly string[]).includes(c))) throw new ValidationError({ competencies: 'invalidChoice' });
    const rec: LearningRecord = stripUndefined({ ...input, id: this.uuid(), caseId, at: this.nowIso() });
    const row = await this.sealRow('learning', { id: rec.id, caseId }, rec);
    const audit = await this.auditRow({ entity: 'learning', entityId: rec.id, caseId, action: 'create', diff: { mode: rec.mode, competencies: rec.competencies, answerLength: (rec.answer ?? '').length, ...(rec.score ? { correct: rec.score.correct } : {}) } });
    await this.db.transaction('rw', [this.db.learning, this.db.audit], async () => {
      await this.db.learning.add(row);
      await this.db.audit.add(audit);
    });
    return rec;
  }

  /** The audit record of a portfolio export: counts and the hash of the content — never the content. */
  async recordPortfolioExport(info: { entries: number; hash: string; as: 'pdf' | 'text' }): Promise<void> {
    await this.appendAudit({ entity: 'portfolio', entityId: 'portfolio', action: 'create', diff: info });
  }

  /** What a Problem Card's staleness and checks read: every entry, every calculation result and which are out of date, every decision. */
  async cardContext(caseId: string): Promise<CardContext> {
    const c = await this.getCase(caseId);
    if (!c) throw new IntegrityError(`Case ${caseId} does not exist.`);
    const [entries, calcResults, reviews, checks] = await Promise.all([this.listEntries(caseId), this.listCalcResults(caseId), this.listCardReviews(caseId), this.listClaimChecks(caseId)]);
    const ctx = { demographics: c.demographics, current: indexTimeline(entries).current };
    const calcOutOfDate = new Set(
      calcResults
        .filter((r) => {
          const def = this.calculators.get(r.calc);
          return def ? !resultCurrency(r, def, ctx).current : false;
        })
        .map((r) => r.id),
    );
    const calcName = (id: string) => {
      const def = this.calculators.get(id as CalculatorId);
      return def ? { en: def.name, ar: def.nameAr } : undefined;
    };
    return { entries, calcResults, calcOutOfDate, reviews, calcName, verdicts: indexVerdicts(checks).byKey };
  }

  /**
   * Owner decision D9: the trainee's own card shows "written by you"; it can
   * be referred for senior review, and is then decided with the preceptor.
   */
  private newReview(caseId: string, item: RegisterItem, decision: CardDecision, reason: string | undefined, withPreceptor: boolean | undefined): CardReview {
    const r = reason?.trim() ?? '';
    if (DECISIONS_NEEDING_REASON.has(decision) && r.length < 3) throw new ValidationError({ reason: 'required' });
    if (r.length > 1000) throw new ValidationError({ reason: 'tooLong' });
    if (!fromModel(item) && decision !== 'needs_senior_review' && !withPreceptor) {
      throw new IntegrityError('A card you wrote yourself is decided with your preceptor: refer it for senior review, or record the decision taken with your preceptor.');
    }
    return stripUndefined({
      id: this.uuid(),
      caseId,
      itemId: item.id,
      itemVersion: item.version,
      contentHash: contentHash(item.fields),
      decision,
      reason: r || undefined,
      withPreceptor: withPreceptor ? (true as const) : undefined,
      at: this.nowIso(),
    });
  }

  private reviewAudit(review: CardReview): Promise<EncryptedRow> {
    return this.auditRow({
      entity: 'card_review',
      entityId: review.itemId,
      caseId: review.caseId,
      action: REVIEW_ACTION[review.decision],
      diff: stripUndefined({ decision: review.decision, reason: review.reason, itemVersion: review.itemVersion, withPreceptor: review.withPreceptor, fromSuggestion: review.fromSuggestion }),
    });
  }

  /**
   * One decision on one Problem Card — there is no operation on several
   * cards, and no default decision. Reject, request more evidence and senior
   * review need their reason. A later change of mind is a new decision; the
   * earlier ones stay. A card whose data changed is not accepted until it has
   * been reviewed again on the current data.
   */
  async reviewCard(caseId: string, itemId: string, input: CardReviewInput): Promise<CardReview> {
    await this.writableCase(caseId);
    if (!(CARD_DECISIONS as readonly string[]).includes(input.decision) || (input.decision as string) === 'edited') throw new ValidationError({ decision: 'invalidChoice' });
    const item = await this.latest<RegisterItem>('items', itemId);
    if (!item || item.caseId !== caseId || item.register !== 'drp') throw new IntegrityError('That Problem Card does not exist in this case.');
    if (item.status !== 'active') throw new IntegrityError('That Problem Card was retracted.');
    const review = this.newReview(caseId, item, input.decision, input.reason, input.withPreceptor);
    if (input.decision === 'accepted' && cardStaleness(item, await this.cardContext(caseId)).stale) {
      throw new IntegrityError('The data this card rests on changed. Review it again on the current data before accepting it.');
    }
    // M5: a card saved before the coherence check, whose classification it questions, is edited before it is accepted.
    if (input.decision === 'accepted' && classificationUnanswered(item.fields)) {
      throw new IntegrityError('Its PCNE classification disagrees with the problem as written: edit the card to correct the codes or to say why they fit, then accept it.');
    }
    // M5, decision 6: a claim the model drafted is accepted only once the verifier found it supported, with a quote.
    if (input.decision === 'accepted' && unverifiedModelClaims(item.fields, await this.cardContext(caseId)).length) {
      throw new IntegrityError('A claim the AI drafted has not been found supported by its source: check the claims with the verifier, or edit them in your own words, then accept the card.');
    }
    const row = await this.sealRow('cardReviews', { id: review.id, caseId }, review);
    const audit = await this.reviewAudit(review);
    await this.db.transaction('rw', [this.db.cardReviews, this.db.audit], async () => {
      await this.db.cardReviews.add(row);
      await this.db.audit.add(audit);
    });
    return review;
  }

  /**
   * A stale card reviewed again on the current data and found still valid
   * (owner decision D8): saved as version n+1 with the reason, unchanged
   * otherwise. A card that cites data corrected since, or a result out of
   * date, is edited instead, so that it links the current values.
   */
  async reconfirmCard(caseId: string, itemId: string, reason: string): Promise<RegisterItem> {
    await this.writableCase(caseId);
    const r = reason.trim();
    if (r.length < 3) throw new ValidationError({ reason: 'required' });
    if (r.length > 1000) throw new ValidationError({ reason: 'tooLong' });
    const prev = await this.latest<RegisterItem>('items', itemId);
    if (!prev || prev.caseId !== caseId || prev.register !== 'drp') throw new IntegrityError('That Problem Card does not exist in this case.');
    if (prev.status !== 'active') throw new IntegrityError('That Problem Card was retracted.');
    const ctx = await this.cardContext(caseId);
    const before = cardStaleness(prev, ctx);
    if (!before.stale) throw new IntegrityError('This card is current: there is nothing to review again.');
    if (cardStaleness({ ...prev, contentAt: this.nowIso() }, ctx).stale) {
      throw new IntegrityError('The card cites data that was corrected or a result that is out of date: edit it and link the current values.');
    }
    return this.writeVersion<RegisterItem>(
      'items',
      itemId,
      (p, version, at) => {
        if (!p || p.status !== 'active') throw new IntegrityError('That Problem Card was retracted.');
        return { ...p, version, versionCreatedAt: at, contentAt: at, changeReason: r };
      },
      (_p, next) => ({
        entity: 'item',
        entityId: itemId,
        caseId,
        action: 'reconfirm',
        diff: { register: 'drp', version: next.version, reason: r, staleBecause: before.reasons.map((x) => x.en) },
      }),
      { caseId },
    );
  }

  // ------------------------------------------------------------------ M3: what the model read (extraction runs)

  rawExtractions(caseId: string): Promise<EncryptedRow[]> {
    return this.db.extractions.where('caseId').equals(caseId).toArray();
  }

  async decodeExtractions(rows: EncryptedRow[]): Promise<ExtractionRun[]> {
    const runs = await this.decodeLatestOfAll<ExtractionRun>('extractions', rows);
    return runs.sort((a, b) => (a.runAt < b.runAt ? -1 : a.runAt > b.runAt ? 1 : 0));
  }

  async listExtractions(caseId: string): Promise<ExtractionRun[]> {
    return this.decodeExtractions(await this.rawExtractions(caseId));
  }

  /** Records one reading of a document. Nothing in it is used until each field is confirmed. */
  async addExtractionRun(caseId: string, input: NewExtractionRun): Promise<ExtractionRun> {
    await this.writableCase(caseId);
    await this.assertActiveAttachment(caseId, input.attachmentId);
    if (input.fields.some((f) => f.decision)) throw new IntegrityError('A new reading cannot carry decisions.');
    const id = this.uuid();
    return this.writeVersion<ExtractionRun>(
      'extractions',
      id,
      (_p, version, at) => ({ ...input, id, caseId, runAt: at, version, versionCreatedAt: at }),
      (_p, next) => ({
        entity: 'extraction',
        entityId: id,
        caseId,
        action: 'create',
        actor: 'model',
        // Counts only: the values themselves are in the encrypted run, not repeated in the log.
        diff: {
          attachmentId: next.attachmentId,
          model: next.model,
          secondModel: next.secondModel,
          promptVersion: next.promptVersion,
          passes: next.passes,
          fields: next.fields.length,
          flagged: next.fields.filter((f) => f.flags.length > 0).length,
          sent: next.sent,
          usage: next.usage,
        },
      }),
      { caseId },
    );
  }

  /**
   * The trainee's decision on one extracted field (Section 13): confirm it as
   * read, correct it, or reject it. A confirmed or corrected field becomes a
   * timeline entry (provenance "confirmed", linked to its source and box) or a
   * register row, through the same validation as a typed entry. One field, one
   * decision; there is no way to decide several at once.
   */
  async decideExtractedField(
    caseId: string,
    runId: string,
    fieldId: string,
    d: FieldDecisionInput,
  ): Promise<{ run: ExtractionRun; entry?: TimelineEntry; item?: RegisterItem }> {
    await this.writableCase(caseId);
    const run = await this.latest<ExtractionRun>('extractions', runId);
    if (!run || run.caseId !== caseId) throw new IntegrityError('That reading does not exist in this case.');
    const field = run.fields.find((f) => f.id === fieldId);
    if (!field) throw new IntegrityError('That field does not exist in this reading.');
    if (field.decision) throw new IntegrityError('That field has already been decided.');

    let entry: TimelineEntry | undefined;
    let item: RegisterItem | undefined;
    let row: { table: 'timeline' | 'items'; row: EncryptedRow } | undefined;
    let createAudit: EncryptedRow | undefined;
    const values = d.kind === 'correct' ? d.values : field.values;
    if (d.kind !== 'reject') {
      await this.assertActiveAttachment(caseId, run.attachmentId);
      const now = this.nowIso();
      if (field.target.kind === 'entry') {
        const type = field.target.type;
        if (!(M1_MANUAL_ENTRY_TYPES as readonly string[]).includes(type)) throw new ValidationError({ type: 'notInM1' });
        const day = d.kind === 'correct' ? d.day : field.day;
        const time = d.kind === 'correct' ? d.timeOfDay : field.timeOfDay;
        const meta = buildEntryMeta({ hospitalDay: day === undefined ? '' : String(day), timeOfDay: time ?? '' });
        const built = buildPayload(type, values, { newId: this.uuid });
        const errors = { ...(meta.ok ? {} : meta.errors), ...(built.ok ? {} : built.errors) };
        if (!meta.ok || !built.ok) throw new ValidationError(errors);
        entry = stripUndefined({
          id: this.uuid(),
          caseId,
          hospitalDay: meta.hospitalDay,
          timeOfDay: meta.timeOfDay,
          recordedAt: now,
          author: 'ai_extracted' as const,
          type,
          payload: built.payload,
          unit: unitOf(type, built.payload),
          sourceAttachmentId: run.attachmentId,
          provenance: 'confirmed' as const,
          extraction: stripUndefined({ runId, fieldId, box: field.box }),
        }) as TimelineEntry;
        row = { table: 'timeline', row: await this.sealRow('timeline', { id: entry.id, caseId }, entry) };
        createAudit = await this.auditRow({ entity: 'timeline_entry', entityId: entry.id, caseId, action: 'create', diff: { after: entry } });
      } else {
        const register = field.target.register;
        const n = normalizeItemFields(register, values);
        if (!n.ok) throw new ValidationError(n.errors);
        const id = this.uuid();
        item = {
          id,
          caseId,
          register,
          fields: n.fields,
          status: 'active',
          createdAt: now,
          version: 1,
          versionCreatedAt: now,
          origin: { kind: 'extraction', runId, fieldId, attachmentId: run.attachmentId },
        };
        row = { table: 'items', row: await this.sealRow('items', { id: `${id}@1`, entityId: id, version: 1, caseId }, item) };
        createAudit = await this.auditRow({ entity: 'item', entityId: id, caseId, action: 'create', diff: { register, after: n.fields, origin: item.origin } });
      }
    }
    const kind = d.kind === 'confirm' ? 'confirmed' : d.kind === 'correct' ? 'corrected' : 'rejected';
    const next = await this.writeVersion<ExtractionRun>(
      'extractions',
      runId,
      (p, version, at) => {
        const f = p?.fields.find((x) => x.id === fieldId);
        if (!p || !f || f.decision) throw new IntegrityError('That field has already been decided.');
        const decision = stripUndefined({ kind, at, entryId: entry?.id, itemId: item?.id, reason: d.kind === 'reject' ? d.reason?.trim() || undefined : undefined }) as FieldDecision;
        return { ...p, fields: p.fields.map((x) => (x.id === fieldId ? { ...x, decision } : x)), version, versionCreatedAt: at };
      },
      () => ({
        entity: 'extraction',
        entityId: runId,
        caseId,
        action: d.kind === 'confirm' ? 'confirm' : d.kind === 'correct' ? 'edit' : 'reject',
        diff: stripUndefined({
          fieldId,
          kind: field.kind,
          entryId: entry?.id,
          itemId: item?.id,
          changed: d.kind === 'correct' ? changedKeys(field.values, values) : undefined,
          reason: d.kind === 'reject' ? d.reason?.trim() || undefined : undefined,
        }),
      }),
      {
        caseId,
        extraAudit: createAudit ? [createAudit] : [],
        also: row ? { tables: [row.table], run: async () => void (await this.db.encryptedTable(row!.table).add(row!.row)) } : undefined,
      },
    );
    return { run: next, entry, item };
  }

  // ------------------------------------------------------------------ M3: case analysis drafts (owner decisions D2, D3)

  rawAnalyses(caseId: string): Promise<EncryptedRow[]> {
    return this.db.analyses.where('caseId').equals(caseId).toArray();
  }

  async decodeAnalyses(rows: EncryptedRow[]): Promise<CaseAnalysis[]> {
    const list = await this.decodeLatestOfAll<CaseAnalysis>('analyses', rows);
    return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  async listAnalyses(caseId: string): Promise<CaseAnalysis[]> {
    return this.decodeAnalyses(await this.rawAnalyses(caseId));
  }

  async addAnalysis(caseId: string, input: NewAnalysis): Promise<CaseAnalysis> {
    await this.writableCase(caseId);
    if (input.suggestions.some((x) => x.decision)) throw new IntegrityError('A new analysis cannot carry decisions.');
    const id = this.uuid();
    return this.writeVersion<CaseAnalysis>(
      'analyses',
      id,
      (_p, version, at) => ({ ...input, id, caseId, createdAt: at, version, versionCreatedAt: at }),
      (_p, next) => ({
        entity: 'analysis',
        entityId: id,
        caseId,
        action: 'create',
        actor: 'model',
        diff: {
          moduleId: next.moduleId,
          model: next.model,
          promptVersion: next.promptVersion,
          retrievedChunkIds: next.retrievedChunkIds,
          suggestions: next.suggestions.length,
          generalKnowledge: next.suggestions.filter((x) => x.basis === 'general_knowledge').length,
          checked: next.suggestions.filter((x) => x.checks.length > 0).length,
          dropped: next.dropped,
          usage: next.usage,
        },
      }),
      { caseId },
    );
  }

  /** Whether the data an analysis was built on has changed since (Section 7, staleness). */
  async isAnalysisStale(a: CaseAnalysis): Promise<boolean> {
    return analysisStale(a, await this.listEntries(a.caseId), await this.listItems(a.caseId));
  }

  /**
   * The trainee's decision on one suggestion — one at a time, never in bulk.
   * Accepting applies it (a checklist answer or a note on the task worksheet,
   * or a register row) in the same transaction as the decision; a rejection
   * needs a reason. A stale analysis cannot be accepted from: it must be
   * re-run on the current data first.
   */
  async decideSuggestion(caseId: string, analysisId: string, suggestionId: string, d: SuggestionDecisionInput): Promise<CaseAnalysis> {
    await this.writableCase(caseId);
    const a = await this.latest<CaseAnalysis>('analyses', analysisId);
    if (!a || a.caseId !== caseId) throw new IntegrityError('That analysis does not exist in this case.');
    const sg = a.suggestions.find((x) => x.id === suggestionId);
    if (!sg) throw new IntegrityError('That suggestion does not exist.');
    if (sg.decision) throw new IntegrityError('That suggestion has already been decided.');
    if (d.kind === 'reject' && !d.reason.trim()) throw new ValidationError({ reason: 'required' });
    const pending = d.kind === 'needs_evidence' || d.kind === 'needs_senior_review';
    if (pending && !(sg.kind === 'item' && sg.register === 'drp')) throw new ValidationError({ decision: 'invalidChoice' });
    if (pending && d.reason.trim().length < 3) throw new ValidationError({ reason: 'required' });
    if (d.kind !== 'reject' && (await this.isAnalysisStale(a))) throw new IntegrityError('The data changed after this analysis. Re-analyse before accepting its suggestions.');
    // M5: what the checks hold back is edited (in the trainee's own words) or rejected, never taken as it is.
    if ((d.kind === 'accept' || pending) && mustEdit(sg)) throw new IntegrityError('This suggestion must be edited or rejected: it cannot be accepted as it is.');
    // M5, decision 6: a drafted statement is accepted as it is only when the verifier found it supported, shown by a literal quote.
    // (A Problem Card may still be kept as waiting for evidence or for a senior review: it then stays out of the form.)
    const gated = !passesDraftGate(sg, analysisId, indexVerdicts(await this.listClaimChecks(caseId)).byOrigin);
    if (d.kind === 'accept' && gated) {
      throw new IntegrityError('The verifier has not found every statement of this suggestion supported by its source: edit it in your own words, or reject it.');
    }
    if (d.kind === 'edit' && (gated || mustEdit(sg))) {
      const unchanged = sg.kind === 'item' ? sameStrings(trimmedValues(sg.fields ?? {}), trimmedValues(d.fields ?? sg.fields ?? {})) : (d.text ?? '').trim() === (sg.text ?? '').trim();
      if (unchanged) throw new IntegrityError('Nothing was changed: a suggestion the checks hold back is edited in your own words, or rejected.');
    }

    let applied: SuggestionDecision['appliedTo'];
    let also: { tables: EncryptedTableName[]; run: () => Promise<void> } | undefined;
    const extraAudit: EncryptedRow[] = [];
    if (d.kind !== 'reject') {
      if (sg.kind === 'item') {
        const fields = (d.kind === 'edit' ? d.fields : undefined) ?? sg.fields ?? {};
        const n = normalizeItemFields(sg.register!, fields);
        if (!n.ok) throw new ValidationError(n.errors);
        if (sg.register === 'drp') n.fields = ownedClaims(n.fields, parseClaims(sg.fields?.claims));
        await this.checkItemRefs(caseId, sg.register!, n.fields);
        const id = this.uuid();
        const now = this.nowIso();
        const item: RegisterItem = {
          id,
          caseId,
          register: sg.register!,
          fields: n.fields,
          status: 'active',
          createdAt: now,
          version: 1,
          versionCreatedAt: now,
          origin: { kind: 'suggestion', analysisId, suggestionId },
          ...(sg.register === 'drp' ? { contentAt: now } : {}),
        };
        const row = await this.sealRow('items', { id: `${id}@1`, entityId: id, version: 1, caseId }, item);
        extraAudit.push(await this.auditRow({ entity: 'item', entityId: id, caseId, action: 'create', diff: { register: item.register, after: n.fields, origin: item.origin } }));
        applied = { kind: 'item', itemId: id };
        also = { tables: ['items'], run: async () => void (await this.db.items.add(row)) };
        if (item.register === 'drp') {
          // A Problem Card's review history starts with this decision on the model's draft (Section 8, Review).
          const decision: CardDecision = d.kind === 'accept' ? 'accepted' : d.kind === 'edit' ? 'edited' : d.kind;
          const review: CardReview = { ...this.newReview(caseId, item, decision, pending ? d.reason : undefined, false), fromSuggestion: { analysisId, suggestionId } };
          const reviewRow = await this.sealRow('cardReviews', { id: review.id, caseId }, review);
          extraAudit.push(await this.reviewAudit(review));
          also = {
            tables: ['items', 'cardReviews'],
            run: async () => {
              await this.db.items.add(row);
              await this.db.cardReviews.add(reviewRow);
            },
          };
        }
      } else {
        // A checklist answer or a note goes onto the task worksheet as its next version.
        const entityId = `${caseId}:${sg.taskId}`;
        const prev = await this.latest<TaskRecord>('tasks', entityId);
        const base: TaskInput = prev
          ? { status: prev.status, naReason: prev.naReason, checks: { ...prev.checks }, fields: { ...prev.fields }, notes: prev.notes }
          : { status: 'not_started', checks: {}, fields: {} };
        if (sg.kind === 'check') {
          base.checks[sg.scope ? `${sg.checkId}@${sg.scope}` : sg.checkId!] = sg.answer!;
        } else {
          const text = (d.kind === 'edit' ? d.text : sg.text) ?? '';
          base.notes = [base.notes?.trim(), text.trim()].filter(Boolean).join('\n');
        }
        if (base.status === 'not_started') base.status = 'in_progress';
        const n = normalizeTaskInput(sg.taskId, base);
        if (!n.ok) throw new ValidationError(n.errors);
        const version = (prev?.version ?? 0) + 1;
        const now = this.nowIso();
        const rec: TaskRecord = stripUndefined({ ...n.value, caseId, taskId: sg.taskId, version, versionCreatedAt: now, changeReason: 'Accepted from the AI draft' });
        const row = await this.sealRow('tasks', { id: `${entityId}@${version}`, entityId, version, caseId }, rec);
        extraAudit.push(
          await this.auditRow({ entity: 'task', entityId, caseId, action: 'update', diff: { task: sg.taskId, fromSuggestion: { analysisId, suggestionId }, status: { before: prev?.status ?? 'not_started', after: rec.status } } }),
        );
        applied = { kind: 'task', taskId: sg.taskId, version };
        also = { tables: ['tasks'], run: async () => void (await this.db.tasks.add(row)) };
      }
    }
    const kind: SuggestionDecision['kind'] = d.kind === 'accept' ? 'accepted' : d.kind === 'edit' ? 'edited' : d.kind === 'reject' ? 'rejected' : d.kind;
    const reasonOf = d.kind === 'reject' || pending ? d.reason.trim() : undefined;
    return this.writeVersion<CaseAnalysis>(
      'analyses',
      analysisId,
      (p, version, at) => {
        const cur = p?.suggestions.find((x) => x.id === suggestionId);
        if (!p || !cur || cur.decision) throw new IntegrityError('That suggestion has already been decided.');
        const decision = stripUndefined({ kind, at, reason: reasonOf, appliedTo: applied }) as SuggestionDecision;
        return { ...p, suggestions: p.suggestions.map((x) => (x.id === suggestionId ? { ...x, decision } : x)), version, versionCreatedAt: at };
      },
      () => ({
        entity: 'suggestion',
        entityId: `${analysisId}:${suggestionId}`,
        caseId,
        action: d.kind === 'accept' ? 'accept' : d.kind === 'edit' ? 'edit' : d.kind === 'reject' ? 'reject' : REVIEW_ACTION[d.kind],
        diff: stripUndefined({ taskId: sg.taskId, kind: sg.kind, basis: sg.basis, appliedTo: applied, reason: reasonOf }),
      }),
      { caseId, extraAudit, also },
    );
  }

  // ------------------------------------------------------------------ open-data cache (Section 19: the same lookup never costs twice)

  // ------------------------------------------------------------------ M2: calculations

  rawCalcResults(caseId: string): Promise<EncryptedRow[]> {
    return this.db.calcResults.where('caseId').equals(caseId).toArray();
  }

  async decodeCalcResults(rows: EncryptedRow[]): Promise<CalcResult[]> {
    const results = await this.openRows<CalcResult>('calcResults', rows);
    return results.sort((a, b) => (a.computedAt < b.computedAt ? -1 : a.computedAt > b.computedAt ? 1 : a.id < b.id ? -1 : 1));
  }

  async listCalcResults(caseId: string): Promise<CalcResult[]> {
    return this.decodeCalcResults(await this.rawCalcResults(caseId));
  }

  /** What a calculator reads: the effective timeline, the case's demographics, and values still waiting for confirmation. */
  async calculationContext(caseId: string): Promise<GatherContext> {
    const c = await this.getCase(caseId);
    if (!c) throw new IntegrityError(`Case ${caseId} does not exist.`);
    const [entries, runs, attachments] = await Promise.all([this.listEntries(caseId), this.listExtractions(caseId), this.listAttachments(caseId)]);
    const active = new Set(attachments.filter((a) => a.status === 'active').map((a) => a.id));
    return { demographics: c.demographics, current: indexTimeline(entries).current, pending: pendingFromRuns(runs, active) };
  }

  /**
   * Run a calculator on the stored record and persist its result (append-only,
   * audited). Inputs are always read here from stored data, never taken from the
   * screen. A calculator shown together with another (QTc) runs as a pair and
   * both results share a group id; if either is refused, nothing is stored.
   */
  async calculate(caseId: string, calcId: CalculatorId, req: GatherRequest = {}): Promise<CalculateOutcome> {
    await this.writableCase(caseId);
    const calc = this.calculators.get(calcId);
    if (!calc) throw new IntegrityError(`Unknown calculator ${calcId}.`);
    const ctx = await this.calculationContext(caseId);
    const ids: CalculatorId[] = calc.pairedWith ? [calcId, calc.pairedWith] : [calcId];
    const groupId = calc.pairedWith ? this.uuid() : undefined;
    const results: CalcResult[] = [];
    for (const id of ids) {
      const c = this.calculators.get(id);
      if (!c) throw new IntegrityError(`Unknown calculator ${id}.`);
      const outcome = runCalculator(c, ctx, req, { caseId, now: this.now, uuid: this.uuid, ...(groupId ? { groupId } : {}) });
      if (!outcome.ok) return { ok: false, problems: outcome.problems, inputs: outcome.inputs, pendingKeys: outcome.pendingKeys };
      results.push(outcome.result);
    }
    const rows: EncryptedRow[] = [];
    const audits: EncryptedRow[] = [];
    for (const r of results) {
      rows.push(await this.sealRow('calcResults', { id: r.id, caseId }, r));
      audits.push(
        await this.auditRow({
          entity: 'calc_result',
          entityId: r.id,
          caseId,
          action: 'create',
          diff: { calc: r.calc, formulaVersion: r.formulaVersion, value: r.value, unit: r.unit, inputs: r.inputs.values, units: r.inputs.units, entryIds: r.inputs.entryIds },
        }),
      );
    }
    await this.db.transaction('rw', [this.db.calcResults, this.db.audit], async () => {
      for (const row of rows) await this.db.calcResults.add(row);
      for (const a of audits) await this.db.audit.add(a);
    });
    return { ok: true, results };
  }

  // ------------------------------------------------------------------ M2: reference tables (formulary, adjustments, thresholds, ONC list)

  rawReference(kind: ReferenceKind): Promise<EncryptedRow[]> {
    return this.db.encryptedTable(REFERENCE_TABLE[kind]).toArray();
  }

  async decodeReference<T extends Versioned>(kind: ReferenceKind, rows: EncryptedRow[]): Promise<T[]> {
    return this.decodeLatestOfAll<T>(REFERENCE_TABLE[kind], rows);
  }

  async listReference<T extends Versioned>(kind: ReferenceKind): Promise<T[]> {
    return this.decodeReference<T>(kind, await this.rawReference(kind));
  }

  referenceHistory<T extends Versioned>(kind: ReferenceKind, id: string): Promise<T[]> {
    return this.history<T>(REFERENCE_TABLE[kind], id);
  }

  /**
   * Add a reference record, or a new version of one (with a reason). The
   * ingredients come from the offline RxNorm match the trainee saw on screen.
   */
  async saveReference(
    kind: ReferenceKind,
    id: string | undefined,
    values: Record<string, string>,
    match: { rxcui?: string; ingredients: string[]; onc?: { sideA: OncResolved; sideB: OncResolved } } = { ingredients: [] },
    reason?: string,
  ): Promise<ReferenceRecord> {
    const n =
      kind === 'formulary'
        ? normalizeFormulary(values, match)
        : kind === 'adjustment'
          ? normalizeAdjustment(values, match.ingredients)
          : kind === 'threshold'
            ? normalizeThreshold(values)
            : normalizeOnc(values, match.onc);
    if (!n.ok) throw new ValidationError(n.errors as Errors);
    const table = REFERENCE_TABLE[kind];
    const entityId = id ?? this.uuid();
    if (id) {
      const prev = await this.latest<FormularyItem>(table, id);
      if (!prev) throw new IntegrityError('That record does not exist.');
      if (!reason?.trim()) throw new ValidationError({ reason: 'required' });
    }
    return this.writeVersion<ReferenceRecord>(
      table,
      entityId,
      (prev, version, at) =>
        ({
          ...n.value,
          id: entityId,
          status: 'active',
          createdAt: prev?.createdAt ?? at,
          version,
          versionCreatedAt: at,
          ...(prev ? { changeReason: reason!.trim() } : {}),
        }) as ReferenceRecord,
      (prev, next) => ({ entity: kind, entityId, action: prev ? 'update' : 'create', diff: { before: prev, after: next } }),
    );
  }

  async retractReference(kind: ReferenceKind, id: string, reason: string): Promise<ReferenceRecord> {
    if (!reason.trim()) throw new ValidationError({ reason: 'required' });
    const table = REFERENCE_TABLE[kind];
    const prev = await this.latest<ReferenceRecord>(table, id);
    if (!prev) throw new IntegrityError('That record does not exist.');
    if (prev.status === 'retracted') return prev;
    return this.writeVersion<ReferenceRecord>(
      table,
      id,
      (p, version, at) => ({ ...p!, status: 'retracted', version, versionCreatedAt: at, changeReason: reason.trim() }),
      () => ({ entity: kind, entityId: id, action: 'retract', diff: { reason: reason.trim() } }),
    );
  }

  // ------------------------------------------------------------------ M2: alerts (firings, acknowledgements) and causality

  rawAlertAcks(caseId: string): Promise<EncryptedRow[]> {
    return this.db.alertAcks.where('caseId').equals(caseId).toArray();
  }

  async decodeAlertAcks(rows: EncryptedRow[]): Promise<AlertAck[]> {
    return (await this.openRows<AlertAck>('alertAcks', rows)).sort((a, b) => (a.at < b.at ? -1 : 1));
  }

  async listAlertAcks(caseId: string): Promise<AlertAck[]> {
    return this.decodeAlertAcks(await this.rawAlertAcks(caseId));
  }

  /** Every firing and acknowledgement of every case, for the per-rule counts. */
  async allAlertRecords(): Promise<{ firings: AlertFiring[]; acks: AlertAck[] }> {
    const [f, a] = await Promise.all([this.db.alertFirings.toArray(), this.db.alertAcks.toArray()]);
    return { firings: await this.openRows<AlertFiring>('alertFirings', f), acks: await this.openRows<AlertAck>('alertAcks', a) };
  }

  /** Firings are recorded one call at a time, so two screens showing the same alert count it once. */
  private firingQueue: Promise<unknown> = Promise.resolve();

  /** Record the alerts shown for the first time (one record per key and data hash). */
  recordAlertFirings(caseId: string, alerts: readonly Pick<Alert, 'key' | 'ruleId' | 'level' | 'dataHash'>[]): Promise<number> {
    const run = this.firingQueue.then(() => this.recordFreshFirings(caseId, alerts));
    this.firingQueue = run.catch(() => undefined);
    return run;
  }

  private async recordFreshFirings(caseId: string, alerts: readonly Pick<Alert, 'key' | 'ruleId' | 'level' | 'dataHash'>[]): Promise<number> {
    if (!alerts.length) return 0;
    const seen = new Set((await this.openRows<AlertFiring>('alertFirings', await this.db.alertFirings.where('caseId').equals(caseId).toArray())).map((f) => `${f.key}#${f.dataHash}`));
    const fresh = alerts.filter((a) => !seen.has(`${a.key}#${a.dataHash}`));
    if (!fresh.length) return 0;
    const at = this.nowIso();
    const rows = await Promise.all(
      fresh.map((a) => {
        const f: AlertFiring = { id: this.uuid(), caseId, key: a.key, ruleId: a.ruleId, level: a.level, dataHash: a.dataHash, at };
        return this.sealRow('alertFirings', { id: f.id, caseId }, f);
      }),
    );
    await this.db.transaction('rw', [this.db.alertFirings], async () => {
      for (const r of rows) await this.db.alertFirings.add(r);
    });
    return rows.length;
  }

  /** Acknowledge an alert. A reason is always required (Section 10). */
  async acknowledgeAlert(caseId: string, alert: Pick<Alert, 'key' | 'ruleId' | 'level' | 'dataHash'>, reason: string): Promise<AlertAck> {
    await this.writableCase(caseId);
    const r = reason.trim();
    if (r.length < 3) throw new ValidationError({ reason: 'required' });
    if (r.length > 1000) throw new ValidationError({ reason: 'tooLong' });
    const ack: AlertAck = { id: this.uuid(), caseId, key: alert.key, ruleId: alert.ruleId, level: alert.level, dataHash: alert.dataHash, reason: r, at: this.nowIso() };
    const row = await this.sealRow('alertAcks', { id: ack.id, caseId }, ack);
    const auditRow = await this.auditRow({ entity: 'alert', entityId: alert.key, caseId, action: 'acknowledge', diff: { ruleId: alert.ruleId, level: alert.level, dataHash: alert.dataHash, reason: r } });
    await this.db.transaction('rw', [this.db.alertAcks, this.db.audit], async () => {
      await this.db.alertAcks.add(row);
      await this.db.audit.add(auditRow);
    });
    return ack;
  }

  rawCausality(caseId: string): Promise<EncryptedRow[]> {
    return this.db.causality.where('caseId').equals(caseId).toArray();
  }

  async decodeCausality(rows: EncryptedRow[]): Promise<CausalityAssessment[]> {
    return this.decodeLatestOfAll<CausalityAssessment>('causality', rows);
  }

  /** Save a complete questionnaire for an ADR row as a new version; the score or category is computed here. */
  async saveCausality(caseId: string, itemId: string, method: 'naranjo' | 'who_umc', answers: Record<string, string>): Promise<CausalityAssessment> {
    await this.writableCase(caseId);
    const item = await this.latest<RegisterItem>('items', itemId);
    if (!item || item.caseId !== caseId || item.register !== 'adr') throw new IntegrityError('That suspected ADR does not exist in this case.');
    const result = method === 'naranjo' ? scoreNaranjo(answers) : assessUmc(answers);
    if (!result.ok) throw new ValidationError(Object.fromEntries(result.unanswered.map((k) => [k, 'required' as const])));
    const entityId = `${itemId}:${method}`;
    const clean = Object.fromEntries(Object.entries(answers).filter(([, v]) => v));
    return this.writeVersion<CausalityAssessment>(
      'causality',
      entityId,
      (prev, version, at) => ({
        id: entityId,
        caseId,
        itemId,
        method,
        answers: clean,
        ...('score' in result ? { score: result.score } : {}),
        category: result.category,
        createdAt: prev?.createdAt ?? at,
        version,
        versionCreatedAt: at,
      }),
      (prev, next) => ({ entity: 'causality', entityId, caseId, action: prev ? 'update' : 'create', diff: { method, category: next.category, score: next.score, answers: clean } }),
      { caseId },
    );
  }

  async getLookup<T>(id: string): Promise<{ value: T; retrievedAt: string } | undefined> {
    const row = await this.db.lookups.get(id);
    return row ? this.openRow<{ value: T; retrievedAt: string }>('lookups', row) : undefined;
  }

  async putLookup<T>(id: string, value: T): Promise<void> {
    await this.db.lookups.put(await this.sealRow('lookups', { id }, { value, retrievedAt: this.nowIso() }));
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

  // ------------------------------------------------------------------ AI settings (M3)

  /** The AI settings; the installation id is created on first use. */
  async getAiSettings(): Promise<AiSettings> {
    const row = await this.db.settings.get('ai');
    if (row) return this.openRow<AiSettings>('settings', row);
    const created: AiSettings = { installId: newInstallId(this.uuid), models: {} };
    const sealed = await this.sealRow('settings', { id: 'ai' }, created);
    const auditRow = await this.auditRow({ entity: 'settings', entityId: 'ai', action: 'create', actor: 'system', diff: { after: auditView(created) } });
    await this.db.transaction('rw', [this.db.settings, this.db.audit], async () => {
      if (await this.db.settings.get('ai')) return; // another tab created it first
      await this.db.settings.add(sealed);
      await this.db.audit.add(auditRow);
    });
    const now = await this.db.settings.get('ai');
    return now ? this.openRow<AiSettings>('settings', now) : created;
  }

  async updateAiSettings(input: AiSettingsInput): Promise<AiSettings> {
    const prev = await this.getAiSettings();
    const n = normalizeAiSettings(prev, input);
    if (!n.ok) throw new ValidationError(n.errors);
    const row = await this.sealRow('settings', { id: 'ai' }, n.value);
    // The access code itself is never written to the audit log.
    const auditRow = await this.auditRow({ entity: 'settings', entityId: 'ai', action: 'update', diff: { before: auditView(prev), after: auditView(n.value) } });
    await this.db.transaction('rw', [this.db.settings, this.db.audit], async () => {
      await this.db.settings.put(row);
      await this.db.audit.add(auditRow);
    });
    return n.value;
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

function isJpeg(b: Uint8Array): boolean {
  return b.byteLength > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function sameStrings(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

const toHex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

/** The metadata fields a document's new version changed (for the audit log). */
function changedMeta(prev: LibraryDocument | undefined, next: LibraryDocument): string[] {
  const keys = ['title', 'publisher', 'year', 'edition', 'url', 'licence', 'aiUse', 'role', 'topic', 'retrievedOn'] as const;
  return keys.filter((k) => prev?.[k] !== next[k]);
}

/** A card's fields with each claim marked the model's exactly when its words are a drafted claim's (problem-card.ts). */
function ownedClaims(fields: Record<string, string>, drafted: readonly CardClaim[]): Record<string, string> {
  if (!fields.claims) return fields;
  const { claims: _old, ...rest } = fields;
  const claims = markModelClaims(fields.claims, drafted);
  return claims ? { ...rest, claims } : rest;
}

/** Values as compared for "nothing was changed": trimmed, empty ones left out. */
function trimmedValues(r: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(r).flatMap(([k, v]) => (v?.trim() ? [[k, v.trim()]] : [])));
}

function sameTask(prev: TaskRecord, next: TaskInput): boolean {
  return (
    prev.status === next.status &&
    (prev.naReason ?? '') === (next.naReason ?? '') &&
    (prev.notes ?? '') === (next.notes ?? '') &&
    sameStrings(prev.checks, next.checks) &&
    sameStrings(prev.fields, next.fields)
  );
}

function prefix(o: Record<string, string> | undefined, p: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o ?? {})) out[p + k] = v;
  return out;
}

function changedKeys(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

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


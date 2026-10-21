/**
 * Core data model (Section 7). Field names follow the specification; every
 * extension added for M1 is marked "M1 extension" with its reason.
 */

export const PROVENANCE_STATES = [
  'extracted_unverified',
  'user_entered',
  'confirmed',
  'calculated',
  'ai_suggestion',
  'trainee_decision',
  'implemented',
  'outcome_documented',
] as const;
export type ProvenanceState = (typeof PROVENANCE_STATES)[number];

export type CaseKind = 'teaching' | 'clinical'; // never mixed in one record
export type Sex = 'M' | 'F';
export type CaseStatus = 'active' | 'discharged' | 'archived';

/** Fields every versioned record carries. Versions are append-only; the highest version is current. */
export interface Versioned {
  version: number;
  versionCreatedAt: string;
  /** Why this version was created (required for every version after the first). */
  changeReason?: string;
}

export interface Case extends Versioned {
  id: string; // CASE-1042 — random, never derived from the MRN
  kind: CaseKind;
  rotationId: string;
  deidentified: true; // clinical cases only exist de-identified
  demographics: { ageYears: number; sex: Sex; heightCm?: number };
  admissionDay0: string; // anchor date (YYYY-MM-DD); all entries use hospitalDay
  status: CaseStatus;
  createdAt: string;
  /** M1 extension: ward or unit name for form Section 1. Not an identifier; room/bed lives in CaseIdentifiers. */
  ward?: string;
  /** M1 extension: calendar discharge date (YYYY-MM-DD), required when status becomes 'discharged'. */
  dischargeDate?: string;
  /** M1 extension: release-gate attestation that the case holds synthetic data only (Section 23). */
  syntheticDataAttestedAt?: string;
}

/**
 * The separate, encrypted identifier field group (Section 15, "The identifier rule").
 * Clinical cases only — a Teaching Case never has these fields at all.
 * Never part of a Case object, an analysis context or any model payload.
 */
export interface CaseIdentifiers extends Versioned {
  caseId: string;
  patientName?: string;
  mrn?: string;
  roomBed?: string;
  consultantName?: string;
}

export const DEPARTMENTS = [
  'internal_medicine',
  'icu',
  'cardiology',
  'nephrology',
  'oncology_haematology',
  'infectious_disease',
  'paediatrics',
  'emergency',
  'other',
] as const;
export type DepartmentId = (typeof DEPARTMENTS)[number];

/** Competency areas adapted from ASHP residency areas and ACCP competencies (Section 17). Not ASHP-accredited. */
export const COMPETENCY_AREAS = [
  'direct_patient_care',
  'pharmacotherapy_knowledge',
  'systems_based_care',
  'communication',
  'professionalism',
  'continuing_development',
] as const;
export type CompetencyArea = (typeof COMPETENCY_AREAS)[number];

export interface Rotation extends Versioned {
  id: string;
  department: DepartmentId;
  departmentOther?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  competencies: CompetencyArea[];
  goals?: string;
  createdAt: string;
}

// ---------------------------------------------------------------- timeline

export const ENTRY_TYPES = [
  'lab',
  'vital',
  'med_start',
  'med_change',
  'med_stop',
  'imaging',
  'procedure',
  'culture',
  'note',
  'weight',
  'event',
  'intervention',
  'outcome',
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Entry types a trainee can create by manual entry in M1. Interventions and outcomes need Problem Cards (M4/M6). */
export const M1_MANUAL_ENTRY_TYPES = [
  'lab',
  'vital',
  'weight',
  'med_start',
  'culture',
  'imaging',
  'procedure',
  'note',
  'event',
] as const satisfies readonly EntryType[];

export type LabResult = { kind: 'numeric'; value: number } | { kind: 'text'; text: string };

export interface LabPayload {
  analyte: string; // catalogue id, or 'other'
  analyteName: string; // English clinical name, as displayed
  result: LabResult;
  unit: string; // always explicit; 'unitless' for dimensionless results such as INR
  refLow?: number;
  refHigh?: number;
  refText?: string;
  comment?: string;
}

export type VitalKind =
  | 'heart_rate'
  | 'blood_pressure'
  | 'respiratory_rate'
  | 'temperature'
  | 'spo2'
  | 'gcs'
  | 'urine_output';

export interface VitalPayload {
  vital: VitalKind;
  value?: number; // every vital except blood pressure
  systolic?: number; // blood pressure only
  diastolic?: number; // blood pressure only
  unit: string;
  periodHours?: number; // urine output only
  comment?: string;
}

export type WeightMethod = 'measured' | 'stated' | 'estimated';
export interface WeightPayload {
  value: number;
  unit: 'kg';
  method: WeightMethod;
}

export type DoseSpec = { kind: 'structured'; value: number; unit: string } | { kind: 'text'; text: string };

export interface MedStartPayload {
  medId: string; // stable id of the medication course; changes and stops refer to it
  drug: string; // generic name as written in the chart
  brand?: string;
  dose: DoseSpec;
  route: string;
  frequency: string;
  indication?: string;
  notes?: string;
}

export interface MedChangePayload {
  medId: string;
  drug: string;
  dose?: DoseSpec;
  route?: string;
  frequency?: string;
  reason?: string;
}

export interface MedStopPayload {
  medId: string;
  drug: string;
  reason?: string;
}

export interface ImagingPayload {
  modality: string;
  region?: string;
  reportText: string; // the written report, transcribed. PRECEPTOR never interprets images.
}

export interface ProcedurePayload {
  name: string;
  details?: string;
}

export type CultureStatus = 'pending' | 'no_growth' | 'growth' | 'contaminant_suspected';
export interface CulturePayload {
  specimen: string;
  status: CultureStatus;
  organism?: string;
  gramStain?: string;
  susceptibility?: string;
}

export type HabitStatus = 'current' | 'former' | 'never' | 'unknown';
export type TextNoteCategory = 'chief_complaint' | 'hpi' | 'pmh' | 'psh' | 'family_history' | 'progress' | 'other';
export type AllergyKind = 'allergy' | 'adr' | 'intolerance' | 'nkda';
export type ProblemStatus = 'active' | 'improving' | 'worsening' | 'resolved' | 'inactive';
/** M2 (M2 plan, decision 7 — proposed default): renal replacement therapy, needed by the Verify gate for renal dose reviews. */
export type RrtStatus = 'none' | 'intermittent_hd' | 'peritoneal' | 'crrt';

export type NotePayload =
  | { category: TextNoteCategory; text: string }
  | {
      category: 'allergy_adr';
      kind: AllergyKind;
      substance?: string; // required unless kind is 'nkda'
      reaction?: string;
      severity?: 'mild' | 'moderate' | 'severe' | 'unknown';
    }
  | {
      category: 'social_history';
      khat: HabitStatus; // required in this setting (Section 15, form Section 2)
      khatDetails?: string;
      tobacco: HabitStatus;
      tobaccoDetails?: string;
      alcohol?: HabitStatus;
      occupation?: string;
      other?: string;
    }
  | {
      category: 'problem';
      problemId: string; // stable id; later status updates refer to it
      name: string;
      acuity: 'acute' | 'chronic';
      status: ProblemStatus;
      stage?: string;
      problemType?: string;
      duration?: string;
      primaryDiagnosis: boolean;
    }
  | {
      /** M2 extension (decision 7): dialysis status as a structured, dated record. */
      category: 'renal_replacement';
      status: RrtStatus;
      details?: string;
    };
export type NoteCategory = NotePayload['category'];

export type EventCategory =
  | 'admission'
  | 'transfer'
  | 'icu_admission'
  | 'icu_discharge'
  | 'surgery'
  | 'rapid_response'
  | 'other';
export interface EventPayload {
  category: EventCategory;
  description: string;
}

/** Defined for completeness; created from Problem Cards in M4/M6. "Requires who and when." */
export interface InterventionPayload {
  problemCardId?: string;
  description: string;
  by: string;
  at: string;
}
/** Defined for completeness; created in M6. "Requires the measurement." */
export interface OutcomePayload {
  problemCardId?: string;
  measured: string;
  goalMet: boolean | null;
}

export interface PayloadMap {
  lab: LabPayload;
  vital: VitalPayload;
  med_start: MedStartPayload;
  med_change: MedChangePayload;
  med_stop: MedStopPayload;
  imaging: ImagingPayload;
  procedure: ProcedurePayload;
  culture: CulturePayload;
  note: NotePayload;
  weight: WeightPayload;
  event: EventPayload;
  intervention: InterventionPayload;
  outcome: OutcomePayload;
}

export interface Correction {
  kind: 'amend' | 'retract'; // retract = "entered in error"; the payload is kept unchanged for readability
  reason: string;
}

interface EntryBase {
  id: string;
  caseId: string;
  hospitalDay: number; // 0, 1, 2 … not a calendar date (negative = before admission)
  /** M1 extension: optional clock time (HH:MM). Needed later for level draw times relative to doses. */
  timeOfDay?: string;
  recordedAt: string;
  author: 'user' | 'ai_extracted';
  unit?: string;
  sourceAttachmentId?: string;
  provenance: ProvenanceState;
  supersedesEntryId?: string; // a correction points at what it replaces
  /** M1 extension: present on every correction — what kind, and why. */
  correction?: Correction;
  /** M3 extension: the extracted field this entry confirms, and where it is on the page. */
  extraction?: { runId: string; fieldId: string; box?: [number, number, number, number] };
}

/** APPEND-ONLY — never updated in place. Discriminated on `type`. */
export type TimelineEntry = { [K in EntryType]: EntryBase & { type: K; payload: PayloadMap[K] } }[EntryType];
export type EntryOf<K extends EntryType> = Extract<TimelineEntry, { type: K }>;

// ---------------------------------------------------------------- source documents (Section 7 "Attachment", Section 13)

/** What kind of chart document a source is. Used to label and group the patient file. */
export const SOURCE_DOC_TYPES = [
  'admission_note',
  'progress_note',
  'lab_report',
  'medication_chart',
  'prescription',
  'vital_signs',
  'diagnostic_report',
  'referral_letter',
  'discharge_summary',
  'handover',
  'other',
] as const;
export type SourceDocType = (typeof SOURCE_DOC_TYPES)[number];

export type AttachmentOrigin = 'typed' | 'text_file' | 'camera' | 'image_file' | 'pdf_page';

/**
 * A source document of the patient file: typed or pasted text, a text file, a
 * photographed or uploaded page, or a rendered PDF page.
 *
 * M1 extensions to the specification's Attachment: the content lives in a
 * separate encrypted row (table `blobs`) so that it can be purged — a page
 * found to still show an identifier must be removable, because "the
 * unredacted original is never stored" (Section 13) outranks keeping it. The
 * metadata stays append-only and the removal is audited.
 */
export interface Attachment extends Versioned {
  id: string;
  caseId: string;
  kind: 'text' | 'image';
  mime: 'text/plain' | 'image/jpeg';
  docType: SourceDocType;
  title?: string;
  /** The hospital day the document refers to, when known. */
  hospitalDay?: number;
  origin: AttachmentOrigin;
  /** Pages captured together share a group id and are numbered from 1. */
  groupId?: string;
  page?: number;
  width?: number;
  height?: number;
  byteLength: number;
  /** Identifiers removed and confirmed by the trainee before anything was stored. Never false: unredacted content is never stored. */
  redacted: true;
  redactionConfirmedAt: string;
  status: 'active' | 'removed';
  removedReason?: string;
  createdAt: string;
  /** Specification field, used from M3 (model extraction). */
  extractionRunId?: string;
}

// ---------------------------------------------------------------- clinical modules (owner's change request, M1 revision)

export type TaskStatus = 'not_started' | 'in_progress' | 'done' | 'not_applicable';
/** A checklist answer: done/no problem, a problem found, or not applicable. Unanswered items have no key. */
export type CheckValue = 'ok' | 'issue' | 'na';

/** The trainee's worksheet for one of the thirty clinical pharmacist tasks in one case. Versioned; never overwritten. */
export interface TaskRecord extends Versioned {
  caseId: string;
  taskId: string;
  status: TaskStatus;
  /** Required when status is 'not_applicable'. */
  naReason?: string;
  /** Checklist answers by item id; items repeated per medication or problem use `${itemId}@${scopeId}`. */
  checks: Record<string, CheckValue>;
  /** Text and choice answers by field id, scoped the same way. */
  fields: Record<string, string>;
  notes?: string;
}

/** Lists shared between tasks (enter data once). */
export const REGISTER_IDS = [
  'home_med',
  'drp',
  'interaction',
  'adr',
  'med_error',
  'tdm',
  'monitoring',
  'rounds',
  'counseling',
  'discharge_med',
  'reference',
  'calc_check',
] as const;
export type RegisterId = (typeof REGISTER_IDS)[number];

/** One row of a register (a home medication, a drug-related problem, an interaction…). Versioned; never overwritten. */
export interface RegisterItem extends Versioned {
  id: string;
  caseId: string;
  register: RegisterId;
  /** Values validated against the register's schema. Multi-choice values are joined with "|". */
  fields: Record<string, string>;
  status: 'active' | 'retracted';
  createdAt: string;
  /** M3 extension: the row was confirmed from a document the model read, or accepted from the model's draft. */
  origin?: { kind: 'extraction'; runId: string; fieldId: string; attachmentId: string } | { kind: 'suggestion'; analysisId: string; suggestionId: string };
  /**
   * M4, a Problem Card: when its clinical content was last written or reviewed again on the data of the time.
   * Recording communication, implementation or outcome does not move it, so it does not make a stale card current.
   */
  contentAt?: string;
}

// ---------------------------------------------------------------- M3: what the model read (Section 7 ExtractionRun, Section 13)

/** Why an extracted field needs a look before it is confirmed. */
export const EXTRACTION_FLAGS = [
  'illegible',
  'uncertain_reading',
  'handwritten',
  'handwritten_dose',
  'name_unmatched',
  'unit_unknown',
  'out_of_range',
  'abbreviation',
  'route_unmatched',
  'frequency_unmatched',
  'dose_unparsed',
  'value_not_number',
  'no_day',
  'day_from_document',
  'needs_choice',
  'dual_pass_disagreement',
  'single_pass',
  'drug_unmatched',
  'drug_not_checked',
  'identifier_in_output',
] as const;
export type ExtractionFlag = (typeof EXTRACTION_FLAGS)[number];

export type ExtractionTarget = { kind: 'entry'; type: EntryType } | { kind: 'register'; register: 'home_med' | 'discharge_med' };

/** One field read from a document, as a draft. It is never used until the trainee confirms or corrects it. */
export interface ExtractedField {
  id: string;
  kind: 'lab' | 'vital' | 'weight' | 'medication' | 'allergy' | 'problem' | 'history' | 'social' | 'culture' | 'imaging' | 'procedure' | 'event';
  medContext?: 'home' | 'inpatient' | 'discharge' | 'unknown';
  target: ExtractionTarget;
  /** The same form values a typed entry (or register row) would have. */
  values: Record<string, string>;
  day?: number;
  timeOfDay?: string;
  /** Exactly what was read, shown beside the value. */
  rawText: string;
  legibility: 'clear' | 'uncertain' | 'illegible';
  handwritten: boolean;
  /** [ymin, xmin, ymax, xmax] scaled 0–1000 of the page. */
  box?: [number, number, number, number];
  flags: ExtractionFlag[];
  note?: string;
  /** The second reading, when the two disagreed. */
  alternative?: string;
  drug?: { status: 'matched' | 'unmatched' | 'not_checked'; rxcui?: string; name?: string };
  decision?: FieldDecision;
}

export interface FieldDecision {
  kind: 'confirmed' | 'corrected' | 'rejected';
  at: string;
  entryId?: string;
  itemId?: string;
  reason?: string;
}

/** One reading of one document (Section 7). Versioned: each decision on a field is a new version. */
export interface ExtractionRun extends Versioned {
  id: string;
  caseId: string;
  attachmentId: string;
  model: string;
  /** The model of the second reading, when there was one. */
  secondModel?: string;
  promptVersion: string;
  runAt: string;
  passes: 1 | 2;
  readable: boolean;
  fields: ExtractedField[];
  /** What the last check before sending did to the text. */
  sent: { identifiersMasked: number; datesReplaced: number };
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

// ---------------------------------------------------------------- M3: case analysis drafts (owner decisions D2, D3 of 16 Oct 2026)

/** What a statement rests on: the case data sent (with its references), or the model's general knowledge (no source). */
export type ClaimBasis = 'case_data' | 'general_knowledge';

/** What the checks in code did to a suggestion (Section 12, "verification enforced in code"). */
export const SUGGESTION_CHECKS = [
  'unknown_ref_removed',
  'no_valid_ref',
  'number_removed',
  'dose_withheld',
  'citation_removed',
  'source_named',
  'invalid_value_removed',
  'trainee_only_removed',
  'incomplete',
  /** M5: a drafted Problem Card whose PCNE classification disagrees with its own problem sentence (pcne-coherence.ts). */
  'classification_questioned',
  /** M5: a text that says something was done ("were reconciled"): only the trainee records what was done. */
  'states_action',
  /** M5: a Problem Card for a problem that already has one (the same drugs and PCNE problem). */
  'duplicate_card',
] as const;
/**
 * Whether a suggestion can only be edited or rejected, not accepted as it is:
 * it is incomplete, its classification is questioned, or a text it would store
 * says that something was done (a checklist answer stores its answer only).
 */
export const mustEdit = (s: Pick<Suggestion, 'kind' | 'checks'>): boolean =>
  s.checks.includes('incomplete') || s.checks.includes('classification_questioned') || (s.kind !== 'check' && s.checks.includes('states_action'));
export type SuggestionCheck = (typeof SUGGESTION_CHECKS)[number];

/** One proposal of the model for one task. It changes nothing until the trainee accepts or edits it. */
export interface Suggestion {
  id: string;
  taskId: string;
  kind: 'check' | 'item' | 'note';
  /** check: a checklist item (scoped per medication or problem with `scope`) and the proposed answer. */
  checkId?: string;
  scope?: string;
  answer?: CheckValue;
  /** item: a row for one of the task's registers. */
  register?: RegisterId;
  fields?: Record<string, string>;
  /** note: summary, missing data or a question to ask. */
  noteKind?: 'summary' | 'missing' | 'question';
  text?: string;
  /** Why, as the model put it after the checks in code. */
  reason: string;
  basis: ClaimBasis;
  /** References to the case data that was sent (timeline entries and register rows). */
  refs: { kind: 'entry' | 'item' | 'medication' | 'problem' | 'calc'; id: string; label: string }[];
  checks: SuggestionCheck[];
  decision?: SuggestionDecision;
}

export interface SuggestionDecision {
  /** M4: a drafted Problem Card can also be kept as a card waiting for more evidence or for a senior review. */
  kind: 'accepted' | 'edited' | 'rejected' | 'needs_evidence' | 'needs_senior_review';
  at: string;
  reason?: string;
  /** What accepting changed: a task version, or a register row. */
  appliedTo?: { kind: 'task'; taskId: string; version: number } | { kind: 'item'; itemId: string };
}

/** One analysis of one module (Section 7 AnalysisVersion). Versioned: each decision is a new version. */
export interface CaseAnalysis extends Versioned {
  id: string;
  caseId: string;
  moduleId: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  /** Exactly what was sent, for staleness: entries and register rows (ids and versions). */
  basedOn: { entryIds: string[]; items: string[] };
  /** Evidence chunks used (none until the evidence library, M5). */
  retrievedChunkIds: string[];
  suggestions: Suggestion[];
  /** Proposals dropped by the checks (unknown task, check or register). */
  dropped: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

// ---------------------------------------------------------------- M4: review of Problem Cards (Section 8, Review)

/** The five decisions on a Problem Card's recommendation (Section 8): accept, edit, reject, request more evidence, needs senior review. */
export const CARD_DECISIONS = ['accepted', 'edited', 'rejected', 'needs_evidence', 'needs_senior_review'] as const;
export type CardDecision = (typeof CARD_DECISIONS)[number];
/** Decisions that are refused without their reason: what is wrong, what evidence is needed, why a senior should review. */
export const DECISIONS_NEEDING_REASON: ReadonlySet<CardDecision> = new Set<CardDecision>(['rejected', 'needs_evidence', 'needs_senior_review']);

/**
 * One decision on one Problem Card. Append-only: a later change of mind is a
 * new decision with its reason, never an overwrite. There is no decision on
 * several cards at once.
 */
export interface CardReview {
  id: string;
  caseId: string;
  itemId: string;
  /** The card version the decision was taken on. */
  itemVersion: number;
  /** Fingerprint of the card's clinical content when decided, to show whether it changed since. */
  contentHash: string;
  decision: CardDecision;
  reason?: string;
  /** Decided together with the preceptor (owner decision D9, for the trainee's own cards). */
  withPreceptor?: true;
  /** The decision on the model's draft that created the card. */
  fromSuggestion?: { analysisId: string; suggestionId: string };
  at: string;
}

// ---------------------------------------------------------------- M2: rules engine records

/** The first time an alert (one key, one data hash) was shown in a case. Append-only; counts firings per rule. */
export interface AlertFiring {
  id: string;
  caseId: string;
  key: string;
  ruleId: string;
  level: 'critical' | 'important' | 'informational';
  dataHash: string;
  at: string;
}

/** An acknowledgement, always with a reason. It covers one key and one data hash: changed data brings the alert back. */
export interface AlertAck {
  id: string;
  caseId: string;
  key: string;
  ruleId: string;
  level: 'critical' | 'important' | 'informational';
  dataHash: string;
  reason: string;
  at: string;
}

/** A causality questionnaire attached to an ADR register row (Naranjo or WHO-UMC). Versioned. */
export interface CausalityAssessment extends Versioned {
  id: string;
  caseId: string;
  itemId: string;
  method: 'naranjo' | 'who_umc';
  answers: Record<string, string>;
  score?: number;
  category: string;
  createdAt: string;
}

// ---------------------------------------------------------------- form, settings, audit

/** Trainee-authored text on the department form (e.g. Section 5 interpretation). Versioned. */
export interface FormDraft extends Versioned {
  caseId: string;
  fields: Record<string, string>;
}

export interface TraineeSettings {
  traineeName?: string;
  programme?: string;
}

export type AuditEntity =
  | 'case'
  | 'identifiers'
  | 'rotation'
  | 'timeline_entry'
  | 'form_draft'
  | 'settings'
  | 'intended_use'
  | 'key'
  | 'backup'
  | 'attachment'
  | 'task'
  | 'item'
  | 'model_call'
  | 'extraction'
  | 'analysis'
  | 'suggestion'
  | 'calc_result'
  | 'formulary'
  | 'adjustment'
  | 'threshold'
  | 'onc'
  | 'alert'
  | 'causality'
  | 'card_review';

export type AuditAction =
  | 'create'
  | 'update'
  | 'correct'
  | 'retract'
  | 'remove'
  | 'acknowledge'
  | 'export'
  | 'restore'
  | 'change_passphrase'
  | 'call'
  | 'confirm'
  | 'reject'
  | 'accept'
  | 'edit'
  | 'request_evidence'
  | 'escalate'
  /** A stale Problem Card reviewed again on the current data and confirmed as a new version. */
  | 'reconfirm';

export interface AuditEvent {
  // append-only, never pruned
  id: string;
  entity: AuditEntity;
  entityId: string;
  /** M1 extension: lets the trainee view the log per case. */
  caseId?: string;
  action: AuditAction;
  actor: 'user' | 'system' | 'model';
  diff: unknown;
  at: string;
}

/**
 * Builds the department form from the case record.
 *
 * Every value comes from a stored record and carries its provenance. Nothing
 * is invented: a field without a source is "missing", a field whose source is
 * built in a later milestone is "not yet available", and identifier fields are
 * withheld or replaced in the Teaching copy.
 */
import type { Milestone } from '../../config/release';
import { VITAL_BY_ID } from '../catalogue';
import { dateOfHospitalDay, hospitalDayOf } from '../dates';
import { formatNumber } from '../numbers';
import { compareEntries, deriveMedCourses, deriveProblems, indexTimeline, regimenText, unitText } from '../timeline';
import type {
  Case,
  CaseIdentifiers,
  EntryOf,
  EntryType,
  FormDraft,
  NoteCategory,
  NotePayload,
  ProvenanceState,
  TextNoteCategory,
  TimelineEntry,
  TraineeSettings,
} from '../types';
import { DRP_CHECKBOXES, FIELD_LABELS, FORM_DEPENDENCIES, SECTION_TITLES, type FieldKey, type FormLabel } from './spec';

export type CopyMode = 'teaching' | 'ward';

export interface FieldItem {
  text?: string;
  /** Hospital day of the underlying record; rendered as "Day N". */
  day?: number;
  /** Day span of a medication course; `null` end = ongoing. */
  dayRange?: [number, number | null];
  /** Calendar date (YYYY-MM-DD). Present only in the Ward copy. */
  date?: string;
  provenance?: ProvenanceState;
  entryId?: string;
}

export type MissingCode = 'family_history' | 'social_history' | 'khat_use' | 'no_indication' | 'room_bed' | 'ward';
export type FormNote = 'case_id_replaces_identifier' | 'room_withheld' | 'nkda_conflict' | 'interpretation_needs_rereview';

export type FieldState =
  | { kind: 'value'; items: FieldItem[]; missingParts?: MissingCode[]; notes?: FormNote[] }
  | { kind: 'missing'; hint?: MissingCode }
  | { kind: 'empty' }
  | { kind: 'not_yet'; milestone: Milestone }
  | { kind: 'withheld' }
  | { kind: 'not_applicable'; reason: 'teaching_case' | 'not_discharged' }
  | { kind: 'signature_line' };

export type EditTarget =
  | { kind: 'identifiers' }
  | { kind: 'case_details' }
  | { kind: 'add_entry'; type: EntryType; category?: NoteCategory }
  | { kind: 'draft'; key: string }
  | { kind: 'settings' };

export interface FormFieldView {
  key: FieldKey;
  label: FormLabel;
  state: FieldState;
  edit?: EditTarget;
}

export interface FormRowView {
  key: string;
  cells: FormFieldView[];
}

export interface FormTableView {
  columns: FieldKey[];
  rows: FormRowView[];
  /** Shown when there are no rows. */
  emptyState: FieldState;
  addTarget?: EditTarget;
}

export interface FormSectionView {
  number: number;
  title: FormLabel;
  fields: FormFieldView[];
  table?: FormTableView;
  checkboxes?: { labels: readonly FormLabel[]; state: FieldState };
}

export interface MissingItem {
  section: number;
  key: FieldKey | 'table';
  label: FormLabel;
  row?: string;
  code?: MissingCode;
}

export interface FormView {
  mode: CopyMode;
  sections: FormSectionView[];
  missing: MissingItem[];
  notYet: { section: number; label: FormLabel; milestone: Milestone }[];
}

export interface FormContext {
  case: Case;
  identifiers?: CaseIdentifiers;
  entries: readonly TimelineEntry[];
  draft?: FormDraft;
  trainee?: TraineeSettings;
  mode: CopyMode;
}

// ---------------------------------------------------------------- helpers

const f = (key: FieldKey, state: FieldState, edit?: EditTarget): FormFieldView => ({
  key,
  label: FIELD_LABELS[key],
  state,
  ...(edit ? { edit } : {}),
});
const value = (items: FieldItem[], extra: { missingParts?: MissingCode[]; notes?: FormNote[] } = {}): FieldState => ({
  kind: 'value',
  items,
  ...(extra.missingParts?.length ? { missingParts: extra.missingParts } : {}),
  ...(extra.notes?.length ? { notes: extra.notes } : {}),
});
const missing = (hint?: MissingCode): FieldState => (hint ? { kind: 'missing', hint } : { kind: 'missing' });
const notYet = (milestone: Milestone): FieldState => ({ kind: 'not_yet', milestone });
const EMPTY: FieldState = { kind: 'empty' };
const typed = (text: string): FieldItem => ({ text, provenance: 'user_entered' });
const fromEntry = (e: TimelineEntry, text: string, withDay = true): FieldItem => ({
  text,
  provenance: e.provenance,
  entryId: e.id,
  ...(withDay ? { day: e.hospitalDay } : {}),
});

type NoteFor<C extends NotePayload['category']> = C extends TextNoteCategory
  ? Extract<NotePayload, { text: string }>
  : Extract<NotePayload, { category: C }>;
type Note<C extends NotePayload['category']> = EntryOf<'note'> & { payload: NoteFor<C> };
function notes<C extends NotePayload['category']>(current: readonly TimelineEntry[], category: C): Note<C>[] {
  return current.filter((e): e is Note<C> => e.type === 'note' && e.payload.category === category);
}

const HABIT_TEXT = { current: 'current', former: 'former', never: 'never', unknown: 'unknown' } as const;

// ---------------------------------------------------------------- sections

function section1(ctx: FormContext, current: readonly TimelineEntry[]): FormSectionView {
  const c = ctx.case;
  const teachingCase = c.kind === 'teaching';
  const teachingCopy = teachingCase || ctx.mode === 'teaching';
  const ids = teachingCase ? undefined : ctx.identifiers;
  const idEdit: EditTarget | undefined = teachingCase ? undefined : { kind: 'identifiers' };

  const identifierField = (key: 's1.patientName' | 's1.mrn', v: string | undefined): FormFieldView => {
    if (teachingCopy) return f(key, value([{ text: c.id }], { notes: ['case_id_replaces_identifier'] }), idEdit);
    return f(key, v ? value([typed(v)]) : missing(), idEdit);
  };

  const age = c.demographics.ageYears;
  const ageText = teachingCopy && age > 89 ? '90 or older' : `${formatNumber(age)} years`;

  let wardRoom: FieldState;
  if (teachingCase) wardRoom = c.ward ? value([typed(c.ward)]) : missing('ward');
  else if (teachingCopy) wardRoom = c.ward ? value([typed(c.ward)], { notes: ['room_withheld'] }) : { kind: 'withheld' };
  else if (!c.ward && !ids?.roomBed) wardRoom = missing();
  else {
    const parts: MissingCode[] = [];
    if (!c.ward) parts.push('ward');
    if (!ids?.roomBed) parts.push('room_bed');
    wardRoom = value([typed(`${c.ward ?? '—'} / ${ids?.roomBed ?? '—'}`)], { missingParts: parts });
  }

  let consultant: FieldState;
  if (teachingCase) consultant = { kind: 'not_applicable', reason: 'teaching_case' };
  else if (teachingCopy) consultant = { kind: 'withheld' };
  else consultant = ids?.consultantName ? value([typed(ids.consultantName)]) : missing();

  const admission = value([{ day: 0, ...(teachingCopy ? {} : { date: c.admissionDay0 }), provenance: 'user_entered' }]);
  let discharge: FieldState = { kind: 'not_applicable', reason: 'not_discharged' };
  if (c.status === 'discharged' && c.dischargeDate) {
    const day = hospitalDayOf(c.admissionDay0, c.dischargeDate);
    discharge = value([{ day, ...(teachingCopy ? {} : { date: c.dischargeDate }), provenance: 'user_entered' }]);
  }

  const weights = current.filter((e): e is EntryOf<'weight'> => e.type === 'weight').sort(compareEntries);
  const w = weights[weights.length - 1];

  return {
    number: 1,
    title: SECTION_TITLES[1]!,
    fields: [
      identifierField('s1.patientName', ids?.patientName),
      identifierField('s1.mrn', ids?.mrn),
      f('s1.age', value([typed(ageText)]), { kind: 'case_details' }),
      f('s1.gender', value([typed(c.demographics.sex === 'M' ? 'Male' : 'Female')]), { kind: 'case_details' }),
      f('s1.wardRoom', wardRoom, teachingCase ? { kind: 'case_details' } : idEdit),
      f('s1.consultant', consultant, idEdit),
      f('s1.admissionDate', admission, { kind: 'case_details' }),
      f('s1.dischargeDate', discharge, { kind: 'case_details' }),
      f(
        's1.height',
        c.demographics.heightCm !== undefined ? value([typed(`${formatNumber(c.demographics.heightCm)} cm`)]) : missing(),
        { kind: 'case_details' },
      ),
      f(
        's1.weight',
        w ? value([fromEntry(w, `${formatNumber(w.payload.value)} kg (${w.payload.method})`)]) : missing(),
        { kind: 'add_entry', type: 'weight' },
      ),
      // BMI and CrCl/eGFR are CalcResult references, never typed (Section 15).
      f('s1.bmi', notYet(FORM_DEPENDENCIES['s1.bmi']!)),
      f('s1.crclEgfr', notYet(FORM_DEPENDENCIES['s1.crclEgfr']!)),
    ],
  };
}

function textNoteField(
  key: FieldKey,
  current: readonly TimelineEntry[],
  category: 'chief_complaint' | 'hpi' | 'family_history',
): FormFieldView {
  const items = notes(current, category).map((e) => fromEntry(e, e.payload.text));
  return f(key, items.length ? value(items) : missing(), { kind: 'add_entry', type: 'note', category });
}

function section2(current: readonly TimelineEntry[]): FormSectionView {
  const pmh = notes(current, 'pmh').map((e) => fromEntry(e, `PMH: ${e.payload.text}`));
  const psh = notes(current, 'psh').map((e) => fromEntry(e, `PSH: ${e.payload.text}`));

  const allergyEntries = notes(current, 'allergy_adr');
  const allergyItems = allergyEntries.map((e) => {
    const p = e.payload;
    if (p.kind === 'nkda') return fromEntry(e, 'NKDA (no known drug allergies)');
    const kind = p.kind === 'adr' ? 'ADR' : p.kind;
    const detail = [kind, p.severity && p.severity !== 'unknown' ? p.severity : undefined].filter(Boolean).join(', ');
    return fromEntry(e, `${p.substance ?? ''}${p.reaction ? ` — ${p.reaction}` : ''} (${detail})`);
  });
  const hasNkda = allergyEntries.some((e) => e.payload.kind === 'nkda');
  const hasAllergy = allergyEntries.some((e) => e.payload.kind !== 'nkda');

  const family = notes(current, 'family_history').map((e) => fromEntry(e, `Family history: ${e.payload.text}`));
  const socials = notes(current, 'social_history');
  const social = socials[socials.length - 1];
  const socialItems: FieldItem[] = [];
  const parts: MissingCode[] = [];
  if (!family.length) parts.push('family_history');
  if (social) {
    const p = social.payload;
    socialItems.push(fromEntry(social, `Khat use: ${HABIT_TEXT[p.khat]}${p.khatDetails ? ` — ${p.khatDetails}` : ''}`));
    socialItems.push(fromEntry(social, `Tobacco: ${HABIT_TEXT[p.tobacco]}${p.tobaccoDetails ? ` — ${p.tobaccoDetails}` : ''}`, false));
    if (p.alcohol) socialItems.push(fromEntry(social, `Alcohol: ${HABIT_TEXT[p.alcohol]}`, false));
    if (p.occupation) socialItems.push(fromEntry(social, `Occupation: ${p.occupation}`, false));
    if (p.other) socialItems.push(fromEntry(social, `Other: ${p.other}`, false));
    if (p.khat === 'unknown') parts.push('khat_use');
  } else parts.push('social_history', 'khat_use');
  const familySocialItems = [...family, ...socialItems];

  return {
    number: 2,
    title: SECTION_TITLES[2]!,
    fields: [
      textNoteField('s2.chiefComplaint', current, 'chief_complaint'),
      textNoteField('s2.hpi', current, 'hpi'),
      f('s2.pmhPsh', pmh.length || psh.length ? value([...pmh, ...psh]) : missing(), {
        kind: 'add_entry',
        type: 'note',
        category: 'pmh',
      }),
      // Absence of an allergy record is never shown as "no allergies": only an explicit NKDA entry says that.
      f(
        's2.allergies',
        allergyItems.length ? value(allergyItems, { notes: hasNkda && hasAllergy ? ['nkda_conflict'] : [] }) : missing(),
        { kind: 'add_entry', type: 'note', category: 'allergy_adr' },
      ),
      f('s2.familySocial', familySocialItems.length ? value(familySocialItems, { missingParts: parts }) : missing(), {
        kind: 'add_entry',
        type: 'note',
        category: 'social_history',
      }),
    ],
  };
}

function section3(current: readonly TimelineEntry[]): FormSectionView {
  const problems = deriveProblems(current);
  const opt = (e: TimelineEntry, s: string | undefined): FieldState => (s ? value([fromEntry(e, s, false)]) : EMPTY);
  const rows: FormRowView[] = problems.map((t) => {
    const e = t.latest;
    const p = e.payload;
    return {
      key: t.problemId,
      cells: [
        f('s3.problem', value([fromEntry(e, p.name)])),
        f('s3.acuity', value([fromEntry(e, p.acuity === 'acute' ? 'Acute' : 'Chronic', false)])),
        f('s3.stage', opt(e, p.stage)),
        f('s3.type', opt(e, p.problemType)),
        f('s3.status', value([fromEntry(e, p.status, false)])),
        f('s3.duration', opt(e, p.duration)),
      ],
    };
  });
  const primary = problems.filter((t) => t.latest.payload.primaryDiagnosis).map((t) => fromEntry(t.latest, t.latest.payload.name));
  return {
    number: 3,
    title: SECTION_TITLES[3]!,
    fields: [f('s3.diagnosis', primary.length ? value(primary) : missing(), { kind: 'add_entry', type: 'note', category: 'problem' })],
    table: {
      columns: ['s3.problem', 's3.acuity', 's3.stage', 's3.type', 's3.status', 's3.duration'],
      rows,
      emptyState: missing(),
      addTarget: { kind: 'add_entry', type: 'note', category: 'problem' },
    },
  };
}

function medLabel(drug: string, brand?: string): string {
  return brand ? `${drug} (${brand})` : drug;
}

function section4(current: readonly TimelineEntry[]): FormSectionView {
  const courses = deriveMedCourses(current);
  const rows: FormRowView[] = courses.map((c) => {
    const last = [c.start, ...c.changes].sort(compareEntries).pop()!;
    return {
      key: c.medId,
      cells: [
        f('s4.medication', value([fromEntry(c.start, medLabel(c.drug, c.brand), false)])),
        f('s4.before', notYet(FORM_DEPENDENCIES['s4.before']!)),
        f(
          's4.during',
          value([{ text: regimenText(c), dayRange: [c.startDay, c.stopDay ?? null], provenance: last.provenance, entryId: last.id }]),
        ),
        f('s4.discharge', notYet(FORM_DEPENDENCIES['s4.discharge']!)),
        f('s4.action', notYet(FORM_DEPENDENCIES['s4.action']!)),
      ],
    };
  });
  return {
    number: 4,
    title: SECTION_TITLES[4]!,
    fields: [],
    table: {
      columns: ['s4.medication', 's4.before', 's4.during', 's4.discharge', 's4.action'],
      rows,
      emptyState: missing(),
      addTarget: { kind: 'add_entry', type: 'med_start' },
    },
  };
}

function monitoringRow(e: TimelineEntry, ctx: FormContext, teachingCopy: boolean): FormRowView | null {
  let parameter = '';
  let result = '';
  let ref: FieldState = EMPTY;
  if (e.type === 'lab') {
    const p = e.payload;
    parameter = p.analyteName;
    result = p.result.kind === 'numeric' ? `${formatNumber(p.result.value)} ${unitText(p.unit)}`.trim() : p.result.text;
    const range =
      p.refLow !== undefined || p.refHigh !== undefined
        ? `${p.refLow !== undefined ? formatNumber(p.refLow) : ''}–${p.refHigh !== undefined ? formatNumber(p.refHigh) : ''} ${unitText(p.unit)}`.trim()
        : undefined;
    const refText = [range, p.refText].filter(Boolean).join('; ');
    ref = refText ? value([fromEntry(e, refText, false)]) : missing();
  } else if (e.type === 'vital') {
    const p = e.payload;
    parameter = VITAL_BY_ID.get(p.vital)?.name ?? p.vital;
    result =
      p.vital === 'blood_pressure'
        ? `${formatNumber(p.systolic ?? 0)}/${formatNumber(p.diastolic ?? 0)} ${p.unit}`
        : `${formatNumber(p.value ?? 0)} ${p.unit}${p.periodHours ? ` over ${formatNumber(p.periodHours)} h` : ''}`;
  } else if (e.type === 'culture') {
    const p = e.payload;
    parameter = `Culture (${p.specimen})`;
    result = [p.status.replace(/_/g, ' '), p.organism, p.susceptibility].filter(Boolean).join(' — ');
  } else return null;

  const draftKey = `s5.interp.${e.id}`;
  const interp = ctx.draft?.fields[draftKey];
  return {
    key: e.id,
    cells: [
      f('s5.parameter', value([fromEntry(e, parameter, false)])),
      f(
        's5.date',
        value([
          {
            day: e.hospitalDay,
            ...(teachingCopy ? {} : { date: dateOfHospitalDay(ctx.case.admissionDay0, e.hospitalDay) }),
            ...(e.timeOfDay ? { text: e.timeOfDay } : {}),
          },
        ]),
      ),
      f('s5.result', value([fromEntry(e, result, false)])),
      f('s5.refRange', ref),
      // Interpretation is a trainee-reviewed field, never auto-filled. It is keyed to this exact
      // entry, so a corrected value needs its interpretation re-entered.
      f(
        's5.interpretation',
        interp ? value([typed(interp)]) : missing(),
        { kind: 'draft', key: draftKey },
      ),
    ],
  };
}

function section5(ctx: FormContext, current: readonly TimelineEntry[]): FormSectionView {
  const teachingCopy = ctx.case.kind === 'teaching' || ctx.mode === 'teaching';
  const order = (e: TimelineEntry) => (e.type === 'lab' ? 0 : e.type === 'vital' ? 1 : 2);
  const name = (e: TimelineEntry) =>
    e.type === 'lab' ? e.payload.analyteName : e.type === 'vital' ? e.payload.vital : e.type === 'culture' ? e.payload.specimen : '';
  const items = current
    .filter((e) => e.type === 'lab' || e.type === 'vital' || e.type === 'culture')
    .sort((a, b) => order(a) - order(b) || name(a).localeCompare(name(b)) || compareEntries(a, b));
  const rows = items.map((e) => monitoringRow(e, ctx, teachingCopy)).filter((r): r is FormRowView => r !== null);
  return {
    number: 5,
    title: SECTION_TITLES[5]!,
    fields: [],
    table: {
      columns: ['s5.parameter', 's5.date', 's5.result', 's5.refRange', 's5.interpretation'],
      rows,
      emptyState: missing(),
      addTarget: { kind: 'add_entry', type: 'lab' },
    },
  };
}

function section6(ctx: FormContext, current: readonly TimelineEntry[]): FormSectionView {
  const courses = deriveMedCourses(current);
  const draft = (col: string, medId: string): FormFieldView => {
    const key = `s6.${col}.${medId}`;
    const v = ctx.draft?.fields[key];
    return f(`s6.${col}` as FieldKey, v ? value([typed(v)]) : missing(), { kind: 'draft', key });
  };
  const rows: FormRowView[] = courses.map((c) => {
    const last = [c.start, ...c.changes].sort(compareEntries).pop()!;
    return {
      key: c.medId,
      cells: [
        f('s6.medication', value([fromEntry(c.start, medLabel(c.drug, c.brand), false)])),
        // Every drug is linked to an indication; one without is flagged, which exposes unindicated drugs.
        f('s6.indication', c.indication ? value([fromEntry(c.start, c.indication, false)]) : missing('no_indication')),
        f('s6.regimen', value([fromEntry(last, `${regimenText(c)}${c.status === 'stopped' ? ' (stopped)' : ''}`, false)])),
        draft('effectiveness', c.medId),
        draft('safety', c.medId),
        draft('monitoring', c.medId),
        draft('target', c.medId),
      ],
    };
  });
  return {
    number: 6,
    title: SECTION_TITLES[6]!,
    fields: [],
    table: {
      columns: ['s6.medication', 's6.indication', 's6.regimen', 's6.effectiveness', 's6.safety', 's6.monitoring', 's6.target'],
      rows,
      emptyState: missing(),
      addTarget: { kind: 'add_entry', type: 'med_start' },
    },
  };
}

function section11(ctx: FormContext): FormSectionView {
  const name = ctx.trainee?.traineeName;
  return {
    number: 11,
    title: SECTION_TITLES[11]!,
    fields: [
      f('s11.name', name ? value([typed(name)]) : missing(), { kind: 'settings' }),
      f('s11.date', notYet(FORM_DEPENDENCIES['s11.date']!)),
      f('s11.signature', { kind: 'signature_line' }),
      f('s11.references', notYet(FORM_DEPENDENCIES['s11.references']!)),
    ],
  };
}

// ---------------------------------------------------------------- assembly

export function deriveForm(ctx: FormContext): FormView {
  const current = indexTimeline(ctx.entries).current;
  const sections: FormSectionView[] = [
    section1(ctx, current),
    section2(current),
    section3(current),
    section4(current),
    section5(ctx, current),
    section6(ctx, current),
    {
      number: 7,
      title: SECTION_TITLES[7]!,
      fields: [],
      table: {
        columns: ['s7.drugA', 's7.drugB', 's7.severity', 's7.mechanism', 's7.management'],
        rows: [],
        emptyState: notYet(FORM_DEPENDENCIES.section7!),
      },
    },
    {
      number: 8,
      title: SECTION_TITLES[8]!,
      fields: [f('s8.explanation', notYet(FORM_DEPENDENCIES.section8!))],
      // Unticked boxes would imply "no problems"; until DRPs are classified (M4) the list is shown as not assessed.
      checkboxes: { labels: DRP_CHECKBOXES, state: notYet(FORM_DEPENDENCIES.section8!) },
    },
    { number: 9, title: SECTION_TITLES[9]!, fields: [f('s9.text', notYet(FORM_DEPENDENCIES.section9!))] },
    {
      number: 10,
      title: SECTION_TITLES[10]!,
      fields: [],
      table: {
        columns: ['s10.parameters', 's10.frequency', 's10.target', 's10.nextReview'],
        rows: [],
        emptyState: notYet(FORM_DEPENDENCIES.section10!),
      },
    },
    section11(ctx),
  ];

  const missingItems: MissingItem[] = [];
  const notYetItems: FormView['notYet'] = [];
  const seenNotYet = new Set<string>();
  const noteNotYet = (section: number, label: FormLabel, s: FieldState) => {
    if (s.kind !== 'not_yet') return;
    const k = `${section}:${label.en}`;
    if (seenNotYet.has(k)) return;
    seenNotYet.add(k);
    notYetItems.push({ section, label, milestone: s.milestone });
  };
  const visit = (section: number, fv: FormFieldView, row?: string) => {
    const s = fv.state;
    if (s.kind === 'missing') missingItems.push({ section, key: fv.key, label: fv.label, ...(row ? { row } : {}), ...(s.hint ? { code: s.hint } : {}) });
    if (s.kind === 'value') for (const code of s.missingParts ?? []) missingItems.push({ section, key: fv.key, label: fv.label, code, ...(row ? { row } : {}) });
    noteNotYet(section, fv.label, s);
  };
  for (const sec of sections) {
    for (const fv of sec.fields) visit(sec.number, fv);
    if (sec.table) {
      for (const row of sec.table.rows) {
        const rowLabel = row.cells[0]?.state.kind === 'value' ? row.cells[0].state.items[0]?.text : undefined;
        for (const cell of row.cells) visit(sec.number, cell, rowLabel);
      }
      if (sec.table.rows.length === 0) {
        if (sec.table.emptyState.kind === 'missing') missingItems.push({ section: sec.number, key: 'table', label: sec.title });
        noteNotYet(sec.number, sec.title, sec.table.emptyState);
      }
    }
    if (sec.checkboxes) noteNotYet(sec.number, sec.title, sec.checkboxes.state);
  }
  return { mode: ctx.case.kind === 'teaching' ? 'teaching' : ctx.mode, sections, missing: missingItems, notYet: notYetItems };
}

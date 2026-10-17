import { describe, expect, it } from 'vitest';
import { deriveForm, type FieldState, type FormContext, type FormView } from '../../src/domain/form/derive';
import { IDENTIFIER_FIELDS } from '../../src/domain/form/spec';
import { compareEntries, deriveMedCourses, deriveProblems, indexTimeline } from '../../src/domain/timeline';
import type { Case, CaseIdentifiers, PayloadMap, TimelineEntry } from '../../src/domain/types';

let n = 0;
const at = () => `2026-10-13T08:${String(n).padStart(2, '0')}:00.000Z`;
function entry<K extends TimelineEntry['type']>(
  type: K,
  payload: PayloadMap[K],
  over: Partial<TimelineEntry> = {},
): TimelineEntry {
  n++;
  return {
    id: `e${n}`,
    caseId: 'CASE-1234',
    hospitalDay: 1,
    recordedAt: at(),
    author: 'user',
    provenance: 'user_entered',
    type,
    payload,
    ...over,
  } as TimelineEntry;
}

const vanco = (medId = 'm1', value = 1): PayloadMap['med_start'] => ({
  medId,
  drug: 'vancomycin',
  dose: { kind: 'structured', value, unit: 'g' },
  route: 'IV',
  frequency: 'every 12 hours',
  indication: 'MRSA bacteraemia',
});

describe('timeline index', () => {
  it('follows correction chains and drops retracted chains from the effective record', () => {
    const a = entry('lab', { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric', value: 6.1 }, unit: 'mmol/L' });
    const a1 = entry('lab', { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric', value: 4.1 }, unit: 'mmol/L' }, {
      supersedesEntryId: a.id,
      correction: { kind: 'amend', reason: 'typo' },
    });
    const b = entry('weight', { value: 80, unit: 'kg', method: 'stated' });
    const b1 = entry('weight', { value: 80, unit: 'kg', method: 'stated' }, {
      supersedesEntryId: b.id,
      correction: { kind: 'retract', reason: 'wrong patient' },
    });
    const idx = indexTimeline([b1, a, b, a1]);
    expect(idx.current.map((e) => e.id)).toEqual([a1.id]);
    expect(idx.heads.map((e) => e.id).sort()).toEqual([a1.id, b1.id].sort());
    expect(idx.chainOf(a1.id).map((e) => e.id)).toEqual([a.id, a1.id]);
    expect(idx.headOf(a.id)?.id).toBe(a1.id);
  });

  it('orders by hospital day, then clock time, then recording time', () => {
    const x = entry('note', { category: 'progress', text: 'x' }, { hospitalDay: 2 });
    const y = entry('note', { category: 'progress', text: 'y' }, { hospitalDay: 1, timeOfDay: '09:00' });
    const z = entry('note', { category: 'progress', text: 'z' }, { hospitalDay: 1, timeOfDay: '07:00' });
    expect([x, y, z].sort(compareEntries).map((e) => e.id)).toEqual([z.id, y.id, x.id]);
  });
});

describe('medication courses and problems', () => {
  it('applies changes in order, records stops, and honours corrections and retractions', () => {
    const s = entry('med_start', vanco('m1', 1), { hospitalDay: 0 });
    const sFix = entry('med_start', vanco('m1', 1.25), { hospitalDay: 0, supersedesEntryId: s.id, correction: { kind: 'amend', reason: 'misread' } });
    const ch = entry('med_change', { medId: 'm1', drug: 'vancomycin', frequency: 'every 8 hours' }, { hospitalDay: 2 });
    const stop = entry('med_stop', { medId: 'm1', drug: 'vancomycin', reason: 'culture negative' }, { hospitalDay: 4 });
    const other = entry('med_start', { ...vanco('m2'), drug: 'cefazolin' }, { hospitalDay: 1 });
    const otherRetract = entry('med_start', { ...vanco('m2'), drug: 'cefazolin' }, {
      hospitalDay: 1,
      supersedesEntryId: other.id,
      correction: { kind: 'retract', reason: 'never given' },
    });
    const orphan = entry('med_change', { medId: 'm2', drug: 'cefazolin', frequency: 'every 8 hours' }, { hospitalDay: 2 });
    const courses = deriveMedCourses(indexTimeline([s, sFix, ch, stop, other, otherRetract, orphan]).current);
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({
      medId: 'm1',
      status: 'stopped',
      dose: { kind: 'structured', value: 1.25, unit: 'g' },
      frequency: 'every 8 hours',
      startDay: 0,
      stopDay: 4,
    });
  });

  it('tracks a problem through status updates', () => {
    const p1 = entry('note', { category: 'problem', problemId: 'p', name: 'AKI', acuity: 'acute', status: 'active', primaryDiagnosis: false });
    const p2 = entry('note', { category: 'problem', problemId: 'p', name: 'AKI', acuity: 'acute', status: 'improving', primaryDiagnosis: false }, { hospitalDay: 3 });
    const [t] = deriveProblems(indexTimeline([p1, p2]).current);
    expect(t?.latest.payload.status).toBe('improving');
    expect(t?.history).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- department form

const clinicalCase: Case = {
  id: 'CASE-1234',
  kind: 'clinical',
  rotationId: 'r',
  deidentified: true,
  demographics: { ageYears: 92, sex: 'F' },
  admissionDay0: '2026-10-10',
  status: 'active',
  createdAt: '2026-10-10T08:00:00Z',
  version: 1,
  versionCreatedAt: '2026-10-10T08:00:00Z',
};
const ids: CaseIdentifiers = {
  caseId: 'CASE-1234',
  patientName: 'Synthetic Patient Gamma',
  mrn: 'MRN-4242',
  roomBed: 'Bed 12',
  consultantName: 'Dr Synthetic Consultant',
  version: 1,
  versionCreatedAt: '2026-10-10T08:00:00Z',
};

function field(view: FormView, key: string): FieldState {
  for (const s of view.sections) for (const f of s.fields) if (f.key === key) return f.state;
  throw new Error(`no field ${key}`);
}

function flatten(view: FormView): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of view.sections) {
    for (const f of s.fields) out.set(f.key, JSON.stringify(f.state));
    for (const r of s.table?.rows ?? []) for (const c of r.cells) out.set(`${c.key}#${r.key}`, JSON.stringify(c.state));
    if (s.table) out.set(`table#${s.number}`, JSON.stringify(s.table.emptyState));
  }
  return out;
}

describe('department form: no invented data', () => {
  const empty: FormContext = { case: clinicalCase, identifiers: undefined, entries: [], mode: 'ward' };

  it('marks every absent field as missing and every later-milestone field as not yet available', () => {
    const view = deriveForm(empty);
    const missingKeys = view.missing.map((m) => m.key);
    for (const k of [
      's1.patientName',
      's1.mrn',
      's1.wardRoom',
      's1.consultant',
      's1.height',
      's1.weight',
      's2.chiefComplaint',
      's2.hpi',
      's2.pmhPsh',
      's2.allergies',
      's2.familySocial',
      's3.diagnosis',
      's8.explanation',
      's9.text',
      's11.name',
      's11.references',
    ]) {
      expect(missingKeys).toContain(k);
    }
    // Sections 4 and 7–10 are filled from the Clinical Modules: empty means missing, never "none".
    expect(view.missing.filter((m) => m.key === 'table').map((m) => m.section).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 10]);
    // Since M2, BMI and CrCl/eGFR come from calculation results: none yet is "missing", never typed.
    expect(field(view, 's1.bmi')).toEqual({ kind: 'missing', hint: 'no_calculation' });
    expect(field(view, 's1.crclEgfr')).toEqual({ kind: 'missing', hint: 'no_calculation' });
    expect([...new Set(view.notYet.map((x) => x.section))].sort((a, b) => a - b)).toEqual([11]);
    expect(field(view, 's11.signature')).toEqual({ kind: 'signature_line' });
  });

  it('only shows values that exist in the record', () => {
    const view = deriveForm(empty);
    const withValues = [...flatten(view)].filter(([, v]) => JSON.parse(v).kind === 'value').map(([k]) => k);
    // Age, gender and admission date come from the case record; nothing else exists yet.
    expect(withValues.sort()).toEqual(['s1.admissionDate', 's1.age', 's1.gender']);
  });

  it('never presents an absent allergy record as "no allergies"', () => {
    expect(field(deriveForm(empty), 's2.allergies')).toEqual({ kind: 'missing' });
    const nkda = entry('note', { category: 'allergy_adr', kind: 'nkda' });
    const pen = entry('note', { category: 'allergy_adr', kind: 'allergy', substance: 'Penicillin', reaction: 'urticaria', severity: 'moderate' });
    const onlyNkda = field(deriveForm({ ...empty, entries: [nkda] }), 's2.allergies');
    expect(onlyNkda).toMatchObject({ kind: 'value', items: [{ text: 'NKDA (no known drug allergies)' }] });
    const conflict = field(deriveForm({ ...empty, entries: [nkda, pen] }), 's2.allergies');
    expect(conflict).toMatchObject({ kind: 'value', notes: ['nkda_conflict'] });
  });

  it('flags khat use that is not established, and medication without an indication', () => {
    const social = entry('note', { category: 'social_history', khat: 'unknown', tobacco: 'never' });
    const med = entry('med_start', { ...vanco(), indication: undefined });
    const view = deriveForm({ ...empty, entries: [social, med] });
    expect(view.missing).toContainEqual(expect.objectContaining({ key: 's2.familySocial', code: 'khat_use' }));
    expect(view.missing).toContainEqual(expect.objectContaining({ key: 's6.indication', code: 'no_indication', row: 'vancomycin' }));
  });

  it('uses only the corrected value and requires the interpretation to be re-entered after a correction', () => {
    const w = entry('weight', { value: 700, unit: 'kg', method: 'measured' });
    const wFix = entry('weight', { value: 70, unit: 'kg', method: 'measured' }, { supersedesEntryId: w.id, correction: { kind: 'amend', reason: 'typo' } });
    const k = entry('lab', { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric', value: 6.5 }, unit: 'mmol/L' });
    const kFix = entry('lab', { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric', value: 4.5 }, unit: 'mmol/L' }, {
      supersedesEntryId: k.id,
      correction: { kind: 'amend', reason: 'haemolysed' },
    });
    const draft = { caseId: 'CASE-1234', fields: { [`s5.interp.${k.id}`]: 'Hyperkalaemia' }, version: 1, versionCreatedAt: '' };
    const view = deriveForm({ ...empty, entries: [w, wFix, k, kFix], draft });
    expect(field(view, 's1.weight')).toMatchObject({ kind: 'value', items: [{ text: '70 kg (measured)', entryId: wFix.id }] });
    const s5 = view.sections.find((s) => s.number === 5)!;
    expect(s5.table!.rows).toHaveLength(1);
    const cells = s5.table!.rows[0]!.cells;
    expect(cells.find((c) => c.key === 's5.result')?.state).toMatchObject({ items: [{ text: '4.5 mmol/L' }] });
    expect(cells.find((c) => c.key === 's5.interpretation')?.state).toEqual({ kind: 'missing' });
    expect(cells.find((c) => c.key === 's5.refRange')?.state).toEqual({ kind: 'missing' });
  });
});

describe('department form: Teaching copy and Ward copy', () => {
  const entries = [
    entry('lab', { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 1.9 }, unit: 'mg/dL', refLow: 0.5, refHigh: 1.1 }, { hospitalDay: 2 }),
    entry('med_start', vanco(), { hospitalDay: 0 }),
    entry('note', { category: 'chief_complaint', text: 'Fever' }, { hospitalDay: 0 }),
  ];
  const ctx: FormContext = {
    case: { ...clinicalCase, ward: 'Medical ward 2', status: 'discharged', dischargeDate: '2026-10-12' },
    identifiers: ids,
    entries,
    mode: 'ward',
  };

  it('differ only in identifier fields', () => {
    const ward = flatten(deriveForm({ ...ctx, mode: 'ward' }));
    const teaching = flatten(deriveForm({ ...ctx, mode: 'teaching' }));
    expect([...ward.keys()].sort()).toEqual([...teaching.keys()].sort());
    const differing = [...ward.keys()].filter((k) => ward.get(k) !== teaching.get(k)).map((k) => k.split('#')[0]!);
    expect(differing.length).toBeGreaterThan(0);
    for (const k of differing) expect(IDENTIFIER_FIELDS.has(k)).toBe(true);
  });

  it('Teaching copy contains no name, MRN, room, consultant or calendar date', () => {
    const json = JSON.stringify(deriveForm({ ...ctx, mode: 'teaching' }));
    expect(json).not.toMatch(/Synthetic Patient Gamma|MRN-4242|Bed 12|Dr Synthetic Consultant|2026-10-1/);
    const view = deriveForm({ ...ctx, mode: 'teaching' });
    expect(field(view, 's1.patientName')).toMatchObject({ items: [{ text: 'CASE-1234' }] });
    expect(field(view, 's1.age')).toMatchObject({ items: [{ text: '90 or older' }] });
  });

  it('Ward copy shows the identifiers and calendar dates', () => {
    const view = deriveForm({ ...ctx, mode: 'ward' });
    expect(field(view, 's1.patientName')).toMatchObject({ items: [{ text: 'Synthetic Patient Gamma' }] });
    expect(field(view, 's1.age')).toMatchObject({ items: [{ text: '92 years' }] });
    expect(field(view, 's1.dischargeDate')).toMatchObject({ items: [{ day: 2, date: '2026-10-12' }] });
  });

  it('a Teaching Case never shows identifiers, whichever copy is requested', () => {
    const teachingCase: Case = { ...clinicalCase, kind: 'teaching' };
    const view = deriveForm({ case: teachingCase, identifiers: ids, entries: [], mode: 'ward' });
    expect(view.mode).toBe('teaching');
    expect(JSON.stringify(view)).not.toMatch(/Synthetic Patient Gamma|MRN-4242|Bed 12|Dr Synthetic/);
    expect(field(view, 's1.consultant')).toEqual({ kind: 'not_applicable', reason: 'teaching_case' });
  });
});

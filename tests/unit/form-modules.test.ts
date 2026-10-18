import { describe, expect, it } from 'vitest';
import { deriveForm, type FieldState, type FormContext, type FormView } from '../../src/domain/form/derive';
import type { Case, PayloadMap, RegisterId, RegisterItem, TaskRecord, TimelineEntry } from '../../src/domain/types';

const base: Case = {
  id: 'CASE-2001',
  kind: 'clinical',
  rotationId: 'r',
  deidentified: true,
  demographics: { ageYears: 58, sex: 'M' },
  admissionDay0: '2026-10-10',
  status: 'active',
  createdAt: '2026-10-10T08:00:00Z',
  version: 1,
  versionCreatedAt: '2026-10-10T08:00:00Z',
};

let n = 0;
function item(register: RegisterId, fields: Record<string, string>, status: RegisterItem['status'] = 'active'): RegisterItem {
  n++;
  return { id: `i${n}`, caseId: base.id, register, fields, status, createdAt: `2026-10-11T08:00:${String(n).padStart(2, '0')}Z`, version: 1, versionCreatedAt: '2026-10-11T08:00:00Z' };
}

function medStart(medId: string, drug: string, day = 0): TimelineEntry {
  n++;
  const payload: PayloadMap['med_start'] = { medId, drug, dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'once daily' };
  return { id: `e${n}`, caseId: base.id, hospitalDay: day, recordedAt: `2026-10-11T09:00:${String(n).padStart(2, '0')}Z`, author: 'user', provenance: 'user_entered', type: 'med_start', payload } as TimelineEntry;
}

const task = (taskId: string, status: TaskRecord['status']): TaskRecord => ({ caseId: base.id, taskId, status, checks: {}, fields: {}, version: 1, versionCreatedAt: '' });

const ctx = (over: Partial<FormContext> = {}): FormContext => ({ case: base, entries: [], mode: 'ward', items: [], tasks: [], ...over });

function section(view: FormView, n: number) {
  return view.sections.find((s) => s.number === n)!;
}
function cell(view: FormView, sec: number, rowKey: string, key: string): FieldState {
  const row = section(view, sec).table!.rows.find((r) => r.key === rowKey);
  if (!row) throw new Error(`no row ${rowKey}`);
  return row.cells.find((c) => c.key === key)!.state;
}
const texts = (s: FieldState) => (s.kind === 'value' ? s.items.map((i) => i.text) : s.kind);

describe('Section 4 — medication reconciliation from Task 2', () => {
  it('shows each home medication before, during and at discharge, and inpatient-only drugs separately', () => {
    const ceftriaxone = medStart('m-cef', 'ceftriaxone');
    const metforminOrder = medStart('m-met', 'metformin');
    const met = item('home_med', {
      drug: 'metformin',
      regimen: '500 mg PO twice daily',
      sources: 'patient|containers',
      linkedMedId: 'm-met',
      admissionStatus: 'changed',
      discrepancy: 'intentional_documented',
      action: 'Reduced while on contrast',
    });
    const aml = item('home_med', { drug: 'amlodipine', regimen: '5 mg PO once daily', sources: 'patient', admissionStatus: 'not_ordered', discrepancy: 'unintentional', discrepancyType: 'omission', resolution: 'pending' });
    const ator = item('home_med', { drug: 'atorvastatin', regimen: '20 mg PO at bedtime', sources: 'patient' });
    const view = deriveForm(ctx({ entries: [ceftriaxone, metforminOrder], items: [met, aml, ator] }));

    expect(texts(cell(view, 4, `home:${met.id}`, 's4.before'))).toEqual(['500 mg PO twice daily']);
    expect(texts(cell(view, 4, `home:${met.id}`, 's4.during'))).toEqual(['1 g IV once daily', 'Continued with a change']);
    expect(texts(cell(view, 4, `home:${met.id}`, 's4.action'))).toEqual(['Intentional — documented; Reduced while on contrast']);
    expect(texts(cell(view, 4, `home:${aml.id}`, 's4.during'))).toEqual(['Not ordered']);
    expect(texts(cell(view, 4, `home:${aml.id}`, 's4.action'))).toEqual(['Unintentional; Omission; Pending']);
    // Not compared yet is missing, not assumed.
    expect(cell(view, 4, `home:${ator.id}`, 's4.during')).toEqual({ kind: 'missing', hint: 'not_compared' });
    // The inpatient-only drug is stated as absent from the list — never as "not taken".
    expect(texts(cell(view, 4, 'm-cef', 's4.before'))).toEqual(['Not on the pre-admission list']);
    // The linked order does not appear twice.
    expect(section(view, 4).table!.rows.map((r) => r.key)).toEqual([`home:${met.id}`, `home:${aml.id}`, `home:${ator.id}`, 'm-cef']);
    // Not discharged: the discharge column is empty, not missing.
    expect(cell(view, 4, `home:${met.id}`, 's4.discharge')).toEqual({ kind: 'empty' });
  });

  it('marks the pre-admission column missing when no list exists, and discharge decisions missing after discharge', () => {
    const cef = medStart('m-cef', 'ceftriaxone');
    const noList = deriveForm(ctx({ entries: [cef] }));
    expect(cell(noList, 4, 'm-cef', 's4.before')).toEqual({ kind: 'missing', hint: 'no_bpmh' });

    const discharged = { ...base, status: 'discharged' as const, dischargeDate: '2026-10-14' };
    const home = item('home_med', { drug: 'metformin', regimen: '500 mg PO twice daily', sources: 'patient', dischargeDecision: 'continue' });
    const plan = item('discharge_med', { drug: 'Ceftriaxone', regimen: '1 g IM once daily for 3 days', change: 'new', reason: 'Complete the course' });
    const view = deriveForm(ctx({ case: discharged, entries: [cef], items: [home, plan] }));
    expect(texts(cell(view, 4, `home:${home.id}`, 's4.discharge'))).toEqual(['Continue unchanged']);
    expect(texts(cell(view, 4, 'm-cef', 's4.discharge'))).toEqual(['New: 1 g IM once daily for 3 days']);
    const other = deriveForm(ctx({ case: discharged, entries: [medStart('m-x', 'omeprazole')], items: [home] }));
    expect(cell(other, 4, 'm-x', 's4.discharge')).toEqual({ kind: 'missing', hint: 'no_discharge_decision' });
  });
});

describe('Sections 7–10 and the references, from the Clinical Modules', () => {
  const drp = (over: Record<string, string> = {}) =>
    item('drp', { problem: 'Enoxaparin dose too high for renal function', category: 'dose_high', evidence: 'SCr 2.4 mg/dL Day 2', priority: 'critical', drugs: 'enoxaparin', ...over });

  it('Section 7 lists the interactions the trainee checked, with where they checked them', () => {
    const ix = item('interaction', { kind: 'drug_drug', drugA: 'clarithromycin', drugB: 'simvastatin', severity: 'contraindicated', management: 'Hold simvastatin during the course', source: 'Product label' });
    const food = item('interaction', { kind: 'drug_food', drugA: 'levothyroxine', drugB: 'breakfast', severity: 'moderate', management: 'Take 30–60 min before breakfast', source: 'Product label' });
    const gone = item('interaction', { kind: 'drug_drug', drugA: 'a', drugB: 'b', severity: 'minor', management: 'x', source: 'y' }, 'retracted');
    const view = deriveForm(ctx({ items: [ix, food, gone] }));
    const rows = section(view, 7).table!.rows;
    expect(rows.map((r) => r.key)).toEqual([ix.id, food.id]);
    expect(texts(cell(view, 7, ix.id, 's7.severity'))).toEqual(['Contraindicated']);
    expect(texts(cell(view, 7, ix.id, 's7.management'))).toEqual(['Hold simvastatin during the course — Source: Product label']);
    expect(texts(cell(view, 7, food.id, 's7.drugB'))).toEqual(['breakfast (Drug–food or khat)']);
    expect(cell(view, 7, ix.id, 's7.mechanism')).toEqual({ kind: 'empty' });
  });

  it('Section 7 keeps the automatic check apart from the trainee rows, and says when it could not be made', () => {
    const ix = item('interaction', { kind: 'drug_drug', drugA: 'clarithromycin', drugB: 'simvastatin', severity: 'contraindicated', management: 'Hold simvastatin', source: 'Product label' });
    const notInstalled = section(deriveForm(ctx({ items: [ix], automaticInteractions: { checked: false, reason: 'Drug–drug interactions were not checked: no dataset.' } })), 7);
    expect(notInstalled.automatic).toEqual({ checked: false, reason: 'Drug–drug interactions were not checked: no dataset.' });
    expect(notInstalled.table!.rows.map((r) => r.key)).toEqual([ix.id]);

    const checked = section(
      deriveForm(
        ctx({
          items: [ix],
          automaticInteractions: { checked: true, source: 'Dataset X v1', rows: [{ key: 'interaction:m1+m2:1+2', drugA: 'ibuprofen', drugB: 'enoxaparin', severity: 'major', mechanism: 'additive bleeding risk' }] },
        }),
      ),
      7,
    );
    expect(checked.automatic?.checked).toBe(true);
    const row = checked.automatic!.checked ? checked.automatic!.rows[0]! : undefined;
    const at = (k: string) => texts(row!.cells.find((c) => c.key === k)!.state);
    expect(at('s7.drugA')).toEqual(['ibuprofen']);
    expect(at('s7.severity')).toEqual(['major']);
    expect(at('s7.management')).toEqual(['Not given by the dataset — Source: Dataset X v1']);
    // The automatic rows never carry the trainee's provenance and never enter the trainee's table.
    expect(row!.cells.every((c) => c.state.kind !== 'value' || c.state.items.every((i) => i.provenance === undefined))).toBe(true);
    expect(checked.table!.rows.map((r) => r.key)).toEqual([ix.id]);
    // Without the rules engine (M1 callers), nothing automatic is claimed.
    expect(section(deriveForm(ctx({ items: [ix] })), 7).automatic).toBeUndefined();
  });

  it('Section 7 says only "none recorded" when Task 6 is done with no interaction — otherwise it is missing', () => {
    expect(section(deriveForm(ctx()), 7).table!.emptyState).toEqual({ kind: 'missing' });
    const done = section(deriveForm(ctx({ tasks: [task('t06', 'done')] })), 7).table!.emptyState;
    expect(texts(done)).toEqual(['None recorded by the trainee (Task 6 marked done)']);
  });

  it('Section 8 ticks exactly the boxes of the recorded DRP categories', () => {
    const view = deriveForm(ctx({ items: [drp(), drp({ category: 'interaction', problem: 'Clarithromycin with simvastatin' }), drp({ category: 'adr' }, ), item('drp', { problem: 'gone', category: 'unnecessary', evidence: 'x', priority: 'informational' }, 'retracted')] }));
    const boxes = section(view, 8).checkboxes!;
    expect(boxes.ticked).toEqual([false, false, false, false, true, true, true, false, false, false]);
    expect(texts(view.sections[7]!.fields[0]!.state)).toHaveLength(3);
    // Nothing recorded: not assessed (missing), never unticked "no problems".
    const none = section(deriveForm(ctx()), 8).checkboxes!;
    expect(none.ticked).toBeUndefined();
    expect(none.state).toEqual({ kind: 'missing' });
    const doneNone = section(deriveForm(ctx({ tasks: [task('t05', 'done')] })), 8).checkboxes!;
    expect(doneNone.ticked).toBeUndefined();
    expect(doneNone.state).toEqual({ kind: 'empty' });
  });

  it('Section 9 holds final recommendations only, with proposed, implemented and measured kept apart', () => {
    const draft = drp({ recommendation: 'Draft idea', recStatus: 'draft' });
    const proposed = drp({ recommendation: 'Reduce enoxaparin to the renal dose from the product label', recStatus: 'final', response: 'awaiting', communicatedTo: 'resident', communicatedDay: '2' });
    const done = drp({
      recommendation: 'Stop simvastatin during clarithromycin',
      recStatus: 'final',
      response: 'accepted',
      implemented: 'yes',
      implementedBy: 'Resident',
      implementedDay: '3',
      goalMet: 'yes',
      outcome: 'CK normal on Day 6',
      outcomeDay: '6',
    });
    const view = deriveForm(ctx({ items: [draft, proposed, done] }));
    const s9 = view.sections[8]!.fields[0]!.state;
    expect(s9.kind).toBe('value');
    if (s9.kind !== 'value') return;
    expect(s9.items.map((i) => [i.text, i.provenance, i.day])).toEqual([
      ['Reduce enoxaparin to the renal dose from the product label — Team response: Communicated — awaiting a response', 'user_entered', undefined],
      ['Stop simvastatin during clarithromycin — Team response: Accepted', 'user_entered', undefined],
      ['Implemented by Resident', 'implemented', 3],
      ['Outcome: CK normal on Day 6 — Goal met', 'outcome_documented', 6],
    ]);
    expect(s9.items.some((i) => i.text?.includes('Draft idea'))).toBe(false);
    expect(deriveForm(ctx({ items: [draft] })).sections[8]!.fields[0]!.state).toEqual({ kind: 'missing', hint: 'no_final_recommendation' });
  });

  it('Section 10 lists active monitoring with a real next review day (the date only in the Ward copy)', () => {
    const scr = item('monitoring', { parameter: 'Serum creatinine', purpose: 'safety', forWhat: 'vancomycin', target: 'Stable within 0.3 mg/dL of baseline', frequency: 'Daily', nextDay: '4', status: 'active' });
    const noDay = item('monitoring', { parameter: 'Temperature', purpose: 'efficacy', target: '< 38 °C', frequency: 'Every 6 hours', status: 'active' });
    const stopped = item('monitoring', { parameter: 'Old', purpose: 'safety', target: 'x', frequency: 'y', status: 'stopped' });
    const ward = deriveForm(ctx({ items: [scr, noDay, stopped] }));
    expect(section(ward, 10).table!.rows.map((r) => r.key)).toEqual([scr.id, noDay.id]);
    expect(cell(ward, 10, scr.id, 's10.nextReview')).toEqual({ kind: 'value', items: [{ day: 4, date: '2026-10-14', provenance: 'user_entered' }] });
    expect(cell(ward, 10, noDay.id, 's10.nextReview')).toEqual({ kind: 'missing', hint: 'no_next_review' });
    expect(texts(cell(ward, 10, scr.id, 's10.parameters'))).toEqual(['Serum creatinine — vancomycin']);
    const teaching = deriveForm(ctx({ mode: 'teaching', items: [scr] }));
    expect(cell(teaching, 10, scr.id, 's10.nextReview')).toEqual({ kind: 'value', items: [{ day: 4, provenance: 'user_entered' }] });
  });

  it('Section 11 lists the references the trainee read, marked as such', () => {
    const ref = item('reference', { title: 'Hospital CAP protocol', publisher: 'Pharmacy and therapeutics committee', year: '2025', type: 'protocol', verified: 'yes' });
    const view = deriveForm(ctx({ items: [ref] }));
    const refs = view.sections[10]!.fields.find((f) => f.key === 's11.references')!.state;
    expect(texts(refs)).toEqual(['Hospital CAP protocol — Pharmacy and therapeutics committee, 2025 (Hospital protocol; read by the trainee)']);
  });
});

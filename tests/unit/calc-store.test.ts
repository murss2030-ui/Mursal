/**
 * The calculation engine inside the store: results are computed from stored
 * data only, persisted append-only with an audit event, never overwritten;
 * refusals store nothing; the Verify gate names what a renal dose review lacks.
 */
import { describe, expect, it } from 'vitest';
import { resultCurrency } from '../../src/calc/currency';
import { makeCalculator } from '../../src/calc/engine';
import { renalDoseReviewGate } from '../../src/calc/gate';
import { CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import { deriveMedCourses, indexTimeline } from '../../src/domain/timeline';
import { readiness } from '../../src/domain/workflow/readiness';
import { AppendOnlyViolationError } from '../../src/store/db';
import { IntegrityError } from '../../src/store/store';
import { newCase, newSession } from './helpers';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(
  CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'test' })]),
);

async function setup(calculators = ALL_VALID) {
  const ctx = await newSession({ calculators });
  const c = await newCase(ctx.store, { ageYears: 60, sex: 'M', heightCm: 175 });
  return { ...ctx, c };
}

const scr = (value: number, day: number, unit = 'mg/dL') => ({
  type: 'lab' as const,
  hospitalDay: day,
  payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric' as const, value }, unit },
});
const weight = (kg: number, day = 0) => ({ type: 'weight' as const, hospitalDay: day, payload: { value: kg, unit: 'kg' as const, method: 'measured' as const } });

describe('calculations in the store', () => {
  it('computes from stored entries, persists the result with its inputs and audits it', async () => {
    const { store, c } = await setup();
    const w = await store.addEntry(c.id, weight(70));
    const s = await store.addEntry(c.id, scr(1.2, 2));
    const out = await store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [r] = out.results;
    expect(r!.value).toBeCloseTo(64.81481481481482, 9);
    expect([...r!.inputs.entryIds].sort()).toEqual([w.id, s.id].sort());
    expect(await store.listCalcResults(c.id)).toEqual(out.results);
    const audit = (await store.listAudit(c.id)).filter((e) => e.entity === 'calc_result');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'create', entityId: r!.id, diff: { calc: 'crcl_cg', unit: 'mL/min' } });
  });

  it('a refused calculation stores nothing and names the missing inputs', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    const out = await store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
    expect(out).toMatchObject({ ok: false, problems: [{ kind: 'missing', key: 'scr' }] });
    expect(await store.listCalcResults(c.id)).toEqual([]);
  });

  it('recomputation after new data creates a new result; the old one stays readable', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.2, 1));
    const req = { answers: { weightBasis: { kind: 'choice' as const, value: 'tbw' } } };
    const first = await store.calculate(c.id, 'crcl_cg', req);
    await store.addEntry(c.id, scr(1.5, 3));
    const second = await store.calculate(c.id, 'crcl_cg', req);
    const all = await store.listCalcResults(c.id);
    expect(all).toHaveLength(2);
    expect(first.ok && second.ok && all[0]!.id === first.results[0]!.id && all[1]!.id === second.results[0]!.id).toBe(true);
    expect(all[1]!.value).toBeCloseTo((80 * 70) / (72 * 1.5), 9);
  });

  it('calculation results can never be overwritten or deleted', async () => {
    const { store, db, c } = await setup();
    await store.addEntry(c.id, weight(70));
    const out = await store.calculate(c.id, 'bmi');
    expect(out.ok).toBe(true);
    const row = (await db.calcResults.toArray())[0]!;
    await expect(db.calcResults.put({ ...row })).rejects.toBeInstanceOf(AppendOnlyViolationError);
    await expect(db.calcResults.delete(row.id)).rejects.toBeInstanceOf(AppendOnlyViolationError);
    await expect(db.calcResults.add({ ...row })).rejects.toThrow();
  });

  it('QTc runs as a pair: both results stored together with one group id', async () => {
    const { store, c } = await setup();
    const out = await store.calculate(c.id, 'qtc_fridericia', {
      answers: { qt: { kind: 'number', value: 360, unit: 'ms' }, hr: { kind: 'number', value: 100, unit: 'beats/min' }, ecgAt: { kind: 'time', day: 1, time: '09:00' } },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.results.map((r) => r.calc)).toEqual(['qtc_fridericia', 'qtc_bazett']);
    expect(out.results[0]!.groupId).toBeDefined();
    expect(out.results[0]!.groupId).toBe(out.results[1]!.groupId);
  });

  it('a calculator that has not passed its tests is refused, and so is its pair', async () => {
    const calculators = new Map(ALL_VALID);
    calculators.set('qtc_bazett', makeCalculator(CALCULATOR_DEFS.find((d) => d.id === 'qtc_bazett')!, { validated: false, reason: 'tests_failed' }));
    const { store, c } = await setup(calculators);
    const out = await store.calculate(c.id, 'qtc_fridericia', {
      answers: { qt: { kind: 'number', value: 360, unit: 'ms' }, hr: { kind: 'number', value: 100, unit: 'beats/min' }, ecgAt: { kind: 'time', day: 1, time: '09:00' } },
    });
    expect(out.ok).toBe(false);
    expect(await store.listCalcResults(c.id)).toEqual([]);
  });

  it('refuses an unknown calculator and a calculation on an archived case', async () => {
    const { store, c } = await setup();
    await expect(store.calculate(c.id, 'magic' as CalculatorId)).rejects.toBeInstanceOf(IntegrityError);
    await store.updateCase(c.id, { status: 'archived' }, 'end of rotation');
    await expect(store.calculate(c.id, 'bmi')).rejects.toBeInstanceOf(IntegrityError);
  });

  it('a value read from a document but not confirmed is named as unverified, never used', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    const a = await store.addAttachment(c.id, { kind: 'text', docType: 'lab_report', origin: 'typed', text: 'Creatinine 1.4 mg/dL', redactionConfirmed: true });
    await store.addExtractionRun(c.id, {
      attachmentId: a.id,
      model: 'test-model',
      promptVersion: 'extract-test',
      passes: 1,
      readable: true,
      sent: { identifiersMasked: 0, datesReplaced: 0 },
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      fields: [
        {
          id: 'f1',
          kind: 'lab',
          target: { kind: 'entry', type: 'lab' },
          values: { analyte: 'scr', resultKind: 'numeric', value: '1.4', unit: 'mg/dL' },
          rawText: 'Creatinine 1.4 mg/dL',
          legibility: 'clear',
          handwritten: false,
          flags: ['no_day'],
        },
      ],
    });
    const out = await store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
    expect(out).toMatchObject({ ok: false, problems: [{ kind: 'unverified', key: 'scr' }], pendingKeys: ['scr'] });
  });

  it('a result becomes out of date when its creatinine is corrected or a newer one is recorded', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    const s = await store.addEntry(c.id, scr(1.2, 1));
    const out = await store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
    if (!out.ok) throw new Error('expected a result');
    const def = CALCULATOR_DEFS.find((d) => d.id === 'crcl_cg')!;
    expect(resultCurrency(out.results[0]!, def, await store.calculationContext(c.id))).toEqual({ current: true });
    await store.addEntry(c.id, scr(1.3, 2));
    const newer = resultCurrency(out.results[0]!, def, await store.calculationContext(c.id));
    expect(newer.current).toBe(false);
    if (!newer.current) expect(newer.reasons[0]!.en).toContain('A newer serum creatinine was recorded (Day 2)');
    await store.correctEntry(c.id, s.id, { kind: 'retract', reason: 'wrong patient' });
    const retracted = resultCurrency(out.results[0]!, def, await store.calculationContext(c.id));
    if (!retracted.current) expect(retracted.reasons.map((r) => r.en).join(' ')).toContain('was corrected or marked entered in error');
    // The stored result itself is unchanged.
    expect((await store.listCalcResults(c.id))[0]).toEqual(out.results[0]);
  });
});

describe('vancomycin without levels, from the store, with the department’s table', () => {
  const req = (onDialysis: boolean) => ({
    answers: {
      ...(onDialysis ? {} : { weightBasis: { kind: 'choice' as const, value: 'tbw' } }),
      mgPerKg: { kind: 'number' as const, value: 15, unit: 'mg/kg' },
      onDialysis: { kind: 'boolean' as const, value: onDialysis },
    },
  });

  it('every 12 h at 78 mL/min; a newer creatinine makes the result out of date, and the stored result stays as it was', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.0, 1));
    const out = await store.calculate(c.id, 'vancomycin_empiric', req(false));
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    const r = out.results[0]!;
    // hand: CrCl = 80 × 70 ÷ 72 = 77.8 → 78 mL/min → 50–90 → every 12 h; dose = 15 × 70 = 1050 mg.
    expect(r.value).toBeCloseTo(1050, 9);
    expect(r.category?.value).toBe('every_12_h');
    const def = CALCULATOR_DEFS.find((d) => d.id === 'vancomycin_empiric')!;
    expect(resultCurrency(r, def, await store.calculationContext(c.id))).toEqual({ current: true });
    await store.addEntry(c.id, scr(3.0, 2));
    expect(resultCurrency(r, def, await store.calculationContext(c.id)).current).toBe(false);
    expect((await store.listCalcResults(c.id))[0]).toEqual(r);
  });

  it('on dialysis: one dose, then dosing by levels — no creatinine needed', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    const out = await store.calculate(c.id, 'vancomycin_empiric', req(true));
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    expect(out.results[0]).toMatchObject({ value: 1050, category: { value: 'one_dose_then_levels' } });
  });
});

describe('the Verify gate for a renal dose review (Task 8)', () => {
  const med = {
    type: 'med_start' as const,
    hospitalDay: 0,
    payload: { medId: 'm1', drug: 'enoxaparin', dose: { kind: 'structured' as const, value: 40, unit: 'mg' }, route: 'subcut', frequency: 'once daily' },
  };

  it('names every missing input, then passes when all are recorded', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, med);
    let ctx = await store.calculationContext(c.id);
    let course = deriveMedCourses(ctx.current)[0]!;
    let gate = renalDoseReviewGate(ctx, course);
    expect(gate.ok).toBe(false);
    expect(gate.items.filter((i) => i.state !== 'ok').map((i) => i.key)).toEqual(['weight', 'scr', 'dialysis', 'indication']);

    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.2, 1));
    await store.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'renal_replacement', status: 'none' } });
    await store.addEntry(c.id, { ...med, payload: { ...med.payload, medId: 'm2', indication: 'VTE prophylaxis' } });
    ctx = await store.calculationContext(c.id);
    course = deriveMedCourses(ctx.current).find((m) => m.medId === 'm2')!;
    gate = renalDoseReviewGate(ctx, course);
    expect(gate.ok).toBe(true);
    expect(gate.items.find((i) => i.key === 'scr')).toMatchObject({ state: 'ok', value: '1.2 mg/dL', day: 1 });
    expect(gate.items.find((i) => i.key === 'dialysis')).toMatchObject({ state: 'ok', value: 'not on dialysis' });
  });

  it('a creatinine waiting in the document review is "unverified", not missing and not used', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, med);
    const ctx = { ...(await store.calculationContext(c.id)), pending: [{ kind: 'lab' as const, analyte: 'scr' }] };
    const gate = renalDoseReviewGate(ctx, deriveMedCourses(ctx.current)[0]!);
    expect(gate.items.find((i) => i.key === 'scr')?.state).toBe('unverified');
  });
});

describe('dialysis status (structured renal replacement therapy note)', () => {
  it('is stored as a note and satisfies the readiness item', async () => {
    const { store, c } = await setup();
    const caseNow = (await store.getCase(c.id))!;
    const before = readiness(['dialysis'], { case: caseNow, current: [], attachments: [], items: [] })[0]!;
    expect(before).toMatchObject({ state: 'missing', add: { kind: 'entry', type: 'note', category: 'renal_replacement' } });
    await store.addEntry(c.id, { type: 'note', hospitalDay: 2, payload: { category: 'renal_replacement', status: 'intermittent_hd', details: 'Mon/Wed/Fri' } });
    const current = indexTimeline(await store.listEntries(c.id)).current;
    expect(readiness(['dialysis'], { case: caseNow, current, attachments: [], items: [] })[0]).toMatchObject({ state: 'ok', value: 'intermittent haemodialysis', day: 2 });
  });
});

describe('the Verify gate is enforced when Task 8 is saved', () => {
  const med = {
    type: 'med_start' as const,
    hospitalDay: 0,
    payload: { medId: 'm1', drug: 'enoxaparin', dose: { kind: 'structured' as const, value: 40, unit: 'mg' }, route: 'subcut', frequency: 'once daily', indication: 'VTE prophylaxis' },
  };

  it('refuses "adjustment needed" while required data is missing, accepts "unsure", and accepts the answer once the data is recorded', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, med);
    await expect(store.saveTask(c.id, 't08', { status: 'in_progress', checks: {}, fields: { 'renal@m1': 'needed' } })).rejects.toMatchObject({ errors: { 'renal@m1': 'gate' } });
    await expect(store.saveTask(c.id, 't08', { status: 'in_progress', checks: {}, fields: { 'renal@m1': 'unsure' } })).resolves.toMatchObject({ version: 1 });
    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.2, 1));
    await store.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'renal_replacement', status: 'none' } });
    await expect(store.saveTask(c.id, 't08', { status: 'in_progress', checks: {}, fields: { 'renal@m1': 'needed' } })).resolves.toMatchObject({ version: 2 });
  });

  it('an answer already saved stays saveable with other changes', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, med);
    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.2, 1));
    const rrt = await store.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'renal_replacement', status: 'none' } });
    await store.saveTask(c.id, 't08', { status: 'in_progress', checks: {}, fields: { 'renal@m1': 'not_needed' } });
    await store.correctEntry(c.id, rrt.id, { kind: 'retract', reason: 'entered in error' });
    await expect(store.saveTask(c.id, 't08', { status: 'in_progress', checks: {}, fields: { 'renal@m1': 'not_needed', 'source@m1': 'local guide' } })).resolves.toMatchObject({ version: 2 });
  });
});

describe('form Section 1 from calculation results (never typed)', () => {
  it('shows BMI and CrCl/eGFR with the calculated provenance, and marks an out-of-date result', async () => {
    const { deriveForm } = await import('../../src/domain/form/derive');
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.2, 1));
    await store.calculate(c.id, 'bmi');
    await store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'ibw' } } });
    await store.calculate(c.id, 'egfr_ckdepi2021');
    const results = await store.listCalcResults(c.id);
    const record = { case: (await store.getCase(c.id))!, entries: await store.listEntries(c.id) };
    const view = (outOfDate: Set<string>) => deriveForm({ ...record, calcResults: results, calcOutOfDate: outOfDate, mode: 'teaching' });
    const s1 = view(new Set()).sections[0]!;
    const bmi = s1.fields.find((f) => f.key === 's1.bmi')!;
    expect(bmi.state).toMatchObject({ kind: 'value', items: [{ text: '22.9 kg/m² (Normal range (18.5–24.9))', provenance: 'calculated' }] });
    expect(bmi.edit).toEqual({ kind: 'calc', calcId: 'bmi' });
    const renal = s1.fields.find((f) => f.key === 's1.crclEgfr')!;
    expect(renal.state.kind === 'value' && renal.state.items.map((i) => i.text)).toEqual([
      // (140 − 60) × 70.46 ÷ (72 × 1.2) = 65.2; CKD-EPI 2021, male 60 y, 1.2 mg/dL = 69.2 (scripts/calc-crosscheck.py)
      'CrCl (Cockcroft–Gault, IBW): 65 mL/min',
      'eGFR (CKD-EPI 2021, staging): 69 mL/min/1.73 m²',
    ]);
    const stale = view(new Set([results[0]!.id])).sections[0]!.fields.find((f) => f.key === 's1.bmi')!;
    expect(stale.state).toMatchObject({ kind: 'value', notes: ['calc_out_of_date'] });
  });
});

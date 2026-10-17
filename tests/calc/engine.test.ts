import { describe, expect, it } from 'vitest';
import { bmi } from '../../src/calc/calculators/body';
import { crclCg } from '../../src/calc/calculators/renal';
import { makeCalculator, run } from '../../src/calc/engine';
import { candidates, confirmationKey, gather, minutesOf } from '../../src/calc/gather';
import { SCR, WEIGHT } from '../../src/calc/inputs';
import { attempt, ctx, lab, male, named, num, ok, pick, refused, textLab, weight } from './helpers';

describe('engine:gather', () => {
  it('takes the most recent timeline entry and keeps its id, day and provenance', () => {
    const old = lab('scr', 1.0, 'mg/dL', { day: 1 });
    const recent = lab('scr', 1.4, 'mg/dL', { day: 3, time: '06:00' });
    const g = gather([SCR], [], ctx(male(60), [old, recent]));
    expect(g.problems).toEqual([]);
    expect(g.inputs.scr).toMatchObject({ value: 1.4, unit: 'mg/dL', source: { kind: 'entry', entryId: recent.id, day: 3, time: '06:00', provenance: 'user_entered' } });
  });

  it('uses the entry the trainee picked instead of the most recent', () => {
    const old = lab('scr', 1.0, 'mg/dL', { day: 1 });
    const recent = lab('scr', 1.4, 'mg/dL', { day: 3 });
    const g = gather([SCR], [], ctx(male(60), [old, recent]), { picks: { scr: old.id } });
    expect(g.inputs.scr?.value).toBe(1.0);
  });

  it('lists candidates most recent first, matching only the right analyte', () => {
    const a = lab('scr', 1.0, 'mg/dL', { day: 1 });
    const b = lab('scr', 1.1, 'mg/dL', { day: 2 });
    const k = lab('k', 4.0, 'mmol/L', { day: 3 });
    expect(candidates(SCR, [a, b, k]).map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('names a missing required input and ignores a missing optional one', () => {
    const g = gather([SCR], [WEIGHT], ctx(male(60), []));
    expect(g.problems).toEqual([{ kind: 'missing', key: 'scr' }]);
    expect(g.inputs.weight).toBeUndefined();
  });

  it('refuses a value that is still extracted_unverified, even when an older verified one exists', () => {
    const verified = lab('scr', 1.0, 'mg/dL', { day: 1 });
    const unverified = lab('scr', 2.0, 'mg/dL', { day: 2, provenance: 'extracted_unverified' });
    const g = gather([SCR], [], ctx(male(60), [verified, unverified]));
    expect(g.problems).toEqual([{ kind: 'unverified', key: 'scr', entryId: unverified.id }]);
    expect(g.inputs.scr).toBeUndefined();
  });

  it('names a value read from a document and not yet confirmed as unverified, never as usable', () => {
    const g = gather([SCR], [], ctx(male(60), [], [{ kind: 'lab', analyte: 'scr' }]));
    expect(g.problems).toEqual([{ kind: 'unverified', key: 'scr' }]);
    expect(g.pendingKeys).toEqual(['scr']);
  });

  it('rejects an entry whose unit is not accepted, naming the accepted units', () => {
    const g = gather([SCR], [], ctx(male(60), [lab('scr', 1.2, 'mg/L')]));
    expect(g.problems).toEqual([{ kind: 'unit', key: 'scr', unit: 'mg/L', accepted: ['mg/dL', 'µmol/L'] }]);
  });

  it('converts explicitly and records the value as it was entered', () => {
    const g = gather([SCR], [], ctx(male(60), [lab('scr', 106.08, 'µmol/L')]));
    expect(g.inputs.scr?.value).toBeCloseTo(1.2, 10);
    expect(g.inputs.scr?.recorded).toEqual({ value: 106.08, unit: 'µmol/L', rule: '÷ 88.4' });
  });

  it('refuses a text result where a number is needed', () => {
    const g = gather([SCR], [], ctx(male(60), [textLab('scr', 'haemolysed', 'mg/dL')]));
    expect(named(g.problems, 'invalid')).toEqual(['scr']);
  });

  it('reads age, sex and height from the case record and names a missing height', () => {
    const r = refused(bmi, ctx(male(50), [weight(70)]));
    expect(r).toEqual([{ kind: 'missing', key: 'height' }]);
  });

  it('converts a day and clock time to minutes from day 0', () => {
    expect(minutesOf(0, '00:00')).toBe(0);
    expect(minutesOf(2, '08:30')).toBe(2 * 1440 + 510);
    expect(minutesOf(-1, '23:00')).toBe(-60);
  });
});

describe('engine:run', () => {
  const c = () => ctx(male(60, 175), [weight(70, { day: 0 }), lab('scr', 1.2, 'mg/dL', { day: 2 })]);
  const tbw = { answers: { weightBasis: pick('tbw') } };

  it('persists inputs with entry ids, values and units; the result explains itself', () => {
    const r = ok(crclCg, c(), tbw);
    expect(r).toMatchObject({ id: 'calc-1', caseId: 'CASE-TEST', calc: 'crcl_cg', formulaVersion: '1', unit: 'mL/min', day: 2 });
    expect(r.inputs.entryIds).toHaveLength(2);
    expect(r.inputs.values).toMatchObject({ age: 60, weight: 70, scr: 1.2, sex: 0 });
    expect(r.inputs.units).toMatchObject({ age: 'years', weight: 'kg', scr: 'mg/dL' });
    expect(r.computedAt).toBe('2026-10-17T12:00:00.000Z');
    const calc = makeCalculator(crclCg, { validated: true, passed: 1, at: 'test' });
    const text = calc.explain(r);
    expect(text).toContain('Formula: CrCl (mL/min) = (140 − age) × weight (kg) ÷ (72 × SCr (mg/dL))');
    expect(text).toContain('CrCl = (140 − 60) × 70 ÷ (72 × 1.2) = 64.8 mL/min');
    expect(text).toContain('Total body weight used, as chosen by the trainee.');
    expect(text).toContain('Source: Cockcroft DW, Gault MH.');
  });

  it('refuses to run a calculator that has not passed its tests', () => {
    const calc = makeCalculator(crclCg, { validated: false, reason: 'tests_failed' });
    const r = run(calc, c(), tbw, { caseId: 'CASE-TEST', now: () => new Date(), uuid: () => 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]?.kind).toBe('refused');
  });

  it('asks for confirmation of an implausible value, then records the confirmation as an assumption', () => {
    const entries = [weight(70), lab('scr', 25, 'mg/dL', { day: 2 })];
    const first = attempt(crclCg, ctx(male(60), entries), tbw);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.problems).toEqual([{ kind: 'out_of_range', key: 'scr', value: 25, unit: 'mg/dL', range: [0.2, 20] }]);
    const key = confirmationKey(first.inputs.scr!);
    expect(key).toBe('scr=25 mg/dL');
    const r = ok(crclCg, ctx(male(60), entries), { ...tbw, confirmed: [key] });
    expect(r.assumptions.map((a) => a.en)).toContain('Serum creatinine: 25 mg/dL is outside the plausible range; confirmed by the trainee as correct.');
  });

  it('a confirmation applies only to the exact value it was given for', () => {
    const entries = [weight(70), lab('scr', 26, 'mg/dL', { day: 2 })];
    const r = attempt(crclCg, ctx(male(60), entries), { ...tbw, confirmed: ['scr=25 mg/dL'] });
    expect(r.ok).toBe(false);
  });

  it('rejects a value outside its definitional limits without offering a confirmation', () => {
    const r = refused(crclCg, ctx(male(60), [weight(70), lab('scr', 0, 'mg/dL')]), tbw);
    expect(named(r, 'invalid')).toEqual(['scr']);
    expect(named(r, 'out_of_range')).toEqual([]);
  });

  it('names every blocking input at once', () => {
    const r = refused(crclCg, ctx(male(60), []));
    expect(named(r, 'missing').sort()).toEqual(['scr', 'weight', 'weightBasis'].sort());
  });

  it('a typed answer in an unknown unit is rejected', () => {
    const r = refused(crclCg, ctx(male(60, 175), [weight(70), lab('scr', 1, 'mg/dL')]), {
      answers: { weightBasis: pick('adjbw'), adjFactor: num(0.4, 'percent') },
    });
    expect(named(r, 'unit')).toEqual(['adjFactor']);
  });
});

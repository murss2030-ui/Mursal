/**
 * Corrected phenytoin (Sheiner–Tozer) — high-risk calculator: extended suite.
 * Origins: "published" = a total of 8 mcg/mL at albumin 2.0 g/dL corresponds
 * to 15–16 mcg/mL at a normal albumin (SCFHS SPLE study guide, section 4.2,
 * open-exam-prep.com); "hand" arithmetic shown; "independent" =
 * scripts/calc-crosscheck.py.
 */
import { describe, expect, it } from 'vitest';
import { ESCALATE, phenytoinCorrected } from '../../src/calc/calculators/phenytoin';
import { ctx, lab, male, named, ok, refused, yesA } from './helpers';

const run = (level: number, levelUnit: string, alb: number, albUnit: string, renal: boolean, opts: { day2?: number } = {}) =>
  ok(phenytoinCorrected, ctx(male(40), [lab('phenytoin', level, levelUnit, { day: 1 }), lab('albumin', alb, albUnit, { day: opts.day2 ?? 1 })]), {
    answers: { renalFailure: yesA(renal) },
  });

describe(`calc:${phenytoinCorrected.id}@${phenytoinCorrected.formulaVersion}`, () => {
  it('8 mg/L with albumin 2.0 g/dL → 8 ÷ (0.2 × 2.0 + 0.1) = 16 mg/L (hand; matches the published 15–16)', () => {
    const r = run(8, 'mg/L', 2.0, 'g/dL', false);
    expect(r.value).toBeCloseTo(16, 12);
    expect(r.value).toBeGreaterThanOrEqual(15);
    expect(r.value).toBeLessThanOrEqual(16);
    expect(r.unit).toBe('mg/L');
  });

  it('renal-failure form: 8 ÷ (0.1 × 2.0 + 0.1) = 26.7 mg/L (hand), with the escalation message', () => {
    const r = run(8, 'mg/L', 2.0, 'g/dL', true);
    expect(r.value).toBeCloseTo(26.666666666666664, 12);
    expect(r.warnings.map((w) => w.en)).toContain(ESCALATE.en);
    expect(r.warnings[0]?.en).toContain('Soriano');
    expect(r.assumptions[0]?.en).toContain('Renal-failure form used');
  });

  it.each([
    [10, 3.0, false, 14.285714285714285],
    [6, 1.8, false, 13.043478260869563],
    [12, 4.5, false, 12],
  ])('level %s mg/L, albumin %s g/dL, renal %s → %s mg/L (independent)', (level, alb, renal, expected) => {
    expect(run(level, 'mg/L', alb, 'g/dL', renal).value).toBeCloseTo(expected, 12);
  });

  it('units: mcg/mL, µmol/L and albumin in g/L give the same result', () => {
    expect(run(8, 'mcg/mL', 2.0, 'g/dL', false).value).toBeCloseTo(16, 12);
    expect(run(31.712, 'µmol/L', 2.0, 'g/dL', false).value).toBeCloseTo(16, 9);
    expect(run(8, 'mg/L', 20, 'g/L', false).value).toBeCloseTo(16, 12);
  });

  it('at albumin 4.5 g/dL the standard form returns the measured level (denominator 1)', () => {
    expect(run(17.3, 'mg/L', 4.5, 'g/dL', false).value).toBeCloseTo(17.3, 12);
  });

  it('the corrected level falls as albumin rises, and the renal form is always the higher', () => {
    let last = Infinity;
    for (let alb = 1.0; alb <= 6.0; alb += 0.25) {
      const std = run(10, 'mg/L', alb, 'g/dL', false).value;
      const renal = run(10, 'mg/L', alb, 'g/dL', true).value;
      expect(std).toBeLessThan(last);
      expect(renal).toBeGreaterThan(std);
      last = std;
    }
  });

  it('escalates below albumin 2.0 g/dL; not at 2.0; notes a normal albumin', () => {
    expect(run(6, 'mg/L', 1.8, 'g/dL', false).warnings.map((w) => w.en)).toContain(ESCALATE.en);
    expect(run(8, 'mg/L', 2.0, 'g/dL', false).warnings.map((w) => w.en)).not.toContain(ESCALATE.en);
    expect(run(12, 'mg/L', 4.2, 'g/dL', false).warnings.map((w) => w.en).join(' ')).toContain('Albumin is not low');
  });

  it('warns when the level and the albumin come from different days', () => {
    expect(run(8, 'mg/L', 2.0, 'g/dL', false, { day2: 4 }).warnings.map((w) => w.en).join(' ')).toContain('different samples');
  });

  it('refuses without the renal question answered — the branch is never assumed', () => {
    const p = refused(phenytoinCorrected, ctx(male(40), [lab('phenytoin', 8, 'mg/L'), lab('albumin', 2, 'g/dL')]));
    expect(p).toEqual([{ kind: 'missing', key: 'renalFailure' }]);
  });

  it('refuses a missing or unverified level and a missing albumin', () => {
    const answers = { answers: { renalFailure: yesA(false) } };
    expect(named(refused(phenytoinCorrected, ctx(male(40), [lab('albumin', 2, 'g/dL')]), answers), 'missing')).toEqual(['level']);
    expect(named(refused(phenytoinCorrected, ctx(male(40), [lab('phenytoin', 8, 'mg/L', { provenance: 'extracted_unverified' }), lab('albumin', 2, 'g/dL')]), answers), 'unverified')).toEqual(['level']);
    expect(named(refused(phenytoinCorrected, ctx(male(40), [lab('phenytoin', 8, 'mg/L')]), answers), 'missing')).toEqual(['albumin']);
  });

  it('limits and plausibility: a level of 80 mg/L needs confirmation; 0 is rejected; albumin 0.5 needs confirmation', () => {
    const answers = { answers: { renalFailure: yesA(false) } };
    expect(named(refused(phenytoinCorrected, ctx(male(40), [lab('phenytoin', 80, 'mg/L'), lab('albumin', 2, 'g/dL')]), answers), 'out_of_range')).toEqual(['level']);
    expect(named(refused(phenytoinCorrected, ctx(male(40), [lab('phenytoin', 0, 'mg/L'), lab('albumin', 2, 'g/dL')]), answers), 'invalid')).toEqual(['level']);
    expect(named(refused(phenytoinCorrected, ctx(male(40), [lab('phenytoin', 8, 'mg/L'), lab('albumin', 0.5, 'g/dL')]), answers), 'out_of_range')).toEqual(['albumin']);
  });

  it('shows the denominator and the substitution', () => {
    const r = run(8, 'mg/L', 2.0, 'g/dL', false);
    expect(r.steps).toContain('Denominator = 0.2 × 2 + 0.1 = 0.5');
    expect(r.steps.at(-1)).toBe('Corrected level = 8 ÷ 0.5 = 16 mg/L');
  });
});

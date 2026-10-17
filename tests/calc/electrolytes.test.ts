/**
 * Anion gap (Figge albumin correction) and corrected calcium (Payne).
 * Origins: "hand" arithmetic shown; "independent" = scripts/calc-crosscheck.py.
 */
import { describe, expect, it } from 'vitest';
import { anionGap, correctedCalcium } from '../../src/calc/calculators/electrolytes';
import { ctx, lab, male, named, ok, refused, secondary } from './helpers';

const lytes = (na: number, cl: number, hco3: number, unit = 'mmol/L', day = 1) => [
  lab('na', na, unit, { day }),
  lab('cl', cl, unit, { day }),
  lab('hco3', hco3, unit, { day }),
];

describe(`calc:${anionGap.id}@${anionGap.formulaVersion}`, () => {
  it('140 − (104 + 24) = 12 (hand); albumin 4.0 leaves it unchanged', () => {
    const r = ok(anionGap, ctx(male(50), [...lytes(140, 104, 24), lab('albumin', 4.0, 'g/dL')]));
    expect(r.value).toBe(12);
    expect(secondary(r, 'agCorrected')).toBe(12);
  });

  it('140 − (100 + 20) = 20; albumin 2.0 g/dL → 20 + 2.5 × 2 = 25 (hand)', () => {
    const r = ok(anionGap, ctx(male(50), [...lytes(140, 100, 20), lab('albumin', 2.0, 'g/dL')]));
    expect(r.value).toBe(20);
    expect(secondary(r, 'agCorrected')).toBeCloseTo(25, 12);
  });

  it('albumin in g/L and electrolytes in mEq/L give the same result', () => {
    const r = ok(anionGap, ctx(male(50), [...lytes(140, 100, 20, 'mEq/L'), lab('albumin', 20, 'g/L')]));
    expect(r.value).toBe(20);
    expect(secondary(r, 'agCorrected')).toBeCloseTo(25, 12);
  });

  it('without albumin it is not corrected, and says so', () => {
    const r = ok(anionGap, ctx(male(50), lytes(140, 100, 20)));
    expect(r.secondary).toBeUndefined();
    expect(r.warnings[0]?.en).toContain('the gap is not corrected');
  });

  it('warns when the electrolytes come from different samples', () => {
    const r = ok(anionGap, ctx(male(50), [lab('na', 140, 'mmol/L', { day: 1 }), lab('cl', 100, 'mmol/L', { day: 2 }), lab('hco3', 20, 'mmol/L', { day: 2 })]));
    expect(r.warnings.map((w) => w.en).join(' ')).toContain('different samples (Day 1, Day 2)');
  });

  it('refuses a missing chloride, an unverified bicarbonate and an unknown unit', () => {
    expect(named(refused(anionGap, ctx(male(50), [lab('na', 140, 'mmol/L'), lab('hco3', 20, 'mmol/L')])), 'missing')).toEqual(['cl']);
    expect(
      named(refused(anionGap, ctx(male(50), [lab('na', 140, 'mmol/L'), lab('cl', 100, 'mmol/L'), lab('hco3', 20, 'mmol/L', { provenance: 'extracted_unverified' })])), 'unverified'),
    ).toEqual(['hco3']);
    expect(named(refused(anionGap, ctx(male(50), [lab('na', 140, 'mg/dL'), lab('cl', 100, 'mmol/L'), lab('hco3', 20, 'mmol/L')])), 'unit')).toEqual(['na']);
  });

  it('a sodium of 90 needs confirmation', () => {
    expect(named(refused(anionGap, ctx(male(50), lytes(90, 60, 20))), 'out_of_range')).toEqual(['na']);
  });
});

describe(`calc:${correctedCalcium.id}@${correctedCalcium.formulaVersion}`, () => {
  it('8.0 mg/dL with albumin 2.0 g/dL → 8.0 + 0.8 × 2.0 = 9.6 mg/dL = 2.395 mmol/L (hand, independent)', () => {
    const r = ok(correctedCalcium, ctx(male(50), [lab('ca_total', 8.0, 'mg/dL'), lab('albumin', 2.0, 'g/dL')]));
    expect(r.value).toBeCloseTo(9.6, 12);
    expect(secondary(r, 'mmol')).toBeCloseTo(2.395209580838323, 12);
  });

  it('in SI units: 2.0 mmol/L with albumin 20 g/L → 2.399 mmol/L, within 0.001 of the SI form 2.0 + 0.02 × (40 − 20)', () => {
    const r = ok(correctedCalcium, ctx(male(50), [lab('ca_total', 2.0, 'mmol/L'), lab('albumin', 20, 'g/L')]));
    expect(r.value).toBeCloseTo(9.616, 12);
    expect(secondary(r, 'mmol')).toBeCloseTo(2.399201596806387, 12);
    expect(Math.abs(secondary(r, 'mmol') - 2.4)).toBeLessThan(0.001);
  });

  it('a high albumin lowers the corrected value (10.0 with albumin 4.5 → 9.6)', () => {
    expect(ok(correctedCalcium, ctx(male(50), [lab('ca_total', 10.0, 'mg/dL'), lab('albumin', 4.5, 'g/dL')])).value).toBeCloseTo(9.6, 12);
  });

  it('refuses without albumin, and warns about different samples', () => {
    expect(named(refused(correctedCalcium, ctx(male(50), [lab('ca_total', 8.0, 'mg/dL')])), 'missing')).toEqual(['albumin']);
    const r = ok(correctedCalcium, ctx(male(50), [lab('ca_total', 8.0, 'mg/dL', { day: 1 }), lab('albumin', 2.0, 'g/dL', { day: 3 })]));
    expect(r.warnings[0]?.en).toContain('different samples');
  });

  it('uses only the total calcium, never the ionised one', () => {
    expect(named(refused(correctedCalcium, ctx(male(50), [lab('ca_ionized', 1.1, 'mmol/L'), lab('albumin', 2.0, 'g/dL')])), 'missing')).toEqual(['calcium']);
  });
});

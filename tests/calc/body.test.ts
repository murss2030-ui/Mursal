/**
 * BMI, BSA (Mosteller), IBW/AdjBW (Devine).
 * Origins: "hand" = arithmetic shown in the test; "independent" = the value
 * printed by scripts/calc-crosscheck.py, a separate implementation written
 * from the published formulas.
 */
import { describe, expect, it } from 'vitest';
import { bmi, bsaMosteller, ibwAdjbw } from '../../src/calc/calculators/body';
import { ctx, female, lab, male, named, num, ok, refused, secondary, weight } from './helpers';

describe(`calc:${bmi.id}@${bmi.formulaVersion}`, () => {
  it.each([
    // [kg, cm, expected, category, origin]
    [70, 175, 22.857142857142858, 'normal', 'hand: 70 ÷ 1.75² = 70 ÷ 3.0625'],
    [45, 160, 17.578124999999996, 'underweight', 'hand: 45 ÷ 1.6² = 45 ÷ 2.56'],
    [95, 170, 32.871972318339104, 'obese', 'independent'],
  ])('%s kg, %s cm → %s (%s)', (kg, cm, expected, category) => {
    const r = ok(bmi, ctx(male(40, cm), [weight(kg)]));
    expect(r.value).toBeCloseTo(expected, 9);
    expect(r.unit).toBe('kg/m²');
    expect(r.category?.value).toBe(category);
  });

  it('category boundaries: 18.5 and 25 and 30 begin the next category', () => {
    // height 100 cm makes BMI equal to the weight in kg
    expect(ok(bmi, ctx(male(40, 100), [weight(18.5)])).category?.value).toBe('normal');
    expect(ok(bmi, ctx(male(40, 100), [weight(24.99)])).category?.value).toBe('normal');
    expect(ok(bmi, ctx(male(40, 100), [weight(25)])).category?.value).toBe('overweight');
    expect(ok(bmi, ctx(male(40, 100), [weight(30)])).category?.value).toBe('obese');
  });

  it('no adult category under 18 years, with a warning', () => {
    const r = ok(bmi, ctx(male(12, 150), [weight(40)]));
    expect(r.category).toBeUndefined();
    expect(r.warnings[0]?.en).toContain('BMI-for-age');
  });

  it('refuses without a weight or a height, naming them', () => {
    expect(refused(bmi, ctx(male(40, 175), []))).toEqual([{ kind: 'missing', key: 'weight' }]);
    expect(refused(bmi, ctx(male(40), [weight(70)]))).toEqual([{ kind: 'missing', key: 'height' }]);
  });

  it('refuses an unverified weight', () => {
    const p = refused(bmi, ctx(male(40, 175), [weight(70, { provenance: 'extracted_unverified' })]));
    expect(named(p, 'unverified')).toEqual(['weight']);
  });

  it('limits and plausibility: weight 0 rejected, weight 350 kg needs confirmation', () => {
    expect(named(refused(bmi, ctx(male(40, 175), [weight(0.1)])), 'invalid')).toEqual(['weight']);
    expect(named(refused(bmi, ctx(male(40, 175), [weight(350)])), 'out_of_range')).toEqual(['weight']);
    expect(ok(bmi, ctx(male(40, 175), [weight(350)]), { confirmed: ['weight=350 kg'] }).value).toBeCloseTo(114.2857, 3);
  });
});

describe(`calc:${bsaMosteller.id}@${bsaMosteller.formulaVersion}`, () => {
  it.each([
    [175, 70, 1.8446619684315546, 'hand: √(175 × 70 ÷ 3600) = √3.40278'],
    [160, 50, 1.4907119849998598, 'hand: √(160 × 50 ÷ 3600) = √2.22222'],
  ])('%s cm, %s kg → %s m²', (cm, kg, expected) => {
    const r = ok(bsaMosteller, ctx(female(30, cm), [weight(kg)]));
    expect(r.value).toBeCloseTo(expected, 9);
    expect(r.unit).toBe('m²');
  });

  it('shows the substituted formula', () => {
    const r = ok(bsaMosteller, ctx(female(30, 175), [weight(70)]));
    expect(r.steps.at(-1)).toBe('BSA = √(175 × 70 ÷ 3600) = 1.84 m²');
  });

  it('refuses without a height', () => {
    expect(refused(bsaMosteller, ctx(female(30), [weight(70)]))).toEqual([{ kind: 'missing', key: 'height' }]);
  });
});

describe(`calc:${ibwAdjbw.id}@${ibwAdjbw.formulaVersion}`, () => {
  const f04 = { answers: { adjFactor: num(0.4, 'unitless') } };

  it('male, 175 cm, TBW 100 kg, factor 0.4 (independent)', () => {
    const r = ok(ibwAdjbw, ctx(male(50, 175), [weight(100)]), f04);
    expect(r.value).toBeCloseTo(70.46456692913384, 9); // 50 + 2.3 × (175/2.54 − 60)
    expect(secondary(r, 'adjbw')).toBeCloseTo(82.2787401574803, 9); // IBW + 0.4 × (100 − IBW)
    expect(secondary(r, 'pctIbw')).toBeCloseTo(141.91529779863677, 9);
    expect(r.assumptions.map((a) => a.en)).toContain('Adjustment factor 0.4, entered by the trainee.');
  });

  it('female, 165 cm, TBW 60 kg (independent)', () => {
    const r = ok(ibwAdjbw, ctx(female(50, 165), [weight(60)]), f04);
    expect(r.value).toBeCloseTo(56.90944881889762, 9);
    expect(secondary(r, 'adjbw')).toBeCloseTo(58.14566929133857, 9);
  });

  it('exactly 5 feet (152.4 cm) gives the base weight; shorter warns of extrapolation', () => {
    expect(ok(ibwAdjbw, ctx(female(50, 152.4), [weight(60)]), f04).value).toBeCloseTo(45.5, 9);
    const short = ok(ibwAdjbw, ctx(female(50, 150), [weight(60)]), f04);
    expect(short.value).toBeCloseTo(43.32677165354331, 9);
    expect(short.warnings.map((w) => w.en).join(' ')).toContain('Height is under 152.4 cm');
  });

  it('warns that AdjBW is not meaningful when TBW is not above IBW', () => {
    const r = ok(ibwAdjbw, ctx(male(50, 175), [weight(60)]), f04);
    expect(r.warnings.map((w) => w.en).join(' ')).toContain('adjusted body weight is not meaningful');
  });

  it('a different factor is used and recorded', () => {
    const r = ok(ibwAdjbw, ctx(male(50, 175), [weight(100)]), { answers: { adjFactor: num(0.3, 'unitless') } });
    expect(secondary(r, 'adjbw')).toBeCloseTo(70.46456692913384 + 0.3 * (100 - 70.46456692913384), 9);
  });

  it('refuses under 18 years, and without the factor', () => {
    expect(refused(ibwAdjbw, ctx(male(16, 175), [weight(70)]), f04)[0]?.kind).toBe('refused');
    expect(refused(ibwAdjbw, ctx(male(50, 175), [weight(70)]))).toEqual([{ kind: 'missing', key: 'adjFactor' }]);
  });

  it('a factor outside 0.2–0.5 needs confirmation; outside 0–1 is rejected', () => {
    expect(named(refused(ibwAdjbw, ctx(male(50, 175), [weight(100)]), { answers: { adjFactor: num(0.6, 'unitless') } }), 'out_of_range')).toEqual(['adjFactor']);
    expect(named(refused(ibwAdjbw, ctx(male(50, 175), [weight(100)]), { answers: { adjFactor: num(1.5, 'unitless') } }), 'invalid')).toEqual(['adjFactor']);
  });

  it('ignores laboratory entries entirely', () => {
    const r = ok(ibwAdjbw, ctx(male(50, 175), [weight(100), lab('scr', 1, 'mg/dL')]), f04);
    expect(r.inputs.entryIds).toHaveLength(1);
  });
});

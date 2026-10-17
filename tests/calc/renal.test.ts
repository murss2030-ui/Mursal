/**
 * Cockcroft–Gault and CKD-EPI 2021.
 * Origins: "published" = a worked example seen in a published source (named);
 * "hand" = arithmetic shown; "independent" = scripts/calc-crosscheck.py.
 */
import { describe, expect, it } from 'vitest';
import { crclCg, egfrCkdEpi2021 } from '../../src/calc/calculators/renal';
import { ctx, female, lab, male, named, num, ok, pick, refused, weight } from './helpers';

const basis = (b: 'tbw' | 'ibw' | 'adjbw', factor?: number) => ({
  answers: { weightBasis: pick(b), ...(factor !== undefined ? { adjFactor: num(factor, 'unitless') } : {}) },
});

describe(`calc:${crclCg.id}@${crclCg.formulaVersion}`, () => {
  it('male, 60 y, 70 kg, SCr 1.2 mg/dL → 64.8 mL/min (hand: 80 × 70 ÷ 86.4 = 5600 ÷ 86.4)', () => {
    const r = ok(crclCg, ctx(male(60, 175), [weight(70), lab('scr', 1.2, 'mg/dL')]), basis('tbw'));
    expect(r.value).toBeCloseTo(64.81481481481482, 9);
    expect(r.unit).toBe('mL/min');
  });

  it('female, same values → 55.1 mL/min (published worked example: 64.8 × 0.85 = 55.1; GFR calculation example, Scribd doc. 1069260613)', () => {
    const r = ok(crclCg, ctx(female(60, 165), [weight(70), lab('scr', 1.2, 'mg/dL')]), basis('tbw'));
    expect(r.value).toBeCloseTo(55.092592592592595, 9);
    expect(Math.round(r.value * 10) / 10).toBe(55.1);
    expect(r.assumptions.map((a) => a.en)).toContain('Sex: female (× 0.85) (case record).');
  });

  it('creatinine in µmol/L gives the same result (106.08 µmol/L = 1.2 mg/dL)', () => {
    const r = ok(crclCg, ctx(male(60, 175), [weight(70), lab('scr', 106.08, 'µmol/L')]), basis('tbw'));
    expect(r.value).toBeCloseTo(64.81481481481482, 9);
    expect(r.steps.join('\n')).toContain('SCr = 1.2 mg/dL (recorded 106.08 µmol/L, ÷ 88.4)');
  });

  it('weight basis is the trainee’s choice and changes the result (independent)', () => {
    const c = ctx(male(50, 175), [weight(100), lab('scr', 1.0, 'mg/dL')]);
    const tbw = ok(crclCg, c, basis('tbw'));
    const ibw = ok(crclCg, c, basis('ibw'));
    const adj = ok(crclCg, c, basis('adjbw', 0.4));
    expect(tbw.value).toBeCloseTo(125, 9);
    expect(ibw.value).toBeCloseTo(88.0807086614173, 9);
    expect(adj.value).toBeCloseTo(102.84842519685037, 9);
    expect(ibw.assumptions.map((a) => a.en)).toContain('Ideal body weight (Devine) used, as chosen by the trainee.');
    expect(adj.assumptions.map((a) => a.en)).toContain('Adjusted body weight used, with factor 0.4, as chosen by the trainee.');
    // BMI 32.7: obesity warning on any basis
    expect(tbw.warnings.map((w) => w.en).join(' ')).toContain('BMI is 32.7 kg/m² (obesity)');
  });

  it('IBW or AdjBW without a height is refused, naming the height', () => {
    const p = refused(crclCg, ctx(male(50), [weight(100), lab('scr', 1.0, 'mg/dL')]), basis('ibw'));
    expect(p).toEqual([{ kind: 'missing', key: 'height', detail: expect.anything() }]);
    const q = refused(crclCg, ctx(male(50, 175), [weight(100), lab('scr', 1.0, 'mg/dL')]), basis('adjbw'));
    expect(named(q, 'missing')).toEqual(['adjFactor']);
  });

  it('refuses under 18 years instead of extrapolating', () => {
    const p = refused(crclCg, ctx(male(17, 170), [weight(60), lab('scr', 0.8, 'mg/dL')]), basis('tbw'));
    expect(p[0]?.kind).toBe('refused');
    expect(ok(crclCg, ctx(male(18, 170), [weight(60), lab('scr', 0.8, 'mg/dL')]), basis('tbw')).value).toBeCloseTo((122 * 60) / (72 * 0.8), 9);
  });

  it('refuses a missing creatinine, an unverified creatinine, and one waiting in the document review', () => {
    expect(named(refused(crclCg, ctx(male(60, 175), [weight(70)]), basis('tbw')), 'missing')).toEqual(['scr']);
    expect(named(refused(crclCg, ctx(male(60, 175), [weight(70), lab('scr', 1.2, 'mg/dL', { provenance: 'extracted_unverified' })]), basis('tbw')), 'unverified')).toEqual(['scr']);
    expect(named(refused(crclCg, ctx(male(60, 175), [weight(70)], [{ kind: 'lab', analyte: 'scr' }]), basis('tbw')), 'unverified')).toEqual(['scr']);
  });

  it('warns that an unstable creatinine (KDIGO criterion met) makes the estimate unreliable', () => {
    const entries = [weight(70), lab('scr', 1.0, 'mg/dL', { day: 1, time: '06:00' }), lab('scr', 1.6, 'mg/dL', { day: 2, time: '06:00' })];
    const r = ok(crclCg, ctx(male(60, 175), entries), basis('tbw'));
    expect(r.value).toBeCloseTo((80 * 70) / (72 * 1.6), 9);
    expect(r.warnings.map((w) => w.en).join(' ')).toContain('meets a KDIGO creatinine criterion for acute kidney injury');
  });

  it('warns above the age range of the original study, and when height is missing', () => {
    const old = ok(crclCg, ctx(male(95, 170), [weight(60), lab('scr', 1.0, 'mg/dL')]), basis('tbw'));
    expect(old.warnings.map((w) => w.en).join(' ')).toContain('original study population (18–92 years)');
    const noHeight = ok(crclCg, ctx(male(60), [weight(70), lab('scr', 1.2, 'mg/dL')]), basis('tbw'));
    expect(noHeight.warnings.map((w) => w.en).join(' ')).toContain('Height is not recorded');
  });

  it('a creatinine of 0.1 mg/dL needs confirmation; 0 is rejected', () => {
    expect(named(refused(crclCg, ctx(male(60, 175), [weight(70), lab('scr', 0.1, 'mg/dL')]), basis('tbw')), 'out_of_range')).toEqual(['scr']);
    expect(named(refused(crclCg, ctx(male(60, 175), [weight(70), lab('scr', 0, 'mg/dL')]), basis('tbw')), 'invalid')).toEqual(['scr']);
  });
});

describe(`calc:${egfrCkdEpi2021.id}@${egfrCkdEpi2021.formulaVersion}`, () => {
  it.each([
    ['female', 50, 0.6, 109.28301133784741, 'independent'],
    ['male', 60, 1.2, 69.23112756748166, 'independent'],
    ['female', 70, 1.1, 54.05610523366444, 'independent'],
    ['male', 40, 0.9, 110.72559960355491, 'independent (SCr exactly κ)'],
    ['female', 40, 0.7, 112.05430679879757, 'independent (SCr exactly κ)'],
  ] as const)('%s, %s y, SCr %s mg/dL → %s (%s)', (sex, age, scr, expected, _origin) => {
    const facts = sex === 'female' ? female(age) : male(age);
    const r = ok(egfrCkdEpi2021, ctx(facts, [lab('scr', scr, 'mg/dL')]));
    expect(r.value).toBeCloseTo(expected, 9);
    expect(r.unit).toBe('mL/min/1.73 m²');
  });

  it('µmol/L gives the same result (97.24 µmol/L = 1.1 mg/dL)', () => {
    expect(ok(egfrCkdEpi2021, ctx(female(70), [lab('scr', 97.24, 'µmol/L')])).value).toBeCloseTo(54.05610523366444, 9);
  });

  it('at SCr = κ both branches give 142 × 0.9938^age (× 1.012 if female) — continuity at the kink', () => {
    const m = ok(egfrCkdEpi2021, ctx(male(40), [lab('scr', 0.9, 'mg/dL')])).value;
    expect(m).toBeCloseTo(142 * 0.9938 ** 40, 9);
    const justBelow = ok(egfrCkdEpi2021, ctx(male(40), [lab('scr', 0.8999999, 'mg/dL')])).value;
    expect(Math.abs(justBelow - m)).toBeLessThan(1e-3);
  });

  it('is always labelled a staging tool, never for drug dosing', () => {
    const r = ok(egfrCkdEpi2021, ctx(male(60), [lab('scr', 1.2, 'mg/dL')]));
    expect(r.warnings[0]?.en).toContain('Do not use it in place of creatinine clearance for drug dosing');
  });

  it('refuses under 18, without creatinine, and with an unverified creatinine', () => {
    expect(refused(egfrCkdEpi2021, ctx(female(15), [lab('scr', 0.6, 'mg/dL')]))[0]?.kind).toBe('refused');
    expect(named(refused(egfrCkdEpi2021, ctx(female(30), [])), 'missing')).toEqual(['scr']);
    expect(named(refused(egfrCkdEpi2021, ctx(female(30), [lab('scr', 0.6, 'mg/dL', { provenance: 'extracted_unverified' })])), 'unverified')).toEqual(['scr']);
  });

  it('carries the creatinine stability warning too', () => {
    const r = ok(egfrCkdEpi2021, ctx(male(60), [lab('scr', 1.0, 'mg/dL', { day: 1 }), lab('scr', 2.0, 'mg/dL', { day: 3 })]));
    expect(r.warnings.map((w) => w.en).join(' ')).toContain('KDIGO');
  });
});

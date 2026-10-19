/**
 * Vancomycin without levels: 15–20 mg/kg of actual body weight per dose
 * (owner decision 6), the interval from the department's table (owner
 * decision, 19 October 2026): CrCl above 90 mL/min every 8 h; 50–90 every
 * 12 h; 20–49 every 24 h; below 20, or on dialysis, one dose, then dosing by
 * levels; CRRT is not calculated (owner decision, 19 October 2026). High-risk
 * calculation: extended suite.
 * Origins: "hand" = the arithmetic is written out in the test.
 */
import { describe, expect, it } from 'vitest';
import type { GatherRequest } from '../../src/calc/gather';
import {
  CRRT_PROTOCOL,
  DEPARTMENT_TABLE,
  ONE_DOSE_THEN_LEVELS,
  POPULATION_ESTIMATE,
  bandFor,
  vancomycinEmpiric,
} from '../../src/calc/calculators/vancomycin-empiric';
import type { TimelineEntry } from '../../src/domain/types';
import { ctx, female, lab, male, named, num, ok, pick, refused, secondary, weight } from './helpers';

const req = (mgPerKg: number, basis = 'tbw'): GatherRequest => ({
  answers: { rrt: pick('none'), weightBasis: pick(basis), mgPerKg: num(mgPerKg, 'mg/kg') },
});
const dialysis = (mgPerKg: number, kind: 'intermittent_hd' | 'peritoneal' = 'intermittent_hd'): GatherRequest => ({
  answers: { rrt: pick(kind), mgPerKg: num(mgPerKg, 'mg/kg') },
});

const scr = (v: number) => lab('scr', v, 'mg/dL');
const hasSecondary = (r: ReturnType<typeof ok>, key: string) => (r.secondary ?? []).some((s) => s.key === key);

describe(`calc:${vancomycinEmpiric.id}@${vancomycinEmpiric.formulaVersion}`, () => {
  it('the department’s table holds every whole-number creatinine clearance exactly once', () => {
    for (let crcl = 0; crcl <= 300; crcl++) {
      const holding = DEPARTMENT_TABLE.filter((b) => (b.min === undefined || crcl >= b.min) && (b.max === undefined || crcl <= b.max));
      expect(holding).toHaveLength(1);
    }
    expect(bandFor(91).regimen).toEqual({ kind: 'interval', hours: 8 });
    expect(bandFor(90).regimen).toEqual({ kind: 'interval', hours: 12 });
    expect(bandFor(50).regimen).toEqual({ kind: 'interval', hours: 12 });
    expect(bandFor(49).regimen).toEqual({ kind: 'interval', hours: 24 });
    expect(bandFor(20).regimen).toEqual({ kind: 'interval', hours: 24 });
    expect(bandFor(19).regimen).toEqual({ kind: 'single' });
    expect(bandFor(0).regimen).toEqual({ kind: 'single' });
  });

  it.each<[number, 'M' | 'F', number, number, number, number, number, number, number, string]>([
    // [age, sex, kg, SCr mg/dL, mg/kg, CrCl, interval h, dose mg, daily mg, origin]
    [60, 'M', 70, 1.0, 15, 77.77777777777777, 12, 1050, 2100, 'hand: CrCl (140−60)×70÷72 = 77.8 → 78 → 50–90 → 12 h; 15×70 = 1050; 1050×24÷12'],
    [30, 'M', 80, 0.9, 15, 135.8024691358025, 8, 1200, 3600, 'hand: CrCl 110×80÷64.8 = 135.8 → 136 → above 90 → 8 h; 15×80 = 1200; 1200×24÷8'],
    [75, 'M', 65, 1.5, 20, 39.120370370370374, 24, 1300, 1300, 'hand: CrCl 65×65÷108 = 39.1 → 39 → 20–49 → 24 h; 20×65 = 1300; 1300×24÷24'],
    [45, 'F', 60, 0.8, 20, 84.11458333333333, 12, 1200, 2400, 'hand: CrCl 95×60÷57.6 × 0.85 = 84.1 → 84 → 50–90 → 12 h; 20×60 = 1200; 1200×24÷12'],
  ])('%s y %s, %s kg, SCr %s, %s mg/kg → CrCl %s, every %s h, %s mg (%s)', (age, sex, kg, s, perKg, crcl, tau, dose, daily) => {
    const demo = sex === 'F' ? female(age) : male(age);
    const r = ok(vancomycinEmpiric, ctx(demo, [weight(kg), scr(s)]), req(perKg));
    expect(r.value).toBeCloseTo(dose, 9);
    expect(r.unit).toBe('mg');
    expect(secondary(r, 'interval')).toBe(tau);
    expect(secondary(r, 'daily')).toBeCloseTo(daily, 9);
    expect(secondary(r, 'crcl')).toBeCloseTo(crcl, 9);
    expect(r.category).toMatchObject({ value: `every_${tau}_h` });
  });

  it('below 20 mL/min: one dose, then dosing by levels — no interval and no daily dose', () => {
    // hand: CrCl = (140 − 80) × 50 ÷ (72 × 2.5) = 16.7 → 17 → below 20; dose = 15 × 50 = 750 mg.
    const r = ok(vancomycinEmpiric, ctx(male(80), [weight(50), scr(2.5)]), req(15));
    expect(r.value).toBeCloseTo(750, 9);
    expect(r.category).toEqual({ value: 'one_dose_then_levels', label: expect.objectContaining({ en: 'One dose, then dosing by levels (department’s table)' }) });
    expect(hasSecondary(r, 'interval')).toBe(false);
    expect(hasSecondary(r, 'daily')).toBe(false);
    expect(secondary(r, 'crcl')).toBeCloseTo(60 * 50 / 180, 9);
    expect(r.warnings).toContainEqual(ONE_DOSE_THEN_LEVELS);
    expect(r.steps).toContain('Department’s table: CrCl below 20 mL/min → one dose, then dosing by levels');
  });

  it('on intermittent haemodialysis or peritoneal dialysis: one dose, then dosing by levels; Cockcroft–Gault is neither asked for nor used', () => {
    // No creatinine in the record, no sex or weight basis asked: not needed on dialysis. hand: 20 × 72 = 1440 mg.
    for (const kind of ['intermittent_hd', 'peritoneal'] as const) {
      const r = ok(vancomycinEmpiric, ctx(male(60), [weight(72)]), dialysis(20, kind));
      expect(r.value).toBeCloseTo(1440, 9);
      expect(r.category?.value).toBe('one_dose_then_levels');
      expect(hasSecondary(r, 'crcl')).toBe(false);
      expect(Object.keys(r.inputs.detail).sort()).toEqual(['age', 'mgPerKg', 'rrt', 'weight']);
    }
    const r = ok(vancomycinEmpiric, ctx(male(60), [weight(72)]), dialysis(20));
    expect(r.steps).toContain('On dialysis: Cockcroft–Gault is not used');
    expect(r.steps).toContain('Department’s table: On intermittent haemodialysis or peritoneal dialysis → one dose, then dosing by levels');
    expect(r.warnings).toContainEqual(ONE_DOSE_THEN_LEVELS);
    // With a creatinine on record, it is still not used on dialysis.
    const withScr = ok(vancomycinEmpiric, ctx(male(60), [weight(72), scr(6.0)]), dialysis(20));
    expect(Object.keys(withScr.inputs.detail)).not.toContain('scr');
    expect(withScr.value).toBeCloseTo(1440, 9);
  });

  it('compares creatinine clearance with the table as a whole number, at each band edge', () => {
    // 60-year-old man. SCr 1.0: CrCl = 80 × W ÷ 72 (W = 0.9 × CrCl); SCr 2.0: CrCl = 80 × W ÷ 144 (W = 1.8 × CrCl);
    // SCr 4.0: CrCl = 80 × W ÷ 288 (W = 3.6 × CrCl).
    const cases: [number, number, number, number | 'single'][] = [
      [81.54, 1.0, 90.6, 8], // → 91: above 90
      [81.36, 1.0, 90.4, 12], // → 90: 50–90
      [89.28, 2.0, 49.6, 12], // → 50: 50–90
      [88.92, 2.0, 49.4, 24], // → 49: 20–49
      [70.56, 4.0, 19.6, 24], // → 20: 20–49
      [69.84, 4.0, 19.4, 'single'], // → 19: below 20
    ];
    for (const [kg, s, crcl, expected] of cases) {
      const r = ok(vancomycinEmpiric, ctx(male(60), [weight(kg), scr(s)]), req(15));
      expect(secondary(r, 'crcl')).toBeCloseTo(crcl, 9);
      if (expected === 'single') expect(r.category?.value).toBe('one_dose_then_levels');
      else expect(secondary(r, 'interval')).toBe(expected);
    }
    const r = ok(vancomycinEmpiric, ctx(male(60), [weight(88.92), scr(2.0)]), req(15));
    expect(r.steps).toContain('CrCl compared with the table as a whole number: 49 mL/min');
  });

  it('the dose uses actual (total) body weight even when creatinine clearance uses ideal body weight', () => {
    // hand: IBW (Devine, male, 175 cm) = 50 + 2.3 × (175 ÷ 2.54 − 60) = 70.46 kg; CrCl = 80 × 70.46 ÷ 72 = 78.3 → 78 → 12 h;
    // dose = 15 mg/kg × 100 kg (total body weight) = 1500 mg.
    const r = ok(vancomycinEmpiric, ctx(male(60, 175), [weight(100), scr(1.0)]), req(15, 'ibw'));
    expect(secondary(r, 'crcl')).toBeCloseTo((80 * (50 + 2.3 * (175 / 2.54 - 60))) / 72, 9);
    expect(r.value).toBeCloseTo(1500, 9);
    expect(secondary(r, 'interval')).toBe(12);
  });

  it('shows every step, the department’s band and its decision, and the population-based label', () => {
    const r = ok(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), req(15));
    const steps = r.steps.join('\n');
    expect(steps).toContain('CrCl = (140 − 60) × 70 ÷ (72 × 1) = 77.8 mL/min');
    expect(steps).toContain('CrCl compared with the table as a whole number: 78 mL/min');
    expect(steps).toContain('Department’s table: CrCl 50–90 mL/min → every 12 h');
    expect(steps).toContain('Dose per kg = 15 mg/kg');
    expect(steps).toContain('Dose = 15 mg/kg × 70 kg = 1050 mg');
    expect(steps).toContain('Daily dose = 1050 mg × 24 ÷ 12 h = 2100 mg/24 h');
    expect(r.category?.label.en).toBe('Every 12 h (department’s table)');
    expect(r.assumptions.map((a) => a.en)).toContain('Interval from the department’s table (owner decision, 19 October 2026): CrCl 50–90 mL/min → every 12 h.');
    expect(r.assumptions.map((a) => a.en)).toContain('The dose is not rounded: round it as your hospital does.');
    expect(r.warnings).toContainEqual(POPULATION_ESTIMATE);
    expect(r.warnings).not.toContainEqual(ONE_DOSE_THEN_LEVELS);
    expect(vancomycinEmpiric.citation).toContain('owner decisions, 19 October 2026');
    expect(vancomycinEmpiric.highRisk).toBe(true);
  });

  it('accepts only the department’s dose range, 15 to 20 mg/kg, in mg/kg', () => {
    for (const perKg of [14.9, 20.1, 25]) {
      expect(named(refused(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), req(perKg)), 'invalid')).toEqual(['mgPerKg']);
    }
    expect(ok(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), req(20)).value).toBeCloseTo(1400, 9); // hand: 20 × 70
    const wrongUnit = { answers: { rrt: pick('none'), weightBasis: pick('tbw'), mgPerKg: num(15, 'mg/day') } };
    expect(named(refused(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), wrongUnit), 'unit')).toEqual(['mgPerKg']);
  });

  it('names what is missing: the dialysis answer, then (off dialysis) the creatinine and the weight basis; the weight always', () => {
    const noAnswer = refused(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), { answers: { mgPerKg: num(15, 'mg/kg') } });
    expect(named(noAnswer, 'missing')).toEqual(['rrt']);
    const noScr = refused(vancomycinEmpiric, ctx(male(60), [weight(70)]), req(15));
    expect(named(noScr, 'missing')).toEqual(['scr']);
    const noBasis = refused(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), { answers: { rrt: pick('none'), mgPerKg: num(15, 'mg/kg') } });
    expect(named(noBasis, 'missing')).toEqual(['weightBasis']);
    const noWeight = refused(vancomycinEmpiric, ctx(male(60), [scr(1.0)]), req(15));
    expect(named(noWeight, 'missing')).toEqual(['weight']);
    expect(named(refused(vancomycinEmpiric, ctx(male(60), []), dialysis(15)), 'missing')).toEqual(['weight']);
  });

  it('CRRT is not calculated: the owner’s message, as soon as CRRT is chosen', () => {
    const p = refused(vancomycinEmpiric, ctx(male(60), []), { answers: { rrt: pick('crrt') } });
    expect(p).toHaveLength(1);
    expect(p[0]).toEqual({ kind: 'refused', reason: CRRT_PROTOCOL });
    expect(CRRT_PROTOCOL.ar).toBe('مرضى CRRT يتطلبون بروتوكولاً خاصاً بالعناية المركزة لحساب الجرعة بناءً على معدلات الترشيح (Effluent rates)، يرجى الرجوع لبروتوكول المستشفى.');
    // With everything else recorded, still refused.
    const full = refused(vancomycinEmpiric, ctx(male(60), [weight(70), scr(1.0)]), { answers: { rrt: pick('crrt'), mgPerKg: num(15, 'mg/kg'), weightBasis: pick('tbw') } });
    expect(full).toEqual([{ kind: 'refused', reason: CRRT_PROTOCOL }]);
  });

  it('refuses a child, on and off dialysis', () => {
    const off = refused(vancomycinEmpiric, ctx(male(12), [weight(40), scr(0.5)]), req(15));
    const on = refused(vancomycinEmpiric, ctx(male(12), [weight(40)]), dialysis(15));
    for (const p of [off, on]) {
      expect(p).toHaveLength(1);
      expect(p[0]!.kind === 'refused' && p[0]!.reason.en).toBe('The department’s vancomycin table is for adults (18 years or older). It is not used for younger patients.');
    }
  });

  it('a creatinine recorded in µmol/L is converted before Cockcroft–Gault', () => {
    // hand: 88.4 µmol/L = 1.0 mg/dL → the same result as the first example.
    const r = ok(vancomycinEmpiric, ctx(male(60), [weight(70), lab('scr', 88.4, 'µmol/L')] as TimelineEntry[]), req(15));
    expect(secondary(r, 'crcl')).toBeCloseTo(77.77777777777777, 6);
    expect(r.value).toBeCloseTo(1050, 9);
    expect(secondary(r, 'interval')).toBe(12);
  });
});

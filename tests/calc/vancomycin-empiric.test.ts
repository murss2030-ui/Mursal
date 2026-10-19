/**
 * Vancomycin without levels (owner decision 6): 15–20 mg/kg of actual body
 * weight per dose, the interval from the department's creatinine clearance
 * table. High-risk calculation: extended suite.
 *
 * The bands below are a SYNTHETIC TEST TABLE that exercises the lookup (open
 * and closed bands, a "dose by levels" band): they are not a clinical
 * recommendation, and the app ships no bands.
 * Origins: "hand" = the arithmetic is written out in the test.
 */
import { describe, expect, it } from 'vitest';
import { resultCurrency } from '../../src/calc/currency';
import type { GatherContext, GatherRequest } from '../../src/calc/gather';
import { POPULATION_ESTIMATE, vancomycinEmpiric } from '../../src/calc/calculators/vancomycin-empiric';
import type { VancomycinIntervalBand } from '../../src/domain/reference';
import type { TimelineEntry } from '../../src/domain/types';
import { ctx, female, lab, male, named, num, ok, pick, refused, secondary, weight, yesA } from './helpers';

let n = 0;
function band(from: number | undefined, below: number | undefined, hours: number | 'levels', over: Partial<VancomycinIntervalBand> = {}): VancomycinIntervalBand {
  return {
    id: `band-${++n}`,
    version: 1,
    versionCreatedAt: '2026-10-18T00:00:00.000Z',
    status: 'active',
    createdAt: '2026-10-18T00:00:00.000Z',
    verifiedBy: 'Test',
    verifiedAt: '2026-10-18',
    ...(from !== undefined ? { crclFrom: from } : {}),
    ...(below !== undefined ? { crclBelow: below } : {}),
    action: hours === 'levels' ? 'levels' : 'interval',
    ...(hours !== 'levels' ? { intervalHours: hours } : {}),
    source: 'Synthetic test table (not a clinical recommendation)',
    ...over,
  };
}

const TABLE = [band(90, undefined, 8), band(60, 90, 12), band(30, 60, 24), band(undefined, 30, 'levels')];

/** The case with the department's table; `null` gives no reference tables at all. */
const withTable = (c: GatherContext, table: readonly VancomycinIntervalBand[] | null = TABLE): GatherContext => ({
  ...c,
  ...(table ? { references: { vancomycinIntervals: table } } : {}),
});

const req = (mgPerKg: number, basis = 'tbw', noRrt = true): GatherRequest => ({
  answers: { weightBasis: pick(basis), mgPerKg: num(mgPerKg, 'mg/kg'), noRrt: yesA(noRrt) },
});

const scr = (v: number) => lab('scr', v, 'mg/dL');

describe(`calc:${vancomycinEmpiric.id}@${vancomycinEmpiric.formulaVersion}`, () => {
  it.each<[number, 'M' | 'F', number, number, number, number, number, number, number, string]>([
    // [age, sex, kg, SCr mg/dL, mg/kg, CrCl, interval h, dose mg, daily mg, origin]
    [60, 'M', 70, 1.0, 15, 77.77777777777777, 12, 1050, 2100, 'hand: CrCl (140−60)×70÷72 = 77.8 → 78 → band 60–<90; 15×70 = 1050; 1050×24÷12'],
    [30, 'M', 80, 0.9, 15, 135.8024691358025, 8, 1200, 3600, 'hand: CrCl 110×80÷64.8 = 135.8 → band ≥90; 15×80 = 1200; 1200×24÷8'],
    [75, 'M', 65, 1.5, 20, 39.120370370370374, 24, 1300, 1300, 'hand: CrCl 65×65÷108 = 39.1 → band 30–<60; 20×65 = 1300; 1300×24÷24'],
    [45, 'F', 60, 0.8, 20, 84.11458333333333, 12, 1200, 2400, 'hand: CrCl 95×60÷57.6 × 0.85 = 84.1 → band 60–<90; 20×60 = 1200; 1200×24÷12'],
  ])('%s y %s, %s kg, SCr %s, %s mg/kg → CrCl %s, every %s h, %s mg (%s)', (age, sex, kg, s, perKg, crcl, tau, dose, daily) => {
    const demo = sex === 'F' ? female(age) : male(age);
    const r = ok(vancomycinEmpiric, withTable(ctx(demo, [weight(kg), scr(s)])), req(perKg));
    expect(r.value).toBeCloseTo(dose, 9);
    expect(r.unit).toBe('mg');
    expect(secondary(r, 'interval')).toBe(tau);
    expect(secondary(r, 'daily')).toBeCloseTo(daily, 9);
    expect(secondary(r, 'crcl')).toBeCloseTo(crcl, 9);
  });

  it('the dose uses actual (total) body weight even when creatinine clearance uses ideal body weight', () => {
    // hand: IBW (Devine, male, 175 cm) = 50 + 2.3 × (175 ÷ 2.54 − 60) = 70.46 kg; CrCl = 80 × 70.46 ÷ 72 = 78.3 → band 60–<90 → 12 h;
    // dose = 15 mg/kg × 100 kg (total body weight) = 1500 mg.
    const r = ok(vancomycinEmpiric, withTable(ctx(male(60, 175), [weight(100), scr(1.0)])), req(15, 'ibw'));
    expect(secondary(r, 'crcl')).toBeCloseTo((80 * (50 + 2.3 * (175 / 2.54 - 60))) / 72, 9);
    expect(r.value).toBeCloseTo(1500, 9);
    expect(secondary(r, 'interval')).toBe(12);
  });

  it('compares creatinine clearance with the table as a whole number, as it is shown (59.6 → 60, 59.4 → 59)', () => {
    // hand: CrCl = 80 × W ÷ 72 for a 60-year-old man with SCr 1.0; W = 53.64 kg → 59.6; W = 53.46 kg → 59.4.
    const upper = ok(vancomycinEmpiric, withTable(ctx(male(60), [weight(53.64), scr(1.0)])), req(15));
    expect(secondary(upper, 'crcl')).toBeCloseTo(59.6, 9);
    expect(secondary(upper, 'interval')).toBe(12); // 60 is in "60 to below 90"
    const lower = ok(vancomycinEmpiric, withTable(ctx(male(60), [weight(53.46), scr(1.0)])), req(15));
    expect(secondary(lower, 'interval')).toBe(24); // 59 is in "30 to below 60"
    expect(lower.steps).toContain('CrCl compared with the table as a whole number: 59 mL/min');
  });

  it('keeps the band it used with the result: its range, version and source, in the steps and the assumptions', () => {
    const r = ok(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)])), req(15));
    const used = r.inputs.detail.interval!;
    expect(used).toMatchObject({ value: 12, unit: 'h', source: { kind: 'reference', table: 'vancomycin_interval', id: TABLE[1]!.id, version: 1 } });
    expect(used.source.kind === 'reference' && used.source.text.en).toBe('creatinine clearance 60 to below 90 mL/min → every 12 h');
    const steps = r.steps.join('\n');
    expect(steps).toContain('CrCl = (140 − 60) × 70 ÷ (72 × 1) = 77.8 mL/min');
    expect(steps).toContain('Band of your department’s table (version 1): creatinine clearance 60 to below 90 mL/min → every 12 h (source: Synthetic test table (not a clinical recommendation))');
    expect(steps).toContain('Dose per kg = 15 mg/kg');
    expect(steps).toContain('Dose = 15 mg/kg × 70 kg = 1050 mg');
    expect(steps).toContain('Daily dose = 1050 mg × 24 ÷ 12 h = 2100 mg/24 h');
    expect(r.category?.label.en).toBe('Every 12 h (your department’s table)');
    expect(r.assumptions.map((a) => a.en)).toContain('The dose is not rounded: round it as your hospital does.');
    expect(r.warnings).toContainEqual(POPULATION_ESTIMATE);
    expect(vancomycinEmpiric.highRisk).toBe(true);
  });

  it('refuses without the department’s table, naming it', () => {
    for (const table of [null, [], [band(60, undefined, 12, { status: 'retracted' })]]) {
      const p = refused(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)]), table), req(15));
      expect(named(p, 'missing')).toEqual(['interval']);
      expect(p[0]!.kind === 'missing' && p[0]!.detail?.en).toContain('vancomycin interval table is empty');
    }
  });

  it('refuses when no band holds the creatinine clearance, and when two bands do', () => {
    const gap = refused(vancomycinEmpiric, withTable(ctx(male(80), [weight(50), scr(2.5)]), [band(30, undefined, 24)]), req(15));
    // hand: CrCl = 60 × 50 ÷ 180 = 16.7 → 17
    expect(gap[0]!.kind === 'missing' && gap[0]!.detail?.en).toBe('no band of your department’s table holds a creatinine clearance of 17 mL/min');
    const overlap = refused(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)]), [band(60, 90, 12), band(50, 100, 24)]), req(15));
    expect(named(overlap, 'invalid')).toEqual(['interval']);
    expect(overlap[0]!.kind === 'invalid' && overlap[0]!.reason.en).toContain('2 bands of your department’s table hold 78 mL/min');
  });

  it('a band that sets no fixed interval refuses the calculation, quoting the band and its source', () => {
    const p = refused(vancomycinEmpiric, withTable(ctx(male(80), [weight(50), scr(2.5)])), req(15));
    expect(p).toHaveLength(1);
    expect(p[0]!.kind === 'refused' && p[0]!.reason.en).toBe(
      'Your department’s table gives no fixed interval for a creatinine clearance of 17 mL/min (band below 30 mL/min): dose by levels. Source: Synthetic test table (not a clinical recommendation).',
    );
  });

  it('accepts only the department’s dose range, 15 to 20 mg/kg', () => {
    for (const perKg of [14.9, 20.1, 25]) {
      expect(named(refused(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)])), req(perKg)), 'invalid')).toEqual(['mgPerKg']);
    }
    expect(ok(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)])), req(20)).value).toBeCloseTo(1400, 9); // hand: 20 × 70
    expect(named(refused(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)])), { answers: { weightBasis: pick('tbw'), mgPerKg: num(15, 'mg/day') , noRrt: yesA(true) } }), 'unit')).toEqual(['mgPerKg']);
  });

  it('refuses on dialysis or CRRT, in a child, and without a creatinine — before reading the table', () => {
    const rrt = refused(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), scr(1.0)])), req(15, 'tbw', false));
    expect(rrt.map((p) => (p.kind === 'refused' ? p.reason.en : '')).join(' ')).toContain('Cockcroft–Gault does not describe the clearance of a patient on dialysis or CRRT');
    const child = refused(vancomycinEmpiric, withTable(ctx(male(12), [weight(40), scr(0.5)])), req(15));
    expect(child.map((p) => (p.kind === 'refused' ? p.reason.en : '')).join(' ')).toContain('validated in adults only');
    const noScr = refused(vancomycinEmpiric, withTable(ctx(male(60), [weight(70)])), req(15));
    expect(named(noScr, 'missing')).toEqual(['scr']);
    const noWeight = refused(vancomycinEmpiric, withTable(ctx(male(60), [scr(1.0)])), req(15));
    expect(named(noWeight, 'missing')).toEqual(['weight']);
  });

  it('a result goes out of date when the band it used is changed or removed', () => {
    const c = withTable(ctx(male(60), [weight(70), scr(1.0)]));
    const r = ok(vancomycinEmpiric, c, req(15));
    expect(resultCurrency(r, vancomycinEmpiric, c)).toEqual({ current: true });
    const changed = TABLE.map((b) => (b.id === TABLE[1]!.id ? { ...b, version: 2, intervalHours: 8 } : b));
    const after = resultCurrency(r, vancomycinEmpiric, withTable(c, changed));
    expect(after.current).toBe(false);
    if (!after.current) expect(after.reasons[0]!.en).toBe('The band of your department’s vancomycin interval table that this result used was changed or removed.');
    const removed = TABLE.map((b) => (b.id === TABLE[1]!.id ? { ...b, version: 2, status: 'retracted' as const } : b));
    expect(resultCurrency(r, vancomycinEmpiric, withTable(c, removed)).current).toBe(false);
  });

  it('a creatinine recorded in µmol/L is converted before Cockcroft–Gault', () => {
    // hand: 88.4 µmol/L = 1.0 mg/dL → the same result as the first example.
    const r = ok(vancomycinEmpiric, withTable(ctx(male(60), [weight(70), lab('scr', 88.4, 'µmol/L')] as TimelineEntry[])), req(15));
    expect(secondary(r, 'crcl')).toBeCloseTo(77.77777777777777, 6);
    expect(r.value).toBeCloseTo(1050, 9);
  });
});

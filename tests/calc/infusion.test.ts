/**
 * Infusion rates (owner decision 9). Weight-based is a high-risk calculation
 * (vasoactive drugs; weight-based doses in children): extended suite.
 * Origins: "hand" = the arithmetic is written out in the test title.
 */
import { describe, expect, it } from 'vitest';
import { infusionRateVolume, infusionRateWeight, PAEDIATRIC_ESCALATE } from '../../src/calc/calculators/infusion';
import type { TimelineEntry } from '../../src/domain/types';
import { ctx, male, named, num, ok, refused, secondary, weight } from './helpers';

const answers = (dose: number, doseUnit: string, conc: number, concUnit: string) => ({
  answers: { doseRate: num(dose, doseUnit), concentration: num(conc, concUnit) },
});

describe(`calc:${infusionRateWeight.id}@${infusionRateWeight.formulaVersion}`, () => {
  it.each([
    // [mcg/kg/min, kg, mcg/mL, mL/h, origin]
    [5, 70, 1600, 13.125, 'hand: 5 × 70 = 350 mcg/min × 60 = 21 000 mcg/h ÷ 1600'],
    [0.1, 80, 64, 7.5, 'hand: 0.1 × 80 = 8 mcg/min × 60 = 480 ÷ 64'],
    [10, 60, 4000, 9, 'hand: 10 × 60 = 600 × 60 = 36 000 ÷ 4000'],
    [0.05, 50, 16, 9.375, 'hand: 0.05 × 50 = 2.5 × 60 = 150 ÷ 16'],
  ])('%s mcg/kg/min, %s kg, %s mcg/mL → %s mL/h (%s)', (dose, kg, conc, expected) => {
    const r = ok(infusionRateWeight, ctx(male(55), [weight(kg)]), answers(dose, 'mcg/kg/min', conc, 'mcg/mL'));
    expect(r.value).toBeCloseTo(expected, 10);
    expect(r.unit).toBe('mL/h');
    expect(r.decimals).toBe(1);
  });

  it('shows the drug delivered per minute and per hour, and every step', () => {
    const r = ok(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mcg/kg/min', 1600, 'mcg/mL'));
    expect(secondary(r, 'mcgPerMin')).toBeCloseTo(350, 10);
    expect(secondary(r, 'mgPerHour')).toBeCloseTo(21, 10);
    expect(r.steps.join('\n')).toContain('Rate = 5 × 70 × 60 ÷ 1600 = 13.1 mL/h');
    expect(r.assumptions.map((a) => a.en)).toContain('Weight: the weight recorded in the case (total body weight).');
  });

  it('concentration in mg/mL and dose rate in mcg/kg/h give the same result (explicit conversions)', () => {
    const base = ok(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mcg/kg/min', 1600, 'mcg/mL')).value;
    const mgml = ok(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mcg/kg/min', 1.6, 'mg/mL'));
    const perHour = ok(infusionRateWeight, ctx(male(55), [weight(70)]), answers(300, 'mcg/kg/h', 1600, 'mcg/mL'));
    expect(mgml.value).toBeCloseTo(base, 10);
    expect(perHour.value).toBeCloseTo(base, 10);
    expect(mgml.steps.join('\n')).toContain('1600 mcg/mL (recorded 1.6 mg/mL, × 1000)');
    expect(perHour.steps.join('\n')).toContain('5 mcg/kg/min (recorded 300 mcg/kg/h, ÷ 60)');
  });

  it('refuses without a weight, a dose rate or a concentration, naming each', () => {
    expect(named(refused(infusionRateWeight, ctx(male(55), []), answers(5, 'mcg/kg/min', 1600, 'mcg/mL')), 'missing')).toEqual(['weight']);
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), { answers: { concentration: num(1600, 'mcg/mL') } }), 'missing')).toEqual(['doseRate']);
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), { answers: { doseRate: num(5, 'mcg/kg/min') } }), 'missing')).toEqual(['concentration']);
  });

  it('rejects an unknown unit and an impossible value; an implausible value needs confirmation', () => {
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mg/kg/min', 1600, 'mcg/mL')), 'unit')).toEqual(['doseRate']);
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mcg/kg/min', 1600, 'mg/L')), 'unit')).toEqual(['concentration']);
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), answers(0, 'mcg/kg/min', 1600, 'mcg/mL')), 'invalid')).toEqual(['doseRate']);
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mcg/kg/min', 0, 'mcg/mL')), 'invalid')).toEqual(['concentration']);
    expect(named(refused(infusionRateWeight, ctx(male(55), [weight(70)]), answers(150, 'mcg/kg/min', 1600, 'mcg/mL')), 'out_of_range')).toEqual(['doseRate']);
    const confirmed = ok(infusionRateWeight, ctx(male(55), [weight(70)]), { ...answers(150, 'mcg/kg/min', 1600, 'mcg/mL'), confirmed: ['doseRate=150 mcg/kg/min'] });
    expect(confirmed.value).toBeCloseTo(393.75, 10); // hand: 150 × 70 × 60 ÷ 1600
    expect(confirmed.assumptions.map((a) => a.en).join(' ')).toContain('confirmed by the trainee as correct');
  });

  it('warns about an unusual pump rate (a likely unit slip)', () => {
    // hand: 10 × 70 × 60 ÷ 10 = 4200 mL/h
    const r = ok(infusionRateWeight, ctx(male(55), [weight(70)]), answers(10, 'mcg/kg/min', 10, 'mcg/mL'));
    expect(r.value).toBeCloseTo(4200, 10);
    expect(r.warnings.map((w) => w.en).join(' ')).toContain('is unusual: check the dose rate, the weight and the concentration');
    const normal = ok(infusionRateWeight, ctx(male(55), [weight(70)]), answers(5, 'mcg/kg/min', 1600, 'mcg/mL'));
    expect(normal.warnings).toEqual([]);
  });

  it('a child: weight-based dose escalation message (high-risk calculation)', () => {
    const r = ok(infusionRateWeight, ctx(male(8), [weight(25)]), answers(5, 'mcg/kg/min', 800, 'mcg/mL'));
    expect(r.value).toBeCloseTo(9.375, 10); // hand: 5 × 25 × 60 ÷ 800
    expect(r.warnings).toContainEqual(PAEDIATRIC_ESCALATE);
    expect(infusionRateWeight.highRisk).toBe(true);
  });

  it('a weight recorded in pounds is converted before use', () => {
    const lb = { ...weight(0), payload: { value: 154, unit: 'lb', method: 'measured' }, unit: 'lb' } as TimelineEntry;
    const r = ok(infusionRateWeight, ctx(male(55), [lb]), answers(5, 'mcg/kg/min', 1600, 'mcg/mL'));
    expect(r.value).toBeCloseTo((5 * 69.85322498 * 60) / 1600, 6);
  });
});

describe(`calc:${infusionRateVolume.id}@${infusionRateVolume.formulaVersion}`, () => {
  it.each([
    [1000, 'mL', 8, 'h', 125, 'hand: 1000 ÷ 8'],
    [100, 'mL', 30, 'min', 200, 'hand: 100 ÷ 0.5 h'],
    [1, 'L', 4, 'h', 250, 'hand: 1000 ÷ 4'],
    [250, 'mL', 90, 'min', 166.66666666666666, 'hand: 250 ÷ 1.5 h'],
  ])('%s %s over %s %s → %s mL/h (%s)', (v, vu, t, tu, expected) => {
    const r = ok(infusionRateVolume, ctx(male(40), []), { answers: { volume: num(v, vu), time: num(t, tu) } });
    expect(r.value).toBeCloseTo(expected, 10);
    expect(r.unit).toBe('mL/h');
  });

  it('refuses without a volume or a time, and rejects zero', () => {
    expect(named(refused(infusionRateVolume, ctx(male(40), []), { answers: { volume: num(500, 'mL') } }), 'missing')).toEqual(['time']);
    expect(named(refused(infusionRateVolume, ctx(male(40), []), { answers: { time: num(2, 'h') } }), 'missing')).toEqual(['volume']);
    expect(named(refused(infusionRateVolume, ctx(male(40), []), { answers: { volume: num(500, 'mL'), time: num(0, 'h') } }), 'invalid')).toEqual(['time']);
  });

  it('a very short time needs confirmation (5 minutes is outside 15 min – 48 h)', () => {
    expect(named(refused(infusionRateVolume, ctx(male(40), []), { answers: { volume: num(100, 'mL'), time: num(5, 'min') } }), 'out_of_range')).toEqual(['time']);
  });
});

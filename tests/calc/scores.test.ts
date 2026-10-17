/**
 * CURB-65, qSOFA, CHA₂DS₂-VASc, HAS-BLED. Origins: the published point
 * definitions (citations in the calculators); every expected score is the
 * sum of those points, by hand, with each threshold tested on both sides.
 */
import { describe, expect, it } from 'vitest';
import { cha2ds2vasc, curb65, hasBled, qsofa } from '../../src/calc/calculators/scores';
import type { Answer } from '../../src/calc/gather';
import { bp, ctx, female, lab, male, named, ok, refused, vital, yesA } from './helpers';

const all = (keys: string[], v: boolean): Record<string, Answer> => Object.fromEntries(keys.map((k) => [k, yesA(v)]));

describe(`calc:${curb65.id}@${curb65.formulaVersion}`, () => {
  const c = (age: number, urea: number, ureaAnalyte: string, ureaUnit: string, rr: number, sbp: number, dbp: number) =>
    ctx(male(age), [lab(ureaAnalyte, urea, ureaUnit), vital('respiratory_rate', rr, 'breaths/min'), bp(sbp, dbp)]);

  it('every threshold just short → 0', () => {
    const r = ok(curb65, c(64, 7.0, 'urea', 'mmol/L', 29, 90, 61), { answers: { confusion: yesA(false) } });
    expect(r.value).toBe(0);
    expect(r.category?.value).toBe('low');
  });

  it('every threshold just met → 5', () => {
    const r = ok(curb65, c(65, 7.1, 'urea', 'mmol/L', 30, 89, 70), { answers: { confusion: yesA(true) } });
    expect(r.value).toBe(5);
    expect(r.category?.value).toBe('high');
  });

  it('a diastolic pressure of 60 alone earns the blood-pressure point', () => {
    expect(ok(curb65, c(40, 5, 'urea', 'mmol/L', 18, 120, 60), { answers: { confusion: yesA(false) } }).value).toBe(1);
  });

  it('score 2 is the intermediate group', () => {
    expect(ok(curb65, c(70, 8, 'urea', 'mmol/L', 18, 120, 80), { answers: { confusion: yesA(false) } }).category?.value).toBe('intermediate');
  });

  it('BUN is converted to urea (÷ 2.801): BUN 20 mg/dL = 7.14 mmol/L → point; BUN 19.5 = 6.96 → no point', () => {
    expect(ok(curb65, c(40, 20, 'bun', 'mg/dL', 18, 120, 80), { answers: { confusion: yesA(false) } }).value).toBe(1);
    expect(ok(curb65, c(40, 19.5, 'bun', 'mg/dL', 18, 120, 80), { answers: { confusion: yesA(false) } }).value).toBe(0);
  });

  it('urea reported in mg/dL (urea mass) is converted with ÷ 6.006: 43 mg/dL = 7.16 mmol/L → point', () => {
    const r = ok(curb65, c(40, 43, 'urea', 'mg/dL', 18, 120, 80), { answers: { confusion: yesA(false) } });
    expect(r.value).toBe(1);
    expect(r.steps[1]).toContain('7.2 mmol/L (recorded 43 mg/dL, ÷ 6.006)');
  });

  it('refuses without the confusion answer, the urea, or a blood pressure', () => {
    expect(named(refused(curb65, c(40, 5, 'urea', 'mmol/L', 18, 120, 80)), 'missing')).toEqual(['confusion']);
    expect(named(refused(curb65, ctx(male(40), [vital('respiratory_rate', 18, 'breaths/min'), bp(120, 80)]), { answers: { confusion: yesA(false) } }), 'missing')).toEqual(['urea']);
    expect(named(refused(curb65, ctx(male(40), [lab('urea', 5, 'mmol/L'), vital('respiratory_rate', 18, 'breaths/min')]), { answers: { confusion: yesA(false) } }), 'missing').sort()).toEqual(['dbp', 'sbp']);
  });
});

describe(`calc:${qsofa.id}@${qsofa.formulaVersion}`, () => {
  const c = (rr: number, sbp: number) => ctx(male(50), [vital('respiratory_rate', rr, 'breaths/min'), bp(sbp, 70)]);

  it('RR 22 → 1; SBP 101 and normal mentation → 0', () => {
    const r = ok(qsofa, c(22, 101), { answers: { alteredMentation: yesA(false) } });
    expect(r.value).toBe(1);
    expect(r.category?.value).toBe('negative');
  });

  it('RR 21, altered mentation, SBP 100 → 2, the higher-risk threshold', () => {
    const r = ok(qsofa, c(21, 100), { answers: { alteredMentation: yesA(true) } });
    expect(r.value).toBe(2);
    expect(r.category?.value).toBe('positive');
  });

  it('all three → 3', () => {
    expect(ok(qsofa, c(30, 85), { answers: { alteredMentation: yesA(true) } }).value).toBe(3);
  });

  it('states that it is not a diagnostic criterion', () => {
    expect(qsofa.limitations[0]?.en).toContain('Not a diagnostic criterion for sepsis');
  });

  it('refuses without the mentation answer', () => {
    expect(named(refused(qsofa, c(22, 100)), 'missing')).toEqual(['alteredMentation']);
  });
});

const VASC_ITEMS = ['chf', 'htn', 'diabetes', 'strokeTia', 'vascular'];

describe(`calc:${cha2ds2vasc.id}@${cha2ds2vasc.formulaVersion}`, () => {
  it('male, 64, no risk factor → 0', () => {
    expect(ok(cha2ds2vasc, ctx(male(64), []), { answers: all(VASC_ITEMS, false) }).value).toBe(0);
  });

  it('female, 75, every risk factor → 1+1+2+1+2+1+1 = 9', () => {
    expect(ok(cha2ds2vasc, ctx(female(75), []), { answers: all(VASC_ITEMS, true) }).value).toBe(9);
  });

  it('age points: 64 → 0, 65 → 1, 74 → 1, 75 → 2; female adds 1', () => {
    const none = { answers: all(VASC_ITEMS, false) };
    expect([64, 65, 74, 75].map((a) => ok(cha2ds2vasc, ctx(male(a), []), none).value)).toEqual([0, 1, 1, 2]);
    expect(ok(cha2ds2vasc, ctx(female(65), []), none).value).toBe(2);
  });

  it('stroke counts 2', () => {
    expect(ok(cha2ds2vasc, ctx(male(50), []), { answers: { ...all(VASC_ITEMS, false), strokeTia: yesA(true) } }).value).toBe(2);
  });

  it('refuses when any risk factor is unanswered — never assumed absent', () => {
    const answers = all(VASC_ITEMS, false);
    delete answers.diabetes;
    expect(named(refused(cha2ds2vasc, ctx(male(50), []), { answers }), 'missing')).toEqual(['diabetes']);
  });

  it('notes the 2024 ESC CHA₂DS₂-VA', () => {
    expect(cha2ds2vasc.limitations.map((l) => l.en).join(' ')).toContain('CHA₂DS₂-VA');
  });
});

const BLED_ITEMS = ['uncontrolledHtn', 'abnormalRenal', 'abnormalLiver', 'stroke', 'bleeding', 'labileInr', 'drugs', 'alcohol'];

describe(`calc:${hasBled.id}@${hasBled.formulaVersion}`, () => {
  it('age 65, nothing else → 0 (elderly is above 65)', () => {
    expect(ok(hasBled, ctx(male(65), []), { answers: all(BLED_ITEMS, false) }).value).toBe(0);
  });

  it('age 66 and every item → 9', () => {
    const r = ok(hasBled, ctx(male(66), []), { answers: all(BLED_ITEMS, true) });
    expect(r.value).toBe(9);
    expect(r.category?.value).toBe('high');
  });

  it('age 70, drugs and alcohol → 3, the high-risk threshold; 2 is below it', () => {
    const answers = { ...all(BLED_ITEMS, false), drugs: yesA(true), alcohol: yesA(true) };
    expect(ok(hasBled, ctx(female(70), []), { answers }).category?.value).toBe('high');
    expect(ok(hasBled, ctx(female(60), []), { answers }).category?.value).toBe('lower');
  });

  it('says a high score is not by itself a reason to withhold anticoagulation', () => {
    expect(hasBled.limitations[0]?.en).toContain('not a reason to withhold anticoagulation');
  });

  it('refuses when an item is unanswered', () => {
    const answers = all(BLED_ITEMS, false);
    delete answers.labileInr;
    expect(named(refused(hasBled, ctx(male(70), []), { answers }), 'missing')).toEqual(['labileInr']);
  });
});

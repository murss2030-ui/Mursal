/**
 * Child–Pugh. Origins: the published point table (Pugh et al. 1973, with INR
 * thresholds); every expected total below is the sum of the table's points,
 * by hand.
 */
import { describe, expect, it } from 'vitest';
import { albuminPoints, bilirubinPoints, childPugh, inrPoints } from '../../src/calc/calculators/liver';
import { ctx, lab, male, named, ok, pick, refused } from './helpers';

const score = (bili: number, biliUnit: string, alb: number, inr: number, ascites: string, enc: string) =>
  ok(childPugh, ctx(male(55), [lab('tbil', bili, biliUnit), lab('albumin', alb, 'g/dL'), lab('inr', inr, 'unitless')]), {
    answers: { ascites: pick(ascites), encephalopathy: pick(enc) },
  });

describe(`calc:${childPugh.id}@${childPugh.formulaVersion}`, () => {
  it('point boundaries of each laboratory item', () => {
    expect([1.99, 2, 3, 3.01].map(bilirubinPoints)).toEqual([1, 2, 2, 3]);
    expect([3.51, 3.5, 2.8, 2.79].map(albuminPoints)).toEqual([1, 2, 2, 3]);
    expect([1.69, 1.7, 2.3, 2.31].map(inrPoints)).toEqual([1, 2, 2, 3]);
  });

  it('all lowest → 5 points, class A', () => {
    const r = score(1.5, 'mg/dL', 3.6, 1.2, 'none', 'none');
    expect(r.value).toBe(5);
    expect(r.category?.value).toBe('A');
  });

  it('2.0 / 3.5 / 1.7 / slight / none → 2+2+2+2+1 = 9, class B', () => {
    const r = score(2.0, 'mg/dL', 3.5, 1.7, 'slight', 'none');
    expect(r.value).toBe(9);
    expect(r.category?.value).toBe('B');
  });

  it('all highest → 15 points, class C', () => {
    const r = score(3.01, 'mg/dL', 2.79, 2.31, 'moderate', 'grade34');
    expect(r.value).toBe(15);
    expect(r.category?.value).toBe('C');
  });

  it('class boundaries: 6 → A, 7 → B, 10 → C', () => {
    expect(score(1.5, 'mg/dL', 3.6, 1.2, 'slight', 'none').category?.value).toBe('A'); // 6
    expect(score(2.5, 'mg/dL', 3.6, 1.2, 'slight', 'none').category?.value).toBe('B'); // 7
    expect(score(3.5, 'mg/dL', 3.0, 2.0, 'slight', 'none').category?.value).toBe('C'); // 3+2+2+2+1 = 10
  });

  it('bilirubin in µmol/L is converted before the thresholds (51.3 µmol/L = 3.0 → 2 points; 52 → 3)', () => {
    expect(score(51.3, 'µmol/L', 3.6, 1.2, 'none', 'none').value).toBe(6);
    expect(score(52, 'µmol/L', 3.6, 1.2, 'none', 'none').value).toBe(7);
  });

  it('states its limits for dose adjustment with every result', () => {
    const r = score(1.5, 'mg/dL', 3.6, 1.2, 'none', 'none');
    expect(r.warnings[0]?.en).toContain('Not a dosing tool by itself');
    expect(childPugh.limitations[0]?.en).toContain('not drug clearance');
  });

  it('lists every point in the explanation', () => {
    const r = score(2.0, 'mg/dL', 3.5, 1.7, 'slight', 'none');
    expect(r.steps.at(-1)).toBe('Total = 2 + 2 + 2 + 2 + 1 = 9 points → class B');
  });

  it('refuses without the ascites or encephalopathy grade — never assumed absent', () => {
    const c = ctx(male(55), [lab('tbil', 1, 'mg/dL'), lab('albumin', 4, 'g/dL'), lab('inr', 1, 'unitless')]);
    expect(named(refused(childPugh, c, { answers: { ascites: pick('none') } }), 'missing')).toEqual(['encephalopathy']);
    expect(named(refused(childPugh, c), 'missing').sort()).toEqual(['ascites', 'encephalopathy']);
  });

  it('refuses a missing INR and an unknown answer value', () => {
    const c = ctx(male(55), [lab('tbil', 1, 'mg/dL'), lab('albumin', 4, 'g/dL')]);
    expect(named(refused(childPugh, c, { answers: { ascites: pick('none'), encephalopathy: pick('none') } }), 'missing')).toEqual(['inr']);
    const c2 = ctx(male(55), [lab('tbil', 1, 'mg/dL'), lab('albumin', 4, 'g/dL'), lab('inr', 1, 'unitless')]);
    expect(named(refused(childPugh, c2, { answers: { ascites: pick('lots'), encephalopathy: pick('none') } }), 'missing')).toEqual(['ascites']);
  });
});

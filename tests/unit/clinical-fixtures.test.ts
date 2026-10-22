import { describe, expect, it } from 'vitest';
import { CLINICAL_FIXTURES, missedCritical, reviewSheet, runFixtures } from '../../src/fixtures/clinical';
import { RELEASE_GATE_MET } from '../../src/config/release';

describe('clinical fixture library (M9)', () => {
  const results = runFixtures();
  it('the engine misses no critical problem in any fixture', () => {
    expect(missedCritical(results)).toEqual([]);
  });
  it('every fixture matches its expectations: no miss, no false alarm, nothing unchecked passed as safe', () => {
    for (const r of results) expect({ id: r.id, missed: r.missed, falseAlarms: r.falseAlarms, missingNotChecked: r.missingNotChecked }).toEqual({ id: r.id, missed: [], falseAlarms: [], missingNotChecked: [] });
  });
  it('covers every critical source the rules have, and has unique ids', () => {
    expect(new Set(CLINICAL_FIXTURES.map((f) => f.id)).size).toBe(CLINICAL_FIXTURES.length);
    const crit = new Set(CLINICAL_FIXTURES.flatMap((f) => f.expectCritical.map((e) => e.ruleId)));
    expect([...crit].sort()).toEqual(['allergy', 'interaction', 'lab_critical']);
  });
  it('the harness really detects a miss', () => {
    const broken = [{ ...CLINICAL_FIXTURES[0]!, entries: [] }];
    expect(missedCritical(runFixtures(broken), broken)).toHaveLength(1);
  });
  it('no fixture is claimed as expert-reviewed, and the gate stays closed', () => {
    expect(CLINICAL_FIXTURES.every((f) => f.review.status === 'awaiting_review')).toBe(true);
    expect(RELEASE_GATE_MET).toBe(false);
    expect(reviewSheet()).toContain('not reviewed by a clinical expert');
  });
});

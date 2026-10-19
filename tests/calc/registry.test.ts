import { describe, expect, it } from 'vitest';
import { CALCULATOR_DEFS, buildRegistry, statusOf, type Manifest } from '../../src/calc/registry';
import { CALCULATOR_IDS } from '../../src/calc/types';

const HASH = 'abc';
const manifest = (over: Partial<NonNullable<Manifest>> = {}): Manifest => ({
  version: 1,
  generatedAt: '2026-10-17T00:00:00.000Z',
  engineHash: HASH,
  engineTests: { passed: 40, failed: 0 },
  calculators: { crcl_cg: { formulaVersion: '1', passed: 20, failed: 0 } },
  ...over,
});
const cg = { id: 'crcl_cg' as const, formulaVersion: '1' };

describe('engine:registry', () => {
  it('has exactly one definition per calculator id, with a citation, a formula and limitations', () => {
    expect(CALCULATOR_DEFS.map((d) => d.id).sort()).toEqual([...CALCULATOR_IDS].sort());
    for (const d of CALCULATOR_DEFS) {
      expect(d.citation.length, d.id).toBeGreaterThan(20);
      expect(d.formula.length, d.id).toBeGreaterThan(10);
      expect(d.limitations.length, d.id).toBeGreaterThan(0);
      expect(d.requiredInputs.length, d.id).toBeGreaterThan(0);
      for (const l of d.limitations) expect(l.ar.length, d.id).toBeGreaterThan(0);
    }
  });

  it('pairs the two QTc calculators and marks vancomycin, phenytoin and the weight-based infusion as high-risk', () => {
    const by = new Map(CALCULATOR_DEFS.map((d) => [d.id, d]));
    expect(by.get('qtc_bazett')?.pairedWith).toBe('qtc_fridericia');
    expect(by.get('qtc_fridericia')?.pairedWith).toBe('qtc_bazett');
    // Section 9: vancomycin AUC, phenytoin correction, and weight-based doses (the weight-based infusion rate).
    expect(CALCULATOR_DEFS.filter((d) => d.highRisk).map((d) => d.id).sort()).toEqual(['infusion_rate_weight', 'phenytoin_corrected', 'vancomycin_auc']);
  });

  it('a calculator with a passing record for this engine is validated', () => {
    expect(statusOf(cg, manifest(), HASH)).toEqual({ validated: true, passed: 20, at: '2026-10-17T00:00:00.000Z' });
  });

  it('no manifest, or no record for the calculator: not validated', () => {
    expect(statusOf(cg, null, HASH)).toEqual({ validated: false, reason: 'not_tested' });
    expect(statusOf({ id: 'bmi', formulaVersion: '1' }, manifest(), HASH)).toEqual({ validated: false, reason: 'not_tested' });
  });

  it('a failing test, or no passing test, hides the calculator', () => {
    const failing = manifest({ calculators: { crcl_cg: { formulaVersion: '1', passed: 19, failed: 1 } } });
    expect(statusOf(cg, failing, HASH)).toEqual({ validated: false, reason: 'tests_failed' });
    const none = manifest({ calculators: { crcl_cg: { formulaVersion: '1', passed: 0, failed: 0 } } });
    expect(statusOf(cg, none, HASH)).toEqual({ validated: false, reason: 'tests_failed' });
  });

  it('engine code changed after the last passing run: every calculator is hidden', () => {
    expect(statusOf(cg, manifest(), 'other')).toEqual({ validated: false, reason: 'engine_changed' });
  });

  it('failing engine tests (units, input checks) hide every calculator', () => {
    expect(statusOf(cg, manifest({ engineTests: { passed: 39, failed: 1 } }), HASH)).toEqual({ validated: false, reason: 'engine_tests_failed' });
  });

  it('a different formula version than the one tested is not validated', () => {
    expect(statusOf({ id: 'crcl_cg', formulaVersion: '2' }, manifest(), HASH)).toEqual({ validated: false, reason: 'formula_changed' });
  });

  it('builds calculators whose validated flag follows the manifest', () => {
    const reg = buildRegistry(manifest(), HASH);
    expect(reg.find((c) => c.id === 'crcl_cg')?.validated).toBe(true);
    expect(reg.find((c) => c.id === 'bmi')?.validated).toBe(false);
  });
});

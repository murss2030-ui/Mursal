/** ANC. Origins: hand arithmetic from the definition. */
import { describe, expect, it } from 'vitest';
import { anc } from '../../src/calc/calculators/anc';
import { ctx, lab, male, named, ok, refused, secondary } from './helpers';

describe(`calc:${anc.id}@${anc.formulaVersion}`, () => {
  it('WBC 5.0, neutrophils 60%, bands 5% → 5.0 × 65 ÷ 100 = 3.25 ×10⁹/L = 3250 cells/µL', () => {
    const r = ok(anc, ctx(male(40), [lab('wbc', 5.0, '×10⁹/L'), lab('neut_pct', 60, '%'), lab('bands_pct', 5, '%')]));
    expect(r.value).toBeCloseTo(3.25, 12);
    expect(secondary(r, 'perUl')).toBeCloseTo(3250, 9);
    expect(r.assumptions).toEqual([]);
  });

  it('without a band count: segmented neutrophils only, and says so (1.2 × 30 ÷ 100 = 0.36)', () => {
    const r = ok(anc, ctx(male(40), [lab('wbc', 1.2, '×10⁹/L'), lab('neut_pct', 30, '%')]));
    expect(r.value).toBeCloseTo(0.36, 12);
    expect(r.assumptions[0]?.en).toContain('segmented neutrophils only');
  });

  it('×10³/µL is the same unit as ×10⁹/L', () => {
    expect(ok(anc, ctx(male(40), [lab('wbc', 5.0, '×10³/µL'), lab('neut_pct', 60, '%')])).value).toBeCloseTo(3, 12);
  });

  it('refuses percentages adding up to more than 100', () => {
    const p = refused(anc, ctx(male(40), [lab('wbc', 5, '×10⁹/L'), lab('neut_pct', 96, '%'), lab('bands_pct', 5, '%')]));
    expect(named(p, 'invalid')).toEqual(['bandsPct']);
  });

  it('a percentage above 100 is rejected outright', () => {
    expect(named(refused(anc, ctx(male(40), [lab('wbc', 5, '×10⁹/L'), lab('neut_pct', 160, '%')])), 'invalid')).toEqual(['neutPct']);
  });

  it('refuses without the differential, and an unverified band count blocks too', () => {
    expect(named(refused(anc, ctx(male(40), [lab('wbc', 5, '×10⁹/L')])), 'missing')).toEqual(['neutPct']);
    const p = refused(anc, ctx(male(40), [lab('wbc', 5, '×10⁹/L'), lab('neut_pct', 60, '%'), lab('bands_pct', 5, '%', { provenance: 'extracted_unverified' })]));
    expect(named(p, 'unverified')).toEqual(['bandsPct']);
  });

  it('warns when the count and the differential come from different samples', () => {
    const r = ok(anc, ctx(male(40), [lab('wbc', 5, '×10⁹/L', { day: 1 }), lab('neut_pct', 60, '%', { day: 2 })]));
    expect(r.warnings[0]?.en).toContain('different samples');
  });
});

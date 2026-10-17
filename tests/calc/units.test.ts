import { describe, expect, it } from 'vitest';
import { ANALYTES } from '../../src/domain/catalogue';
import {
  BUN_UNIT,
  QUANTITIES,
  acceptedUnits,
  convert,
  fromCanonical,
  normaliseUnit,
  round,
  show,
  toCanonical,
  type QuantityId,
} from '../../src/calc/units';

/**
 * Each pair: [quantity, value in unit A, unit A, value in unit B, unit B].
 * Origin of the factors: exact definitions (lb, inch) or molar masses, as
 * listed in src/calc/units.ts; values below computed by hand.
 */
const PAIRS: [QuantityId, number, string, number, string][] = [
  ['creatinine', 1, 'mg/dL', 88.4, 'µmol/L'],
  ['creatinine', 1.2, 'mg/dL', 106.08, 'µmol/L'],
  ['albumin', 3.5, 'g/dL', 35, 'g/L'],
  ['calcium', 2.5, 'mmol/L', 10.02, 'mg/dL'],
  ['weight', 1, 'lb', 0.45359237, 'kg'],
  ['weight', 154, 'lb', 69.85322498, 'kg'],
  ['height', 1, 'in', 2.54, 'cm'],
  ['height', 70, 'in', 177.8, 'cm'],
  ['temperature', 37, '°C', 98.6, '°F'],
  ['temperature', -40, '°C', -40, '°F'],
  ['urea', 7, 'mmol/L', 42.042, 'mg/dL'],
  ['urea', 7, 'mmol/L', 19.607, BUN_UNIT],
  ['bilirubin', 2, 'mg/dL', 34.2, 'µmol/L'],
  ['phenytoin', 10, 'mg/L', 39.64, 'µmol/L'],
  ['phenytoin', 10, 'mg/L', 10, 'mcg/mL'],
  ['vancomycin', 15, 'mg/L', 15, 'mcg/mL'],
  ['electrolyte', 140, 'mmol/L', 140, 'mEq/L'],
  ['cell_count', 5.2, '×10⁹/L', 5.2, '×10³/µL'],
  ['qt', 0.44, 's', 440, 'ms'],
  ['dose', 1.25, 'g', 1250, 'mg'],
  ['duration', 90, 'min', 1.5, 'h'],
];

describe('engine:units', () => {
  it.each(PAIRS)('%s: %s %s ↔ %s %s, both directions', (q, a, ua, b, ub) => {
    const ab = convert(q, a, ua, ub);
    const ba = convert(q, b, ub, ua);
    expect(ab.ok && ba.ok).toBe(true);
    if (!ab.ok || !ba.ok) return;
    expect(ab.value).toBeCloseTo(b, 6);
    expect(ba.value).toBeCloseTo(a, 6);
  });

  it('round-trips every accepted unit of every quantity through the canonical unit', () => {
    for (const q of Object.keys(QUANTITIES) as QuantityId[]) {
      for (const unit of acceptedUnits(q)) {
        for (const v of [0.37, 1, 12.5, 250]) {
          const c = toCanonical(q, v, unit);
          expect(c.ok).toBe(true);
          if (!c.ok) continue;
          const back = fromCanonical(q, c.value, unit);
          expect(back.ok && Math.abs(back.value - v) < 1e-9).toBe(true);
        }
      }
    }
  });

  it('rejects an unknown unit and names the accepted ones', () => {
    const r = toCanonical('creatinine', 1.2, 'mg/L');
    expect(r).toEqual({ ok: false, reason: 'unknown_unit', unit: 'mg/L', accepted: ['mg/dL', 'µmol/L'] });
    expect(toCanonical('weight', 70, 'stone').ok).toBe(false);
    expect(toCanonical('albumin', 3.5, '').ok).toBe(false);
    expect(convert('height', 170, 'cm', 'ft').ok).toBe(false);
  });

  it('never maps one unit onto a different one: only typography is normalised', () => {
    expect(normaliseUnit('μmol/L')).toBe('µmol/L'); // Greek mu → micro sign
    expect(normaliseUnit('umol/L')).toBe('µmol/L');
    expect(normaliseUnit(' mg/dL ')).toBe('mg/dL');
    expect(normaliseUnit('mmol/L')).toBe('mmol/L');
    expect(toCanonical('creatinine', 88.4, 'μmol/L')).toMatchObject({ ok: true, value: 1 });
    expect(toCanonical('creatinine', 1, 'mmol/L').ok).toBe(false);
  });

  it('accepts every unit the laboratory catalogue offers for the analytes calculators read', () => {
    const used: Record<string, QuantityId> = {
      scr: 'creatinine',
      albumin: 'albumin',
      ca_total: 'calcium',
      na: 'electrolyte',
      cl: 'electrolyte',
      hco3: 'electrolyte',
      urea: 'urea',
      tbil: 'bilirubin',
      inr: 'inr',
      wbc: 'cell_count',
      neut_pct: 'percent',
      bands_pct: 'percent',
      phenytoin: 'phenytoin',
      vanco: 'vancomycin',
    };
    for (const a of ANALYTES.filter((x) => x.id in used)) {
      for (const unit of a.units) expect(toCanonical(used[a.id]!, 1, unit).ok, `${a.id} ${unit}`).toBe(true);
    }
    // BUN is read with the urea-nitrogen factor, under its own unit label.
    expect(toCanonical('urea', 19.607, BUN_UNIT)).toMatchObject({ ok: true });
  });

  it('rounds only for display, without trailing zeros', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(2.5, 0)).toBe(3);
    expect(show(64.81481, 'mL/min', 1)).toBe('64.8 mL/min');
    expect(show(1.8, 'm²', 2)).toBe('1.8 m²');
    expect(show(1.2, 'unitless')).toBe('1.2');
  });
});

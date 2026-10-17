import { describe, expect, it } from 'vitest';
import { creatinineChanges, scrSeries, stabilityWarning } from '../../src/calc/kdigo';
import { lab } from './helpers';

/** Values chosen by hand around the KDIGO creatinine criteria (≥ 0.3 mg/dL in 48 h; ≥ 1.5 × in 7 days). */
describe('engine:kdigo', () => {
  it('flags a rise of 0.3 mg/dL within 48 hours when clock times prove it', () => {
    const s = scrSeries([lab('scr', 1.0, 'mg/dL', { day: 1, time: '08:00' }), lab('scr', 1.3, 'mg/dL', { day: 3, time: '07:00' })]);
    const c = creatinineChanges(s);
    expect(c.map((x) => x.kind)).toEqual(['rise_48h']);
    expect(c[0]!.certainWithin48h).toBe(true);
    expect(stabilityWarning(s)?.en).toContain('meets a KDIGO creatinine criterion for acute kidney injury');
  });

  it('does not count a 0.3 rise spread over more than 48 hours', () => {
    const s = scrSeries([lab('scr', 1.0, 'mg/dL', { day: 1, time: '08:00' }), lab('scr', 1.3, 'mg/dL', { day: 3, time: '09:00' })]);
    expect(creatinineChanges(s)).toEqual([]);
    expect(stabilityWarning(s)).toBeUndefined();
  });

  it('without clock times, a rise within two hospital days is flagged as possible', () => {
    const s = scrSeries([lab('scr', 1.0, 'mg/dL', { day: 1 }), lab('scr', 1.35, 'mg/dL', { day: 3 })]);
    const c = creatinineChanges(s);
    expect(c[0]).toMatchObject({ kind: 'rise_48h', certainWithin48h: false });
    expect(stabilityWarning(s)?.en).toContain('within 2 hospital days (clock times not recorded)');
  });

  it('flags a rise to 1.5 times a value from the previous 7 days, in µmol/L too', () => {
    const s = scrSeries([lab('scr', 70, 'µmol/L', { day: 0 }), lab('scr', 106, 'µmol/L', { day: 6 })]);
    expect(creatinineChanges(s).map((x) => x.kind)).toContain('rise_7d');
  });

  it('ignores values more than 7 days apart', () => {
    const s = scrSeries([lab('scr', 0.8, 'mg/dL', { day: 0 }), lab('scr', 1.6, 'mg/dL', { day: 9 })]);
    expect(creatinineChanges(s)).toEqual([]);
  });

  it('a falling creatinine is reported as not at steady state, not as kidney injury', () => {
    const s = scrSeries([lab('scr', 2.4, 'mg/dL', { day: 1 }), lab('scr', 1.5, 'mg/dL', { day: 2 })]);
    const w = stabilityWarning(s);
    expect(w?.en).toContain('Creatinine is changing');
    expect(w?.en).not.toContain('KDIGO');
  });

  it('looks back only from the value a calculation used', () => {
    const a = lab('scr', 1.0, 'mg/dL', { day: 1 });
    const b = lab('scr', 1.05, 'mg/dL', { day: 2 });
    const c = lab('scr', 2.0, 'mg/dL', { day: 3 });
    const s = scrSeries([a, b, c]);
    expect(stabilityWarning(s, b.id)).toBeUndefined();
    expect(stabilityWarning(s, c.id)).toBeDefined();
  });

  it('leaves out unverified and non-numeric results', () => {
    const s = scrSeries([lab('scr', 1.0, 'mg/dL', { day: 1, provenance: 'extracted_unverified' }), lab('scr', 1.0, 'mg/L', { day: 1 })]);
    expect(s).toEqual([]);
  });
});

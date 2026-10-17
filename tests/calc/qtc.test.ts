/**
 * QTc Bazett and Fridericia, always computed together.
 * Origins: "definition" = at 60 beats/min RR is 1 s and both formulas return QT
 * unchanged; others "independent" (scripts/calc-crosscheck.py).
 */
import { describe, expect, it } from 'vitest';
import { qtcBazett, qtcFridericia } from '../../src/calc/calculators/qtc';
import { at, ctx, male, named, num, ok, refused } from './helpers';

const ecg = (qt: number, hr: number, qtUnit = 'ms') => ({
  answers: { qt: num(qt, qtUnit), hr: num(hr, 'beats/min'), ecgAt: at(2, '09:15') },
});

const CASES: [number, number, number, number][] = [
  // [QT ms, HR, Bazett, Fridericia]
  [400, 60, 400, 400],
  [360, 100, 464.75800154489, 426.8271965388075],
  [440, 50, 401.66320883712183, 414.0558527076525],
];

describe(`calc:${qtcBazett.id}@${qtcBazett.formulaVersion}`, () => {
  it.each(CASES)('QT %s ms at %s beats/min → %s ms', (qt, hr, bazett) => {
    const r = ok(qtcBazett, ctx(male(50), []), ecg(qt, hr));
    expect(r.value).toBeCloseTo(bazett, 9);
    expect(r.unit).toBe('ms');
  });

  it('QT entered in seconds is converted (0.36 s = 360 ms)', () => {
    expect(ok(qtcBazett, ctx(male(50), []), ecg(0.36, 100, 's')).value).toBeCloseTo(464.75800154489, 9);
  });

  it('records that QT and heart rate came from the ECG report, not from reading the ECG', () => {
    const r = ok(qtcBazett, ctx(male(50), []), ecg(400, 60));
    expect(r.assumptions[0]?.en).toContain('transcribed from the ECG report');
    expect(r.inputs.detail.ecgAt?.value).toBe(2 * 1440 + 9 * 60 + 15);
  });

  it('at extremes of heart rate it says to trust Fridericia, and why', () => {
    expect(ok(qtcBazett, ctx(male(50), []), ecg(440, 50)).warnings[0]?.en).toContain('Trust the Fridericia value here');
    expect(ok(qtcBazett, ctx(male(50), []), ecg(320, 120)).warnings[0]?.en).toContain('over-corrects fast heart rates');
    expect(ok(qtcBazett, ctx(male(50), []), ecg(400, 75)).warnings[0]?.en).toContain('within 60–100');
  });

  it('refuses without the QT, the heart rate, or the time of the ECG', () => {
    expect(named(refused(qtcBazett, ctx(male(50), []), { answers: { hr: num(60, 'beats/min'), ecgAt: at(1, '08:00') } }), 'missing')).toEqual(['qt']);
    expect(named(refused(qtcBazett, ctx(male(50), []), { answers: { qt: num(400, 'ms'), ecgAt: at(1, '08:00') } }), 'missing')).toEqual(['hr']);
    expect(named(refused(qtcBazett, ctx(male(50), []), { answers: { qt: num(400, 'ms'), hr: num(60, 'beats/min') } }), 'missing')).toEqual(['ecgAt']);
  });

  it('an implausible QT needs confirmation; a QT of 0 is rejected', () => {
    expect(named(refused(qtcBazett, ctx(male(50), []), ecg(900, 60)), 'out_of_range')).toEqual(['qt']);
    expect(named(refused(qtcBazett, ctx(male(50), []), ecg(0, 60)), 'invalid')).toEqual(['qt']);
  });
});

describe(`calc:${qtcFridericia.id}@${qtcFridericia.formulaVersion}`, () => {
  it.each(CASES)('QT %s ms at %s beats/min → %s ms (Fridericia %s)', (qt, hr, _b, fridericia) => {
    const r = ok(qtcFridericia, ctx(male(50), []), ecg(qt, hr));
    expect(r.value).toBeCloseTo(fridericia, 9);
  });

  it('is never shown alone: it is paired with Bazett', () => {
    expect(qtcFridericia.pairedWith).toBe('qtc_bazett');
    expect(qtcBazett.pairedWith).toBe('qtc_fridericia');
  });

  it('above 60 beats/min Fridericia corrects less than Bazett; below, more', () => {
    const fast = [ok(qtcBazett, ctx(male(50), []), ecg(360, 100)).value, ok(qtcFridericia, ctx(male(50), []), ecg(360, 100)).value];
    const slow = [ok(qtcBazett, ctx(male(50), []), ecg(440, 50)).value, ok(qtcFridericia, ctx(male(50), []), ecg(440, 50)).value];
    expect(fast[1]!).toBeLessThan(fast[0]!);
    expect(slow[1]!).toBeGreaterThan(slow[0]!);
  });

  it('shows the RR interval and the substitution', () => {
    const r = ok(qtcFridericia, ctx(male(50), []), ecg(360, 100));
    expect(r.steps).toContain('RR interval = 60 ÷ 100 = 0.6 s');
    expect(r.steps.at(-1)).toBe('QTc (Fridericia) = 360 ÷ ∛0.6 = 427 ms');
  });
});

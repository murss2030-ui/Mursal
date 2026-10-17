/**
 * Vancomycin AUC₂₄ (Sawchuk–Zaske) — high-risk calculator: extended suite.
 *
 * Origins:
 * - "published": Herman RA, Clinical Pharmacokinetics course, University of
 *   Iowa, "Vancomycin Example" — 1 g every 12 h over 90 min; peak 17.0 mg/L
 *   drawn 60 min after the end of the infusion, trough 4.1 mg/L at the end of
 *   the interval; t2 − t1 = 9.5 h, ke ≈ 0.15 /h, half-life ≈ 4.6 h.
 * - "simulation": levels generated from known clearance and volume with the
 *   one-compartment steady-state model (forward), which the calculator must
 *   recover (inverse); scripts/calc-crosscheck.py also integrates the curve
 *   numerically to confirm AUC₂₄ = daily dose ÷ CL.
 * - "independent": scripts/calc-crosscheck.py.
 */
import { describe, expect, it } from 'vitest';
import { AUC_TARGET, ESCALATE_VANCO, vancomycinAuc } from '../../src/calc/calculators/vancomycin';
import type { Answer } from '../../src/calc/gather';
import { at, close, ctx, lab, male, named, num, ok, refused, secondary, weight, yesA } from './helpers';

/** Steady-state concentration t hours after the start of an infusion (one compartment, first order). */
function simulate(cl: number, v: number, dose: number, tinf: number, tau: number, t: number): number {
  const ke = cl / v;
  const r0 = dose / tinf;
  const acc = 1 / (1 - Math.exp(-ke * tau));
  const cmax = (r0 / cl) * (1 - Math.exp(-ke * tinf)) * acc;
  if (t <= tinf) {
    const cmin = cmax * Math.exp(-ke * (tau - tinf));
    return cmin * Math.exp(-ke * t) + (r0 / cl) * (1 - Math.exp(-ke * t));
  }
  return cmax * Math.exp(-ke * (t - tinf));
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.round(minutes % 60)).padStart(2, '0')}`;

interface Setup {
  dose: number;
  tinfH: number;
  tauH: number;
  c1: number;
  c2: number;
  /** Hours after the start of the infusion (start = day 3, 06:00). */
  t1H: number;
  t2H: number;
  kg?: number;
  answers?: Partial<Record<string, Answer>>;
}

const START_DAY = 3;
const START_MIN = 6 * 60;

function setup(s: Setup) {
  const t1 = START_MIN + s.t1H * 60;
  const t2 = START_MIN + s.t2H * 60;
  const l1 = lab('vanco', s.c1, 'mg/L', { day: START_DAY + Math.floor(t1 / 1440), time: hhmm(t1 % 1440) });
  const l2 = lab('vanco', s.c2, 'mg/L', { day: START_DAY + Math.floor(t2 / 1440), time: hhmm(t2 % 1440) });
  const entries = [l1, l2, ...(s.kg ? [weight(s.kg)] : [])];
  const answers: Record<string, Answer> = {
    dose: num(s.dose, 'mg'),
    tinf: num(s.tinfH, 'h'),
    tau: num(s.tauH, 'h'),
    doseStart: at(START_DAY, hhmm(START_MIN)),
    steadyState: yesA(true),
    noRrt: yesA(true),
  };
  for (const [k, v] of Object.entries(s.answers ?? {})) {
    if (v) answers[k] = v;
    else delete answers[k];
  }
  return { c: ctx(male(45), entries), req: { picks: { level1: l1.id, level2: l2.id }, answers }, l1, l2 };
}

function simulated(cl: number, v: number, dose: number, tinfH: number, tauH: number, t1H: number, t2H: number, kg?: number) {
  return setup({ dose, tinfH, tauH, t1H, t2H, c1: simulate(cl, v, dose, tinfH, tauH, t1H), c2: simulate(cl, v, dose, tinfH, tauH, t2H), ...(kg ? { kg } : {}) });
}

describe(`calc:${vancomycinAuc.id}@${vancomycinAuc.formulaVersion}`, () => {
  it('reproduces the published worked example: ke ≈ 0.15 /h and half-life ≈ 4.6 h (Herman, University of Iowa)', () => {
    const { c, req } = setup({ dose: 1000, tinfH: 1.5, tauH: 12, c1: 17.0, c2: 4.1, t1H: 2.5, t2H: 12, kg: 68 });
    const r = ok(vancomycinAuc, c, req);
    expect(secondary(r, 'ke')).toBeCloseTo(0.15, 2);
    expect(secondary(r, 'halfLife')).toBeCloseTo(4.6, 1);
    // Remaining values: independent (scripts/calc-crosscheck.py)
    expect(secondary(r, 'ke')).toBeCloseTo(0.14970803898378462, 12);
    expect(secondary(r, 'cmax')).toBeCloseTo(19.7454163929014, 9);
    expect(secondary(r, 'cmin')).toBeCloseTo(4.1, 12);
    expect(secondary(r, 'v')).toBeCloseTo(54.381825058575636, 9);
    expect(secondary(r, 'cl')).toBeCloseTo(8.141396385878597, 9);
    expect(r.value).toBeCloseTo(245.65810399172273, 9);
    expect(r.unit).toBe('mg·h/L');
    expect(r.category?.value).toBe('below');
  });

  it.each([
    // [CL L/h, V L, dose mg, tinf h, tau h, t1 h, t2 h, expected AUC24, category]
    [4, 50, 1250, 1, 12, 2, 11.5, 625, 'above'],
    [5, 60, 1250, 1, 12, 2, 11.5, 500, 'within'],
    [2, 40, 1500, 1.5, 12, 2.5, 11.5, 1500, 'above'],
    [3, 70, 1000, 1, 8, 2.5, 7.5, 1000, 'above'],
  ] as const)('recovers CL %s L/h and V %s L from levels simulated for %s mg over %s h every %s h', (cl, v, dose, tinf, tau, t1, t2, auc, category) => {
    const { c, req } = simulated(cl, v, dose, tinf, tau, t1, t2);
    const r = ok(vancomycinAuc, c, req);
    expect(close(secondary(r, 'cl'), cl, 1e-9)).toBe(true);
    expect(close(secondary(r, 'v'), v, 1e-9)).toBe(true);
    expect(close(r.value, auc, 1e-9)).toBe(true);
    expect(close(r.value, (dose * 24) / tau / cl, 1e-9)).toBe(true);
    expect(r.category?.value).toBe(category);
  });

  it('recovers the parameters for 60 randomly drawn patients (seeded)', () => {
    let seed = 20261017;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 60; i++) {
      const cl = 1 + rnd() * 9; // 1–10 L/h
      const v = 30 + rnd() * 70; // 30–100 L
      const tau = [8, 12, 24][Math.floor(rnd() * 3)]!;
      const tinf = [1, 1.5, 2][Math.floor(rnd() * 3)]!;
      const dose = [750, 1000, 1250, 1500][Math.floor(rnd() * 4)]!;
      const t1 = tinf + 1;
      const t2 = tau - 0.5;
      const c1 = simulate(cl, v, dose, tinf, tau, t1);
      const c2 = simulate(cl, v, dose, tinf, tau, t2);
      if (c1 > 100 || c2 < 1) continue; // outside the plausible range: tested separately
      const { c, req } = setup({ dose, tinfH: tinf, tauH: tau, c1, c2, t1H: t1, t2H: t2 });
      const r = ok(vancomycinAuc, c, req);
      expect(close(secondary(r, 'cl'), cl, 1e-6)).toBe(true);
      expect(close(r.value, (dose * 24) / tau / cl, 1e-6)).toBe(true);
    }
  });

  it('the target range is 400–600 (2020 consensus, MIC 1 mg/L) and the statement on non-invasive infection is always shown', () => {
    expect(AUC_TARGET).toEqual([400, 600]);
    const { c, req } = simulated(5, 60, 1250, 1, 12, 2, 11.5);
    const r = ok(vancomycinAuc, c, req);
    expect(r.warnings.map((w) => w.en)).toContain('Evidence is insufficient to recommend AUC targeting in non-invasive infection (2020 consensus).');
    expect(r.assumptions.map((a) => a.en)).toContain('Target assumes an MIC of 1 mg/L (2020 consensus).');
  });

  it('warns above an AUC of 800 and above an estimated trough of 15 mg/L', () => {
    const { c, req } = simulated(2, 40, 1500, 1.5, 12, 2.5, 11.5);
    const text = ok(vancomycinAuc, c, req).warnings.map((w) => w.en).join(' ');
    expect(text).toContain('AUC₂₄ above 800 mg·h/L');
    expect(text).toContain('above 15 mg/L');
  });

  it('no AUC or trough warning inside the target range', () => {
    const { c, req } = simulated(5, 60, 1250, 1, 12, 2, 11.5);
    const text = ok(vancomycinAuc, c, req).warnings.map((w) => w.en).join(' ');
    expect(text).not.toContain('above 800');
    expect(text).not.toContain('above 15 mg/L');
  });

  it('warns when the first level is drawn within an hour of the end of the infusion', () => {
    const { c, req } = simulated(5, 60, 1250, 1, 12, 1.5, 11.5);
    expect(ok(vancomycinAuc, c, req).warnings.map((w) => w.en).join(' ')).toContain('distribution phase');
  });

  it('escalates when the derived values fall outside the validated range (V 2.0 L/kg)', () => {
    const { c, req } = simulated(5, 140, 1250, 1, 12, 2, 11.5, 70);
    const r = ok(vancomycinAuc, c, req);
    expect(secondary(r, 'vPerKg')).toBeCloseTo(2, 9);
    expect(r.warnings.map((w) => w.en)).toContain(ESCALATE_VANCO.en);
  });

  it('refuses without both levels picked explicitly — never defaults to the latest results', () => {
    const { c, req } = simulated(5, 60, 1250, 1, 12, 2, 11.5);
    const p = refused(vancomycinAuc, c, { answers: req.answers });
    expect(named(p, 'missing').sort()).toEqual(['level1', 'level2']);
  });

  it('refuses a level without its clock time', () => {
    const l1 = lab('vanco', 30, 'mg/L', { day: 3 });
    const { c, req } = simulated(5, 60, 1250, 1, 12, 2, 11.5);
    const p = refused(vancomycinAuc, ctx(male(45), [...c.current, l1]), { ...req, picks: { ...req.picks, level1: l1.id } });
    expect(p).toEqual([{ kind: 'missing', key: 'level1', detail: expect.anything() }]);
  });

  it('refuses without the dose start time, dose, infusion time or interval', () => {
    for (const key of ['doseStart', 'dose', 'tinf', 'tau']) {
      const { c, req } = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 2, t2H: 11.5, answers: { [key]: undefined } });
      expect(named(refused(vancomycinAuc, c, req), 'missing')).toEqual([key]);
    }
  });

  it('refuses levels not at steady state, and during dialysis or CRRT', () => {
    const a = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 2, t2H: 11.5, answers: { steadyState: yesA(false) } });
    expect(refused(vancomycinAuc, a.c, a.req)[0]?.kind).toBe('refused');
    const b = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 2, t2H: 11.5, answers: { noRrt: yesA(false) } });
    expect(refused(vancomycinAuc, b.c, b.req)[0]?.kind).toBe('refused');
  });

  it('refuses a first level drawn during the infusion', () => {
    const { c, req } = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 0.5, t2H: 11.5 });
    const p = refused(vancomycinAuc, c, req);
    expect(named(p, 'invalid')).toEqual(['level1']);
    expect(JSON.stringify(p)).toContain('before the infusion ended');
  });

  it('refuses a second level drawn after the next dose was due', () => {
    const { c, req } = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 2, t2H: 12.5 });
    expect(named(refused(vancomycinAuc, c, req), 'invalid')).toEqual(['level2']);
  });

  it('refuses a second level that is not lower than the first, or drawn before it', () => {
    const a = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 12, c2: 30, t1H: 2, t2H: 11.5 });
    expect(named(refused(vancomycinAuc, a.c, a.req), 'invalid')).toEqual(['level2']);
    const b = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 6, t2H: 4 });
    expect(named(refused(vancomycinAuc, b.c, b.req), 'invalid')).toContain('level2');
  });

  it('refuses the same result picked for both levels', () => {
    const { c, req, l1 } = simulated(5, 60, 1250, 1, 12, 2, 11.5);
    expect(named(refused(vancomycinAuc, c, { ...req, picks: { level1: l1.id, level2: l1.id } }), 'invalid')).toEqual(['level2']);
  });

  it('refuses an infusion that is not shorter than the interval', () => {
    const { c, req } = setup({ dose: 1250, tinfH: 12, tauH: 12, c1: 30, c2: 12, t1H: 12, t2H: 12 });
    expect(named(refused(vancomycinAuc, c, req), 'invalid')).toContain('tinf');
  });

  it('accepts the dose in grams and the infusion time in minutes', () => {
    const base = simulated(5, 60, 1250, 1, 12, 2, 11.5);
    const r = ok(vancomycinAuc, base.c, { ...base.req, answers: { ...base.req.answers, dose: num(1.25, 'g'), tinf: num(60, 'min') } });
    expect(close(r.value, 500, 1e-9)).toBe(true);
  });

  it('works across midnight (levels on the next hospital day)', () => {
    // start day 3 06:00 + 24 h interval; second level at 05:30 on day 4
    const { c, req } = simulated(4, 60, 1500, 2, 24, 3, 23.5);
    const r = ok(vancomycinAuc, c, req);
    expect(close(r.value, (1500 * 24) / 24 / 4, 1e-9)).toBe(true);
  });

  it('a level above 100 mg/L needs confirmation; an implausible dose too', () => {
    const a = setup({ dose: 1250, tinfH: 1, tauH: 12, c1: 120, c2: 30, t1H: 2, t2H: 11.5 });
    expect(named(refused(vancomycinAuc, a.c, a.req), 'out_of_range')).toEqual(['level1']);
    const b = setup({ dose: 6000, tinfH: 1, tauH: 12, c1: 30, c2: 12, t1H: 2, t2H: 11.5 });
    expect(named(refused(vancomycinAuc, b.c, b.req), 'out_of_range')).toEqual(['dose']);
  });

  it('shows every step with substituted values', () => {
    const { c, req } = setup({ dose: 1000, tinfH: 1.5, tauH: 12, c1: 17.0, c2: 4.1, t1H: 2.5, t2H: 12 });
    const steps = ok(vancomycinAuc, c, req).steps;
    expect(steps[0]).toBe('Dose 1000 mg over 1.5 h, every 12 h; infusion started Day 3 06:00, ended Day 3 07:30; next dose Day 3 18:00');
    expect(steps[3]).toBe('ke = ln(17 ÷ 4.1) ÷ 9.5 h = 0.1497 /h');
    expect(steps.at(-1)).toBe('AUC₂₄ = (1000 × 24 ÷ 12) ÷ 8.141 = 245.7 mg·h/L');
  });
});

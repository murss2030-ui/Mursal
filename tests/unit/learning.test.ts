/**
 * M8: the learning modes and the portfolio. Everything is built from the
 * trainee's own record and the app's validated calculators — no model — so
 * nothing in a question, a challenge or a lesson can be invented. Answers are
 * marked against the calculator; the trainee's words are kept append-only and
 * tagged with competency areas; the portfolio counts, grades nothing, and the
 * audit log never holds the trainee's words.
 */
import { describe, expect, it } from 'vitest';
import { calcInputsText } from '../../src/ai/analysis/payload';
import { makeCalculator } from '../../src/calc/engine';
import { CALC_BY_ID, CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import { assessmentQuestions, buildPortfolio, challengesFor, markAnswer, teachSections } from '../../src/domain/learning';
import { ValidationError } from '../../src/domain/validation';
import { portfolioCases } from '../../src/learning/portfolio-input';
import { newCase, newSession } from './helpers';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'test' })]));

async function setup() {
  const ctx = await newSession({ calculators: ALL_VALID });
  const c = await newCase(ctx.store, { ageYears: 70, sex: 'M', heightCm: 175, admissionDay0: '2026-10-13' });
  await ctx.store.addEntry(c.id, { type: 'weight', hospitalDay: 0, payload: { value: 70, unit: 'kg', method: 'measured' } });
  await ctx.store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.1 }, unit: 'mg/dL' } });
  const out = await ctx.store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
  if (!out.ok) throw new Error('refused');
  return { ...ctx, c, crcl: out.results[0]! };
}

const CARD = { problem: 'Metformin continued while creatinine rose', evidence: 'SCr 2.1 mg/dL on Day 1', drugs: 'metformin', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C3.2', priority: 'important' };

describe('Assessment mode', () => {
  it('asks the trainee to reproduce each current calculation from the case’s own inputs, and marks it against the calculator', async () => {
    const { crcl } = await setup();
    const qs = assessmentQuestions([crcl], new Set(), (r) => CALC_BY_ID.get(r.calc)!.name, calcInputsText, (r) => CALC_BY_ID.get(r.calc)?.formula);
    expect(qs).toHaveLength(1);
    const q = qs[0]!;
    expect(q.text).toContain('Serum creatinine 2.1 mg/dL');
    expect(q.text).not.toContain(String(q.expected)); // the answer is not given in the question
    expect(q.feedback[0]).toMatch(/^Formula:/);
    expect(markAnswer(q, String(q.expected))).toEqual({ ok: true, correct: true, entered: q.expected });
    expect(markAnswer(q, String(q.expected * 1.04)).correct).toBe(true);
    expect(markAnswer(q, String(q.expected * 1.2)).correct).toBe(false);
    expect(markAnswer(q, 'about fifty')).toEqual({ ok: false, correct: false });
    expect(markAnswer(q, '1,5').ok).toBe(false); // a comma is never guessed
    // A result that is out of date is not asked about.
    expect(assessmentQuestions([crcl], new Set([crcl.id]), () => 'x', () => 'y', () => undefined)).toEqual([]);
  });
});

describe('Argue with me and Teach me', () => {
  it('challenges come from the card’s own gaps, the alerts raised and the kind of problem; always the two closing questions', () => {
    const list = challengesFor(CARD, [{ key: 'k1', title: 'Renal adjustment needed: metformin' }], ['Missing information']);
    expect(list.map((c) => c.from)).toEqual(['gap', 'alert', 'cause', 'always', 'always']);
    expect(list.find((c) => c.from === 'cause')!.text).toMatch(/dose/i);
    expect(list.find((c) => c.from === 'alert')!.text).toContain('Renal adjustment needed: metformin');
    expect(list.at(-1)!.text).toMatch(/declines/);
    // No dose, number or citation appears in anything the app puts to the trainee.
    for (const c of list) expect(c.text).not.toMatch(/\d+\s?(mg|mL)|et al|doi/i);
  });

  it('the lesson is the card’s PCNE wording and the trainee’s own teaching question, nothing else', () => {
    const s = teachSections({ ...CARD, teaching: 'How does renal function change metformin’s safety?' });
    expect(s.map((x) => x.title.en)).toEqual(['The problem, in PCNE V9.1', 'Its causes', expect.stringContaining('question this problem teaches')]);
    expect(s[0]!.items[0]!.en).toContain('P2.1');
    expect(s[1]!.items[0]!.en).toContain('C3.2');
    expect(teachSections({}).length).toBe(0);
  });
});

describe('what the trainee did is kept, tagged and counted', () => {
  it('records append-only in the trainee’s own words; the audit log holds only the mode, tags and length', async () => {
    const { store, c } = await setup();
    const rec = await store.recordLearning(c.id, { mode: 'argue', competencies: ['pharmacotherapy_knowledge', 'communication'], prompt: 'Give the strongest argument against your own recommendation, and answer it.', answer: 'SECRET-WORDS my argument' });
    expect((await store.listLearning(c.id)).map((r) => r.id)).toEqual([rec.id]);
    const audit = (await store.listAudit()).filter((e) => e.entity === 'learning');
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('SECRET-WORDS');
    expect(audit[0]!.diff).toMatchObject({ mode: 'argue', answerLength: 'SECRET-WORDS my argument'.length });
    await expect(store.recordLearning(c.id, { mode: 'teach', competencies: ['nonsense' as never], prompt: 'x' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.recordLearning(c.id, { mode: 'teach', competencies: [], prompt: '  ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.recordLearning(c.id, { mode: 'argue', competencies: [], prompt: 'p', answer: 'x'.repeat(4001) })).rejects.toBeInstanceOf(ValidationError);
  });

  it('the portfolio gathers cards, reflections tagged by the trainee, learning and the register work by competency — counts, no grades', async () => {
    const { store, c } = await setup();
    await store.addItem(c.id, 'drp', { ...CARD, recStatus: 'final', recommendation: 'Hold metformin', response: 'accepted', implemented: 'yes', implementedBy: 'Dr Synthetic', implementedDay: '2', preceptorReviewed: 'yes' });
    await store.addItem(c.id, 'counseling', { who: 'patient', meds: 'Metformin counselling', topics: 'indication|how', teachBack: 'understood' });
    await store.addItem(c.id, 'rounds', { day: '1', roundType: 'ward', points: 'Raised metformin in kidney injury' });
    await store.saveTask(c.id, 't25', { status: 'in_progress', checks: {}, fields: { learning: 'Check renal function before continuing metformin', differently: 'Ask for the creatinine trend earlier', competencies: 'direct_patient_care|continuing_development', research: 'Audit metformin in AKI' } });
    await store.recordLearning(c.id, { mode: 'assess', competencies: ['pharmacotherapy_knowledge'], prompt: 'What is the CrCl?', answer: '41', score: { correct: true, expected: '41 mL/min' } });
    const p = buildPortfolio(await portfolioCases(store));
    const kinds = (a: keyof typeof p) => p[a].map((e) => e.kind).sort();
    expect(kinds('direct_patient_care')).toEqual(['card', 'reflection']);
    expect(p.direct_patient_care.find((e) => e.kind === 'card')!.detail).toBe('implemented; outcome not measured');
    expect(kinds('communication')).toEqual(['card', 'counselling']);
    expect(kinds('professionalism')).toEqual(['preceptor']);
    expect(kinds('systems_based_care')).toEqual(['round']);
    expect(kinds('pharmacotherapy_knowledge')).toEqual(['assessment']);
    expect(kinds('continuing_development')).toEqual(['reflection', 'research_idea']);
    expect(JSON.stringify(p)).not.toMatch(/grade|score\b|passed/i);
    // Filtered to a rotation with no cases: nothing.
    expect(Object.values(buildPortfolio(await portfolioCases(store, 'no-such-rotation'))).flat()).toEqual([]);
  });
});

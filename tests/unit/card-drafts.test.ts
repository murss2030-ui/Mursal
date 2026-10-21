/**
 * M4f: the model drafts Problem Cards. The checks in code (Section 12, and
 * the hostile fixtures of Section 21): an invalid PCNE code is removed; a
 * number that is not in the data it cites is removed; a dose is kept only
 * from a cited calculation result; citations are removed; references must
 * point to data that was sent; the model never sets a review decision, the
 * implementation or the outcome; the teaching explanation is drafted. Then
 * each drafted card is decided on its own.
 */
import { describe, expect, it } from 'vitest';
import { makeCalculator } from '../../src/calc/engine';
import { CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import { analysisSchema, ANALYSE_PROMPT_VERSION, ANALYSE_SYSTEM, type RawAnalysis, type RawItem } from '../../src/ai/analysis/contract';
import { buildCasePayload, draftableRegisters, type CasePayload } from '../../src/ai/analysis/payload';
import { verifyAnalysis } from '../../src/ai/analysis/verify';
import { isOutputSchema, validateOutput } from '../../src/ai/schema';
import { claimsValue, parseClaims, parseLinks } from '../../src/domain/card-data';
import { cardFields, reviewState } from '../../src/domain/problem-card';
import { MODULE_BY_ID, MODULES, TASKS } from '../../src/domain/workflow/catalogue';
import { newCase, newSession } from './helpers';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'test' })]));

async function setup() {
  const ctx = await newSession({ calculators: ALL_VALID });
  const c = await newCase(ctx.store, { ageYears: 70, sex: 'M', heightCm: 175, admissionDay0: '2026-10-13' });
  const s = ctx.store;
  await s.addEntry(c.id, { type: 'weight', hospitalDay: 0, payload: { value: 70, unit: 'kg', method: 'measured' } });
  const scr = await s.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.4 }, unit: 'mg/dL' } });
  await s.addEntry(c.id, {
    type: 'med_start',
    hospitalDay: 0,
    payload: { medId: 'med-enox', drug: 'enoxaparin', dose: { kind: 'structured', value: 40, unit: 'mg' }, route: 'SC', frequency: 'once daily', indication: 'VTE prophylaxis' },
  });
  const out = await s.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
  if (!out.ok) throw new Error('calculation refused');
  return { ...ctx, c, scr, crcl: out.results[0]! };
}

async function payload(ctx: Awaited<ReturnType<typeof setup>>): Promise<CasePayload> {
  const cards = await ctx.store.cardContext(ctx.c.id);
  return buildCasePayload({
    case: (await ctx.store.getCase(ctx.c.id))!,
    entries: await ctx.store.listEntries(ctx.c.id),
    items: await ctx.store.listItems(ctx.c.id),
    tasks: await ctx.store.listTasks(ctx.c.id),
    module: MODULE_BY_ID.get('plan')!,
    today: '2026-10-16',
    calcResults: cards.calcResults,
    calcOutOfDate: cards.calcOutOfDate,
  });
}

const refOf = (p: CasePayload, label: RegExp) => [...p.refs].find(([, t]) => label.test(t.label))![0];

/** A careless model's Problem Card: grounded mostly, with everything the checks must catch. */
function hostileCard(p: CasePayload): RawItem {
  const scr = refOf(p, /Serum creatinine/);
  const crcl = [...p.refs].find(([, t]) => t.kind === 'calc')![0];
  const enox = refOf(p, /enoxaparin/);
  return {
    register: 'drp',
    fields: [
      { field: 'problem', value: 'Enoxaparin dose not adjusted for kidney function' },
      { field: 'drugs', value: 'enoxaparin' },
      { field: 'pcneProblem', value: 'P2.1' },
      { field: 'pcneType', value: 'potential' },
      // One invented cause code among valid ones.
      { field: 'pcneCauses', value: 'C3.2|C11.4' },
      // A reference that was never sent among valid ones.
      { field: 'supporting', value: `${scr}, ${crcl}, E99` },
      { field: 'evidence', value: `Creatinine 2.4 mg/dL on Day 1 and a CrCl estimate of 99 mL/min.` },
      { field: 'priority', value: 'critical' },
      { field: 'urgency', value: 'high' },
      // A dose not from a calculation, and one with a citation.
      { field: 'recommendation', value: 'Reduce enoxaparin to 30 mg SC once daily (Garcia et al., 2012).' },
      { field: 'monitoring', value: 'Anti-Xa level after the 4th dose; see https://example.org/anti-xa' },
      { field: 'teaching', value: 'Which of my patient’s drugs are cleared by the kidney, and how is the dose adjusted?' },
      // Only the trainee records these.
      { field: 'recStatus', value: 'final' },
      { field: 'implemented', value: 'yes' },
      { field: 'goalMet', value: 'yes' },
      { field: 'boxes', value: 'adr' },
      { field: 'claims', value: '[{"text":"smuggled","source":"none"}]' },
    ],
    claims: [
      { text: 'Serum creatinine is 2.4 mg/dL on Day 1.', basis: 'case_data', refs: [scr] },
      { text: `The calculated creatinine clearance is ${p.refs.get(crcl)!.text.match(/(\d+(?:\.\d+)?) mL\/min/)![1]} mL/min.`, basis: 'case_data', refs: [crcl] },
      { text: 'Enoxaparin 40 mg once daily is ordered; 20 mg would be safer.', basis: 'case_data', refs: [enox] },
      { text: 'Enoxaparin accumulates when kidney function is reduced [3].', basis: 'general_knowledge', refs: [] },
      { text: 'Levels rise 7-fold.', basis: 'case_data', refs: ['E42'] },
    ],
    reason: 'Ordered before the creatinine rose.',
    basis: 'case_data',
    refs: [scr, enox],
  };
}

describe('the model drafts Problem Cards: the checks in code', () => {
  it('sends current calculation results as references, and offers the card’s fields with their allowed values', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const calc = [...p.refs.values()].find((t) => t.kind === 'calc')!;
    expect(calc).toMatchObject({ kind: 'calc', id: ctx.crcl.id });
    expect(p.text).toContain('"calculations":[{"ref":"C1"');
    // A medication reference points the claim to the order on the timeline.
    expect(p.refs.get('M1')!.entryId).toBeDefined();
    const drp = draftableRegisters(TASKS.get('t05')!).find((r) => r.register === 'drp')!;
    const ids = drp.fields.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['pcneProblem', 'pcneType', 'pcneCauses', 'supporting', 'urgency', 'teaching']));
    for (const never of ['category', 'boxes', 'boxesReason', 'classificationReason', 'claims', 'implemented', 'goalMet', 'response', 'references']) expect(ids).not.toContain(never);
    expect(drp.fields.find((f) => f.id === 'pcneCauses')!.allowed).toHaveLength(38);
    expect(drp.fields.find((f) => f.id === 'recStatus')!.allowed).toEqual(['draft']);
    expect(ANALYSE_PROMPT_VERSION).toBe('analyse-v4');
    expect(ANALYSE_SYSTEM).toMatch(/PCNE V9\.1/);
  });

  it('removes the invalid code, the unknown reference, untraced numbers, the dose not from a calculation, citations and what only the trainee records', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const raw: RawAnalysis = { tasks: [{ taskId: 't05', summary: '', checks: [], items: [hostileCard(p)], missingData: [], questions: [] }] };
    expect(validateOutput(raw, analysisSchema(p.tasks))).toEqual([]);
    const { suggestions } = verifyAnalysis(raw, p);
    const sg = suggestions.find((x) => x.kind === 'item')!;
    const f = sg.fields!;
    expect(f.pcneCauses).toBe('C3.2');
    expect(parseLinks(f.supporting)).toEqual([
      { kind: 'entry', id: ctx.scr.id },
      { kind: 'calc', id: ctx.crcl.id },
    ]);
    // 99 is not in the data the card cites.
    expect(f.evidence).toBe('Creatinine 2.4 mg/dL on Day 1 and a CrCl estimate of [number removed] mL/min.');
    expect(f.recommendation).toBe('Reduce enoxaparin to [dose withheld — to be calculated] SC once daily.');
    expect(f.monitoring).not.toMatch(/https?:/);
    expect(f.teaching).toBe('Which of my patient’s drugs are cleared by the kidney, and how is the dose adjusted?');
    expect(f.recStatus).toBeUndefined();
    for (const k of ['implemented', 'goalMet', 'boxes']) expect(f[k]).toBeUndefined();
    expect(sg.checks).toEqual(expect.arrayContaining(['invalid_value_removed', 'unknown_ref_removed', 'number_removed', 'dose_withheld', 'citation_removed', 'trainee_only_removed']));

    const claims = parseClaims(f.claims);
    expect(claims.map((c) => [c.source, c.by])).toEqual([
      ['entry', 'model'],
      ['calc', 'model'],
      ['entry', 'model'],
      ['none', 'model'],
      ['none', 'model'],
    ]);
    // The claim citing the medication points to its order on the timeline; its dose not in the order is withheld.
    expect(claims[2]!.text).toBe('Enoxaparin 40 mg once daily is ordered; [dose withheld — to be calculated] would be safer.');
    expect(claims[3]!.text).toBe('Enoxaparin accumulates when kidney function is reduced.');
    expect(claims[4]!.text).toBe('Levels rise [number removed]-fold.');
    expect(sg.checks).toContain('no_valid_ref');
    expect(claims[1]!.ref).toBe(ctx.crcl.id);
    // The smuggled claims field never passes as a field value.
    expect(claims.some((c) => c.text === 'smuggled')).toBe(false);
  });

  it('the output schema of every module stays within the relay’s limits (depth, size)', async () => {
    const ctx = await setup();
    for (const m of MODULES) {
      const p = buildCasePayload({
        case: (await ctx.store.getCase(ctx.c.id))!,
        entries: await ctx.store.listEntries(ctx.c.id),
        items: [],
        tasks: [],
        module: m,
        today: '2026-10-16',
      });
      if (p.tasks.length) expect(isOutputSchema(analysisSchema(p.tasks)), m.id).toBe(true);
    }
  });

  it('a medication or a problem given as supporting data is linked through its entry on the timeline', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const med = refOf(p, /enoxaparin/);
    const raw: RawAnalysis = {
      tasks: [{ taskId: 't05', summary: '', checks: [], items: [{ register: 'drp', fields: [{ field: 'supporting', value: `${med} R77` }], reason: '', basis: 'case_data', refs: [med] }], missingData: [], questions: [] }],
    };
    const sg = verifyAnalysis(raw, p).suggestions[0]!;
    expect(parseLinks(sg.fields!.supporting)).toEqual([{ kind: 'entry', id: p.refs.get(med)!.entryId }]);
    expect(sg.checks).toContain('unknown_ref_removed');
  });

  it('a dose the model takes from a cited calculation result is kept (Section 12)', async () => {
    const ctx = await setup();
    const out = await ctx.store.calculate(ctx.c.id, 'vancomycin_empiric', {
      answers: { rrt: { kind: 'choice', value: 'none' }, weightBasis: { kind: 'choice', value: 'tbw' }, mgPerKg: { kind: 'number', value: 15, unit: 'mg/kg' } },
    });
    if (!out.ok) throw new Error(JSON.stringify(out.problems));
    const p = await payload(ctx);
    const ref = [...p.refs].find(([, t]) => t.kind === 'calc' && t.id === out.results[0]!.id)![0];
    const dose = /(\d+) mg/.exec(p.refs.get(ref)!.text)![1];
    const raw: RawAnalysis = {
      tasks: [
        {
          taskId: 't05',
          summary: '',
          checks: [],
          items: [
            {
              register: 'drp',
              fields: [{ field: 'recommendation', value: `Give ${dose} mg IV as the loading dose.` }],
              claims: [{ text: `Calculated dose ${dose} mg.`, basis: 'case_data', refs: [ref] }],
              reason: '',
              basis: 'case_data',
              refs: [ref],
            },
          ],
          missingData: [],
          questions: [],
        },
      ],
    };
    const sg = verifyAnalysis(raw, p).suggestions[0]!;
    expect(sg.fields!.recommendation).toBe(`Give ${dose} mg IV as the loading dose.`);
    expect(parseClaims(sg.fields!.claims)[0]).toMatchObject({ source: 'calc', text: `Calculated dose ${dose} mg.` });
  });
});

describe('a drafted card is decided on its own', () => {
  async function drafted() {
    const ctx = await setup();
    const p = await payload(ctx);
    const raw: RawAnalysis = { tasks: [{ taskId: 't05', summary: '', checks: [], items: [hostileCard(p)], missingData: [], questions: [] }] };
    const { suggestions, dropped } = verifyAnalysis(raw, p);
    const a = await ctx.store.addAnalysis(ctx.c.id, {
      moduleId: 'plan',
      model: 'm',
      promptVersion: ANALYSE_PROMPT_VERSION,
      basedOn: p.basedOn,
      retrievedChunkIds: [],
      suggestions,
      dropped,
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    });
    return { ...ctx, a, sg: suggestions.find((x) => x.kind === 'item')! };
  }

  it('edited: the card exists with its first decision; its fields are filled or explicitly missing', async () => {
    const { store, c, a, sg } = await drafted();
    expect(sg.checks).not.toContain('incomplete');
    // M5, decision 6: a card with a general-knowledge claim, or a claim the verifier has not found supported, is not accepted as it is.
    await expect(store.decideSuggestion(c.id, a.id, sg.id, { kind: 'accept' })).rejects.toThrow(/verifier/);
    // Saved unchanged, an edit would be an acceptance in disguise.
    await expect(store.decideSuggestion(c.id, a.id, sg.id, { kind: 'edit', fields: { ...sg.fields! } })).rejects.toThrow(/Nothing was changed/);
    // The trainee removes the claims without a source and saves the card in their own words.
    const kept = parseClaims(sg.fields!.claims).filter((x) => x.source !== 'none');
    await store.decideSuggestion(c.id, a.id, sg.id, { kind: 'edit', fields: { ...sg.fields!, claims: claimsValue(kept) } });
    const [card] = await store.listItems(c.id);
    expect(card!.origin).toEqual({ kind: 'suggestion', analysisId: a.id, suggestionId: sg.id });
    const reviews = await store.listCardReviews(c.id);
    expect(reviewState(card!, reviews)).toMatchObject({ kind: 'decided', decision: 'edited' });
    const fields = cardFields(card!, await store.cardContext(c.id));
    expect(fields.filter((x) => x.missing).map((x) => x.no)).toEqual([3, 4, 11, 12]);
  });

  it('kept for more evidence or a senior review: the card waits with its reason, out of the form', async () => {
    const { store, c, a, sg } = await drafted();
    await expect(store.decideSuggestion(c.id, a.id, sg.id, { kind: 'needs_senior_review', reason: '' })).rejects.toMatchObject({ errors: { reason: 'required' } });
    const after = await store.decideSuggestion(c.id, a.id, sg.id, { kind: 'needs_senior_review', reason: 'Is a dose reduction right on Day 1?' });
    expect(after.suggestions.find((x) => x.id === sg.id)!.decision).toMatchObject({ kind: 'needs_senior_review', reason: 'Is a dose reduction right on Day 1?' });
    const [card] = await store.listItems(c.id);
    expect(reviewState(card!, await store.listCardReviews(c.id))).toMatchObject({ decision: 'needs_senior_review' });
    // Not allowed on a suggestion that is not a Problem Card.
    const other = after.suggestions.find((x) => x.kind !== 'item');
    if (other) await expect(store.decideSuggestion(c.id, a.id, other.id, { kind: 'needs_evidence', reason: 'x y z' })).rejects.toBeTruthy();
  });
});

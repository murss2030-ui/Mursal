/**
 * M5, the drafting prompt analyse-v4 and what the model receives (the live
 * probe's proposals 3 and 4, approved by the owner on 21 October 2026):
 * register rows with their labels, calculation results with their inputs,
 * every reference with its subject and day; references kept out of the text;
 * a claim citing several values; a text that says something was done held
 * back; one card per problem.
 */
import { describe, expect, it } from 'vitest';
import { makeCalculator } from '../../src/calc/engine';
import { CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import { ANALYSE_SYSTEM, type RawAnalysis, type RawItem } from '../../src/ai/analysis/contract';
import { buildCasePayload, calcInputsText, type CasePayload, type DraftedCard } from '../../src/ai/analysis/payload';
import { analyseModule } from '../../src/ai/analysis/run';
import { cardKey, cleanStatement, verifyAnalysis } from '../../src/ai/analysis/verify';
import { claimsFromSuggestions } from '../../src/ai/verification/claims';
import { verifyDraft } from '../../src/ai/verification/draft';
import { checkVerification } from '../../src/ai/verification/check';
import { claimTargets, normalizeClaims, parseClaims } from '../../src/domain/card-data';
import { buildCard, cardStaleness, citedEntryIds } from '../../src/domain/problem-card';
import { MODULE_BY_ID } from '../../src/domain/workflow/catalogue';
import { mustEdit } from '../../src/domain/types';
import { newCase, newSession, standInVerifier } from './helpers';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'test' })]));

async function setup() {
  const ctx = await newSession({ calculators: ALL_VALID });
  const c = await newCase(ctx.store, { ageYears: 70, sex: 'M', heightCm: 175, admissionDay0: '2026-10-13' });
  const s = ctx.store;
  await s.addEntry(c.id, { type: 'weight', hospitalDay: 0, payload: { value: 70, unit: 'kg', method: 'measured' } });
  const scr0 = await s.addEntry(c.id, { type: 'lab', hospitalDay: 0, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 1 }, unit: 'mg/dL' } });
  const scr2 = await s.addEntry(c.id, { type: 'lab', hospitalDay: 2, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.1 }, unit: 'mg/dL' } });
  await s.addEntry(c.id, {
    type: 'med_start',
    hospitalDay: 0,
    payload: { medId: 'med-met', drug: 'metformin', dose: { kind: 'structured', value: 1000, unit: 'mg' }, route: 'PO', frequency: 'twice daily', indication: 'type 2 diabetes' },
  });
  await s.addItem(c.id, 'home_med', { drug: 'metformin', regimen: '1000 mg twice daily', sources: 'patient|containers', action: 'Continued on admission' });
  const out = await s.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
  if (!out.ok) throw new Error('calculation refused');
  return { ...ctx, c, scr0, scr2, crcl: out.results[0]! };
}

async function payload(ctx: Awaited<ReturnType<typeof setup>>, moduleId = 'plan', draftedCards?: DraftedCard[]): Promise<CasePayload> {
  const cards = await ctx.store.cardContext(ctx.c.id);
  return buildCasePayload({
    case: (await ctx.store.getCase(ctx.c.id))!,
    entries: await ctx.store.listEntries(ctx.c.id),
    items: await ctx.store.listItems(ctx.c.id),
    tasks: await ctx.store.listTasks(ctx.c.id),
    module: MODULE_BY_ID.get(moduleId as never)!,
    today: '2026-10-15',
    calcResults: cards.calcResults,
    calcOutOfDate: cards.calcOutOfDate,
    ...(draftedCards ? { draftedCards } : {}),
  });
}

const refWhere = (p: CasePayload, f: (t: ReturnType<CasePayload['refs']['get']> & object) => boolean) => [...p.refs].find(([, t]) => f(t))![0];

const card = (fields: Record<string, string>, claims: RawItem['claims'] = [], refs: string[] = []): RawItem => ({
  register: 'drp',
  fields: Object.entries(fields).map(([field, value]) => ({ field, value })),
  claims,
  reason: '',
  basis: refs.length ? 'case_data' : 'general_knowledge',
  refs,
});
const draft = (items: RawItem[], over: Partial<RawAnalysis['tasks'][number]> = {}): RawAnalysis => ({ tasks: [{ taskId: 't05', summary: '', checks: [], items, missingData: [], questions: [], ...over }] });

describe('what the model receives', () => {
  it('register rows with their labels and the wording of their choices, never a number from a label', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const row = [...p.refs.values()].find((t) => t.kind === 'item')!;
    expect(row.text).toContain('Sources used for this medication: Patient interview, Medication containers');
    expect(row.text).toContain('Action / reason: Continued on admission');
    // "(department form, Section 4)" is not sent: its 4 could otherwise be borrowed by a statement citing the row.
    expect(row.text).not.toMatch(/Section 4/);
    expect(p.text).toContain('"list":"Pre-admission medications (BPMH)"');
    expect(p.text).not.toContain('patient|containers');
  });

  it('calculation results with the inputs they used, each with its unit and day', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const calc = [...p.refs.values()].find((t) => t.kind === 'calc')!;
    const inputs = calcInputsText(ctx.crcl);
    expect(inputs).toMatch(/Serum creatinine 2\.1 mg\/dL \(Day 2\)/);
    expect(inputs).toMatch(/70 kg \(Day 0\)/);
    expect(inputs).toMatch(/male/);
    expect(calc.text).toContain(`inputs: ${inputs}`);
    expect(calc).toMatchObject({ subject: 'calc:crcl_cg', day: 2 });
  });

  it('each reference with what it is about and its day', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const labs = [...p.refs.values()].filter((t) => t.kind === 'entry' && /Serum creatinine/.test(t.label));
    expect(labs.map((t) => [t.subject, t.day])).toEqual([
      ['lab:scr', 0],
      ['lab:scr', 2],
    ]);
    expect([...p.refs.values()].find((t) => t.kind === 'medication')).toMatchObject({ subject: 'med:med-met', day: 0 });
  });

  it('the cards another module drafted and the trainee has not decided, so that they are not drafted twice', async () => {
    const ctx = await setup();
    const p = await payload(ctx, 'plan', [{ problem: 'Metformin in acute kidney injury', drugs: 'metformin', pcneProblem: 'P2.1' }]);
    expect(p.text).toContain('"cardsAwaitingDecision":[{"problem":"Metformin in acute kidney injury","drugs":"metformin"}]');
    expect(ANALYSE_SYSTEM).toMatch(/one card per problem/);
    expect(ANALYSE_SYSTEM).toMatch(/cardsAwaitingDecision/);
  });

  it('the prompt asks for data rather than process, references only in refs, and codes consistent with the sentence', () => {
    expect(ANALYSE_SYSTEM).toMatch(/State the data itself, never what was done with it/);
    expect(ANALYSE_SYSTEM).toMatch(/never inside a text/);
    expect(ANALYSE_SYSTEM).toMatch(/a card about toxicity is never C3\.1/);
    expect(ANALYSE_SYSTEM).toMatch(/A change \("rose", "fell", "improved"\) cites both values/);
  });
});

describe('the checks in code on the draft', () => {
  it('keeps references out of the text', () => {
    const all = new Set(['1', '2.1']);
    expect(cleanStatement('Amlodipine (R2) is continued.', all).text).toBe('Amlodipine is continued.');
    expect(cleanStatement('Creatinine rose from 1 to 2.1 mg/dL [E2, E3].', all).text).toBe('Creatinine rose from 1 to 2.1 mg/dL.');
    expect(cleanStatement('As shown (see C1).', all).text).toBe('As shown.');
    // Not a reference: kept.
    expect(cleanStatement('Vitamin B12 (cobalamin) level pending.', new Set(['12'])).text).toBe('Vitamin B12 (cobalamin) level pending.');
  });

  it('a claim cites every value it uses; the card checks its numbers against all of them and goes stale with any of them', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const e0 = refWhere(p, (t) => t.kind === 'entry' && t.day === 0 && t.subject === 'lab:scr');
    const e2 = refWhere(p, (t) => t.kind === 'entry' && t.day === 2 && t.subject === 'lab:scr');
    const { suggestions } = verifyAnalysis(
      draft([
        card(
          { problem: 'Metformin continued while creatinine rose', drugs: 'metformin', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C1.1', priority: 'important', supporting: `${e0}, ${e2}` },
          [{ text: 'Creatinine rose from 1 mg/dL on Day 0 to 2.1 mg/dL on Day 2.', basis: 'case_data', refs: [e0, e2] }],
          [e2],
        ),
      ]),
      p,
    );
    const [claim] = parseClaims(suggestions[0]!.fields!.claims);
    expect(claim).toMatchObject({ source: 'entry', ref: ctx.scr0.id, also: [`e:${ctx.scr2.id}`], by: 'model' });
    expect(claimTargets(claim!).map((l) => l.id)).toEqual([ctx.scr0.id, ctx.scr2.id]);

    // Verified (a stand-in that finds every statement supported) and accepted, the card checks the claim against both values.
    const a = await ctx.store.addAnalysis(ctx.c.id, analysisOf(suggestions, p.basedOn));
    await ctx.store.updateAiSettings({ models: { verify: 'verifier-stand-in' } });
    await verifyDraft(ctx.store, ctx.c.id, a.id, { fetch: standInVerifier().f, online: () => true }, p);
    await ctx.store.decideSuggestion(ctx.c.id, a.id, suggestions[0]!.id, { kind: 'accept' });
    const item = (await ctx.store.listItems(ctx.c.id)).find((r) => r.register === 'drp')!;
    const cardCtx = await ctx.store.cardContext(ctx.c.id);
    expect(buildCard(item, cardCtx).claims[0]!.check).toEqual({ kind: 'numbers_found' });
    expect(citedEntryIds(item.fields)).toEqual(expect.arrayContaining([ctx.scr0.id, ctx.scr2.id]));

    // A correction of the second value makes the card stale.
    await ctx.store.correctEntry(ctx.c.id, ctx.scr2.id, {
      kind: 'amend',
      hospitalDay: 2,
      payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.2 }, unit: 'mg/dL' },
      reason: 'typo',
    });
    expect(cardStaleness(item, await ctx.store.cardContext(ctx.c.id)).stale).toBe(true);
  });

  it('the verifier receives both values of a change, each with its subject and day, so the guard does not hold the change back', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const e0 = refWhere(p, (t) => t.kind === 'entry' && t.day === 0 && t.subject === 'lab:scr');
    const e2 = refWhere(p, (t) => t.kind === 'entry' && t.day === 2 && t.subject === 'lab:scr');
    const { suggestions } = verifyAnalysis(
      draft([
        card({ problem: 'Metformin continued while creatinine rose', drugs: 'metformin', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C1.1', priority: 'important' }, [
          { text: 'Creatinine increased from 1 mg/dL to 2.1 mg/dL.', basis: 'case_data', refs: [e0, e2] },
        ]),
      ]),
      p,
    );
    const { input } = claimsFromSuggestions(suggestions, p);
    const [v] = input.claims;
    expect(v!.sourceIds).toHaveLength(3); // the header and both values
    const cited = input.sources.filter((s) => v!.sourceIds.includes(s.id) && !s.context);
    expect(cited.map((s) => [s.subject, s.day])).toEqual([
      ['lab:scr', 0],
      ['lab:scr', 2],
    ]);
    // A verifier that quotes both values: supported, and "increased" is not held back.
    const [verdict] = checkVerification(
      { results: [{ claimId: v!.id, verdict: 'supported', contradicted: false, quotes: cited.map((s) => ({ sourceId: s.id, text: s.day === 0 ? 'Day 0' : 'Day 2' })), unsupportedParts: [] }] },
      input,
    );
    expect(verdict).toMatchObject({ verdict: 'supported', flags: [] });
  });

  it('a stored text that says something was done is held back; a checklist reason saying it is only flagged', async () => {
    const ctx = await setup();
    const p = await payload(ctx);
    const { suggestions } = verifyAnalysis(
      draft([card({ problem: 'Metformin in kidney injury', drugs: 'metformin', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C1.1', priority: 'important', assessment: 'Renal function was assessed and the medications were reconciled.' })], {
        summary: 'Home medications were reconciled on admission.',
        checks: [{ checkId: 'ddi_checked', scopeRef: null, answer: 'ok', reason: 'Interactions were checked.', basis: 'general_knowledge', refs: [] }],
      }),
      p,
    );
    const summary = suggestions.find((s) => s.kind === 'note')!;
    const item = suggestions.find((s) => s.kind === 'item')!;
    expect(summary.checks).toContain('states_action');
    expect(item.checks).toContain('states_action');
    expect(mustEdit(summary)).toBe(true);
    expect(mustEdit(item)).toBe(true);
    // A checklist answer stores its answer only: the reason is flagged, not held back.
    expect(mustEdit({ kind: 'check', checks: ['states_action'] })).toBe(false);
    // Data stated as data passes.
    const ok = verifyAnalysis(draft([], { summary: 'Creatinine 2.1 mg/dL on Day 2; metformin 1000 mg twice daily is ordered.' }), p).suggestions[0]!;
    expect(ok.checks).not.toContain('states_action');
  });

  it('one card per problem: a second card for the same drugs and PCNE problem is flagged, within a draft and against the case', async () => {
    const ctx = await setup();
    const p = await payload(ctx, 'plan', [{ problem: 'Ibuprofen in acute kidney injury', drugs: 'ibuprofen', pcneProblem: 'P2.1' }]);
    const base = { pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C1.1', priority: 'important' };
    const { suggestions } = verifyAnalysis(
      draft([
        card({ ...base, problem: 'Metformin use in acute kidney injury', drugs: 'metformin' }),
        card({ ...base, problem: 'Risk of lactic acidosis on metformin', drugs: 'Metformin' }),
        card({ ...base, problem: 'Potential nephrotoxicity from NSAID use', drugs: 'ibuprofen' }),
        card({ ...base, problem: 'Warfarin and amiodarone', drugs: 'warfarin, amiodarone' }),
      ]),
      p,
    );
    expect(suggestions.map((s) => s.checks.includes('duplicate_card'))).toEqual([false, true, true, false]);
    expect(cardKey({ drugs: 'amiodarone + warfarin', pcneProblem: 'P2.1' })).toBe(cardKey({ drugs: 'Warfarin, Amiodarone', pcneProblem: 'P2.1' }));
    expect(cardKey({ problem: 'No VTE prophylaxis.' })).toBe(cardKey({ problem: 'no vte prophylaxis' }));
  });

  it('analyseModule sends the cards another module drafted, and only those the trainee has not decided on current data', async () => {
    const ctx = await setup();
    // Another module's draft with a pending card.
    const other = await ctx.store.addAnalysis(ctx.c.id, {
      moduleId: 'followup',
      model: 'stand-in',
      promptVersion: 'analyse-v4',
      basedOn: (await payload(ctx, 'followup')).basedOn,
      retrievedChunkIds: [],
      suggestions: [
        { id: 's1', taskId: 't29', kind: 'item', register: 'drp', fields: { problem: 'Metformin in acute kidney injury', drugs: 'metformin', pcneProblem: 'P2.1' }, reason: '', basis: 'general_knowledge', refs: [], checks: [] },
      ],
      dropped: 0,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    });
    expect(other.moduleId).toBe('followup');
    let sent = '';
    const relay = async (_url: string, init?: RequestInit) => {
      sent = String(init!.body);
      return new Response(JSON.stringify({ model: 'stand-in', output: { tasks: [] }, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await ctx.store.updateAiSettings({ models: { analyse: 'stand-in' } });
    await analyseModule(ctx.store, ctx.c.id, 'plan', { fetch: relay as unknown as typeof fetch, online: () => true });
    sent = (JSON.parse(sent) as { parts: { text: string }[] }).parts.map((x) => x.text).join('\n');
    expect(sent).toContain('"cardsAwaitingDecision":[{"problem":"Metformin in acute kidney injury","drugs":"metformin"}]');
  });
});

describe('a claim citing several values, as stored', () => {
  const claim = (also: unknown, source = 'entry') => JSON.stringify([{ text: 'Creatinine rose', source, ref: source === 'dataset' ? 'k1' : 'a1', also }]);
  it('keeps the other values in a fixed form, and refuses malformed ones', () => {
    expect(normalizeClaims(claim(['e:a2', 'c:r1']))).toEqual({ ok: true, value: JSON.stringify([{ text: 'Creatinine rose', source: 'entry', ref: 'a1', also: ['e:a2', 'c:r1'] }]) });
    expect(normalizeClaims(claim([]))).toEqual({ ok: true, value: JSON.stringify([{ text: 'Creatinine rose', source: 'entry', ref: 'a1' }]) });
    expect(normalizeClaims(claim(['e:a1']))).toEqual({ ok: false, error: 'invalidChoice' }); // its own source again
    expect(normalizeClaims(claim(['e:a2', 'e:a2']))).toEqual({ ok: false, error: 'invalidChoice' });
    expect(normalizeClaims(claim(['x:a2']))).toEqual({ ok: false, error: 'invalidChoice' });
    expect(normalizeClaims(claim(['e:a2|e:a3']))).toEqual({ ok: false, error: 'invalidChoice' });
    expect(normalizeClaims(claim('e:a2'))).toEqual({ ok: false, error: 'invalidChoice' });
    expect(normalizeClaims(claim(['e:a2'], 'dataset'))).toEqual({ ok: false, error: 'invalidChoice' });
    expect(normalizeClaims(claim(Array.from({ length: 7 }, (_, i) => `e:b${i}`)))).toEqual({ ok: false, error: 'tooLong' });
  });

  it('a claim without other values reads exactly as before', () => {
    expect(claimTargets({ source: 'calc', ref: 'r1' })).toEqual([{ kind: 'calc', id: 'r1' }]);
    expect(claimTargets({ source: 'none' })).toEqual([]);
    expect(claimTargets({ source: 'dataset', ref: 'k1' })).toEqual([]);
  });
});

function analysisOf(suggestions: ReturnType<typeof verifyAnalysis>['suggestions'], basedOn: CasePayload['basedOn']) {
  return { moduleId: 'plan', model: 'stand-in', promptVersion: 'analyse-v4', basedOn, retrievedChunkIds: [], suggestions, dropped: 0, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
}

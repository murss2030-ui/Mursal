/**
 * M5, decision 6 (owner, 20 October 2026): "a statement enters the official
 * form only with the verdict supported and its literal quote". The verifier
 * runs after a draft and on request on a card's claims; its verdicts are
 * append-only records tied to the exact words and sources they checked; a
 * drafted statement is accepted as it is only when supported; the department
 * form's Sections 8 and 9 take a card only when every claim the model drafted
 * is supported with a quote. All with a stand-in for the AI service: no call
 * leaves the test.
 */
import { describe, expect, it } from 'vitest';
import { makeCalculator } from '../../src/calc/engine';
import { CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import type { RawAnalysis, RawItem } from '../../src/ai/analysis/contract';
import { analyseModule, casePayloadFor } from '../../src/ai/analysis/run';
import { verifyCardClaims, verifyDraft } from '../../src/ai/verification/draft';
import { AiError } from '../../src/ai/client';
import { claimsValue, parseClaims } from '../../src/domain/card-data';
import { deriveForm } from '../../src/domain/form/derive';
import { buildCard, cardFormStatus } from '../../src/domain/problem-card';
import { claimKey, draftStatements, indexVerdicts, passesDraftGate } from '../../src/domain/verdicts';
import { newCase, newSession, standInVerifier } from './helpers';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'test' })]));

async function setup(kind: 'teaching' | 'clinical' = 'teaching') {
  const ctx = await newSession({ calculators: ALL_VALID });
  const c = await newCase(ctx.store, {
    kind,
    ageYears: 70,
    sex: 'M',
    heightCm: 175,
    admissionDay0: '2026-10-13',
    ...(kind === 'clinical' ? { identifiers: { patientName: 'Saleh Qaid', mrn: 'MRN-77120', roomBed: 'Bed 14', consultantName: 'Dr Hamdan Saif' } } : {}),
  } as never);
  const s = ctx.store;
  await s.addEntry(c.id, { type: 'weight', hospitalDay: 0, payload: { value: 70, unit: 'kg', method: 'measured' } });
  const scr = await s.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.4 }, unit: 'mg/dL' } });
  await s.addEntry(c.id, {
    type: 'med_start',
    hospitalDay: 0,
    payload: { medId: 'med-enox', drug: 'enoxaparin', dose: { kind: 'structured', value: 40, unit: 'mg' }, route: 'SC', frequency: 'once daily', indication: 'VTE prophylaxis' },
  });
  await s.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'hpi', text: 'Leg swelling for two days. Seen by Dr Hamdan Saif.' } });
  await s.updateAiSettings({ models: { analyse: 'model-y', verify: 'verifier-stand-in' } });
  return { ...ctx, c, scr };
}

/** A stand-in relay: the drafting call gets `draft`; every verification call goes to `verifier`. */
function relay(draft: RawAnalysis, verifier = standInVerifier()) {
  const f = (async (url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as { task: string };
    if (body.task === 'verify') return verifier.f(url, init);
    return new Response(JSON.stringify({ output: draft, usage: { inputTokens: 1000, outputTokens: 300, costUsd: 0.002 }, model: 'model-y', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, verifier };
}

const refOf = async (ctx: Awaited<ReturnType<typeof setup>>, kind: 'entry' | 'medication', label: RegExp) =>
  [...(await casePayloadFor(ctx.store, ctx.c.id, 'plan')).refs].find(([, t]) => t.kind === kind && label.test(t.label))![0];

async function card(ctx: Awaited<ReturnType<typeof setup>>, claims: RawItem['claims']): Promise<RawItem> {
  const scr = await refOf(ctx, 'entry', /Serum creatinine/);
  return {
    register: 'drp',
    fields: [
      { field: 'problem', value: 'Enoxaparin dose not adjusted for kidney function' },
      { field: 'drugs', value: 'enoxaparin' },
      { field: 'pcneProblem', value: 'P2.1' },
      { field: 'pcneType', value: 'potential' },
      { field: 'pcneCauses', value: 'C3.2' },
      { field: 'supporting', value: scr },
      { field: 'priority', value: 'important' },
      { field: 'recommendation', value: 'Discuss renal dosing of enoxaparin with the team.' },
    ],
    claims,
    reason: '',
    basis: 'case_data',
    refs: [scr],
  };
}

async function draftOf(_ctx: Awaited<ReturnType<typeof setup>>, items: RawItem[], extra: Partial<RawAnalysis['tasks'][number]> = {}) {
  return { tasks: [{ taskId: 't05', summary: '', checks: [], items, missingData: [], questions: [], ...extra }] } satisfies RawAnalysis;
}

const deps = (f: typeof fetch) => ({ fetch: f, online: () => true });

describe('the verifier after a draft', () => {
  it('records a verdict for every statement that rests on case data, tied to its words and sources, and audits the run without the text', async () => {
    const ctx = await setup();
    const scr = await refOf(ctx, 'entry', /Serum creatinine/);
    const raw = await draftOf(ctx, [await card(ctx, [{ text: 'Serum creatinine is 2.4 mg/dL on Day 1.', basis: 'case_data', refs: [scr] }])], {
      summary: 'Creatinine 2.4 mg/dL on Day 1 while enoxaparin 40 mg once daily is ordered.',
      missingData: ['Urine output'],
    });
    const r = relay(raw);
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    const out = await verifyDraft(ctx.store, ctx.c.id, a.id, deps(r.f));
    expect(out.checked).toBe(2); // the card's claim and the summary; missing data is not a claim
    expect(out.records.map((x) => [x.origin.kind === 'suggestion' && x.origin.part, x.verdict])).toEqual([
      [{ claim: 0 }, 'supported'],
      ['text', 'supported'],
    ]);
    const claim = out.records[0]!;
    expect(claim.quotes[0]!.source).toBe('Serum creatinine: 2.4 mg/dL — Day 1');
    expect(claim.model).toBe('verifier-stand-in');
    expect(claim.promptVersion).toBe('verify-v2');
    const item = a.suggestions.find((s) => s.kind === 'item')!;
    const [c0] = parseClaims(item.fields!.claims);
    expect(claim.key).toBe(claimKey(c0!.text, [`entry:${ctx.scr.id}`]));
    // The summary was checked against the whole case that was sent.
    const summaryRequest = JSON.parse(r.verifier.bodies.at(-1)!.parts[1]!.text) as { claims: { text: string; sources: string[] }[] };
    expect(summaryRequest.claims.at(-1)!.sources.length).toBeGreaterThan(3);
    const audit = (await ctx.store.listAudit(ctx.c.id)).find((e) => e.entity === 'claim_check')!;
    expect(audit.diff).toMatchObject({ statements: 2, supported: 2, promptVersion: 'verify-v2', models: ['verifier-stand-in'] });
    expect(JSON.stringify(audit.diff)).not.toContain('creatinine');
  });

  it('masks an identifier typed into the record before the verifier sees it (clinical case)', async () => {
    const ctx = await setup('clinical');
    const raw = await draftOf(ctx, [], { summary: 'Leg swelling for two days, seen by Dr Hamdan Saif.' });
    const r = relay(raw);
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    await verifyDraft(ctx.store, ctx.c.id, a.id, deps(r.f));
    expect(r.verifier.bodies.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.verifier.bodies)).not.toMatch(/Hamdan|Saleh|MRN-77120|Bed 14/);
  });

  it('a batch the service cannot answer leaves its statements not checked, with the reason; checked again, they get their verdict', async () => {
    const ctx = await setup();
    const scr = await refOf(ctx, 'entry', /Serum creatinine/);
    const raw = await draftOf(ctx, [await card(ctx, [{ text: 'Serum creatinine is 2.4 mg/dL on Day 1.', basis: 'case_data', refs: [scr] }])]);
    const draftOnly = relay(raw);
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(draftOnly.f));
    const busy = (async () =>
      new Response(JSON.stringify({ error: { code: 'provider_unavailable', message: 'High demand.' } }), { status: 502, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    const failed = await verifyDraft(ctx.store, ctx.c.id, a.id, { fetch: busy, online: () => true, sleep: async () => {} });
    expect(failed.records.map((x) => [x.verdict, x.failure])).toEqual([['not_checked', 'provider_unavailable']]);
    const sg = a.suggestions.find((s) => s.kind === 'item')!;
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, sg.id, { kind: 'accept' })).rejects.toThrow(/verifier/);
    const again = await verifyDraft(ctx.store, ctx.c.id, a.id, deps(standInVerifier().f));
    expect(again.records.map((x) => x.verdict)).toEqual(['supported']);
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, sg.id, { kind: 'accept' })).resolves.toBeTruthy();
  });

  it('without a verification model nothing is checked and nothing is recorded: the refusal is said', async () => {
    const ctx = await setup();
    const scr = await refOf(ctx, 'entry', /Serum creatinine/);
    const r = relay(await draftOf(ctx, [await card(ctx, [{ text: 'Serum creatinine is 2.4 mg/dL on Day 1.', basis: 'case_data', refs: [scr] }])]));
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    await ctx.store.updateAiSettings({ models: { analyse: 'model-y' } });
    const err = await verifyDraft(ctx.store, ctx.c.id, a.id, deps(r.f)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('no_model');
    expect(await ctx.store.listClaimChecks(ctx.c.id)).toEqual([]);
  });
});

describe('the gate on accepting a draft as it is', () => {
  it('only a statement found supported, with a quote, is accepted as it is; partly supported, unsupported, contradicted and general knowledge are edited or rejected', async () => {
    const ctx = await setup();
    const scr = await refOf(ctx, 'entry', /Serum creatinine/);
    const enox = await refOf(ctx, 'medication', /enoxaparin/);
    const raw = await draftOf(ctx, [
      await card(ctx, [{ text: 'Serum creatinine is 2.4 mg/dL on Day 1.', basis: 'case_data', refs: [scr] }]),
      await card(ctx, [{ text: 'Enoxaparin 40 mg once daily is renally cleared.', basis: 'case_data', refs: [enox] }]),
      await card(ctx, [{ text: 'Serum creatinine is normal on Day 1.', basis: 'case_data', refs: [scr] }]),
      await card(ctx, [{ text: 'Enoxaparin accumulates when kidney function is reduced.', basis: 'general_knowledge', refs: [] }]),
    ]);
    // The verifier says supported to the first two (the guard in code holds back "renally cleared", which no source states), and quotes the contradiction of the third.
    const verifier = standInVerifier((c, text) => {
      const q = c.sources.filter((s) => s !== 'H').map((s) => ({ sourceId: s, text: text(s).slice(0, 24) }));
      if (/normal/.test(c.text)) return { claimId: c.id, verdict: 'unsupported', contradicted: true, quotes: q, unsupportedParts: ['normal'] };
      return undefined;
    });
    const r = relay(raw, verifier);
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    const out = await verifyDraft(ctx.store, ctx.c.id, a.id, deps(r.f));
    expect(out.records.map((x) => x.verdict)).toEqual(['supported', 'partial', 'contradicted']);
    const cards = a.suggestions.filter((s) => s.kind === 'item');
    const { byOrigin } = indexVerdicts(await ctx.store.listClaimChecks(ctx.c.id));
    expect(cards.map((s) => passesDraftGate(s, a.id, byOrigin))).toEqual([true, false, false, false]);
    expect(draftStatements(cards[3]!)[0]).toMatchObject({ checkable: false });

    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, cards[0]!.id, { kind: 'accept' })).resolves.toBeTruthy();
    for (const s of cards.slice(1)) await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, s.id, { kind: 'accept' })).rejects.toThrow(/verifier/);
    // Kept for more evidence: allowed — the card waits, out of the form.
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, cards[3]!.id, { kind: 'needs_evidence', reason: 'Find a source for the accumulation' })).resolves.toBeTruthy();
    // Edited in the trainee's own words: allowed.
    const own = parseClaims(cards[2]!.fields!.claims).map((c) => ({ ...c, text: 'Serum creatinine is 2.4 mg/dL on Day 1.' }));
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, cards[2]!.id, { kind: 'edit', fields: { ...cards[2]!.fields!, claims: claimsValue(own) } })).resolves.toBeTruthy();
  });

  it('a note listing missing data or a question is not a claim; a summary is', async () => {
    const ctx = await setup();
    const r = relay(await draftOf(ctx, [], { summary: 'Creatinine 2.4 mg/dL on Day 1.', missingData: ['Urine output'], questions: ['Has the team reviewed the dose?'] }));
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    const [summary, missing, question] = a.suggestions;
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, missing!.id, { kind: 'accept' })).resolves.toBeTruthy();
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, question!.id, { kind: 'accept' })).resolves.toBeTruthy();
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, summary!.id, { kind: 'accept' })).rejects.toThrow(/verifier/);
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, summary!.id, { kind: 'edit', text: 'Creatinine 2.4 mg/dL on Day 1.' })).rejects.toThrow(/Nothing was changed/);
    await verifyDraft(ctx.store, ctx.c.id, a.id, deps(r.f));
    await expect(ctx.store.decideSuggestion(ctx.c.id, a.id, summary!.id, { kind: 'accept' })).resolves.toBeTruthy();
  });
});

describe('the gate on the department form (Sections 8 and 9)', () => {
  async function acceptedCard(claimText = 'Serum creatinine is 2.4 mg/dL on Day 1.') {
    const ctx = await setup();
    const scr = await refOf(ctx, 'entry', /Serum creatinine/);
    const r = relay(await draftOf(ctx, [await card(ctx, [{ text: claimText, basis: 'case_data', refs: [scr] }])]));
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    await verifyDraft(ctx.store, ctx.c.id, a.id, deps(r.f));
    const sg = a.suggestions.find((s) => s.kind === 'item')!;
    await ctx.store.decideSuggestion(ctx.c.id, a.id, sg.id, { kind: 'accept' });
    const item = (await ctx.store.listItems(ctx.c.id)).find((i) => i.register === 'drp')!;
    return { ...ctx, a, item, r };
  }

  it('takes a card whose drafted claims are supported with a quote, and shows the verdict on the card', async () => {
    const { store, c, item } = await acceptedCard();
    const ctx = await store.cardContext(c.id);
    expect(cardFormStatus(item, ctx).section8).toBeUndefined();
    const model = buildCard(item, ctx);
    expect(model.claims[0]!.verdict).toMatchObject({ verdict: 'supported', quotes: [expect.objectContaining({ source: 'Serum creatinine: 2.4 mg/dL — Day 1' })] });
    expect(parseClaims(item.fields.claims)[0]!.by).toBe('model');
  });

  it('a drafted claim with no verdict keeps the card out and from being accepted; once checked on request and supported, the card is accepted and enters', async () => {
    const ctx = await setup();
    const scr = await refOf(ctx, 'entry', /Serum creatinine/);
    const r = relay(await draftOf(ctx, [await card(ctx, [{ text: 'Serum creatinine is 2.4 mg/dL on Day 1.', basis: 'case_data', refs: [scr] }])]));
    const a = await analyseModule(ctx.store, ctx.c.id, 'plan', deps(r.f));
    // Kept for more evidence without any check: allowed, and out of the form.
    const sg = a.suggestions.find((s) => s.kind === 'item')!;
    await ctx.store.decideSuggestion(ctx.c.id, a.id, sg.id, { kind: 'needs_evidence', reason: 'Check the claim first' });
    const item = (await ctx.store.listItems(ctx.c.id)).find((i) => i.register === 'drp')!;
    expect(cardFormStatus(item, await ctx.store.cardContext(ctx.c.id)).section8).toBe('needs_evidence');
    // Accepting it now would let an unchecked drafted claim in: refused.
    await expect(ctx.store.reviewCard(ctx.c.id, item.id, { decision: 'accepted', withPreceptor: true })).rejects.toThrow(/verifier/);
    await ctx.store.reviewCard(ctx.c.id, item.id, { decision: 'needs_senior_review', reason: 'Is a dose reduction right?' });
    expect(cardFormStatus(item, await ctx.store.cardContext(ctx.c.id)).section8).toBe('needs_senior_review');
    const out = await verifyCardClaims(ctx.store, ctx.c.id, item.id, deps(r.f));
    expect(out.records.map((x) => x.verdict)).toEqual(['supported']);
    await ctx.store.reviewCard(ctx.c.id, item.id, { decision: 'accepted', withPreceptor: true });
    expect(cardFormStatus(item, await ctx.store.cardContext(ctx.c.id)).section8).toBeUndefined();
    // And a drafted claim whose words are not the ones checked has no verdict: it keeps the card out.
    const other = { ...item, fields: { ...item.fields, claims: claimsValue(parseClaims(item.fields.claims).map((x) => ({ ...x, text: 'Serum creatinine was 2.4 mg/dL.' }))) } };
    expect(cardFormStatus(other, await ctx.store.cardContext(ctx.c.id)).section8).toBe('claims_not_verified');
  });

  it('a claim the trainee rewrites is theirs: not gated, checked on request, its verdict shown', async () => {
    const { store, c, item } = await acceptedCard();
    const rewritten = parseClaims(item.fields.claims).map((x) => ({ ...x, text: 'Creatinine of 2.4 mg/dL on Day 1, from the lab.' }));
    await store.updateItem(c.id, item.id, { ...item.fields, claims: claimsValue(rewritten) }, undefined, { decision: 'edited' });
    const saved = (await store.listItems(c.id)).find((i) => i.id === item.id)!;
    expect(parseClaims(saved.fields.claims)[0]!.by).toBeUndefined();
    let ctx = await store.cardContext(c.id);
    expect(cardFormStatus(saved, ctx).section8).toBeUndefined(); // the trainee's own claim is not gated
    expect(buildCard(saved, ctx).claims[0]!.verdict).toBeUndefined();
    // Restoring the model's words makes it the model's again: an editor cannot launder a drafted claim.
    const restored = parseClaims(saved.fields.claims).map((x) => ({ ...x, text: 'Serum creatinine is 2.4 mg/dL on Day 1.', by: undefined }));
    await store.updateItem(c.id, item.id, { ...saved.fields, claims: claimsValue(restored) }, undefined, { decision: 'edited' });
    const back = (await store.listItems(c.id)).find((i) => i.id === item.id)!;
    expect(parseClaims(back.fields.claims)[0]!.by).toBe('model');
    // Checked on request: the trainee's claims of a card, against the current data.
    await store.updateItem(c.id, item.id, { ...back.fields, claims: claimsValue(rewritten) }, undefined, { decision: 'edited' });
    const out = await verifyCardClaims(store, c.id, item.id, deps(standInVerifier().f));
    expect(out.records.map((x) => [x.origin, x.verdict])).toEqual([[{ kind: 'card', itemId: item.id, claim: 0 }, 'supported']]);
    ctx = await store.cardContext(c.id);
    const latest = (await store.listItems(c.id)).find((i) => i.id === item.id)!;
    expect(buildCard(latest, ctx).claims[0]!.verdict?.verdict).toBe('supported');
    // Nothing left to check: no call.
    const none = standInVerifier();
    expect((await verifyCardClaims(store, c.id, item.id, deps(none.f))).checked).toBe(0);
    expect(none.bodies).toEqual([]);
  });

  it('the trainee cannot mark their own claim as the model’s, nor a card they wrote as drafted', async () => {
    const ctx = await setup();
    const own = await ctx.store.addItem(ctx.c.id, 'drp', {
      problem: 'Enoxaparin dose not adjusted for kidney function',
      drugs: 'enoxaparin',
      pcneProblem: 'P2.1',
      pcneType: 'potential',
      pcneCauses: 'C3.2',
      priority: 'important',
      supporting: `e:${ctx.scr.id}`,
      claims: claimsValue([{ text: 'Serum creatinine is 2.4 mg/dL on Day 1.', source: 'entry', ref: ctx.scr.id, by: 'model' }]),
    });
    expect(parseClaims(own.fields.claims)[0]!.by).toBeUndefined();
  });

  it('Sections 8 and 9 leave out a card whose drafted claim is not supported, and say why', async () => {
    const { store, c, item } = await acceptedCard();
    const entries = await store.listEntries(c.id);
    const cardCtx = await store.cardContext(c.id);
    const base = { case: (await store.getCase(c.id))!, entries, items: await store.listItems(c.id), reviews: await store.listCardReviews(c.id), mode: 'teaching' as const };
    const withVerdicts = deriveForm({ ...base, ...(cardCtx.verdicts ? { verdicts: cardCtx.verdicts } : {}) });
    const s8 = withVerdicts.sections.find((s) => s.number === 8)!;
    expect(s8.excluded ?? []).toEqual([]);
    // Without the verdicts (as if never checked): left out, with the reason.
    const without = deriveForm(base);
    const s8b = without.sections.find((s) => s.number === 8)!;
    expect(s8b.excluded).toEqual([expect.objectContaining({ itemId: item.id, reason: 'claims_not_verified' })]);
  });
});

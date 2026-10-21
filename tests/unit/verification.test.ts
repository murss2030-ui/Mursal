/**
 * The verifier pass (Section 12, check 4), prepared for M5: the request it
 * sends, and the checks in code on its answer — a quote must be copied from a
 * source the claim cites, an unsupported part from the claim, and a verdict
 * the verifier cannot show is not kept. Section 21's hostile fixtures that
 * concern it: a paraphrased quote fails the literal check; a source id that
 * was never sent is caught; a statement with no source is unsupported.
 */
import { describe, expect, it } from 'vitest';
import { analysisSchema, type RawAnalysis } from '../../src/ai/analysis/contract';
import { buildCasePayload } from '../../src/ai/analysis/payload';
import { verifyAnalysis } from '../../src/ai/analysis/verify';
import { AiError } from '../../src/ai/client';
import type { ModelResponse } from '../../src/ai/protocol';
import { isOutputSchema, validateOutput } from '../../src/ai/schema';
import { checkVerification, normalizeForMatch, passesVerifier } from '../../src/ai/verification/check';
import { claimsFromSuggestions } from '../../src/ai/verification/claims';
import { VERIFY_PROMPT_VERSION, VERIFY_SYSTEM, verificationSchema, type RawVerdict, type RawVerification, type VerifyInput } from '../../src/ai/verification/contract';
import { batches, verifyClaims, VERIFY_BATCH } from '../../src/ai/verification/run';
import { numbersInText } from '../../src/domain/numbers';
import { MODULE_BY_ID } from '../../src/domain/workflow/catalogue';
import { BENCH_ITEMS, BENCH_SOURCES } from '../fixtures/semantic-benchmark';
import { newCase, newSession } from './helpers';

const INPUT: VerifyInput = {
  sources: [
    { id: 'S1', label: 'Creatinine Day 0', text: 'Day 0 Serum creatinine: 2.1 mg/dL' },
    { id: 'S2', label: 'Creatinine Day 1', text: 'Day 1 Serum creatinine:   2.6 mg/dL' },
    { id: 'S3', label: 'Passage', text: 'In patients with severe renal impairment (creatinine clearance below 30 mL/min), the recommended prophylactic dose is 30 mg once daily — “by subcutaneous injection”.' },
  ],
  claims: [
    { id: 'V1', text: 'Serum creatinine rose from 2.1 to 2.6 mg/dL.', sourceIds: ['S1', 'S2'] },
    { id: 'V2', text: 'Below a clearance of 30 mL/min the prophylactic dose is 30 mg once daily.', sourceIds: ['S3'] },
    { id: 'V3', text: 'Enoxaparin accumulates in renal impairment.', sourceIds: [] },
  ],
};

const answer = (x: Partial<RawVerdict> & Pick<RawVerdict, 'claimId' | 'verdict'>): RawVerdict => ({ contradicted: false, quotes: [], unsupportedParts: [], ...x });
const check = (...results: RawVerdict[]) => checkVerification({ results }, INPUT);

describe('the verifier’s request', () => {
  it('is a well-formed schema whose claim and source ids are the ones sent', () => {
    const schema = verificationSchema(INPUT);
    expect(isOutputSchema(schema)).toBe(true);
    const ok: RawVerification = { results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S1', text: '2.1 mg/dL' }] })] };
    expect(validateOutput(ok, schema)).toEqual([]);
    // A source id that was never sent is refused by the schema check (Section 21: a fabricated identifier is caught).
    const forged = { results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S9', text: '2.1 mg/dL' }] })] };
    expect(validateOutput(forged, schema)).toEqual([{ path: '$.results[0].quotes[0].sourceId', problem: 'not an allowed value' }]);
    expect(VERIFY_PROMPT_VERSION).toBe('verify-v2');
    expect(VERIFY_SYSTEM).toMatch(/never from your own knowledge/);
    expect(VERIFY_SYSTEM).toMatch(/Judge meaning, not shared words or numbers/);
    // v2: what the live probe saw let through — each named as an assertion of its own.
    for (const word of ['nephrotoxic', 'currently', 'increased', 'for the management of', 'not ordered', 'requires']) expect(VERIFY_SYSTEM).toContain(word);
  });

  it('lets a claim that cites many sources be shown by a quote from each', () => {
    const sources = Array.from({ length: 9 }, (_, i) => ({ id: `S${i + 1}`, label: `Order ${i + 1}`, text: `drug ${i + 1} 10 mg PO once daily for an indication` }));
    const input: VerifyInput = { sources, claims: [{ id: 'V1', text: 'Every order states its indication.', sourceIds: sources.map((s) => s.id) }] };
    const output = { results: [answer({ claimId: 'V1', verdict: 'supported', quotes: sources.map((s) => ({ sourceId: s.id, text: s.text })) })] };
    expect(validateOutput(output, verificationSchema(input))).toEqual([]);
  });

  it('sends only the sources its claims cite, in batches, never the labels; a claim with no source is not sent', () => {
    const many: VerifyInput = {
      sources: INPUT.sources,
      claims: Array.from({ length: VERIFY_BATCH + 3 }, (_, i) => ({ id: `V${i + 1}`, text: `Claim ${i + 1}`, sourceIds: i % 2 ? ['S1'] : ['S2'] })),
    };
    const b = batches({ ...many, claims: [...many.claims, { id: 'V99', text: 'No source', sourceIds: [] }] });
    expect(b.map((x) => x.claims.length)).toEqual([VERIFY_BATCH, 3]);
    expect(b[1]!.sources.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(b.flatMap((x) => x.claims.map((c) => c.id))).not.toContain('V99');
  });
});

describe('the verifier’s answer, checked in code', () => {
  it('keeps a supported verdict only with a quote found word for word in the claim’s own source', () => {
    const [v1] = check(answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S1', text: '2.1 mg/dL' }, { sourceId: 'S2', text: 'Serum creatinine: 2.6 mg/dL' }] }));
    expect(v1).toMatchObject({ verdict: 'supported', flags: [] });
    // Whitespace, quotation marks and dashes are encoding, not meaning.
    expect(v1!.quotes).toEqual([
      { sourceId: 'S1', text: '2.1 mg/dL' },
      { sourceId: 'S2', text: 'Serum creatinine: 2.6 mg/dL' },
    ]);
    const [, v2] = check(answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S1', text: '2.1' }] }), answer({ claimId: 'V2', verdict: 'supported', quotes: [{ sourceId: 'S3', text: '30 mg once daily - "by subcutaneous injection"' }] }));
    expect(v2).toMatchObject({ verdict: 'supported' });
    expect(passesVerifier(v2!)).toBe(true);
  });

  it('Section 21: a quote that paraphrases its source fails the literal check, and the claim is unsupported', () => {
    const [, v] = check(answer({ claimId: 'V2', verdict: 'supported', quotes: [{ sourceId: 'S3', text: 'below 30 mL/min the prophylactic dose is 30 mg daily' }] }));
    expect(v).toMatchObject({ verdict: 'unsupported', quotes: [], flags: ['quote_not_found', 'support_not_shown'] });
    expect(passesVerifier(v!)).toBe(false);
  });

  it('a claim that cites data is not shown supported by a quote from the case header alone', () => {
    const withHeader: VerifyInput = {
      sources: [{ id: 'H', label: 'Case header', text: 'Case: {"age":67,"sex":"M"}', context: true }, ...INPUT.sources],
      claims: [{ id: 'V1', text: 'A 67-year-old man whose creatinine rose from 2.1 to 2.6 mg/dL.', sourceIds: ['H', 'S1', 'S2'] }],
    };
    const [headerOnly] = checkVerification({ results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'H', text: '"age":67' }] })] }, withHeader);
    expect(headerOnly).toMatchObject({ verdict: 'unsupported', flags: ['support_not_shown'] });
    const [both] = checkVerification({ results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'H', text: '"age":67' }, { sourceId: 'S2', text: 'Serum creatinine: 2.6 mg/dL' }] })] }, withHeader);
    expect(both).toMatchObject({ verdict: 'supported', flags: [] });
    // A contradiction shown by the header is still one (a wrong age).
    const wrongAge = { ...withHeader, claims: [{ ...withHeader.claims[0]!, text: 'A 45-year-old man whose creatinine rose from 2.1 to 2.6 mg/dL.' }] };
    const [contradicted] = checkVerification({ results: [answer({ claimId: 'V1', verdict: 'partial', contradicted: true, quotes: [{ sourceId: 'H', text: '"age":67' }] })] }, wrongAge);
    expect(contradicted).toMatchObject({ verdict: 'contradicted', flags: ['support_not_shown'] });
  });

  it('a verifier that also quotes a source the claim does not cite judged it on outside material: at most partly supported', () => {
    // Live probe, 20 October 2026: "Serum creatinine increased from 2.1 mg/dL to 2.6 mg/dL" citing only the Day 0 value.
    const oneSource: VerifyInput = { sources: INPUT.sources, claims: [{ id: 'V1', text: 'Serum creatinine increased from 2.1 mg/dL to 2.6 mg/dL.', sourceIds: ['S1'] }] };
    const [v] = checkVerification(
      { results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S1', text: 'Serum creatinine: 2.1 mg/dL' }, { sourceId: 'S2', text: 'Serum creatinine: 2.6 mg/dL' }] })] },
      oneSource,
    );
    // The guard sees it too: a rise with one of its two values in the cited source.
    expect(v).toMatchObject({ verdict: 'partial', quotes: [{ sourceId: 'S1', text: 'Serum creatinine: 2.1 mg/dL' }], flags: ['quote_from_other_source', 'unsourced_assertion'] });
  });

  it('a quote from a source the claim does not cite is not its support; a two-letter quote proves nothing', () => {
    const [v1] = check(answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S3', text: 'renal impairment' }, { sourceId: 'S1', text: 'mg' }] }));
    expect(v1).toMatchObject({ verdict: 'unsupported', flags: ['quote_from_other_source', 'quote_not_found', 'support_not_shown'] });
  });

  it('keeps the unsupported parts copied from the claim; a supported verdict that names one is partial', () => {
    const [, v] = check(
      answer({ claimId: 'V2', verdict: 'supported', quotes: [{ sourceId: 'S3', text: 'the recommended prophylactic dose is 30 mg once daily' }], unsupportedParts: ['Below a clearance of 30 mL/min', 'for every patient'] }),
    );
    expect(v).toMatchObject({ verdict: 'partial', unsupportedParts: ['Below a clearance of 30 mL/min'], flags: ['part_not_in_claim'] });
  });

  it('a contradiction is reported only when the verifier quotes it', () => {
    const [shown] = check(answer({ claimId: 'V1', verdict: 'unsupported', contradicted: true, quotes: [{ sourceId: 'S2', text: 'Day 1 Serum creatinine: 2.6 mg/dL' }] }));
    expect(shown).toMatchObject({ verdict: 'contradicted', answered: { verdict: 'unsupported', contradicted: true } });
    const [unshown] = check(answer({ claimId: 'V1', verdict: 'partial', contradicted: true }));
    expect(unshown).toMatchObject({ verdict: 'unsupported', flags: ['support_not_shown', 'contradiction_not_shown'] });
  });

  it('Section 21: a statement with no source is unsupported without asking; a claim left unanswered is "not checked"; two answers keep the less favourable', () => {
    const verdicts = check(answer({ claimId: 'V2', verdict: 'supported', quotes: [{ sourceId: 'S3', text: 'creatinine clearance below 30 mL/min' }] }), answer({ claimId: 'V2', verdict: 'partial', contradicted: true, quotes: [{ sourceId: 'S3', text: '30 mg once daily' }] }));
    expect(verdicts.map((v) => v.verdict)).toEqual(['not_checked', 'contradicted', 'unsupported']);
    expect(verdicts[0]!.flags).toEqual(['no_answer']);
    expect(verdicts[1]!.flags).toEqual(['answered_twice']);
    expect(verdicts[2]!.flags).toEqual(['no_source']);
    expect(normalizeForMatch(' a  “b” – c ')).toBe('a "b" - c');
  });
});

// ---------------------------------------------------------------- through callModel, with a stand-in for the relay

function relay(output: (body: Record<string, any>) => unknown) {
  const bodies: Record<string, any>[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    return new Response(JSON.stringify({ output: output(body), usage: { inputTokens: 900, outputTokens: 200, costUsd: 0.0006 }, model: 'verifier-test', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 1 } } satisfies ModelResponse), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { f, bodies };
}

async function session() {
  const ctx = await newSession();
  const c = await newCase(ctx.store, { ageYears: 67, sex: 'M', heightCm: 170, admissionDay0: '2026-10-10' });
  await ctx.store.updateAiSettings({ models: { analyse: 'drafter-test', verify: 'verifier-test' } });
  return { ...ctx, c };
}

describe('verifying claims through callModel (task "verify")', () => {
  it('sends the claims and their sources only, checks the answer and audits the call', async () => {
    const { store, c } = await session();
    const { f, bodies } = relay(() => ({
      results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S1', text: 'Serum creatinine: 2.1 mg/dL' }] }), answer({ claimId: 'V2', verdict: 'partial', quotes: [{ sourceId: 'S3', text: 'invented words' }] })],
    }));
    const run = await verifyClaims(store, { caseId: c.id, caseKind: 'teaching' }, INPUT, { fetch: f, online: () => true });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.task).toBe('verify');
    expect(bodies[0]!.model).toBe('verifier-test');
    const sent = JSON.parse(bodies[0]!.parts[1].text);
    expect(sent.claims.map((x: { id: string }) => x.id)).toEqual(['V1', 'V2']);
    expect(JSON.stringify(sent)).not.toMatch(/Creatinine Day 0|Passage/); // labels stay on the device
    expect(run.verdicts.map((v) => [v.claimId, v.verdict])).toEqual([
      ['V1', 'supported'],
      ['V2', 'unsupported'],
      ['V3', 'unsupported'],
    ]);
    expect(run.calls).toEqual([{ model: 'verifier-test', usage: { inputTokens: 900, outputTokens: 200, costUsd: 0.0006 }, claims: 2, claimIds: ['V1', 'V2'] }]);
    expect(run.failures).toEqual([]);
    const audit = (await store.listAudit(c.id)).filter((e) => e.entity === 'model_call');
    expect(audit.map((e) => e.diff)).toEqual([expect.objectContaining({ task: 'verify', promptVersion: 'verify-v2', outcome: 'ok' })]);
  });

  it('a batch the service could not answer leaves its claims "not checked" and keeps the others; a budget refusal stops the run', async () => {
    const { store, c } = await session();
    const many: VerifyInput = {
      sources: INPUT.sources,
      claims: Array.from({ length: VERIFY_BATCH + 2 }, (_, i) => ({ id: `V${i + 1}`, text: 'Serum creatinine rose from 2.1 to 2.6 mg/dL.', sourceIds: ['S1', 'S2'] })),
    };
    let n = 0;
    const flaky = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      // The first batch meets "high demand" twice (the call and its one retry); the second is answered.
      if (++n <= 2) return new Response(JSON.stringify({ error: { code: 'provider_unavailable', message: 'High demand.' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      const ids = (JSON.parse(body.parts[1].text) as { claims: { id: string }[] }).claims.map((x) => x.id);
      const output = { results: ids.map((id) => answer({ claimId: id, verdict: 'supported', quotes: [{ sourceId: 'S1', text: '2.1 mg/dL' }] })) };
      return new Response(JSON.stringify({ output, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: 'verifier-test', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const run = await verifyClaims(store, { caseId: c.id, caseKind: 'teaching' }, many, { fetch: flaky, online: () => true, sleep: async () => undefined });
    expect(run.verdicts.slice(0, VERIFY_BATCH).every((v) => v.verdict === 'not_checked')).toBe(true);
    expect(run.verdicts.slice(VERIFY_BATCH).every((v) => v.verdict === 'supported')).toBe(true);
    expect(run.failures).toEqual([{ claimIds: many.claims.slice(0, VERIFY_BATCH).map((x) => x.id), code: 'provider_unavailable', message: 'High demand.' }]);

    const broke = (async () => new Response(JSON.stringify({ error: { code: 'budget_exhausted', message: 'Budget used up.' } }), { status: 402, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    await expect(verifyClaims(store, { caseId: c.id, caseKind: 'teaching' }, many, { fetch: broke, online: () => true })).rejects.toMatchObject({ code: 'budget_exhausted' });
  });

  it('a batch the chosen model cannot answer goes to the trainee\'s fallback models, in order', async () => {
    const { store, c } = await session();
    await store.updateAiSettings({ models: { analyse: 'drafter-test', verify: 'verifier-a' }, fallbacks: { verify: 'verifier-b, verifier-c' } });
    expect((await store.getAiSettings()).fallbacks).toEqual({ verify: ['verifier-b', 'verifier-c'] });
    const tried: string[] = [];
    const busyThenOk = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      tried.push(body.model);
      if (body.model !== 'verifier-c') return new Response(JSON.stringify({ error: { code: body.model === 'verifier-a' ? 'provider_quota_exhausted' : 'model_unavailable', message: 'No.' } }), { status: 429, headers: { 'content-type': 'application/json' } });
      const output = { results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S1', text: 'Serum creatinine: 2.1 mg/dL' }, { sourceId: 'S2', text: 'Serum creatinine: 2.6 mg/dL' }] })] };
      return new Response(JSON.stringify({ output, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: 'verifier-c', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const run = await verifyClaims(store, { caseId: c.id, caseKind: 'teaching' }, { sources: INPUT.sources, claims: [INPUT.claims[0]!] }, { fetch: busyThenOk, online: () => true, sleep: async () => undefined });
    expect(tried).toEqual(['verifier-a', 'verifier-b', 'verifier-c']);
    expect(run.verdicts.map((v) => v.verdict)).toEqual(['supported']);
    expect(run.calls.map((x) => x.model)).toEqual(['verifier-c']);
    expect(run.failures).toEqual([]);
    // At most three fallbacks; each an allowed model id.
    await expect(store.updateAiSettings({ models: { verify: 'a' }, fallbacks: { verify: 'b, c, d, e' } })).rejects.toMatchObject({ errors: { fallback_verify: 'tooMany' } });
    await expect(store.updateAiSettings({ models: { verify: 'a' }, fallbacks: { verify: 'not a model' } })).rejects.toMatchObject({ errors: { fallback_verify: 'modelId' } });
  });

  it('Section 21: an answer citing a source id that was never sent is refused whole: its claims are not checked', async () => {
    const { store, c } = await session();
    const { f } = relay(() => ({ results: [answer({ claimId: 'V1', verdict: 'supported', quotes: [{ sourceId: 'S7', text: 'Serum creatinine: 2.1 mg/dL' }] })] }));
    const run = await verifyClaims(store, { caseId: c.id, caseKind: 'teaching' }, INPUT, { fetch: f, online: () => true });
    expect(run.verdicts.map((v) => v.verdict)).toEqual(['not_checked', 'not_checked', 'unsupported']);
    expect(run.failures).toEqual([expect.objectContaining({ claimIds: ['V1', 'V2'], code: 'invalid_shape' } satisfies Partial<AiError & { claimIds: string[] }>)]);
    const audit = (await store.listAudit(c.id)).filter((e) => e.entity === 'model_call');
    expect(audit.map((e) => (e.diff as { outcome: string }).outcome)).toEqual(['invalid_shape']);
  });
});

// ---------------------------------------------------------------- the statements of a drafted module

describe('the statements of a drafted module that rest on case data', () => {
  it('become claims with the data they cite and the case header; general knowledge, missing data and questions are not sent; a summary is checked against the whole case', async () => {
    const { store, c } = await session();
    const scr = await store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.6 }, unit: 'mg/dL' } });
    await store.addEntry(c.id, {
      type: 'med_start',
      hospitalDay: 0,
      payload: { medId: 'med-enox', drug: 'enoxaparin', dose: { kind: 'structured', value: 40, unit: 'mg' }, route: 'SC', frequency: 'once daily', indication: 'VTE prophylaxis' },
    });
    const module = MODULE_BY_ID.get('plan')!;
    const p = buildCasePayload({ case: (await store.getCase(c.id))!, entries: await store.listEntries(c.id), items: [], tasks: [], module, today: '2026-10-12' });
    const e = [...p.refs].find(([, t]) => t.kind === 'entry')![0];
    const m = [...p.refs].find(([, t]) => t.kind === 'medication')![0];
    const raw: RawAnalysis = {
      tasks: [
        {
          taskId: 't05',
          summary: 'Creatinine 2.6 mg/dL on Day 1.',
          checks: [],
          items: [
            {
              register: 'drp',
              fields: [
                { field: 'problem', value: 'Enoxaparin not adjusted for kidney function' },
                { field: 'pcneProblem', value: 'P2.1' },
                { field: 'pcneType', value: 'potential' },
                { field: 'pcneCauses', value: 'C3.2' },
                { field: 'priority', value: 'important' },
              ],
              claims: [
                { text: 'Serum creatinine is 2.6 mg/dL on Day 1.', basis: 'case_data', refs: [e] },
                { text: 'Enoxaparin 40 mg SC once daily is ordered.', basis: 'case_data', refs: [m] },
                { text: 'Enoxaparin accumulates in renal impairment.', basis: 'general_knowledge', refs: [] },
              ],
              reason: 'Creatinine has risen while enoxaparin continues.',
              basis: 'case_data',
              refs: [e, m],
            },
          ],
          missingData: ['Urine output'],
          questions: [],
        },
      ],
    };
    expect(validateOutput(raw, analysisSchema(p.tasks))).toEqual([]);
    const { suggestions } = verifyAnalysis(raw, p);
    const { input, origin } = claimsFromSuggestions(suggestions, p);
    expect(input.claims.map((x) => x.text)).toEqual([
      'Creatinine has risen while enoxaparin continues.',
      'Serum creatinine is 2.6 mg/dL on Day 1.',
      'Enoxaparin 40 mg SC once daily is ordered.',
      // M5: the summary, last, against every entry, medication, problem and calculation sent.
      'Creatinine 2.6 mg/dL on Day 1.',
    ]);
    const summary = input.claims[3]!;
    expect(summary.sourceIds.length).toBe(1 + [...p.refs.values()].filter((t) => t.kind !== 'item').length);
    // Every claim may use the case header; each cites the very text the drafting model received.
    expect(input.claims.every((x) => x.sourceIds[0] === 'H')).toBe(true);
    const text = (id: string) => input.sources.find((s) => s.id === id)!.text;
    expect(text(input.claims[1]!.sourceIds[1]!)).toMatch(/Day 1 .*Serum creatinine.*2\.6 mg\/dL/);
    // The medication claim points to the order on the timeline, and is checked against the course as sent.
    expect(text(input.claims[2]!.sourceIds[1]!)).toMatch(/^enoxaparin 40 mg SC once daily from Day 0 active for VTE prophylaxis$/);
    expect(text('H')).toMatch(/"age":67/);
    expect([...origin.values()].map((o) => o.part)).toEqual(['reason', { claim: 0 }, { claim: 1 }, 'text']);
    expect(scr.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------- the benchmark

describe('the semantic benchmark (M5 preparation)', () => {
  const ids = new Set(BENCH_SOURCES.map((s) => s.id));
  const numbers = (s: string) => new Set(numbersInText(s));

  it('is well formed: unique ids, known sources, valid expected verdicts', () => {
    expect(new Set(BENCH_ITEMS.map((b) => b.id)).size).toBe(BENCH_ITEMS.length);
    for (const b of BENCH_ITEMS) {
      expect(b.sources.every((s) => ids.has(s)), b.id).toBe(true);
      expect(b.expected.length, b.id).toBeGreaterThan(0);
    }
    expect(BENCH_SOURCES.filter((s) => s.id.startsWith('G')).every((s) => s.text.startsWith('Test passage written for the benchmark, not a source for practice'))).toBe(true);
  });

  it('holds claims the number check of M3–M4 lets through although their meaning is wrong: what the verifier is for', () => {
    // Every number of the claim is found in its sources, yet the expected verdict is not "supported".
    const passNumberCheck = BENCH_ITEMS.filter((b) => {
      const src = new Set(b.sources.flatMap((id) => [...numbers(BENCH_SOURCES.find((s) => s.id === id)!.text)]));
      return [...numbers(b.claim)].every((n) => src.has(n)) && !b.expected.includes('supported');
    }).map((b) => b.id);
    expect(passNumberCheck).toEqual(expect.arrayContaining(['b02', 'b04', 'b13', 'b17', 'b23', 'b25', 'b35', 'b36', 'b37']));
    expect(passNumberCheck.length).toBeGreaterThanOrEqual(15);
  });

  it('holds an item for each kind of assertion the live probe saw let through (verify-v2)', () => {
    const kinds = new Set(BENCH_ITEMS.map((b) => b.kind));
    for (const k of ['property', 'time', 'change', 'reason', 'absence', 'judgement'] as const) expect(kinds.has(k), k).toBe(true);
    // Among them, the probe's medical error: metformin described as nephrotoxic must never be "supported".
    expect(BENCH_ITEMS.filter((b) => /metformin/i.test(b.claim) && /nephrotoxic/i.test(b.claim)).every((b) => !b.expected.includes('supported'))).toBe(true);
  });
});

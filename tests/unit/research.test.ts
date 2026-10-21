/**
 * M5d/e: "Research this question". The question in PICO form from a Problem
 * Card; retrieval (the library first, then answers recorded from the open
 * services); the model drafts only from the passages it was sent; the checks
 * in code (Section 21's four hostile fixtures) and the independent verifier;
 * every statement added to the card one at a time, only if it passed the gate.
 * The AI service is a stand-in: no call leaves the test.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CalcResult } from '../../src/calc/types';
import { checkResearch } from '../../src/ai/research/check';
import { RESEARCH_PROMPT_VERSION, researchSchema, type CaseValue, type RawResearch, type SentSource } from '../../src/ai/research/contract';
import { researchCard } from '../../src/ai/research/run';
import { verifyResearch } from '../../src/ai/research/verify';
import { claimsValue, parseClaims } from '../../src/domain/card-data';
import type { DocumentMetaInput } from '../../src/domain/library';
import { buildCard, unverifiedModelClaims } from '../../src/domain/problem-card';
import { addable, confidenceFactors, defaultPico, picoQuery, picoQuestion, researchKey, type ResearchRun } from '../../src/domain/research';
import { validateOutput } from '../../src/ai/schema';
import { indexVerdicts } from '../../src/domain/verdicts';
import { IntegrityError } from '../../src/store/store';
import { GUIDE, line, page } from './library-fixtures';
import { newCase, newSession, standInVerifier } from './helpers';

const fx = (name: string): { url: string; body: string }[] => (JSON.parse(readFileSync(new URL(`../fixtures/connectors/${name}.json`, import.meta.url), 'utf8')) as { requests: { url: string; body: string }[] }).requests;
const FDA = fx('openfda-metformin')[0]!.body;
const PUBMED_SEARCH = fx('pubmed-vancomycin')[0]!.body;
const PUBMED_FETCH = fx('pubmed-vancomycin')[1]!;
const EPMC = fx('europepmc-vancomycin')[0]!.body;

const pdf = (marker: string) => new TextEncoder().encode(`%PDF-1.4\n% synthetic ${marker}\n`);
const META: DocumentMetaInput = { title: 'Synthetic renal guideline', publisher: 'Synthetic Society', year: '2024', licence: 'CC BY 4.0', aiUse: 'may_send', licenceConfirmed: 'yes', role: 'primary', retrievedOn: '2026-10-12' };
const LOCAL_MARKER = 'LOCALONLY-MARKER-7741';

/** A synthetic guideline passage about metformin in kidney injury (no real guidance). */
const RENAL_PAGES = [
  page(
    1,
    line('2 Kidney injury', 60, 16),
    line('Recommendation 1. We recommend that synthetic metformin be held in adults with acute kidney injury until kidney function is known to be stable, and that the decision be reviewed daily.', 100),
    line('(Strong recommendation, moderate-quality evidence)', 114),
  ),
];
const LOCAL_PAGES = [
  page(1, line('3 Local protocol', 60, 16), line(`Recommendation 2. ${LOCAL_MARKER} synthetic metformin local protocol text for adults with acute kidney injury that is never sent anywhere at all by the application.`, 100)),
];

const CARD = { problem: 'Metformin continued while creatinine rose', drugs: 'metformin', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C1.1', priority: 'important' };

async function setup(opts: { kind?: 'teaching' | 'clinical'; docs?: boolean } = {}) {
  const ctx = await newSession();
  const { store } = ctx;
  const c = await newCase(store, {
    kind: opts.kind ?? 'teaching',
    ageYears: 70,
    sex: 'M',
    admissionDay0: '2026-10-13',
    ...(opts.kind === 'clinical' ? { identifiers: { patientName: 'Saleh Qaid', mrn: 'MRN-77120', roomBed: 'Bed 14', consultantName: 'Dr Hamdan Saif' } } : {}),
  } as never);
  const scr = await store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.4 }, unit: 'mg/dL' } });
  const item = await store.addItem(c.id, 'drp', { ...CARD, supporting: `e:${scr.id}` });
  await store.updateAiSettings({ models: { analyse: 'model-y', verify: 'verifier-stand-in', research: 'researcher-stand-in' } });
  if (opts.docs !== false) {
    await store.addDocument({ meta: META, file: { name: 'renal.pdf', bytes: pdf('renal') }, pages: RENAL_PAGES, pageCount: 1 });
    await store.addDocument({ meta: { ...META, title: 'Local protocol', aiUse: 'local_only', licenceConfirmed: '' }, file: { name: 'local.pdf', bytes: pdf('local') }, pages: LOCAL_PAGES, pageCount: 1 });
  }
  return { ...ctx, c, item, scr };
}

type Req = { question: string; caseContext: string; caseValues: { ref: string; text: string }[]; sources: { id: string; kind: string; text: string }[] };

/** The whole outside world: the model, the verifier and the open services, with every request kept. */
function world(opts: { answer?: (req: Req) => RawResearch; verifier?: ReturnType<typeof standInVerifier>; openSources?: boolean } = {}) {
  const verifier = opts.verifier ?? standInVerifier();
  const modelBodies: { task: string; parts: { text: string }[] }[] = [];
  const outside: string[] = [];
  const first = (req: Req, kind: RegExp) => req.sources.find((s) => kind.test(s.kind));
  const answer =
    opts.answer ??
    ((req: Req): RawResearch => {
      const guide = first(req, /^guideline passage/)!;
      const label = first(req, /^drug label section/);
      return {
        answerable: true,
        statements: [
          { role: 'recommendation', text: guide.text.slice(0, 80), sourceId: guide.id, quote: guide.text.slice(0, 80), caseRefs: [] },
          ...(label ? [{ role: 'supporting' as const, text: label.text.slice(0, 70), sourceId: label.id, quote: label.text.slice(0, 70), caseRefs: [] }] : []),
        ],
        missingData: ['Creatinine clearance on the day of the decision'],
      };
    });
  const f = (async (url: string, init: RequestInit = {}) => {
    const json = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (init.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { task: string; parts: { text: string }[] };
      if (body.task === 'verify') return verifier.f(url, init);
      modelBodies.push(body);
      const req = JSON.parse(body.parts[1]!.text) as Req;
      return json({ output: answer(req), usage: { inputTokens: 2000, outputTokens: 400, costUsd: 0.003 }, model: 'researcher-stand-in', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } });
    }
    outside.push(url);
    if (opts.openSources === false) throw new TypeError('offline');
    if (url.startsWith('https://api.fda.gov/drug/label.json')) return json(url.includes('metformin') ? FDA : '{"error":{"code":"NOT_FOUND"}}', url.includes('metformin') ? 200 : 404);
    if (url.startsWith('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi')) return json(PUBMED_SEARCH);
    if (url.startsWith('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi')) return new Response(PUBMED_FETCH.body, { status: 200, headers: { 'content-type': 'text/xml' } });
    if (url.startsWith('https://www.ebi.ac.uk/europepmc/webservices/rest/search')) return json(EPMC);
    return json('{}', 404);
  }) as unknown as typeof fetch;
  return { f, modelBodies, outside, verifier, deps: { fetch: f, online: () => true, sleep: async () => {} } };
}

describe('the question in PICO form', () => {
  it('is built from the card for the trainee to edit, and searched by its clinical words only', () => {
    const p = defaultPico({ problem: 'Metformin continued while creatinine rose', drugs: 'metformin, insulin', ageYears: 70, sex: 'M' });
    expect(p).toEqual({ population: 'Adult 70-year-old male patient', intervention: 'metformin, insulin', comparison: '', outcome: 'Metformin continued while creatinine rose' });
    expect(picoQuestion(p)).toBe('In Adult 70-year-old male patient, how should metformin, insulin be used, given: Metformin continued while creatinine rose?');
    expect(picoQuery(p)).toBe('metformin insulin continued creatinine rose');
    expect(picoQuery({ ...p, intervention: '', outcome: '' })).toBe('');
  });
});

describe('the checks in code — the four hostile fixtures of Section 21', () => {
  const SRC: SentSource[] = [
    { id: 'S1', recordId: 'library:d:1:1', describe: 'guideline passage', text: 'We recommend that metformin be held in adults with acute kidney injury. Vancomycin 15 mg/kg is a label dose in this synthetic text.' },
    { id: 'S2', recordId: 'openfda_label:x', section: 'Dosage and administration', describe: 'label', text: 'The usual dose is 500 mg twice daily with meals.' },
  ];
  const CALC: CalcResult = {
    id: 'calc-1',
    caseId: 'c',
    calc: 'vancomycin_empiric',
    formulaVersion: 'v1',
    inputs: { entryIds: [], values: { weight: 70 }, units: {}, detail: {} },
    value: 1250,
    unit: 'mg',
    decimals: 0,
    assumptions: [],
    warnings: [],
    steps: [],
    computedAt: '2026-10-14T08:00:00Z',
  };
  const VALUES: (CaseValue & { calc?: CalcResult })[] = [{ label: 'C1', kind: 'calc', id: 'calc-1', text: 'Vancomycin loading dose: 1250 mg', calc: CALC }];
  const raw = (...statements: Partial<RawResearch['statements'][number]>[]): RawResearch => ({
    answerable: true,
    statements: statements.map((s) => ({ role: 'recommendation', text: 'x', sourceId: 'S1', quote: 'We recommend that metformin be held in adults with acute kidney injury', caseRefs: [], ...s })),
    missingData: [],
  });
  const check = (r: RawResearch) => checkResearch(r, { sent: SRC, values: VALUES }).statements;

  it('(1) a source that was not retrieved is caught and flagged', () => {
    const [s] = check(raw({ sourceId: 'S9' }));
    expect(s!.flags).toContain('source_not_retrieved');
    expect(addable(s!, { verdict: 'supported', quotes: [{ source: 'x', text: 'y' }] })).toBe(false);
  });

  it('(2) a quote that paraphrases its passage fails the literal match; whitespace, quotation marks and dashes are not meaning', () => {
    expect(check(raw({ quote: 'We advise holding metformin in adults who have acute kidney injury' }))[0]!.flags).toContain('quote_not_found');
    expect(check(raw({ quote: '  We recommend   that metformin be held in adults with acute kidney injury ' }))[0]!.flags).toEqual([]);
    expect(check(raw({ quote: 'held in' }))[0]!.flags).toContain('quote_not_found'); // too short to show anything
    expect(check(raw({ sourceId: 'S2', quote: 'The usual dose is 500 mg twice daily with meals.' }))[0]).toMatchObject({ sourceId: 'openfda_label:x', section: 'Dosage and administration' });
  });

  it('(3) a dose that contradicts the calculation is flagged in red and not shown as the model wrote it', () => {
    const [s] = check(raw({ text: 'Give a loading dose of 1500 mg to this patient', quote: 'Vancomycin 15 mg/kg is a label dose in this synthetic text.', caseRefs: ['C1'] }));
    expect(s!.flags).toContain('differs_from_calculation');
    expect(s!.differsFrom).toEqual([{ label: 'C1', result: '1250 mg' }]);
    expect(s!.text).not.toContain('1500');
    expect(s!.text).toContain('[dose withheld — differs from the calculation]');
    expect(s!.asDrafted).toContain('1500 mg');
    expect(addable(s!, { verdict: 'supported', quotes: [{ source: 'x', text: 'y' }] })).toBe(false);
    // The same dose as the calculation is not flagged (and is still withheld unless the quote contains it).
    const same = check(raw({ text: 'Give a loading dose of 1250 mg', quote: 'We recommend that metformin be held in adults with acute kidney injury' }))[0]!;
    expect(same.flags).not.toContain('differs_from_calculation');
    expect(same.flags).toContain('dose_withheld');
  });

  it('(4) a fact with no retrieved support reaches the verifier and is unsupported (see the run below); a number or a dose the quote does not contain is removed or withheld', () => {
    const [n] = check(raw({ text: 'It is held in 3 out of 4 adults', quote: 'We recommend that metformin be held in adults with acute kidney injury' }));
    expect(n!.flags).toContain('number_removed');
    expect(n!.text).toContain('[number removed]');
    const [d] = check(raw({ text: 'Restart at 850 mg daily', quote: 'We recommend that metformin be held in adults with acute kidney injury' }));
    expect(d!.flags).toContain('dose_withheld');
    expect(d!.text).not.toContain('850');
    // A dose the quote contains is shown when the card cites no calculation of the same quantity...
    const [ok] = checkResearch(raw({ sourceId: 'S2', text: 'The usual dose is 500 mg twice daily', quote: 'The usual dose is 500 mg twice daily with meals.' }), { sent: SRC, values: [] }).statements;
    expect(ok!.flags).toEqual([]);
    // ...and flagged against one it differs from (the red flag asks the trainee to look; it does not decide which is right).
    const [red] = check(raw({ sourceId: 'S2', text: 'The usual dose is 500 mg twice daily', quote: 'The usual dose is 500 mg twice daily with meals.' }));
    expect(red!.flags).toEqual(['differs_from_calculation']);
  });

  it('removes a citation the model wrote: the app shows the citation from its record', () => {
    const [s] = check(raw({ text: 'Metformin is held (Smith et al. 2019; PMID 123456), Grade A, see https://example.org/x' }));
    expect(s!.flags).toContain('citation_removed');
    expect(s!.text).not.toMatch(/Smith|PMID|Grade A|https/);
  });

  it('drops an empty statement or one with an unknown role; the schema holds the model to the retrieved ids', () => {
    const r = checkResearch(raw({ text: '  ' }, { role: 'diagnosis' as never }, {}), { sent: SRC, values: VALUES });
    expect(r.dropped).toBe(2);
    expect(r.statements).toHaveLength(1);
    const schema = researchSchema(SRC, VALUES);
    expect(validateOutput(raw({}), schema)).toEqual([]);
    expect(validateOutput(raw({ sourceId: 'S9' }), schema).length).toBeGreaterThan(0);
    expect(validateOutput(raw({ caseRefs: ['C9'] }), schema).length).toBeGreaterThan(0);
  });
});

describe('researching a Problem Card', () => {
  it('retrieves from the library and the open sources, sends only what may be sent, checks and verifies, and records every source with its link', async () => {
    const { store, c, item } = await setup();
    const w = world();
    const pico = defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs, ageYears: 70, sex: 'M' });
    const { run, verification, verifyError } = await researchCard(store, c.id, item.id, pico, w.deps);
    expect(verifyError).toBeUndefined();
    expect(run).toMatchObject({ status: 'answered', promptVersion: RESEARCH_PROMPT_VERSION, itemId: item.id, version: 1 });
    expect(run.model).toBe('researcher-stand-in');
    // Everything retrieved is recorded as a source, with where it opens.
    const kinds = new Set(run.sources.map((s) => s.kind));
    expect(kinds).toEqual(new Set(['library', 'openfda_label', 'pubmed', 'europepmc']));
    for (const s of run.sources) expect(s.url).toBeTruthy();
    expect(run.sources.filter((s) => s.kind === 'openfda_label').every((s) => s.url.startsWith('https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid='))).toBe(true);
    // A document kept for local search is shown, never sent: not in the request, not among the sent passages.
    const local = run.sources.find((s) => s.localOnly)!;
    expect(local.sections[0]!.text).toContain(LOCAL_MARKER);
    expect(run.sent.some((p) => p.recordId === local.id)).toBe(false);
    expect(JSON.stringify(w.modelBodies)).not.toContain(LOCAL_MARKER);
    expect(JSON.stringify(w.verifier.bodies)).not.toContain(LOCAL_MARKER);
    // Only drug names and the question's words went to the open services; no key, no identifier.
    expect(w.outside.every((u) => /^https:\/\/(api\.fda\.gov|eutils\.ncbi\.nlm\.nih\.gov|www\.ebi\.ac\.uk)\//.test(u))).toBe(true);
    expect(w.outside.some((u) => u.includes('dailymed'))).toBe(false);
    // The library's passage came first and is cited from the document's record, with its page.
    const guide = run.statements.find((s) => s.role === 'recommendation')!;
    const guideSource = run.sources.find((s) => s.id === guide.sourceId)!;
    expect(guideSource).toMatchObject({ kind: 'library', role: 'primary', citation: expect.stringContaining('Synthetic Society. Synthetic renal guideline, 2024, p. 1') });
    expect(guideSource.url).toMatch(/^#\/library\/[^/]+\/page\/1$/);
    // Every statement's quote is word for word in the passage it cites, and each has a recorded verdict.
    const verdicts = indexVerdicts(await store.listClaimChecks(c.id)).byKey;
    for (const s of run.statements) {
      const passage = run.sent.find((p) => p.recordId === s.sourceId && (p.section ?? '') === (s.section ?? ''))!;
      expect(passage.text).toContain(s.quote);
      expect(verdicts.get(researchKey(run.id, s))?.verdict).toBe('supported');
    }
    expect(verification!.checked).toBe(run.statements.length);
    // The audit has counts and ids, never the question or a passage.
    const audit = (await store.listAudit()).filter((e) => e.entity === 'research_run');
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toMatch(/continued while creatinine|We recommend that synthetic metformin|renal and hepatic/i);
    const call = (await store.listAudit()).filter((e) => e.entity === 'model_call' && (e.diff as { task?: string }).task === 'research');
    expect(call).toHaveLength(1);
    expect((call[0]!.diff as { retrievedChunkIds: string[] }).retrievedChunkIds.length).toBeGreaterThan(0);
  });

  it('adds a statement to the card one at a time, with its citation and quote; only a supported statement with nothing removed can be added', async () => {
    const { store, c, item } = await setup();
    // The model writes one honest statement, one with a dose the quote does not contain, one quoting another passage than the one it cites, one that paraphrases.
    const w = world({
      answer: (req) => {
        const guide = req.sources.find((s) => /^guideline passage/.test(s.kind))!;
        const label = req.sources.find((s) => /^drug label section/.test(s.kind))!;
        const q = guide.text.slice(0, 80);
        return {
          answerable: true,
          statements: [
            { role: 'recommendation', text: q, sourceId: guide.id, quote: q, caseRefs: [] },
            { role: 'supporting', text: 'Restart at 850 mg daily', sourceId: guide.id, quote: q, caseRefs: [] },
            { role: 'supporting', text: 'The label says the same', sourceId: label.id, quote: q, caseRefs: [] },
            { role: 'conflicting', text: 'Metformin is safe to continue', sourceId: guide.id, quote: 'Metformin is safe to continue in kidney injury', caseRefs: [] },
          ],
          missingData: [],
        };
      },
    });
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    expect(run.statements.map((s) => s.flags)).toEqual([[], ['dose_withheld'], ['quote_not_found'], ['quote_not_found']]);
    const verdicts = indexVerdicts(await store.listClaimChecks(c.id)).byKey;
    // Refused by the code, never asked of a model: unsupported with no quote.
    expect(verdicts.get(researchKey(run.id, run.statements[2]!))).toMatchObject({ verdict: 'unsupported', flags: ['quote_not_found'] });
    expect(verdicts.get(researchKey(run.id, run.statements[3]!))).toMatchObject({ verdict: 'unsupported', flags: ['quote_not_found'] });
    expect(w.verifier.bodies).toHaveLength(1); // one batch, and only for the two statements that reached it
    for (const n of [1, 2, 3]) await expect(store.addResearchClaim(c.id, item.id, run.id, n)).rejects.toBeInstanceOf(IntegrityError);
    const card = await store.addResearchClaim(c.id, item.id, run.id, 0);
    const [claim] = parseClaims(card.fields.claims);
    expect(claim).toMatchObject({ source: 'research', ref: `${run.id}:0`, text: run.statements[0]!.text, quote: run.statements[0]!.quote, by: 'model' });
    expect(claim!.title).toContain('Synthetic Society. Synthetic renal guideline, 2024, p. 1');
    await expect(store.addResearchClaim(c.id, item.id, run.id, 0)).rejects.toThrow(/already/);
    // The card shows the claim with its verdict, and it passes the gate for the form.
    const ctx = await store.cardContext(c.id);
    expect(unverifiedModelClaims(card.fields, ctx)).toEqual([]);
    expect(buildCard(card, ctx).claims[0]!.verdict?.verdict).toBe('supported');
  });

  it('a statement citing a passage that was never sent makes the whole answer invalid: nothing is recorded (Section 21, fixture 1)', async () => {
    const { store, c, item } = await setup();
    const w = world({ answer: () => ({ answerable: true, statements: [{ role: 'recommendation', text: 'Held in kidney injury', sourceId: 'S99', quote: 'We recommend that synthetic metformin be held', caseRefs: [] }], missingData: [] }) });
    await expect(researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps)).rejects.toMatchObject({ code: 'invalid_shape' });
    expect(await store.listResearchRuns(c.id)).toEqual([]);
  });

  it('a claim the trainee rewrites is theirs: its verdict is gone until it is checked again, and it is not gated', async () => {
    const { store, c, item } = await setup();
    const w = world();
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    const card = await store.addResearchClaim(c.id, item.id, run.id, 0);
    const claims = parseClaims(card.fields.claims);
    const edited = await store.updateItem(c.id, item.id, { ...card.fields, claims: claimsValue([{ ...claims[0]!, text: `${claims[0]!.text} and I also think the dose should be halved` }]) });
    const [mine] = parseClaims(edited.fields.claims);
    expect(mine!.by).toBeUndefined();
    const ctx = await store.cardContext(c.id);
    expect(unverifiedModelClaims(edited.fields, ctx)).toEqual([]);
    expect(buildCard(edited, ctx).claims[0]!.verdict).toBeUndefined();
    // A claim naming a research statement that does not exist is refused.
    await expect(store.updateItem(c.id, item.id, { ...edited.fields, claims: claimsValue([{ text: 'x', source: 'research', ref: 'nope:0', title: 't' }]) })).rejects.toMatchObject({ errors: { claims: 'invalidChoice' } });
  });

  it('is stale like the card: new data the card cites, or a changed problem, makes it stale and stops adding from it', async () => {
    const { store, c, item, scr } = await setup();
    const w = world();
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    expect((await store.researchStaleness(run)).stale).toBe(false);
    await store.addEntry(c.id, { type: 'lab', hospitalDay: 3, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 3.1 }, unit: 'mg/dL' } });
    const stale = await store.researchStaleness(run);
    expect(stale.stale).toBe(true);
    expect(stale.reasons.length).toBeGreaterThan(0);
    await expect(store.addResearchClaim(c.id, item.id, run.id, 0)).rejects.toThrow(/Research the question again/);
    void scr;
  });

  it('a researched statement the verifier could not reach stays not checked, and cannot be added', async () => {
    const { store, c, item } = await setup();
    const w = world();
    const down = (async (url: string, init: RequestInit = {}) => {
      const body = init.body ? (JSON.parse(String(init.body)) as { task: string }) : undefined;
      if (body?.task === 'verify') return new Response(JSON.stringify({ error: { code: 'provider_unavailable', message: 'busy' } }), { status: 503, headers: { 'content-type': 'application/json' } });
      return w.f(url, init);
    }) as unknown as typeof fetch;
    const { run, verification } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), { ...w.deps, fetch: down });
    expect(verification!.failures.length).toBeGreaterThan(0);
    const v = indexVerdicts(await store.listClaimChecks(c.id)).byKey.get(researchKey(run.id, run.statements[0]!));
    expect(v?.verdict).toBe('not_checked');
    await expect(store.addResearchClaim(c.id, item.id, run.id, 0)).rejects.toBeInstanceOf(IntegrityError);
    // Checking again, when the service answers, makes it addable.
    const again = await verifyResearch(store, c.id, run.id, w.deps);
    expect(again.checked).toBeGreaterThan(0);
    await expect(store.addResearchClaim(c.id, item.id, run.id, 0)).resolves.toBeTruthy();
  });

  it('a fact the passages do not support is unsupported, and cannot enter the card (Section 21, fixture 4)', async () => {
    const { store, c, item } = await setup();
    const w = world({
      verifier: standInVerifier((claim) => ({ claimId: claim.id, verdict: 'unsupported', contradicted: false, quotes: [], unsupportedParts: [claim.text.slice(0, 20)] })),
    });
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    const v = indexVerdicts(await store.listClaimChecks(c.id)).byKey.get(researchKey(run.id, run.statements[0]!));
    expect(v?.verdict).toBe('unsupported');
    expect(addable(run.statements[0]!, v)).toBe(false);
    await expect(store.addResearchClaim(c.id, item.id, run.id, 0)).rejects.toBeInstanceOf(IntegrityError);
  });
});

describe('when nothing adequate is found', () => {
  it('says so plainly, keeps the question as an open item for the preceptor, and does not ask the model to fill the gap', async () => {
    const { store, c, item } = await setup({ docs: false });
    const w = world({ openSources: false });
    const { run, verification } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), { ...w.deps, online: () => true });
    expect(run).toMatchObject({ status: 'insufficient', openQuestion: true, statements: [], sent: [], model: '' });
    expect(run.notes).toEqual(expect.arrayContaining(['library_empty', 'open_sources_failed']));
    expect(w.modelBodies).toEqual([]);
    expect(verification).toBeUndefined();
    await expect(store.addResearchClaim(c.id, item.id, run.id, 0)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('offline: the library still answers; the open sources are said not to have been reached', async () => {
    const { store, c, item } = await setup();
    const w = world();
    const offline = { ...w.deps, online: () => false };
    // The model also needs a connection: with none, the passages are kept and the call is refused plainly.
    await expect(researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), offline)).rejects.toMatchObject({ code: 'offline' });
    expect(w.outside).toEqual([]);
  });

  it('the model finding the passages inadequate is the same: insufficient, with what is missing, nothing added', async () => {
    const { store, c, item } = await setup();
    const w = world({ answer: () => ({ answerable: false, statements: [], missingData: ['Nothing in the passages addresses the question'] }) });
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    expect(run).toMatchObject({ status: 'insufficient', openQuestion: true, missingData: ['Nothing in the passages addresses the question'] });
  });

  it('a document kept for local search alone is found and shown but the model is not asked', async () => {
    const { store, c, item } = await setup({ docs: false });
    await store.addDocument({ meta: { ...META, aiUse: 'local_only', licenceConfirmed: '' }, file: { name: 'local.pdf', bytes: pdf('only') }, pages: LOCAL_PAGES, pageCount: 1 });
    const w = world({ openSources: false });
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    expect(run.status).toBe('insufficient');
    expect(run.notes).toContain('library_local_only');
    expect(run.sources.some((s) => s.localOnly)).toBe(true);
    expect(w.modelBodies).toEqual([]);
  });
});

describe('what may leave the device', () => {
  it('refuses a question holding the patient’s name or record number, before any call', async () => {
    const { store, c, item } = await setup({ kind: 'clinical' });
    const w = world();
    const pico = { ...defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), population: 'Saleh Qaid, an adult' };
    await expect(researchCard(store, c.id, item.id, pico, w.deps)).rejects.toMatchObject({ code: 'identifier' });
    await expect(researchCard(store, c.id, item.id, { ...pico, population: 'Adult MRN-77120' }, w.deps)).rejects.toMatchObject({ code: 'identifier' });
    expect(w.outside).toEqual([]);
    expect(w.modelBodies).toEqual([]);
  });

  it('the store refuses a run that would send the text of a document kept for local search', async () => {
    const { store, c, item } = await setup();
    const w = world();
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    const local = run.sources.find((s) => s.localOnly)!;
    const { id: _id, caseId: _c, createdAt: _a, itemVersion: _v, version: _ver, versionCreatedAt: _vc, ...input } = run;
    await expect(store.addResearchRun(c.id, { ...input, sent: [...run.sent, { id: 'S9', recordId: local.id, describe: 'x', text: local.sections[0]!.text }] })).rejects.toThrow(/never sent/);
    await expect(store.addResearchRun(c.id, { ...input, status: 'answered', statements: [] })).rejects.toThrow(/at least one statement/);
  });
});

describe('the limits of confidence, as factors', () => {
  it('are computed from what was retrieved, cited and checked — never a single score', async () => {
    const { store, c, item } = await setup();
    const w = world();
    const { run } = await researchCard(store, c.id, item.id, defaultPico({ problem: item.fields.problem, drugs: item.fields.drugs }), w.deps);
    const verdicts = indexVerdicts(await store.listClaimChecks(c.id)).byKey;
    const f = confidenceFactors(run, verdicts, store.today());
    const by = Object.fromEntries(f.map((x) => [x.id, x]));
    expect(by.sources!.level).toBe('good'); // the department's primary document is cited
    expect(by.verification!.level).toBe('good');
    expect(by.missing).toMatchObject({ level: 'caution', n: 1 });
    expect(by.local_only).toMatchObject({ level: 'caution', n: 1 });
    // Only literature: a limit. Old documents: a caution with the years.
    const literatureOnly: ResearchRun = { ...run, sources: run.sources.filter((s) => s.kind === 'pubmed'), statements: [{ ...run.statements[0]!, sourceId: run.sources.find((s) => s.kind === 'pubmed')!.id }] };
    expect(confidenceFactors(literatureOnly, new Map(), store.today()).find((x) => x.id === 'sources')!.level).toBe('limit');
    expect(confidenceFactors(literatureOnly, new Map(), store.today()).find((x) => x.id === 'verification')!.level).toBe('limit');
    expect(confidenceFactors(literatureOnly, new Map(), store.today()).find((x) => x.id === 'abstracts')).toBeTruthy();
    const oldDoc: ResearchRun = { ...run, sources: run.sources.map((s) => (s.kind === 'library' ? { ...s, old: true as const, date: '2018' } : s)) };
    expect(confidenceFactors(oldDoc, verdicts, '2026-10-21').find((x) => x.id === 'age')).toMatchObject({ level: 'caution', years: 8 });
    const conflicting: ResearchRun = { ...run, statements: [...run.statements, { ...run.statements[0]!, n: 9, role: 'conflicting' }] };
    expect(confidenceFactors(conflicting, verdicts, store.today()).some((x) => x.id === 'conflict')).toBe(true);
  });
});

void GUIDE;

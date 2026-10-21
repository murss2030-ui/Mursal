/**
 * "Research this question" from a Problem Card (plan M5d). The flow, with
 * what leaves the device at each step:
 *
 * 1. The question in PICO form — built from the card by the app and edited by
 *    the trainee; checked for identifiers before anything is sent.
 * 2. Retrieval — the library on the device (the question's words are sent
 *    only to compute their vector, when an embedding model is chosen); then
 *    the open sources (drug names and the question's words only).
 * 3. The model drafts from the retrieved passages and nothing else — only
 *    passages of documents the trainee allowed to be sent. When nothing is
 *    sendable the model is not asked, and the app says so plainly.
 * 4. The checks in code, then the independent verifier; every verdict is
 *    recorded. The trainee adds statements to the card one at a time.
 */
import { citedCalcIds, citedEntryIds } from '../../domain/problem-card';
import { namedDrugs } from '../../domain/pcne-coherence';
import { picoQuery, picoQuestion, problemHash, type Pico, type ResearchRun } from '../../domain/research';
import { indexTimeline } from '../../domain/timeline';
import type { Store } from '../../store/store';
import { calcSource, caseHeader, entrySource } from '../analysis/payload';
import { maskForCase } from '../analysis/run';
import { AiError, callModel, type CallDeps } from '../client';
import { guardQuery } from '../connectors/http';
import type { VerificationOutcome } from '../verification/draft';
import { checkResearch } from './check';
import { RESEARCH_PROMPT_VERSION, RESEARCH_SYSTEM, researchHeader, researchRequestText, researchSchema, type CaseValue, type RawResearch } from './contract';
import { retrieveEvidence } from './retrieve';
import { verifyResearch } from './verify';

/** Values from the card the model may point to. */
const MAX_VALUES = 8;

export interface ResearchResult {
  run: ResearchRun;
  verification?: VerificationOutcome;
  /** Why the statements are not checked yet (the verifier could not be reached); the run is kept. */
  verifyError?: string;
}

/** The words the trainee confirmed, checked for identifiers: the question is the only free text that leaves the device. */
export async function checkedQuestion(store: Store, caseId: string, pico: Pico): Promise<{ question: string; query: string }> {
  const question = picoQuestion(pico);
  await guardQuery(store, caseId, [pico.population, pico.intervention, pico.comparison, pico.outcome].join(' '));
  return { question, query: picoQuery(pico) };
}

export async function researchCard(store: Store, caseId: string, itemId: string, pico: Pico, deps: CallDeps = {}): Promise<ResearchResult> {
  const c = await store.getCase(caseId);
  const item = (await store.listItems(caseId)).find((i) => i.id === itemId && i.register === 'drp' && i.status === 'active');
  if (!c || !item) throw new AiError('bad_request', 'Unknown case or Problem Card.');
  const { question, query } = await checkedQuestion(store, caseId, pico);
  if (!query) throw new AiError('bad_request', 'The question has no clinical words to search with. Complete its parts.');
  const drugs = namedDrugs(pico.intervention) ?? namedDrugs(item.fields.drugs) ?? [];

  // The values of the case the card cites, the only case data the model may point to.
  const ctx = await store.cardContext(caseId);
  const idx = indexTimeline(ctx.entries);
  const values: CaseValue[] = [];
  for (const id of citedEntryIds(item.fields).slice(0, MAX_VALUES)) {
    const e = idx.byId.get(id);
    if (e && idx.current.some((x) => x.id === id)) values.push({ label: `E${values.filter((v) => v.kind === 'entry').length + 1}`, kind: 'entry', id, text: entrySource(e).text.replace(/\s+/g, ' ').trim() });
  }
  for (const id of citedCalcIds(item.fields).slice(0, MAX_VALUES)) {
    const r = ctx.calcResults.find((x) => x.id === id);
    if (r && !ctx.calcOutOfDate.has(r.id)) values.push({ label: `C${values.filter((v) => v.kind === 'calc').length + 1}`, kind: 'calc', id, text: calcSource(r).text });
  }
  const calcById = new Map(ctx.calcResults.map((r) => [r.id, r]));

  const retrieval = await retrieveEvidence(store, {
    caseId,
    caseKind: c.kind,
    query,
    drugs,
    ...(deps.fetch || deps.online ? { connectors: { ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.online ? { online: deps.online } : {}) } } : {}),
    deps,
  });
  // Free text typed into the record could still hold an identifier: masked before it is stored as "what was sent" and before it leaves.
  const sent = await Promise.all(retrieval.sent.map(async (p) => ({ ...p, text: await maskForCase(store, caseId, p.text) })));
  const context = await maskForCase(store, caseId, JSON.stringify({ ...caseHeader(c, store.today()), problem: item.fields.problem ?? '', medications: drugs }));
  const maskedQuestion = await maskForCase(store, caseId, question);

  const base = {
    itemId,
    question,
    pico,
    query,
    drugs,
    sources: retrieval.sources,
    sent,
    retrievedChunkIds: retrieval.chunkIds,
    notes: retrieval.notes,
    basedOn: { problemHash: problemHash(item.fields), links: [...citedEntryIds(item.fields).map((id) => `entry:${id}`), ...citedCalcIds(item.fields).map((id) => `calc:${id}`)] },
  };

  let raw: RawResearch | undefined;
  let model = '';
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  // Nothing sendable: the model is not asked to fill the gap (plan: "the app says so plainly").
  if (sent.length) {
    const settings = await store.getAiSettings();
    const chosen = settings.models.research ?? settings.models.analyse;
    const res = await callModel<RawResearch>(
      store,
      {
        task: 'research',
        ...(chosen ? { model: chosen } : {}),
        promptVersion: RESEARCH_PROMPT_VERSION,
        caseId,
        caseKind: c.kind,
        system: RESEARCH_SYSTEM,
        parts: [{ text: researchHeader(sent.length) }, { text: researchRequestText({ question: maskedQuestion, pico, context, values, sources: sent }) }],
        schema: researchSchema(sent, values),
        maxOutputTokens: 4096,
        temperature: 0.2,
        retrievedChunkIds: retrieval.chunkIds,
      },
      deps,
    );
    raw = res.output;
    model = res.model;
    usage = res.usage;
  }

  const checked = raw?.answerable ? checkResearch(raw, { sent, values: values.map((v) => ({ ...v, ...(v.kind === 'calc' && calcById.get(v.id) ? { calc: calcById.get(v.id)! } : {}) })) }) : { statements: [], dropped: raw?.statements?.length ?? 0 };
  const answered = checked.statements.length > 0;
  const run = await store.addResearchRun(caseId, {
    ...base,
    model,
    promptVersion: RESEARCH_PROMPT_VERSION,
    status: answered ? 'answered' : 'insufficient',
    statements: checked.statements,
    missingData: (raw?.missingData ?? []).map((m) => m.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10),
    dropped: checked.dropped,
    ...(answered ? {} : { openQuestion: true as const }),
    usage,
  });
  if (!answered) return { run };
  try {
    return { run, verification: await verifyResearch(store, caseId, run.id, deps) };
  } catch (e) {
    // The run is kept; its statements stay "not checked" and cannot be added until they are.
    if (e instanceof AiError) return { run, verifyError: e.message };
    throw e;
  }
}

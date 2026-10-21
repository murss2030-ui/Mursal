/**
 * Drafting one module of the Clinical Modules (owner decision D2): the
 * confirmed, de-identified case goes to the model with the module's task
 * definitions; what comes back passes every check in code and is stored as
 * an analysis whose suggestions the trainee decides one at a time. M5: the
 * verifier then checks the draft's statements (verification/draft.ts).
 */
import type { CaseAnalysis } from '../../domain/types';
import { MODULE_BY_ID } from '../../domain/workflow/catalogue';
import { analysisStale, type Store } from '../../store/store';
import { AiError, callModel, type CallDeps } from '../client';
import { maskIdentifiers } from '../extraction/deid';
import { ANALYSE_PROMPT_VERSION, ANALYSE_SYSTEM, analyseHeader, analysisSchema, type RawAnalysis } from './contract';
import { buildCasePayload, type CasePayload, type DraftedCard } from './payload';
import { verifyAnalysis } from './verify';

/** The case as sent for one module: the same function serves the draft and, later, the verification of its statements. */
export async function casePayloadFor(store: Store, caseId: string, moduleId: string): Promise<CasePayload> {
  const c = await store.getCase(caseId);
  const module = MODULE_BY_ID.get(moduleId as never);
  if (!c || !module) throw new AiError('bad_request', 'Unknown case or module.');
  const [entries, items, tasks, cards, analyses] = await Promise.all([store.listEntries(caseId), store.listItems(caseId), store.listTasks(caseId), store.cardContext(caseId), store.listAnalyses(caseId)]);
  // M5: Problem Cards another module drafted on the current data and the trainee has not decided yet: not to be drafted twice.
  const draftedCards: DraftedCard[] = analyses
    .filter((a) => a.moduleId !== module.id && !analysisStale(a, entries, items))
    .flatMap((a) => a.suggestions.filter((s) => s.kind === 'item' && s.register === 'drp' && !s.decision && s.fields?.problem))
    .map((s) => ({ problem: s.fields!.problem!, ...(s.fields!.drugs ? { drugs: s.fields!.drugs } : {}), ...(s.fields!.pcneProblem ? { pcneProblem: s.fields!.pcneProblem } : {}) }));
  // M4: current calculation results are sent too, so that a Problem Card's claim (and a dose) can cite one.
  return buildCasePayload({ case: c, entries, items, tasks, module, today: store.today(), calcResults: cards.calcResults, calcOutOfDate: cards.calcOutOfDate, draftedCards });
}

/** Free text typed into the record could still hold an identifier: masked before it leaves the device (clinical cases). */
export async function maskForCase(store: Store, caseId: string, text: string): Promise<string> {
  const c = await store.getCase(caseId);
  if (c?.kind !== 'clinical') return text;
  const ids = await store.getIdentifiers(caseId);
  return maskIdentifiers(text, { patientName: ids?.patientName, mrn: ids?.mrn, roomBed: ids?.roomBed, consultantName: ids?.consultantName }).text;
}

export async function analyseModule(store: Store, caseId: string, moduleId: string, deps: CallDeps = {}): Promise<CaseAnalysis> {
  const c = await store.getCase(caseId);
  const module = MODULE_BY_ID.get(moduleId as never);
  if (!c || !module) throw new AiError('bad_request', 'Unknown case or module.');
  const payload = await casePayloadFor(store, caseId, moduleId);
  const text = await maskForCase(store, caseId, payload.text);
  const res = await callModel<RawAnalysis>(
    store,
    {
      task: 'analyse',
      promptVersion: ANALYSE_PROMPT_VERSION,
      caseId,
      caseKind: c.kind,
      system: ANALYSE_SYSTEM,
      parts: [{ text: analyseHeader(module.id, payload.tasks.map((x) => x.id)) }, { text }],
      schema: analysisSchema(payload.tasks),
      maxOutputTokens: 8192,
      temperature: 0.2,
      retrievedChunkIds: [],
    },
    deps,
  );
  const v = verifyAnalysis(res.output, payload);
  return store.addAnalysis(caseId, {
    moduleId: module.id,
    model: res.model,
    promptVersion: ANALYSE_PROMPT_VERSION,
    basedOn: payload.basedOn,
    retrievedChunkIds: [],
    suggestions: v.suggestions,
    dropped: v.dropped,
    usage: res.usage,
  });
}

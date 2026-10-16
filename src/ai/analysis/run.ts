/**
 * Drafting one module of the Clinical Modules (owner decision D2): the
 * confirmed, de-identified case goes to the model with the module's task
 * definitions; what comes back passes every check in code and is stored as
 * an analysis whose suggestions the trainee decides one at a time.
 */
import type { CaseAnalysis } from '../../domain/types';
import { MODULE_BY_ID } from '../../domain/workflow/catalogue';
import type { Store } from '../../store/store';
import { AiError, callModel, type CallDeps } from '../client';
import { maskIdentifiers } from '../extraction/deid';
import { ANALYSE_PROMPT_VERSION, ANALYSE_SYSTEM, analyseHeader, analysisSchema, type RawAnalysis } from './contract';
import { buildCasePayload } from './payload';
import { verifyAnalysis } from './verify';

export async function analyseModule(store: Store, caseId: string, moduleId: string, deps: CallDeps = {}): Promise<CaseAnalysis> {
  const c = await store.getCase(caseId);
  const module = MODULE_BY_ID.get(moduleId as never);
  if (!c || !module) throw new AiError('bad_request', 'Unknown case or module.');
  const [entries, items, tasks] = await Promise.all([store.listEntries(caseId), store.listItems(caseId), store.listTasks(caseId)]);
  const payload = buildCasePayload({ case: c, entries, items, tasks, module, today: store.today() });
  // Free text typed into the record could still hold an identifier: masked before it leaves the device.
  const ids = c.kind === 'clinical' ? await store.getIdentifiers(caseId) : undefined;
  const text = maskIdentifiers(payload.text, { patientName: ids?.patientName, mrn: ids?.mrn, roomBed: ids?.roomBed, consultantName: ids?.consultantName }).text;
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

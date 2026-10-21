/**
 * Check 4 for a researched answer (plan M5e): the independent verifier reads
 * each statement beside the very passage it cites and says whether its
 * meaning is supported, with a quote. A statement the code checks already
 * rejected — a passage that was not retrieved, a quote that is not in its
 * passage — is recorded "unsupported" without asking a model: it can never
 * pass. Verdicts are append-only records tied to exactly the statement's words
 * (verdicts.ts); the gate of decision 6 reads them.
 */
import type { ResearchRun, ResearchStatement, SentPassage } from '../../domain/research';
import { researchKey, researchTarget } from '../../domain/research';
import { sourceCitation } from '../../domain/sources';
import type { ClaimVerification } from '../../domain/verdicts';
import type { Store } from '../../store/store';
import { AiError, type CallDeps } from '../client';
import { toRecords, type VerificationOutcome } from '../verification/draft';
import { VERIFY_PROMPT_VERSION, type VerifyClaim, type VerifyInput, type VerifySource } from '../verification/contract';
import { verifyClaims } from '../verification/run';

/** The passage a statement cites: the one sent to the model for its source (and label section). */
export function passageOf(run: Pick<ResearchRun, 'sent'>, st: Pick<ResearchStatement, 'sourceId' | 'section'>): SentPassage | undefined {
  return run.sent.find((p) => p.recordId === st.sourceId && (p.section ?? '') === (st.section ?? ''));
}

type Recorded = Omit<ClaimVerification, 'id' | 'caseId' | 'at'>;

/** The record of a statement that cannot pass, made without asking a model. */
function refused(run: ResearchRun, st: ResearchStatement): Recorded {
  return {
    key: researchKey(run.id, st),
    origin: { kind: 'research', runId: run.id, claim: st.n },
    verdict: 'unsupported',
    quotes: [],
    unsupportedParts: [],
    flags: [st.flags.includes('source_not_retrieved') ? 'no_source' : 'quote_not_found'],
    promptVersion: VERIFY_PROMPT_VERSION,
  };
}

/**
 * Checks the statements of a run that have no verdict yet (or all, with
 * `all`), and records the verdicts. A batch the service could not answer
 * leaves its statements "not checked", with the reason.
 */
export async function verifyResearch(store: Store, caseId: string, runId: string, deps: CallDeps = {}, opts: { all?: boolean } = {}): Promise<VerificationOutcome> {
  const c = await store.getCase(caseId);
  const run = (await store.listResearchRuns(caseId)).find((r) => r.id === runId);
  if (!c || !run) throw new AiError('bad_request', 'Unknown case or research.');
  const verdicts = (await store.cardContext(caseId)).verdicts;
  const pending = run.statements.filter((s) => {
    const v = verdicts?.get(researchKey(run.id, s));
    return opts.all || !v || v.verdict === 'not_checked';
  });
  const records: Recorded[] = [];
  const sources: VerifySource[] = [];
  const claims: VerifyClaim[] = [];
  const located = new Map<string, ResearchStatement>();
  for (const st of pending) {
    const p = passageOf(run, st);
    if (st.flags.includes('source_not_retrieved') || st.flags.includes('quote_not_found') || !p) {
      records.push(refused(run, st));
      continue;
    }
    if (!sources.some((x) => x.id === p.id)) {
      const rec = run.sources.find((x) => x.id === p.recordId);
      sources.push({ id: p.id, label: `${rec ? sourceCitation(rec) : p.recordId}${p.section ? ` [${p.section}]` : ''}`, text: p.text.replace(/\s+/g, ' ').trim() });
    }
    const id = `V${claims.length + 1}`;
    claims.push({ id, text: st.text, sourceIds: [p.id] });
    located.set(id, st);
  }
  let failures: VerificationOutcome['failures'] = [];
  if (claims.length) {
    const input: VerifyInput = { claims, sources };
    const result = await verifyClaims(store, { caseId, caseKind: c.kind }, input, deps);
    failures = result.failures;
    records.push(
      ...toRecords(result, input, (id) => {
        const st = located.get(id);
        return st && { origin: { kind: 'research', runId: run.id, claim: st.n }, text: st.text, targets: [researchTarget(run.id, st.n)] };
      }),
    );
  }
  const saved = await store.addClaimChecks(caseId, records);
  return { checked: pending.length, records: saved, failures };
}

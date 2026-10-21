/**
 * Runs the verifier over a set of claims through callModel (task "verify"),
 * in batches, each batch carrying only the sources its claims cite. A claim
 * with no source the app holds is not sent: it is unsupported by definition.
 * A batch the chosen model cannot answer (busy, too slow, out of quota, an
 * answer of the wrong shape) goes to the next of the trainee's fallback
 * models; if none answers, its claims are "not checked" and the others keep
 * their verdicts. A refusal that would refuse every model too — offline,
 * budget, settings, access — stops the run. Every call is in the audit log
 * like any other (model, prompt version, token use, cost — never the content).
 */
import type { CaseKind } from '../../domain/types';
import type { Store } from '../../store/store';
import { maskForCase } from '../analysis/run';
import { AiError, callModel, type AiErrorCode, type CallDeps } from '../client';
import { modelsFor } from '../settings';
import type { ModelUsage } from '../protocol';
import { checkVerification, type ClaimVerdict } from './check';
import { verificationSchema, verifyHeader, verifyRequestText, VERIFY_PROMPT_VERSION, VERIFY_SYSTEM, type RawVerification, type VerifyInput } from './contract';

/** Claims per call: small enough that every claim gets an answer within the output limit. */
export const VERIFY_BATCH = 12;

/** Refusals that no other batch and no other model would escape. */
const STOPS: ReadonlySet<AiErrorCode> = new Set(['offline', 'network', 'no_model', 'relay_missing', 'not_configured', 'access_denied', 'free_key_clinical', 'budget_exhausted', 'rate_limited', 'provider_auth']);

export interface VerifyRun {
  verdicts: ClaimVerdict[];
  calls: { model: string; usage: ModelUsage; claims: number; claimIds: string[] }[];
  /** Batches the service could not answer: their claims are "not checked". */
  failures: { claimIds: string[]; code: AiErrorCode; message: string }[];
}

export function batches(input: VerifyInput, size = VERIFY_BATCH): VerifyInput[] {
  const known = new Set(input.sources.map((s) => s.id));
  const sendable = input.claims.filter((c) => c.sourceIds.some((id) => known.has(id)));
  const out: VerifyInput[] = [];
  for (let i = 0; i < sendable.length; i += size) {
    const claims = sendable.slice(i, i + size);
    const cited = new Set(claims.flatMap((c) => c.sourceIds));
    out.push({ claims, sources: input.sources.filter((s) => cited.has(s.id)) });
  }
  return out;
}

export async function verifyClaims(store: Store, scope: { caseId: string; caseKind: CaseKind }, input: VerifyInput, deps: CallDeps = {}): Promise<VerifyRun> {
  const calls: VerifyRun['calls'] = [];
  const failures: VerifyRun['failures'] = [];
  const answered = new Map<string, ClaimVerdict>();
  const models = modelsFor(await store.getAiSettings(), 'verify');
  for (const batch of batches(input)) {
    let output: RawVerification = { results: [] }; // until a model answers: every claim of the batch not checked
    let last: AiError | undefined;
    // As for drafting: free text typed into the record could still hold an identifier, masked before it leaves the device.
    const text = await maskForCase(store, scope.caseId, verifyRequestText(batch));
    for (const model of models.length ? models : [undefined]) {
      try {
        const res = await callModel<RawVerification>(
          store,
          {
            task: 'verify',
            ...(model ? { model } : {}),
            promptVersion: VERIFY_PROMPT_VERSION,
            caseId: scope.caseId,
            caseKind: scope.caseKind,
            system: VERIFY_SYSTEM,
            parts: [{ text: verifyHeader(batch.claims.length) }, { text }],
            schema: verificationSchema(batch),
            maxOutputTokens: 8192,
            temperature: 0,
          },
          deps,
        );
        calls.push({ model: res.model, usage: res.usage, claims: batch.claims.length, claimIds: batch.claims.map((c) => c.id) });
        output = res.output;
        last = undefined;
        break;
      } catch (e) {
        if (!(e instanceof AiError) || STOPS.has(e.code)) throw e;
        last = e; // this model could not answer: the next one is tried
      }
    }
    if (last) failures.push({ claimIds: batch.claims.map((c) => c.id), code: last.code, message: last.message });
    for (const v of checkVerification(output, batch)) answered.set(v.claimId, v);
  }
  // Claims that were not sent (no source) are checked here, without the model.
  const unsent = checkVerification({ results: [] }, { claims: input.claims.filter((c) => !answered.has(c.id)), sources: input.sources });
  for (const v of unsent) answered.set(v.claimId, v);
  return { verdicts: input.claims.map((c) => answered.get(c.id)!), calls, failures };
}

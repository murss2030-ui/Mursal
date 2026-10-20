/**
 * Runs the verifier over a set of claims through callModel (task "verify"),
 * in batches, each batch carrying only the sources its claims cite. A claim
 * with no source the app holds is not sent: it is unsupported by definition.
 * A batch the service could not answer leaves its claims "not checked" (the
 * others keep their verdicts); a refusal that would refuse every batch too —
 * offline, budget, settings, access — stops the run. Every call is in the
 * audit log like any other (model, prompt version, token use, cost — never
 * the content).
 */
import type { CaseKind } from '../../domain/types';
import type { Store } from '../../store/store';
import { AiError, callModel, type AiErrorCode, type CallDeps } from '../client';
import type { ModelUsage } from '../protocol';
import { checkVerification, type ClaimVerdict } from './check';
import { verificationSchema, verifyHeader, verifyRequestText, VERIFY_PROMPT_VERSION, VERIFY_SYSTEM, type RawVerification, type VerifyInput } from './contract';

/** Claims per call: small enough that every claim gets an answer within the output limit. */
export const VERIFY_BATCH = 12;

/** Refusals that no other batch would escape. */
const STOPS: ReadonlySet<AiErrorCode> = new Set([
  'offline',
  'no_model',
  'relay_missing',
  'not_configured',
  'access_denied',
  'model_not_allowed',
  'price_not_configured',
  'free_key_clinical',
  'budget_exhausted',
  'rate_limited',
  'provider_auth',
  'provider_quota_exhausted',
  'model_unavailable',
]);

export interface VerifyRun {
  verdicts: ClaimVerdict[];
  calls: { model: string; usage: ModelUsage; claims: number }[];
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
  for (const batch of batches(input)) {
    let output: RawVerification;
    try {
      const res = await callModel<RawVerification>(
        store,
        {
          task: 'verify',
          promptVersion: VERIFY_PROMPT_VERSION,
          caseId: scope.caseId,
          caseKind: scope.caseKind,
          system: VERIFY_SYSTEM,
          parts: [{ text: verifyHeader(batch.claims.length) }, { text: verifyRequestText(batch) }],
          schema: verificationSchema(batch),
          maxOutputTokens: 8192,
          temperature: 0,
        },
        deps,
      );
      calls.push({ model: res.model, usage: res.usage, claims: batch.claims.length });
      output = res.output;
    } catch (e) {
      if (!(e instanceof AiError) || STOPS.has(e.code)) throw e;
      failures.push({ claimIds: batch.claims.map((c) => c.id), code: e.code, message: e.message });
      output = { results: [] }; // every claim of the batch: not checked
    }
    for (const v of checkVerification(output, batch)) answered.set(v.claimId, v);
  }
  // Claims that were not sent (no source) are checked here, without the model.
  const unsent = checkVerification({ results: [] }, { claims: input.claims.filter((c) => !answered.has(c.id)), sources: input.sources });
  for (const v of unsent) answered.set(v.claimId, v);
  return { verdicts: input.claims.map((c) => answered.get(c.id)!), calls, failures };
}

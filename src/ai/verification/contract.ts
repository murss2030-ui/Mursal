/**
 * The independent verifier pass (Section 12, check 4). A second call, routed
 * to the task "verify" (the cheapest tier), reads each claim beside the very
 * sources it cites and says whether their meaning supports it — supported,
 * partial or unsupported — and whether a source says the opposite. It judges
 * meaning, not shared words or numbers: a claim that reuses a source's
 * numbers with another threshold, direction, drug, population, condition,
 * unit or frequency is not supported.
 *
 * The verifier can only point. Its quotes must be copied from the sources and
 * the parts it finds unsupported from the claim; check.ts keeps nothing else,
 * so it never writes clinical content of its own. It sees only the sources a
 * claim cites, never the whole case. Agreement between two models is not
 * proof of correctness: this is one signal among the five.
 */
import { S, type OutputSchema } from '../schema';

/** v2 (M5, after the live probe of 20 October 2026): descriptions, time words, changes, reasons, absences and judgements each need their own support. */
export const VERIFY_PROMPT_VERSION = 'verify-v2';

/** A source as the verifier reads it: case data (an entry, a medication, a calculation) or, from M5, a retrieved passage. */
export interface VerifySource {
  id: string;
  /** Shown to the trainee; never sent. */
  label: string;
  text: string;
  /** Context every claim may use (the case header): a quote from it alone does not show a claim's support. */
  context?: boolean;
  /** What the source is about (a test, a vital sign, a drug) and its hospital day: two values of one subject show a change. */
  subject?: string;
  day?: number;
}

export interface VerifyClaim {
  id: string;
  text: string;
  sourceIds: string[];
}

export interface VerifyInput {
  claims: VerifyClaim[];
  sources: VerifySource[];
}

export const VERDICTS = ['supported', 'partial', 'unsupported'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface RawVerdict {
  claimId: string;
  verdict: Verdict;
  contradicted: boolean;
  quotes: { sourceId: string; text: string }[];
  unsupportedParts: string[];
}

export interface RawVerification {
  results: RawVerdict[];
}

export function verificationSchema(input: VerifyInput): OutputSchema {
  // A claim citing many sources may be shown by a quote from each (live probe: a whole batch was refused at 6).
  const quotes = Math.max(6, ...input.claims.map((c) => c.sourceIds.length + 2));
  return S.obj({
    results: S.arr(
      S.obj({
        claimId: S.enumOf(input.claims.map((c) => c.id)),
        verdict: S.enumOf(VERDICTS),
        contradicted: S.bool('True only when a source states the opposite of the claim, or something incompatible with it'),
        quotes: S.arr(S.obj({ sourceId: S.enumOf(input.sources.map((s) => s.id)), text: S.str('Exact words copied from that source') }), quotes),
        unsupportedParts: S.arr(S.str('Exact words copied from the claim'), 10),
      }),
      input.claims.length,
    ),
  });
}

export const VERIFY_SYSTEM = `You check statements written for a supervised clinical pharmacy trainee against the sources each statement cites. Judge only from those source texts — never from your own knowledge, even when you know a statement to be true or false.

For each claim, compare its meaning with the sources listed for it (and only those):
- "supported": everything the claim asserts is stated in its sources, or follows from them directly (a restatement, or simple arithmetic such as a rise from one value to another).
- "partial": part of what the claim asserts is supported, and part is not stated in its sources. List the unsupported parts.
- "unsupported": its sources do not support what the claim mainly asserts.
Set "contradicted" to true when a source states the opposite of the claim, or something incompatible with it.

Judge meaning, not shared words or numbers. A claim is not supported when it reuses its sources' words or numbers but changes a threshold or range, the direction of a change or an effect, the drug or drug class, the population, a condition or exception, a dose, its unit, route or frequency, or the certainty (stating as certain what a source says may happen).
A clinical interpretation, judgement or recommendation that a source does not state — for example naming a diagnosis from a laboratory value, or saying that a dose must change — is not supported by a source that only reports the value.

Each of these is an assertion of its own, and is not supported unless a source states it — even when the rest of the claim is supported and even when you know it to be true:
- a property of a drug or drug class: nephrotoxic, hepatotoxic, renally cleared, high-alert, contraindicated, narrow therapeutic index, interacts with another drug;
- a time: currently, still, now, recently, on day N, after or before an event — the source must give that time (a value recorded on an earlier day is not current);
- a change: rose, fell, increased, improved, worsened, was changed, was converted — the sources must give both values, or state the change;
- a reason or purpose: because, due to, for the management of, to prevent, in order to;
- an absence: not ordered, not prescribed, not documented, no plan, none — the sources only show what is recorded, so an absence is unsupported unless a source states it;
- a judgement or need: requires, should, must, needs review, significant, abnormal, above or below a target or range that the source does not give.
When such an assertion is unsupported, the claim is at best "partial": list those words among the unsupported parts.

Quotes: copy exact words from the source, character for character — the shortest span that shows the support or the contradiction. Give at least one quote for "supported" and "partial", and one for a contradiction.
Unsupported parts: copy exact words from the claim.
Answer every claim once. Return JSON only.`;

/** What is sent: the claims and their sources by id. Labels stay on the device. */
export function verifyRequestText(input: VerifyInput): string {
  return JSON.stringify({
    sources: input.sources.map((s) => ({ id: s.id, text: s.text })),
    claims: input.claims.map((c) => ({ id: c.id, text: c.text, sources: c.sourceIds })),
  });
}

export function verifyHeader(count: number): string {
  return [`TASK: verify`, `PROMPT: ${VERIFY_PROMPT_VERSION}`, `CLAIMS: ${count}`, 'CLAIMS AND SOURCES (JSON) below.'].join('\n');
}

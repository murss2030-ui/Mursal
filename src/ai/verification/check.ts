/**
 * The verifier's answer, checked in code before anything is shown (Section
 * 12: "Prompt instructions are not a control"). A quote must be found, word
 * for word, in a source the claim itself cites; an unsupported part, in the
 * claim. A verdict the verifier cannot show is not kept: "supported" or
 * "partial" without a quote found becomes unsupported, and a contradiction
 * without a quote is not reported as one. A claim with no source the app
 * holds is unsupported without asking the model; a claim the verifier did not
 * answer is "not checked".
 *
 * Only whitespace, quotation marks and dashes are normalised for the
 * comparison — encoding differences, not meaning. Near-matches fail.
 */
import type { RawVerdict, RawVerification, Verdict, VerifyInput } from './contract';

export const FINAL_VERDICTS = ['supported', 'partial', 'unsupported', 'contradicted', 'not_checked'] as const;
export type FinalVerdict = (typeof FINAL_VERDICTS)[number];

export const VERDICT_FLAGS = [
  'no_source',
  'no_answer',
  'answered_twice',
  'quote_not_found',
  'quote_from_other_source',
  'part_not_in_claim',
  'support_not_shown',
  'contradiction_not_shown',
] as const;
export type VerdictFlag = (typeof VERDICT_FLAGS)[number];

export interface ClaimVerdict {
  claimId: string;
  verdict: FinalVerdict;
  /** What the verifier answered, before the checks. */
  answered?: { verdict: Verdict; contradicted: boolean };
  /** Quotes found in the claim's own sources, as they appear there. */
  quotes: { sourceId: string; text: string }[];
  /** Parts of the claim its sources do not state, as they appear in the claim. */
  unsupportedParts: string[];
  flags: VerdictFlag[];
}

export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A quote must carry some text: "mg" is in every dose table. */
const MIN_QUOTE_CHARS = 4;

export function checkVerification(raw: RawVerification, input: VerifyInput): ClaimVerdict[] {
  const sources = new Map(input.sources.map((s) => [s.id, normalizeForMatch(s.text)]));
  const context = new Set(input.sources.filter((s) => s.context).map((s) => s.id));
  const answers = new Map<string, RawVerdict[]>();
  for (const r of raw.results ?? []) answers.set(r.claimId, [...(answers.get(r.claimId) ?? []), r]);

  return input.claims.map((claim): ClaimVerdict => {
    const own = claim.sourceIds.filter((id) => sources.has(id));
    if (!own.length) return { claimId: claim.id, verdict: 'unsupported', quotes: [], unsupportedParts: [], flags: ['no_source'] };
    const given = answers.get(claim.id) ?? [];
    if (!given.length) return { claimId: claim.id, verdict: 'not_checked', quotes: [], unsupportedParts: [], flags: ['no_answer'] };
    const flags = new Set<VerdictFlag>();
    // Two answers for one claim: neither can be relied on more than the other, so the less favourable is kept.
    if (given.length > 1) flags.add('answered_twice');
    const a = given.reduce((worst, x) => (rank(x) < rank(worst) ? x : worst));

    const quotes: ClaimVerdict['quotes'] = [];
    for (const q of a.quotes ?? []) {
      const text = normalizeForMatch(q.text ?? '');
      if (!own.includes(q.sourceId)) {
        flags.add('quote_from_other_source');
        continue;
      }
      if (text.replace(/\s/g, '').length < MIN_QUOTE_CHARS || !sources.get(q.sourceId)!.includes(text)) {
        flags.add('quote_not_found');
        continue;
      }
      if (!quotes.some((x) => x.sourceId === q.sourceId && x.text === text)) quotes.push({ sourceId: q.sourceId, text });
    }
    const claimText = normalizeForMatch(claim.text);
    const parts: string[] = [];
    for (const p of a.unsupportedParts ?? []) {
      const text = normalizeForMatch(p ?? '');
      if (!text) continue;
      if (!claimText.includes(text)) flags.add('part_not_in_claim');
      else if (!parts.includes(text)) parts.push(text);
    }

    // A claim that cites data must be shown supported by that data, not only by the context every claim may use.
    const cited = own.filter((id) => !context.has(id));
    const shown = cited.length ? quotes.some((q) => !context.has(q.sourceId)) : quotes.length > 0;
    let verdict: FinalVerdict;
    if (a.verdict === 'unsupported') verdict = 'unsupported';
    else if (!shown) {
      flags.add('support_not_shown');
      verdict = 'unsupported';
      // A verifier that quotes a source the claim does not cite judged it on outside material: at most partly supported.
    } else verdict = a.verdict === 'partial' || parts.length || flags.has('quote_from_other_source') ? 'partial' : 'supported';
    // A contradiction may be shown by any source the claim uses, the case header included (a wrong age).
    if (a.contradicted) {
      if (quotes.length) verdict = 'contradicted';
      else flags.add('contradiction_not_shown');
    }
    return { claimId: claim.id, verdict, answered: { verdict: a.verdict, contradicted: Boolean(a.contradicted) }, quotes, unsupportedParts: parts, flags: [...flags] };
  });
}

function rank(r: RawVerdict): number {
  if (r.contradicted) return 0;
  return r.verdict === 'unsupported' ? 1 : r.verdict === 'partial' ? 2 : 3;
}

/** Whether a claim may enter a form or a presentation on the verifier's account (one signal of five; M5 plan). */
export const passesVerifier = (v: Pick<ClaimVerdict, 'verdict'>): boolean => v.verdict === 'supported';

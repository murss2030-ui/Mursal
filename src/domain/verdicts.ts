/**
 * The verifier's verdicts (Section 12, check 4) as the app keeps them: one
 * append-only record per check of one statement, tied to exactly that
 * statement — its words and what it cites. A statement whose words or
 * sources change has no verdict until it is checked again.
 *
 * Decision 6 of the M5 plan, as the owner approved it on 20 October 2026: a
 * statement enters the official form only with the verdict "supported" and a
 * literal quote. A drafted statement with any other verdict — partly
 * supported, unsupported, contradicted, not checked — is shown with its reason
 * and is edited (in the trainee's own words) or rejected; it is never accepted
 * as it is. The trainee's own statements are checked on request and show
 * their verdict; they are the trainee's judgement and are labelled as such.
 */
import { claimTargets, parseClaims } from './card-data';
import type { Suggestion } from './types';

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
  /** The claim asserts a property, a time, a change, a reason or an absence that no source it cites makes (verification/guard.ts). */
  'unsourced_assertion',
] as const;
export type VerdictFlag = (typeof VERDICT_FLAGS)[number];

/** Only whitespace, quotation marks and dashes are normalised for a comparison — encoding differences, not meaning. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A statement's key: what it cites (`entry:<id>`, `calc:<id>`, `medication:<id>` …, in order) and its words. */
export function claimKey(text: string, targets: readonly string[]): string {
  return `${[...new Set(targets)].sort().join(',')}\u0000${normalizeForMatch(text)}`;
}

/** Where a statement of a draft is: its reason, a note's text, or one claim of a drafted Problem Card. */
export type DraftPart = 'reason' | 'text' | { claim: number };

export type VerifiedOrigin =
  | { kind: 'suggestion'; analysisId: string; suggestionId: string; part: DraftPart }
  /** A claim of a Problem Card, checked on request. */
  | { kind: 'card'; itemId: string; claim: number }
  /** M5d: a claim of a research run. */
  | { kind: 'research'; runId: string; claim: number };

/** One check of one statement against the sources it cites. Append-only: a later check is a new record. */
export interface ClaimVerification {
  id: string;
  caseId: string;
  key: string;
  origin: VerifiedOrigin;
  verdict: FinalVerdict;
  /** Quotes found word for word in the sources the statement cites, with the source's label. */
  quotes: { source: string; text: string }[];
  /** Words of the statement its sources do not state. */
  unsupportedParts: string[];
  flags: VerdictFlag[];
  /** Why the verifier gave no answer (busy, too slow, out of quota): the statement is not checked. */
  failure?: string;
  model?: string;
  promptVersion: string;
  at: string;
}

export const originKey = (o: VerifiedOrigin): string =>
  o.kind === 'suggestion' ? `s:${o.analysisId}:${o.suggestionId}:${typeof o.part === 'string' ? o.part : `c${o.part.claim}`}` : o.kind === 'card' ? `card:${o.itemId}:${o.claim}` : `r:${o.runId}:${o.claim}`;

/** The latest check of each statement, by key and by where it was. Records are in order of time. */
export function indexVerdicts(records: readonly ClaimVerification[]): { byKey: Map<string, ClaimVerification>; byOrigin: Map<string, ClaimVerification> } {
  const byKey = new Map<string, ClaimVerification>();
  const byOrigin = new Map<string, ClaimVerification>();
  for (const r of [...records].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))) {
    byKey.set(r.key, r);
    byOrigin.set(originKey(r.origin), r);
  }
  return { byKey, byOrigin };
}

/** The gate of decision 6: supported, shown by at least one literal quote. */
export const passesGate = (v: Pick<ClaimVerification, 'verdict' | 'quotes'> | undefined): boolean => v?.verdict === 'supported' && v.quotes.length > 0;

export interface DraftStatement {
  part: DraftPart;
  text: string;
  /** What it cites, for its key. */
  targets: string[];
  /** Sent to the verifier: it rests on case data the app holds. A statement that is not (general knowledge) can never pass the gate. */
  checkable: boolean;
}

/**
 * The statements of a drafted suggestion the gate looks at: its reason, a
 * summary's text, each claim of a drafted Problem Card. A note listing missing
 * data or a question is not a claim; neither is a card's teaching explanation
 * (owner decision D6 of M4: general knowledge, labelled as such).
 */
export function draftStatements(s: Pick<Suggestion, 'kind' | 'noteKind' | 'text' | 'reason' | 'basis' | 'refs' | 'register' | 'fields'>): DraftStatement[] {
  const out: DraftStatement[] = [];
  if (s.kind === 'note') {
    if (s.noteKind === 'summary' && s.text?.trim()) out.push({ part: 'text', text: s.text, targets: ['case'], checkable: true });
    return out;
  }
  if (s.reason.trim()) {
    const targets = s.refs.map((r) => `${r.kind}:${r.id}`);
    out.push({ part: 'reason', text: s.reason, targets, checkable: s.basis === 'case_data' && targets.length > 0 });
  }
  if (s.kind === 'item' && s.register === 'drp') {
    parseClaims(s.fields?.claims).forEach((c, i) => {
      const targets = claimTargets(c).map((l) => `${l.kind}:${l.id}`);
      out.push({ part: { claim: i }, text: c.text, targets, checkable: targets.length > 0 });
    });
  }
  return out;
}

/** Whether every statement of a drafted suggestion passed the gate, so that it may be accepted as it is. */
export function passesDraftGate(s: Parameters<typeof draftStatements>[0] & { id: string }, analysisId: string, byOrigin: ReadonlyMap<string, ClaimVerification>): boolean {
  return draftStatements(s).every((st) => st.checkable && passesGate(byOrigin.get(originKey({ kind: 'suggestion', analysisId, suggestionId: s.id, part: st.part }))));
}

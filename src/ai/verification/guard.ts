/**
 * A check in code on what the verifier may accept (Section 12: "Prompt
 * instructions are not a control"). In the live probe of 20 October 2026 the
 * verifier accepted statements whose facts were in the data but which added
 * an assertion of their own: a drug property ("nephrotoxic agents like
 * ibuprofen and metformin" — metformin is not nephrotoxic), a time
 * ("currently" for a value of Day 0 on Day 2), a change cited with one value,
 * a reason, an absence. Whatever the verifier answers, a claim that makes
 * such an assertion is at most partly supported unless a source it cites
 * makes it too; the words are named as unsupported.
 *
 * The rules are lexical and deliberately narrow: each was seen in real
 * drafts, and none fires on a correct item of the semantic benchmark.
 */
import type { VerifySource } from './contract';

export type GuardKind = 'property' | 'current' | 'continuation' | 'change' | 'reason' | 'absence';

export interface GuardHit {
  kind: GuardKind;
  /** The words, as they appear in the claim. */
  text: string;
}

interface Rule {
  kind: GuardKind;
  re: RegExp;
}

const RULES: readonly Rule[] = [
  {
    kind: 'property',
    re: /\b(nephrotoxic\w*|hepatotoxic\w*|ototoxic\w*|cardiotoxic\w*|neurotoxic\w*|myelotoxic\w*|teratogenic|renally (?:cleared|excreted|eliminated)|hepatically (?:cleared|metaboli[sz]ed)|high[- ]alert|narrow therapeutic (?:index|range|window)|contraindicat\w*|qt[- ]prolong\w*|prolongs? the qt\w*|serotonergic|anticholinergic|(?:cyp\s?\w+|p-gp) (?:inhibitor|inducer)s?|interacts? with)\b/gi,
  },
  { kind: 'current', re: /\b(currently|at present|presently|right now|now)\b/gi },
  { kind: 'continuation', re: /\b(still|remains?|remained|persist\w*|ongoing|continues? to)\b/gi },
  { kind: 'change', re: /\b(increas\w*|decreas\w*|rose|risen|rising|fell|fallen|falling|dropp\w*|declin\w*|improv\w*|worsen\w*|deteriorat\w*|reduced|raised|changed|converted|switched)\b/gi },
  { kind: 'reason', re: /\b(for the (?:management|treatment) of|in order to|so as to|secondary to|due to|attributable to|caused by|as a result of)\b/gi },
  {
    kind: 'absence',
    re: /\b(not (?:yet )?(?:been )?(?:ordered|prescribed|documented|recorded|given|started|defined|specified|included|planned)|no (?:documented|recorded)|no (?:\w+ ){0,3}(?:is|are|was|were|has been|have been) (?:ordered|prescribed|documented|recorded|given|started|planned)|without (?:a |any )?(?:documented|recorded|ordered|prescribed))\b/gi,
  },
];

/** The part of a matched word that a source must share: its stem for a single word ("nephrotox"), the phrase otherwise. */
export function stem(words: string): string {
  const w = words.toLowerCase();
  if (/\s/.test(w)) return w;
  const s = w.replace(/(?:ically|ities|ity|ical|ions?|ing|ed|ic|es|s|ly)$/, '');
  return s.length >= 4 ? s : w;
}

const DAY = /\b(?:hospital )?day\s*-?\d+\b/gi;
const NUMBER = /(?<![\p{L}\p{N}.])\d+(?:\.\d+)?(?![\p{L}\p{N}]|\.\d)/gu;
const numbersIn = (s: string) => [...s.replace(DAY, ' ').matchAll(NUMBER)].map((m) => String(Number(m[0])));

/** Today's hospital day, from the case header source (`"hospitalDayToday":N`). */
function todayOf(sources: readonly VerifySource[]): number | undefined {
  for (const s of sources) {
    const m = s.context ? /"hospitalDayToday":\s*(-?\d+)/.exec(s.text) : null;
    if (m) return Number(m[1]);
  }
  return undefined;
}

/**
 * The assertions of `claim` that no cited source makes. `sources` are the
 * sources the claim cites (the case header among them, marked `context`).
 */
export function unsourcedAssertions(claim: string, sources: readonly VerifySource[]): GuardHit[] {
  const texts = sources.map((s) => s.text.toLowerCase());
  const said = (words: string) => texts.some((t) => t.includes(stem(words)));
  const data = sources.filter((s) => !s.context);
  const sameSubject = (() => {
    const seen = new Map<string, Set<number | undefined>>();
    for (const s of data) if (s.subject) seen.set(s.subject.toLowerCase(), new Set([...(seen.get(s.subject.toLowerCase()) ?? []), s.day]));
    return [...seen.values()];
  })();
  const twoOfOneSubject = sameSubject.some((days) => days.size >= 2);
  const sourceNumbers = new Set(data.flatMap((s) => numbersIn(s.text)));
  const claimNumbersFound = new Set(numbersIn(claim).filter((n) => sourceNumbers.has(n))).size;
  const today = todayOf(sources);
  const hits: GuardHit[] = [];
  for (const rule of RULES) {
    for (const m of claim.matchAll(rule.re)) {
      const text = m[0];
      if (said(text)) continue;
      // A change, or a state that lasts, is shown by two values of the same thing (or two numbers of the claim found in its sources).
      if ((rule.kind === 'change' || rule.kind === 'continuation') && (twoOfOneSubject || claimNumbersFound >= 2)) continue;
      // "Currently" is shown by a value recorded today.
      if (rule.kind === 'current' && today !== undefined && data.some((s) => s.day === today)) continue;
      if (!hits.some((h) => h.text.toLowerCase() === text.toLowerCase())) hits.push({ kind: rule.kind, text });
    }
  }
  return hits;
}

/**
 * The checks on a researched answer, in code (Section 12 — "prompt
 * instructions are not a control"; Section 21's four hostile fixtures):
 *
 * 1. Shape: roles, texts and quotes are the contract's (the schema is checked
 *    by callModel; here an empty or unknown statement is dropped).
 * 2. The source exists: a statement citing a passage that was not retrieved
 *    is kept, flagged, and can never be added to a card.
 * 3. The quote is found, word for word, in the passage it cites.
 * 4. (The independent verifier reads meaning — research/verify.ts.)
 * 5. Numbers: a number the quote does not contain is removed, a dose it does
 *    not contain is withheld, citations the model wrote are removed, and a
 *    dose that differs from the calculation the card cites for the same
 *    quantity is flagged in red and not shown as the model wrote it.
 */
import type { CalcResult } from '../../calc/types';
import { calcNumbers } from '../../domain/problem-card';
import { RESEARCH_ROLES, type CaseRef, type ResearchFlag, type ResearchStatement } from '../../domain/research';
import { normalizeForMatch } from '../../domain/verdicts';
import type { SuggestionCheck } from '../../domain/types';
import { cleanStatement, numbersIn } from '../analysis/verify';
import { MAX_QUOTE, MIN_QUOTE, type CaseValue, type RawResearch, type SentSource } from './contract';

export interface CheckContext {
  sent: readonly SentSource[];
  /** The case values the model could point to; a calculation carries its result for the cross-check. */
  values: readonly (CaseValue & { calc?: CalcResult })[];
}

const DOSE_PAIR = /(?<![\p{L}\p{N}.\-/])(\d+(?:\.\d+)?)\s*(mg\/kg\/day|mg\/kg|mcg\/kg|units\/kg|mg\/24\s?h|mg\/h|ml\/h|mcg\/min|mg\/day|mg|g|mcg|µg|ug|units?|iu|ml|mmol|meq)(?![\w/])/giu;

/** One spelling for a unit, so that "mg/24 h" and "mg/day" compare equal. */
export function canonUnit(u: string): string {
  const x = u.toLowerCase().replace(/\s+/g, '').replace('µg', 'mcg').replace(/^ug$/, 'mcg');
  return x === 'mg/24h' ? 'mg/day' : x === 'units' ? 'unit' : x;
}

const FLAG_OF: Partial<Record<SuggestionCheck, ResearchFlag>> = {
  citation_removed: 'citation_removed',
  source_named: 'source_named',
  dose_withheld: 'dose_withheld',
  number_removed: 'number_removed',
};

const shown = (r: CalcResult): string => `${Number(r.value.toFixed(r.decimals))} ${r.unit}`;

export function checkResearch(raw: RawResearch, ctx: CheckContext): { statements: ResearchStatement[]; dropped: number } {
  const bySource = new Map(ctx.sent.map((s) => [s.id, s]));
  const byLabel = new Map(ctx.values.map((v) => [v.label, v]));
  const out: ResearchStatement[] = [];
  let dropped = 0;
  for (const r of raw.statements ?? []) {
    const text = (r.text ?? '').replace(/\s+/g, ' ').trim();
    if (!(RESEARCH_ROLES as readonly string[]).includes(r.role) || !text) {
      dropped++;
      continue;
    }
    const flags = new Set<ResearchFlag>();
    const quote = (r.quote ?? '').replace(/\s+/g, ' ').trim();
    const source = bySource.get(r.sourceId);
    // Check 2: the passage must be one that was retrieved and sent.
    if (!source) flags.add('source_not_retrieved');
    // Check 3: the quote is in that passage, word for word (whitespace, quotation marks and dashes aside).
    else if (quote.length < MIN_QUOTE || quote.length > MAX_QUOTE || !normalizeForMatch(source.text).includes(normalizeForMatch(quote))) flags.add('quote_not_found');

    const caseRefs: CaseRef[] = [...new Set(r.caseRefs ?? [])].flatMap((l) => {
      const v = byLabel.get(l);
      return v ? [{ kind: v.kind, id: v.id, label: v.label }] : [];
    });

    // Check 5a: a dose that differs from a calculation of the same quantity (the card's own calculations are all in ctx.values).
    let working = text;
    const inQuote = numbersIn(quote);
    const differsFrom: { label: string; result: string }[] = [];
    const calcs = ctx.values.flatMap((v) => (v.calc ? [{ label: v.label, calc: v.calc, unit: canonUnit(v.calc.unit) }] : []));
    working = working.replace(DOSE_PAIR, (whole, num: string, unit: string) => {
      const same = calcs.filter((c) => c.unit === canonUnit(unit));
      if (!same.length) return whole;
      const n = String(Number(num));
      if (same.some((c) => calcNumbers(c.calc).has(n))) return whole;
      for (const c of same) if (!differsFrom.some((d) => d.label === c.label)) differsFrom.push({ label: c.label, result: shown(c.calc) });
      flags.add('differs_from_calculation');
      // A dose the quote does not contain is withheld for that reason too (check 5b), whatever the calculation says.
      if (!inQuote.has(n)) flags.add('dose_withheld');
      return '[dose withheld — differs from the calculation]';
    });

    // Check 5b: numbers and doses must be in the quote; citations the model wrote are removed.
    const cleaned = cleanStatement(working, inQuote, inQuote);
    for (const c of cleaned.checks) {
      const f = FLAG_OF[c];
      if (f) flags.add(f);
    }

    const finalText = cleaned.text.trim();
    if (!finalText) {
      dropped++;
      continue;
    }
    out.push({
      n: out.length,
      role: r.role,
      text: finalText,
      sourceId: source ? source.recordId : r.sourceId,
      ...(source?.section ? { section: source.section } : {}),
      quote,
      caseRefs,
      flags: [...flags],
      ...(differsFrom.length ? { differsFrom } : {}),
    });
  }
  return { statements: out, dropped };
}

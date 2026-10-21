/**
 * The statements of a drafted module that rest on case data, with the data
 * they cite, ready for the verifier: a checklist answer's reason, a register
 * row's reason, each claim of a drafted Problem Card that cites a timeline
 * entry or a calculation result, and (M5) each task's summary, checked
 * against the whole case that was sent. Statements marked general knowledge,
 * and notes that list missing data or questions, are not claims about a
 * source and are not sent.
 *
 * Each source is the very text the drafting model received for that
 * reference; the case's header (age, sex, height, today's hospital day) is a
 * source every statement may use.
 */
import { claimTargets, parseClaims } from '../../domain/card-data';
import type { Suggestion } from '../../domain/types';
import { draftStatements, type DraftPart } from '../../domain/verdicts';
import type { CasePayload, RefTarget } from '../analysis/payload';
import type { VerifyClaim, VerifyInput, VerifySource } from './contract';

export interface ClaimOrigin {
  suggestionId: string;
  taskId: string;
  /** The suggestion's reason, a note's text, or the index of a Problem Card's claim. */
  part: DraftPart;
  /** The statement and what it cites, for its key (verdicts.ts). */
  text: string;
  targets: string[];
}

export interface SuggestionClaims {
  input: VerifyInput;
  origin: Map<string, ClaimOrigin>;
}

export const HEADER_SOURCE = 'H';

/** The label a quote is shown under: what the source is, and its day. */
export const sourceLabel = (t: Pick<RefTarget, 'label' | 'day'>): string => (t.day !== undefined ? `${t.label} — Day ${t.day}` : t.label);

export function claimsFromSuggestions(suggestions: readonly Suggestion[], payload: CasePayload): SuggestionClaims {
  const sourceOf = new Map<string, string>(); // `${kind}:${id}` → source id
  const sources: VerifySource[] = [{ id: HEADER_SOURCE, label: 'Case header', text: `Case: ${payload.context}`, context: true }];
  const byKey = new Map<string, RefTarget>();
  const byEntry = new Map<string, RefTarget>();
  for (const t of payload.refs.values()) {
    byKey.set(`${t.kind}:${t.id}`, t);
    if (t.kind === 'entry') byEntry.set(t.id, t);
    else if (t.entryId && !byEntry.has(t.entryId)) byEntry.set(t.entryId, t);
  }
  const source = (t: RefTarget | undefined): string | undefined => {
    if (!t) return undefined;
    const key = `${t.kind}:${t.id}`;
    let id = sourceOf.get(key);
    if (!id) {
      id = `S${sources.length}`;
      sourceOf.set(key, id);
      sources.push({ id, label: sourceLabel(t), text: t.text.replace(/\s+/g, ' ').trim(), ...(t.subject ? { subject: t.subject } : {}), ...(t.day !== undefined ? { day: t.day } : {}) });
    }
    return id;
  };

  const claims: VerifyClaim[] = [];
  const origin = new Map<string, ClaimOrigin>();
  const add = (text: string, ids: (string | undefined)[], o: ClaimOrigin) => {
    const sourceIds = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!text.trim() || !sourceIds.length) return;
    const id = `V${claims.length + 1}`;
    claims.push({ id, text: text.trim(), sourceIds: [HEADER_SOURCE, ...sourceIds] });
    origin.set(id, o);
  };
  // A summary is about the whole case: it cites every timeline entry, medication, problem and calculation that was sent.
  const wholeCase = () => [...payload.refs.values()].filter((t) => t.kind !== 'item').map(source);

  const summaries: [string, ClaimOrigin][] = [];
  for (const s of suggestions) {
    for (const st of draftStatements(s)) {
      if (!st.checkable) continue;
      const o: ClaimOrigin = { suggestionId: s.id, taskId: s.taskId, part: st.part, text: st.text, targets: st.targets };
      if (st.part === 'text') summaries.push([st.text, o]);
      else if (st.part === 'reason') add(st.text, s.refs.map((r) => source(byKey.get(`${r.kind}:${r.id}`))), o);
      else {
        // Every value the claim cites (a change cites both).
        const c = parseClaims(s.fields?.claims)[st.part.claim]!;
        add(st.text, claimTargets(c).map((l) => source(l.kind === 'calc' ? byKey.get(`calc:${l.id}`) : byEntry.get(l.id))), o);
      }
    }
  }
  // Summaries last, so that the batches citing the whole case are as few as possible.
  for (const [text, o] of summaries) add(text, wholeCase(), o);
  return { input: { claims, sources }, origin };
}

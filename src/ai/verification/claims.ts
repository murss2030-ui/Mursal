/**
 * The statements of a drafted module that rest on case data, with the data
 * they cite, ready for the verifier: a checklist answer's reason, a register
 * row's reason, and each claim of a drafted Problem Card that cites a timeline
 * entry or a calculation result. Statements marked general knowledge, and
 * notes (summaries, missing data, questions), are not claims about a source
 * and are not sent.
 *
 * Each source is the very text the drafting model received for that
 * reference; the case's header (age, sex, height, today's hospital day) is a
 * source every statement may use.
 */
import { parseClaims } from '../../domain/card-data';
import type { Suggestion } from '../../domain/types';
import type { CasePayload, RefTarget } from '../analysis/payload';
import type { VerifyClaim, VerifyInput, VerifySource } from './contract';

export interface ClaimOrigin {
  suggestionId: string;
  taskId: string;
  /** The suggestion's reason, or the index of a Problem Card's claim. */
  part: 'reason' | { claim: number };
}

export interface SuggestionClaims {
  input: VerifyInput;
  origin: Map<string, ClaimOrigin>;
}

const HEADER = 'H';

export function claimsFromSuggestions(suggestions: readonly Suggestion[], payload: CasePayload): SuggestionClaims {
  const sourceOf = new Map<string, string>(); // `${kind}:${id}` → source id
  const sources: VerifySource[] = [{ id: HEADER, label: 'Case header', text: `Case: ${payload.context}`, context: true }];
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
      sources.push({ id, label: t.label, text: t.text.replace(/\s+/g, ' ').trim() });
    }
    return id;
  };

  const claims: VerifyClaim[] = [];
  const origin = new Map<string, ClaimOrigin>();
  const add = (text: string, ids: (string | undefined)[], o: ClaimOrigin) => {
    const sourceIds = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!text.trim() || !sourceIds.length) return;
    const id = `V${claims.length + 1}`;
    claims.push({ id, text: text.trim(), sourceIds: [HEADER, ...sourceIds] });
    origin.set(id, o);
  };

  for (const s of suggestions) {
    if (s.kind === 'note') continue;
    if (s.basis === 'case_data' && s.refs.length && s.reason)
      add(
        s.reason,
        s.refs.map((r) => source(byKey.get(`${r.kind}:${r.id}`))),
        { suggestionId: s.id, taskId: s.taskId, part: 'reason' },
      );
    if (s.kind === 'item' && s.register === 'drp' && s.fields?.claims) {
      parseClaims(s.fields.claims).forEach((c, i) => {
        if ((c.source !== 'entry' && c.source !== 'calc') || !c.ref) return;
        const t = c.source === 'calc' ? byKey.get(`calc:${c.ref}`) : byEntry.get(c.ref);
        add(c.text, [source(t)], { suggestionId: s.id, taskId: s.taskId, part: { claim: i } });
      });
    }
  }
  return { input: { claims, sources }, origin };
}

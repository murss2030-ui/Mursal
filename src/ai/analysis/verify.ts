/**
 * Verification enforced in code (Section 12: "Prompt instructions are not a
 * control"). Every proposal of the model passes these checks before it is
 * shown, whatever the model was told:
 *
 * 1. References must exist among the data actually sent; others are removed
 *    and flagged. A "case data" statement left with no valid reference is
 *    shown as having no source.
 * 2. Every number must appear in the data the statement references (or, for
 *    notes without references, in the case data sent), in the case's header
 *    (age, height, today's hospital day) or in the checklist item it answers;
 *    otherwise it is removed, and a number next to a dose unit is withheld as
 *    a dose (Decision 12: never an unsupported numerical dose).
 * 3. Citations — URLs, DOIs, PMIDs, "et al.", bracketed references, grades —
 *    are removed; commercial references are never named; a named source the
 *    app did not retrieve is labelled.
 * 4. Tasks, checklist items, registers, fields and choice values must be the
 *    ones defined; anything else is dropped.
 * 5. What only the trainee can record (limits.ts) is removed: what a person
 *    did, what happened, outcomes, sources and references.
 */
import { REGISTERS, type FieldDef } from '../../domain/workflow/registers';
import { claimsValue, linksValue, MAX_CLAIM_ALSO, MAX_CLAIM_TEXT, MAX_CLAIMS, parseClaims, type CardClaim, type CardLink } from '../../domain/card-data';
import type { TaskDef } from '../../domain/workflow/catalogue';
import { normalizeItemFields } from '../../domain/workflow/registers';
import { namedDrugs, pcneCoherence } from '../../domain/pcne-coherence';
import type { CheckValue, ClaimBasis, Suggestion, SuggestionCheck } from '../../domain/types';
import type { CasePayload, RefTarget } from './payload';
import type { RawAnalysis, RawClaim, RawSuggestionBase } from './contract';
import { fieldLimit, modelMayAddTo, modelMayAnswer } from './limits';

const NUMBER = /(?<![\p{L}\p{N}.\-/])\d+(?:\.\d+)?(?![\p{L}\p{N}]|\.\d)/gu;
// Compound units first; a bare unit followed by "/" is a rate such as mL/min (a clearance), not a dose.
const DOSE_UNIT = /^\s*(?:mg\/kg\/day|mg\/kg|mcg\/kg|units\/kg|mg\/h|ml\/h|mg\/day|mg|g|mcg|µg|ug|units?|iu|ml|mmol|meq|tablets?|tabs?|capsules?|puffs?|drops?)(?![\w/])/i;

const COMMERCIAL = /\b(up\s?to\s?date|lexi-?comp|lexidrug|micromedex|medscape|epocrates|clinical pharmacology|bnf|nice|nccn)\b/gi;
const CITATIONS: readonly RegExp[] = [
  /\bhttps?:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  /\bdoi:?\s*10\.\d{4,9}\/\S+/gi,
  /\b10\.\d{4,9}\/\S+/g,
  /\bPMID:?\s*\d+/gi,
  /\(?\b[A-Z][A-Za-z'-]+ et al\.?(?:,?\s*\(?(?:19|20)\d{2}[a-z]?\)?)?\)?/g,
  /\[\d+(?:\s*[,–-]\s*\d+)*\]/g,
  /\((?:[A-Z][A-Za-z'-]+(?: et al\.?)?,?\s*)?(?:19|20)\d{2}\)/g,
  /\b(?:grade|level)\s+(?:of\s+evidence\s+)?(?:[A-D]|[1-3][abc]?)\b/gi,
  /\bclass\s+(?:I{1,3}|IV)[ab]?\s+recommendation\b/gi,
];
const NAMED_SOURCE = /\b(according to|as recommended by|recommended by|per the|guidelines? (?:from|by|of))\b|\b(IDSA|ATS|KDIGO|ACC\/AHA|AHA|ESC|ADA|GOLD|GINA|CHEST|WHO|ASHP|ACCP|FDA)\b/;
/** "(R2)", "[E3, E4]", "(see C1)": a payload reference written into a text. */
const REF_IN_TEXT = /\s*[([]\s*(?:refs?\.?:?\s*|see\s+)?[CEMPR]\d{1,3}(?:\s*(?:[,;/&]|and)\s*[CEMPR]\d{1,3})*\s*[)\]]/gi;
/** "were reconciled", "was checked": what a person did, which only the trainee records (limits.ts; Section 24). */
const ACTION =
  /\b(?:was|were|has been|have been|had been)\s+(?:(?:already|then|also|carefully|fully|not)\s+)?(?:checked|double-checked|reviewed|reconciled|evaluated|assessed|verified|screened|counsell?ed|educated|discussed|communicated|implemented)\b/i;

/** A Problem Card as compared for duplicates: the same drugs and the same PCNE problem, or the same sentence when no drug is named. */
export function cardKey(c: { problem?: string; drugs?: string; pcneProblem?: string }): string {
  const drugs = namedDrugs(c.drugs)?.map((d) => d.toLowerCase()).sort().join('+');
  return drugs ? `${drugs}#${c.pcneProblem ?? ''}` : `text#${(c.problem ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`;
}

function numbersIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(NUMBER)) out.add(String(Number(m[0])));
  return out;
}

export interface CleanResult {
  text: string;
  checks: Set<SuggestionCheck>;
}

/**
 * Removes citations, unsupported numbers and doses from a statement. A number
 * next to a dose unit must come from `doseAllowed` — the data the statement
 * cites — never merely from the case header or the checklist wording.
 */
export function cleanStatement(text: string, allowed: ReadonlySet<string>, doseAllowed: ReadonlySet<string> = allowed): CleanResult {
  const checks = new Set<SuggestionCheck>();
  // M5: references belong in refs, not in the text (live probe: "Amlodipine (R2)").
  let s = text.replace(REF_IN_TEXT, '');
  for (const re of CITATIONS) {
    if (re.test(s)) {
      checks.add('citation_removed');
      s = s.replace(re, '');
    }
    re.lastIndex = 0;
  }
  if (COMMERCIAL.test(s)) {
    checks.add('citation_removed');
    s = s.replace(COMMERCIAL, '[source name removed]');
  }
  COMMERCIAL.lastIndex = 0;
  if (NAMED_SOURCE.test(s)) checks.add('source_named');
  let out = '';
  let pos = 0;
  for (const m of s.matchAll(NUMBER)) {
    const n = String(Number(m[0]));
    const after = s.slice(m.index! + m[0].length);
    const dose = DOSE_UNIT.test(after);
    if (dose ? doseAllowed.has(n) : allowed.has(n)) continue;
    out += s.slice(pos, m.index!);
    if (dose) {
      checks.add('dose_withheld');
      out += '[dose withheld — to be calculated]';
      pos = m.index! + m[0].length + (DOSE_UNIT.exec(after)?.[0].length ?? 0);
    } else {
      checks.add('number_removed');
      out += '[number removed]';
      pos = m.index! + m[0].length;
    }
  }
  out += s.slice(pos);
  // Tidy what removals leave behind: empty brackets and stray spaces before punctuation.
  const tidy = out
    .replace(/\(\s*[,;]?\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:)])/g, '$1')
    .trim();
  return { text: tidy, checks };
}

interface Refs {
  basis: ClaimBasis;
  refs: Suggestion['refs'];
  /** Numbers a statement may use: the cited data, the case header (and, for a checklist answer, its wording). */
  allowed: Set<string>;
  /** Numbers a dose may use: the cited data only. */
  cited: Set<string>;
  checks: Set<SuggestionCheck>;
}

function resolveRefs(raw: RawSuggestionBase, payload: CasePayload, everything: ReadonlySet<string>, fallbackToAll: boolean): Refs {
  const checks = new Set<SuggestionCheck>();
  const refs: Suggestion['refs'] = [];
  const cited = new Set<string>();
  for (const r of raw.refs ?? []) {
    const t = payload.refs.get(r.trim());
    if (!t) {
      checks.add('unknown_ref_removed');
      continue;
    }
    if (!refs.some((x) => x.id === t.id)) refs.push({ kind: t.kind, id: t.id, label: t.label });
    for (const n of numbersIn(t.text)) cited.add(n);
  }
  let basis: ClaimBasis = raw.basis === 'case_data' ? 'case_data' : 'general_knowledge';
  if (basis === 'case_data' && refs.length === 0) {
    if (!fallbackToAll) {
      checks.add('no_valid_ref');
      basis = 'general_knowledge';
    }
  }
  if (fallbackToAll && refs.length === 0) for (const n of everything) cited.add(n);
  // The case header is data every statement may use (live run: "a 67-year-old", "on hospital day 3" were removed).
  const allowed = new Set([...cited, ...numbersIn(payload.context)]);
  return { basis, refs, allowed, cited, checks };
}

function scopeOf(def: TaskDef, checkId: string): 'case' | 'medication' | 'problem' | undefined {
  if (def.case?.checks.some((c) => c.id === checkId)) return 'case';
  if (def.perMedication?.checks.some((c) => c.id === checkId)) return 'medication';
  if (def.perProblem?.checks.some((c) => c.id === checkId)) return 'problem';
  return undefined;
}

function itemFields(
  register: string,
  raw: { field: string; value: string }[],
  allowed: ReadonlySet<string>,
  cited: ReadonlySet<string>,
  payload: CasePayload,
  checks: Set<SuggestionCheck>,
): Record<string, string> {
  const def = REGISTERS[register as keyof typeof REGISTERS];
  const byId = new Map<string, FieldDef>(def.fields.map((f) => [f.id, f]));
  const out: Record<string, string> = {};
  for (const { field, value } of raw) {
    const f = byId.get(field);
    const v = (value ?? '').trim();
    if (!f || !v || f.kind === 'confirm') {
      if (f?.kind === 'confirm' || (!f && v)) checks.add('invalid_value_removed');
      continue;
    }
    const limit = fieldLimit(def.id, f.id);
    if (limit === 'never' || (Array.isArray(limit) && !v.split(/[|,]/).every((x) => limit.includes(x.trim())))) {
      checks.add('trainee_only_removed');
      continue;
    }
    if (f.kind === 'choice') {
      if (f.options?.some((o) => o.value === v)) out[f.id] = v;
      else checks.add('invalid_value_removed');
    } else if (f.kind === 'multi') {
      const given = v.split(/[|,]/).map((x) => x.trim()).filter(Boolean);
      let parts = [...new Set(given.filter((x) => f.options?.some((o) => o.value === x)))];
      // "No obvious cause" beside named causes: the named causes are kept.
      if (parts.length > 1 && f.exclusive) parts = parts.filter((x) => !f.exclusive!.includes(x));
      if (parts.length < given.length) checks.add('invalid_value_removed');
      if (parts.length) out[f.id] = parts.join('|');
    } else if (f.kind === 'links') {
      // M4: a Problem Card's supporting data — only references to data that was sent, timeline entries and calculation results.
      const links: CardLink[] = [];
      for (const token of v.split(/[\s,;|]+/).filter(Boolean)) {
        const t = payload.refs.get(token);
        // A medication or a problem is linked through its latest entry on the timeline (its order, its note).
        const link: CardLink | undefined =
          t?.kind === 'entry' || t?.kind === 'calc' ? { kind: t.kind, id: t.id } : t?.entryId ? { kind: 'entry', id: t.entryId } : undefined;
        if (!link) checks.add('unknown_ref_removed');
        else if (!links.some((l) => l.id === link.id)) links.push(link);
      }
      if (links.length) out[f.id] = linksValue(links);
    } else if (f.kind === 'medRef' || f.kind === 'problemRef' || f.kind === 'entryRef') {
      const t = payload.refs.get(v);
      const want = f.kind === 'medRef' ? 'medication' : f.kind === 'problemRef' ? 'problem' : 'entry';
      if (t && t.kind === want) out[f.id] = t.id;
      else checks.add('invalid_value_removed');
    } else if (f.kind === 'day') {
      const n = Number(v);
      if (Number.isInteger(n) && allowed.has(String(n))) out[f.id] = String(n);
      else checks.add('number_removed');
    } else {
      const c = cleanStatement(v, allowed, cited);
      for (const x of c.checks) checks.add(x);
      if (c.text) out[f.id] = c.text;
    }
  }
  return out;
}

/**
 * M4: the claims of a drafted Problem Card. Each keeps only references to data
 * that was sent; its numbers must be in what it cites (a dose, only in a cited
 * calculation result); a citation is removed; a claim without a valid source
 * is general knowledge — no source.
 */
export function draftClaims(raw: readonly RawClaim[], payload: CasePayload, checks: Set<SuggestionCheck>): CardClaim[] {
  const header = numbersIn(payload.context);
  const out: CardClaim[] = [];
  for (const c of raw.slice(0, MAX_CLAIMS)) {
    const targets: RefTarget[] = [];
    for (const r of c.refs ?? []) {
      const t = payload.refs.get(r.trim());
      if (t) targets.push(t);
      else checks.add('unknown_ref_removed');
    }
    const cited = new Set<string>();
    for (const t of targets) for (const n of numbersIn(t.text)) cited.add(n);
    const clean = cleanStatement(c.text ?? '', new Set([...cited, ...header]), cited);
    for (const x of clean.checks) checks.add(x);
    const text = clean.text.slice(0, MAX_CLAIM_TEXT);
    if (!text) continue;
    // M5: a claim may cite several values (a change cites both); a medication or a problem is cited through its latest entry. A calculation comes first.
    const links: CardLink[] = [];
    const order = (t: RefTarget) => (t.kind === 'calc' ? 0 : t.kind === 'entry' ? 1 : 2);
    for (const t of [...targets].sort((a, b) => order(a) - order(b))) {
      const link: CardLink | undefined = t.kind === 'calc' || t.kind === 'entry' ? { kind: t.kind, id: t.id } : t.entryId ? { kind: 'entry', id: t.entryId } : undefined;
      if (link && !links.some((l) => l.kind === link.kind && l.id === link.id)) links.push(link);
    }
    if (c.basis === 'case_data' && !links.length) checks.add('no_valid_ref');
    const [first, ...more] = c.basis === 'case_data' ? links : [];
    const source: Pick<CardClaim, 'source' | 'ref' | 'also'> = first
      ? { source: first.kind, ref: first.id, ...(more.length ? { also: more.slice(0, MAX_CLAIM_ALSO).map((l) => `${l.kind === 'entry' ? 'e' : 'c'}:${l.id}`) } : {}) }
      : { source: 'none' };
    out.push({ text, ...source, by: 'model' });
  }
  return out;
}

/** The model's draft for one module → suggestions the trainee can decide on, after every check. */
export function verifyAnalysis(raw: RawAnalysis, payload: CasePayload): { suggestions: Suggestion[]; dropped: number } {
  const suggestions: Suggestion[] = [];
  let dropped = 0;
  let n = 0;
  // Every number of the cited data sent; notes without references are checked against it (plus the case header).
  const everything = new Set<string>();
  for (const t of payload.refs.values()) for (const x of numbersIn(t.text)) everything.add(x);
  const noteAllowed = new Set([...everything, ...numbersIn(payload.context)]);
  const next = () => `s${++n}`;
  const drafted = new Set<string>();

  for (const draft of raw.tasks ?? []) {
    const def = payload.tasks.find((t) => t.id === draft.taskId);
    if (!def) {
      dropped += (draft.checks?.length ?? 0) + (draft.items?.length ?? 0) + 1;
      continue;
    }
    const note = (noteKind: 'summary' | 'missing' | 'question', text: string) => {
      const c = cleanStatement(text, noteAllowed, everything);
      if (!c.text) return;
      if (ACTION.test(c.text)) c.checks.add('states_action');
      suggestions.push({ id: next(), taskId: def.id, kind: 'note', noteKind, text: c.text, reason: '', basis: 'case_data', refs: [], checks: [...c.checks] });
    };
    if (draft.summary?.trim()) note('summary', draft.summary);

    for (const ck of draft.checks ?? []) {
      const scope = scopeOf(def, ck.checkId);
      if (!scope || !modelMayAnswer(def.id, ck.checkId)) {
        dropped++;
        continue;
      }
      let scopeId: string | undefined;
      if (scope !== 'case') {
        const t = ck.scopeRef ? payload.refs.get(ck.scopeRef.trim()) : undefined;
        if (!t || t.kind !== scope) {
          dropped++;
          continue;
        }
        scopeId = t.id;
      }
      const r = resolveRefs(ck, payload, everything, false);
      // The checklist item's own wording may carry numbers ("48–72 hour review documented").
      const label = [...(def.case?.checks ?? []), ...(def.perMedication?.checks ?? []), ...(def.perProblem?.checks ?? [])].find((x) => x.id === ck.checkId)?.label.en ?? '';
      for (const n of numbersIn(label)) r.allowed.add(n);
      const c = cleanStatement(ck.reason ?? '', r.allowed, r.cited);
      // The reason is shown, not stored: a process statement is flagged so the trainee reads it for what it is.
      if (ACTION.test(c.text)) c.checks.add('states_action');
      suggestions.push({
        id: next(),
        taskId: def.id,
        kind: 'check',
        checkId: ck.checkId,
        ...(scopeId ? { scope: scopeId } : {}),
        answer: ck.answer as CheckValue,
        reason: c.text,
        basis: r.basis,
        refs: r.refs,
        checks: [...new Set([...r.checks, ...c.checks])],
      });
    }

    for (const it of draft.items ?? []) {
      if (!(def.registers ?? []).includes(it.register as never) || !modelMayAddTo(it.register as never)) {
        dropped++;
        continue;
      }
      const r = resolveRefs(it, payload, everything, false);
      const checks = new Set<SuggestionCheck>(r.checks);
      const fields = itemFields(it.register, it.fields ?? [], r.allowed, r.cited, payload, checks);
      if (it.register === 'drp' && it.claims?.length) {
        const claims = draftClaims(it.claims, payload, checks);
        if (claims.length) fields.claims = claimsValue(claims);
      }
      const c = cleanStatement(it.reason ?? '', r.allowed, r.cited);
      for (const x of c.checks) checks.add(x);
      // M5: a card whose classification disagrees with its own problem sentence is never accepted as it is; only the trainee gives the reason.
      const questioned = it.register === 'drp' && pcneCoherence(fields).length > 0;
      if (questioned) checks.add('classification_questioned');
      const valid = normalizeItemFields(it.register as never, fields);
      if (!valid.ok && Object.keys(valid.errors).some((k) => !(questioned && k === 'classificationReason'))) checks.add('incomplete');
      // M5: a stored text that says something was done is the trainee's to write (Section 24).
      const def2 = REGISTERS[it.register as keyof typeof REGISTERS];
      const texts = [...def2.fields.filter((f) => f.kind === 'text' || f.kind === 'longtext').map((f) => fields[f.id] ?? ''), ...parseClaims(fields.claims).map((x) => x.text)];
      if (texts.some((x) => ACTION.test(x))) checks.add('states_action');
      // M5: one card per problem (live probe: Tasks 5 and 29 drafted the same four problems).
      if (it.register === 'drp') {
        const key = cardKey(fields);
        if (payload.cards?.some((x) => cardKey(x) === key) || drafted.has(key)) checks.add('duplicate_card');
        drafted.add(key);
      }
      suggestions.push({ id: next(), taskId: def.id, kind: 'item', register: it.register as never, fields, reason: c.text, basis: r.basis, refs: r.refs, checks: [...checks] });
    }

    for (const m of draft.missingData ?? []) note('missing', m);
    for (const q of draft.questions ?? []) note('question', q);
  }
  return { suggestions, dropped };
}

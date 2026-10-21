/**
 * Two parts of the Problem Card stored inside its register row (Section 14):
 *
 * - Field 2, supporting data: links to timeline entries and calculation
 *   results, stored as `e:<entry id>|c:<result id>`. The card shows each with
 *   its value and day, and its staleness is computed from them.
 * - Field 7, claims (Section 7, Claim): each statement with its source,
 *   stored as JSON. Before the evidence library (M5) a source is the case's
 *   own data, a calculation, PRECEPTOR's offline interaction check, a source
 *   the trainee read themselves, or none — general knowledge, unverified.
 */

export type CardLink = { kind: 'entry' | 'calc'; id: string };

export const MAX_LINKS = 40;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

export function parseLinks(v: string | undefined): CardLink[] {
  if (!v) return [];
  const out: CardLink[] = [];
  for (const part of v.split('|')) {
    const m = /^([ec]):(.+)$/.exec(part);
    if (m && ID.test(m[2]!)) out.push({ kind: m[1] === 'e' ? 'entry' : 'calc', id: m[2]! });
  }
  return out;
}

export const linksValue = (links: readonly CardLink[]): string => links.map((l) => `${l.kind === 'entry' ? 'e' : 'c'}:${l.id}`).join('|');

/** Checks the stored form; existence in the case is checked by the store. */
export function normalizeLinks(v: string): { ok: true; value: string } | { ok: false; error: 'invalidChoice' | 'tooLong' } {
  const parts = v.split('|').filter(Boolean);
  if (parts.length > MAX_LINKS) return { ok: false, error: 'tooLong' };
  const links = parseLinks(v);
  if (links.length !== parts.length) return { ok: false, error: 'invalidChoice' };
  if (new Set(parts).size !== parts.length) return { ok: false, error: 'invalidChoice' };
  return { ok: true, value: linksValue(links) };
}

// ---------------------------------------------------------------- claims

export const CLAIM_SOURCES = ['entry', 'calc', 'dataset', 'reading', 'none'] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];

export interface CardClaim {
  text: string;
  source: ClaimSource;
  /** entry: a timeline entry id; calc: a calculation result id; dataset: the interaction alert's key. */
  ref?: string;
  /** M5, entry or calc only: the other values the claim rests on, as `e:<entry id>` or `c:<result id>` — a change cites both of its values. */
  also?: string[];
  /** dataset: what the check said when it was cited; reading: the source the trainee read. */
  title?: string;
  /** Drafted by the model; otherwise written by the trainee. */
  by?: 'model';
}

export const MAX_CLAIMS = 15;
export const MAX_CLAIM_TEXT = 600;
/** Values one claim may cite besides its first. */
export const MAX_CLAIM_ALSO = 6;
const MAX_REF = 200;
const MAX_TITLE = 300;

/** Every timeline entry and calculation result a claim cites: its source, then the other values. */
export function claimTargets(c: Pick<CardClaim, 'source' | 'ref' | 'also'>): CardLink[] {
  if ((c.source !== 'entry' && c.source !== 'calc') || !c.ref) return [];
  const first: CardLink = { kind: c.source, id: c.ref };
  const more = parseLinks((c.also ?? []).join('|')).filter((l) => !(l.kind === first.kind && l.id === first.id));
  return [first, ...more];
}

const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/** The claims of a stored value; anything malformed is left out (values are validated when saved). */
export function parseClaims(v: string | undefined): CardClaim[] {
  if (!v) return [];
  try {
    const raw: unknown = JSON.parse(v);
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x) => {
      const c = toClaim(x);
      return c.ok ? [c.claim] : [];
    });
  } catch {
    return [];
  }
}

type ClaimError = 'invalidChoice' | 'tooLong' | 'required';

function toClaim(x: unknown): { ok: true; claim: CardClaim } | { ok: false; error: ClaimError } {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return { ok: false, error: 'invalidChoice' };
  const o = x as Record<string, unknown>;
  const text = str(o.text);
  const source = o.source as ClaimSource;
  if (!(CLAIM_SOURCES as readonly string[]).includes(source)) return { ok: false, error: 'invalidChoice' };
  // A claim without its statement, or without the source it names, is incomplete: "required", not a wrong choice.
  if (!text) return { ok: false, error: 'required' };
  if (text.length > MAX_CLAIM_TEXT) return { ok: false, error: 'tooLong' };
  const ref = str(o.ref);
  const title = str(o.title);
  if (ref.length > MAX_REF || title.length > MAX_TITLE) return { ok: false, error: 'tooLong' };
  if ((source === 'entry' || source === 'calc' || source === 'dataset') && !ref) return { ok: false, error: 'required' };
  if ((source === 'entry' || source === 'calc') && !ID.test(ref)) return { ok: false, error: 'invalidChoice' };
  if (source === 'reading' && !title) return { ok: false, error: 'required' };
  if (o.by !== undefined && o.by !== 'model') return { ok: false, error: 'invalidChoice' };
  let also: string[] = [];
  if (o.also !== undefined) {
    if (!Array.isArray(o.also) || (source !== 'entry' && source !== 'calc')) return { ok: false, error: 'invalidChoice' };
    if (o.also.length > MAX_CLAIM_ALSO) return { ok: false, error: 'tooLong' };
    also = o.also.map(str);
    const own = `${source === 'entry' ? 'e' : 'c'}:${ref}`;
    if (parseLinks(also.join('|')).length !== also.length || also.some((x) => !x || x === own) || new Set(also).size !== also.length) return { ok: false, error: 'invalidChoice' };
  }
  // A fixed key order, so that an unchanged claim list is the same string (an unchanged card writes no new version).
  const claim: CardClaim = {
    text,
    source,
    ...(source === 'entry' || source === 'calc' || source === 'dataset' ? { ref } : {}),
    ...(also.length ? { also } : {}),
    ...((source === 'reading' || source === 'dataset') && title ? { title } : {}),
    ...(o.by === 'model' ? { by: 'model' as const } : {}),
  };
  return { ok: true, claim };
}

export const claimsValue = (claims: readonly CardClaim[]): string => (claims.length ? JSON.stringify(claims) : '');

export function normalizeClaims(v: string): { ok: true; value: string } | { ok: false; error: ClaimError } {
  let raw: unknown;
  try {
    raw = JSON.parse(v);
  } catch {
    return { ok: false, error: 'invalidChoice' };
  }
  if (!Array.isArray(raw)) return { ok: false, error: 'invalidChoice' };
  if (raw.length > MAX_CLAIMS) return { ok: false, error: 'tooLong' };
  const claims: CardClaim[] = [];
  for (const x of raw) {
    const c = toClaim(x);
    if (!c.ok) return c;
    claims.push(c.claim);
  }
  return { ok: true, value: claimsValue(claims) };
}

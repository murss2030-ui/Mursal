/**
 * RxNorm approximate matching (Section 13: "drug names normalised through
 * RxNorm approximate matching; a failed match marks the field uncertain").
 * A free NIH service (Section 4); only the drug name is sent. Answers are
 * cached locally with their retrieval date (Section 19), so the same name is
 * looked up once. Offline, the name is reported as not checked.
 */
import type { Store } from '../../store/store';

export const RXNAV = 'https://rxnav.nlm.nih.gov';

export type RxMatch = { status: 'matched'; rxcui: string; name?: string } | { status: 'unmatched' } | { status: 'not_checked' };

interface Candidate {
  rxcui?: string;
  score?: string;
  rank?: string;
  name?: string;
  source?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** Reads an approximateTerm.json answer (exported for tests with recorded responses). */
export function readApproximateTerm(term: string, body: unknown): RxMatch {
  const list = (body as { approximateGroup?: { candidate?: Candidate[] } })?.approximateGroup?.candidate ?? [];
  const ranked = [...list].filter((c) => c.rxcui).sort((a, b) => Number(a.rank ?? 99) - Number(b.rank ?? 99));
  const top = ranked[0];
  if (!top?.rxcui) return { status: 'unmatched' };
  // A match on the RxNorm vocabulary itself, or a name that agrees with what was written.
  const t = norm(term);
  const fromRxNorm = ranked.find((c) => c.rank === top.rank && c.source === 'RXNORM');
  const named = ranked.find((c) => c.rank === top.rank && c.name && (norm(c.name) === t || norm(c.name).startsWith(t) || t.startsWith(norm(c.name))));
  const best = named ?? fromRxNorm;
  return best?.rxcui ? { status: 'matched', rxcui: best.rxcui, ...(best.name ? { name: best.name } : {}) } : { status: 'unmatched' };
}

export async function rxnormMatch(
  term: string,
  deps: { store: Store; fetch?: typeof fetch; online?: () => boolean; timeoutMs?: number },
): Promise<RxMatch> {
  const q = term.trim();
  if (!q) return { status: 'unmatched' };
  const key = `rxnorm:${q.toLowerCase()}`;
  const cached = await deps.store.getLookup<RxMatch>(key);
  if (cached) return cached.value;
  const online = deps.online ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  if (!online()) return { status: 'not_checked' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 6000);
  try {
    const res = await (deps.fetch ?? fetch)(`${RXNAV}/REST/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=3`, { signal: ctrl.signal });
    if (!res.ok) return { status: 'not_checked' };
    const result = readApproximateTerm(q, await res.json());
    await deps.store.putLookup(key, result);
    return result;
  } catch {
    return { status: 'not_checked' };
  } finally {
    clearTimeout(timer);
  }
}

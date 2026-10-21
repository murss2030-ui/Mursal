/**
 * What every open-source connector shares (plan M5c): the question's words are
 * checked for identifiers before anything leaves the device, answers are
 * cached with their retrieval date so the same lookup never costs twice, an
 * old answer is refreshed when there is a connection and kept (and said to be
 * old) when there is none, and every failure says what happened.
 *
 * Hosts reached from the browser (Content-Security-Policy `connect-src`):
 * api.fda.gov, eutils.ncbi.nlm.nih.gov, www.ebi.ac.uk, connect.medlineplus.gov.
 * DailyMed sends no CORS headers, so the browser cannot call it: its labels
 * are opened by link only, built from the set id openFDA returns.
 */
import { datesToHospitalDays, maskIdentifiers } from '../extraction/deid';
import type { Store } from '../../store/store';

export const OPEN_HOSTS = ['https://api.fda.gov', 'https://eutils.ncbi.nlm.nih.gov', 'https://www.ebi.ac.uk', 'https://connect.medlineplus.gov'] as const;

export type ConnectorErrorCode = 'offline' | 'identifier' | 'network' | 'rate_limited' | 'http' | 'shape' | 'empty_query';

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export interface ConnectorDeps {
  store: Store;
  fetch?: typeof fetch;
  online?: () => boolean;
  timeoutMs?: number;
  /** A cached answer older than this is fetched again when online (default 30). Age is read on the store's clock, the one that dated the answer. */
  maxAgeDays?: number;
  /** Ignore the cache (the trainee asked to look again). */
  refresh?: boolean;
  /** The case a question comes from: its patient's identifiers are checked for in the query. */
  caseId?: string;
}

export interface Fetched<T> {
  value: T;
  /** When the answer was retrieved (ISO instant). */
  retrievedAt: string;
  fromCache: boolean;
  /** An old answer kept because the service could not be reached. */
  stale: boolean;
}

const DEFAULT_MAX_AGE_DAYS = 30;
const DAY_MS = 86_400_000;

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/**
 * Only drug names and the question's words may leave the device. Refuses a
 * query that holds the case's patient name, record number, bed or consultant,
 * a phone or long number, a doctor's name or a calendar date.
 */
export async function guardQuery(store: Store, caseId: string | undefined, text: string): Promise<string> {
  const q = text.replace(/\s+/g, ' ').trim();
  if (!q) throw new ConnectorError('empty_query', 'There is nothing to look up.');
  const ids = caseId ? await store.getIdentifiers(caseId) : undefined;
  const known = ids ? { patientName: ids.patientName, mrn: ids.mrn, roomBed: ids.roomBed, consultantName: ids.consultantName } : {};
  if (maskIdentifiers(q, known).masked > 0 || datesToHospitalDays(q, '2000-01-01').replaced > 0) {
    throw new ConnectorError('identifier', 'The question contains something that looks like an identifier or a calendar date. Remove it: only drug names and clinical words are sent to outside services.');
  }
  return q;
}

/**
 * The cached answer for `key`, or the result of `load`, stored with its
 * retrieval date. `load` is called only online and not for a fresh cache hit.
 */
export async function cached<T>(deps: ConnectorDeps, key: string, load: () => Promise<T>): Promise<Fetched<T>> {
  const now = () => Date.parse(deps.store.nowIso());
  const hit = deps.refresh ? undefined : await deps.store.getLookup<T>(key);
  const age = hit ? now() - Date.parse(hit.retrievedAt) : Infinity;
  const limit = (deps.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * DAY_MS;
  if (hit && age <= limit) return { value: hit.value, retrievedAt: hit.retrievedAt, fromCache: true, stale: false };
  const old = hit ?? (deps.refresh ? await deps.store.getLookup<T>(key) : undefined);
  if (!(deps.online ?? isOnline)()) {
    if (old) return { value: old.value, retrievedAt: old.retrievedAt, fromCache: true, stale: true };
    throw new ConnectorError('offline', 'You are offline and this has not been looked up before.');
  }
  try {
    const value = await load();
    await deps.store.putLookup(key, value);
    const stored = await deps.store.getLookup<T>(key);
    return { value, retrievedAt: stored?.retrievedAt ?? new Date(now()).toISOString(), fromCache: false, stale: false };
  } catch (e) {
    if (old && !(e instanceof ConnectorError && e.code === 'identifier')) return { value: old.value, retrievedAt: old.retrievedAt, fromCache: true, stale: true };
    throw e;
  }
}

async function request(deps: ConnectorDeps, url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? 10_000);
  try {
    const res = await (deps.fetch ?? fetch)(url, { signal: ctrl.signal, headers: { accept: 'application/json, application/xml;q=0.9, */*;q=0.1' } });
    if (res.status === 429) throw new ConnectorError('rate_limited', 'The service asked us to slow down. Try again in a minute.');
    // openFDA answers 404 "No matches found" for a search with no result: an empty answer, not a failure.
    if (!res.ok && res.status !== 404) throw new ConnectorError('http', `The service answered ${res.status}.`);
    return res;
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    throw new ConnectorError('network', 'The service could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

export async function getJson(deps: ConnectorDeps, url: string): Promise<unknown> {
  const res = await request(deps, url);
  if (res.status === 404) return undefined;
  try {
    return await res.json();
  } catch {
    throw new ConnectorError('shape', 'The service answered something that is not JSON.');
  }
}

export async function getText(deps: ConnectorDeps, url: string): Promise<string> {
  const res = await request(deps, url);
  return res.status === 404 ? '' : res.text();
}

/** HTML or XML markup removed from a text a service returned, entities decoded, whitespace collapsed. */
export function plainText(markup: string): string {
  return decodeEntities(markup.replace(/<\s*(?:br|\/p|\/li|\/h\d|\/tr|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', plusmn: '±', ge: '≥', le: '≤', micro: 'µ', deg: '°' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** Keeps a long text to a size the model and the screen can use, ending at a sentence or a word. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return `${(end > max * 0.6 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' '))).trimEnd()} […]`;
}

/**
 * Shared helpers for the dataset builders (DDInter, AWaRe): polite RxNav
 * requests with a local cache, and drug-name resolution to RxNorm
 * ingredients that accepts only exact or normalised matches — never an
 * approximate one, because a near-miss is worse than "not mapped".
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://rxnav.nlm.nih.gov/REST';
const CACHE = join(ROOT, 'node_modules/.cache/preceptor-data/rxnav-cache.json');
const RATE = 10; // requests per second (RxNav allows 20)

let cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
let dirty = 0;
export function saveCache() {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));
  dirty = 0;
}

let next = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + 1000 / RATE;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

export async function rxnav(path, attempt = 0) {
  if (path in cache) return cache[path];
  await slot();
  try {
    const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${path}`), { fatal: true });
    const body = await res.json();
    cache[path] = body;
    if (++dirty >= 200) saveCache();
    return body;
  } catch (e) {
    if (e.fatal || attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return rxnav(path, attempt + 1);
  }
}

export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The same normalisation as src/drugs/vocabulary.ts normaliseName. */
export function normaliseName(s) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact lookup in the offline vocabulary (public/data/rxnorm-subset.json). */
export function localIndex(subset) {
  const byName = new Map();
  const put = (name, via, ingredients) => {
    const k = normaliseName(name);
    if (!byName.has(k)) byName.set(k, { via, ingredients });
  };
  for (const [rxcui, name] of subset.ingredients) put(name, 'IN', [rxcui]);
  for (const [, name, ins] of subset.precise) put(name, 'PIN', ins);
  for (const [, name, ins] of subset.multi) put(name, 'MIN', ins);
  for (const [name, rxcui] of subset.synonyms) put(name, 'synonym', [rxcui]);
  for (const [rxcui, name] of subset.extra ?? []) put(name, 'IN', [rxcui]);
  return byName;
}

const ids = (body) => body?.idGroup?.rxnormId ?? [];

/**
 * Resolve a name to RxNorm ingredients:
 * 1. the offline vocabulary (exact, normalised);
 * 2. RxNav, RxNorm names (search=2: exact or normalised — no approximate match);
 * 3. RxNav, names from all its sources (e.g. international names), same rule.
 * The concept found must be an ingredient (IN), a precise ingredient (PIN, mapped to its IN) or a
 * multiple ingredient (MIN); one concept only, or the name is reported as ambiguous.
 */
export async function resolveName(name, local) {
  const hit = local.get(normaliseName(name));
  if (hit) return { status: 'mapped', via: `vocabulary ${hit.via}`, ingredients: hit.ingredients, multi: hit.via === 'MIN' || hit.ingredients.length > 1 };
  for (const allsrc of [0, 1]) {
    const found = ids(await rxnav(`/rxcui.json?name=${encodeURIComponent(name)}&search=2${allsrc ? '&allsrc=1' : ''}`));
    if (!found.length) continue;
    if (found.length > 1) return { status: 'ambiguous', via: `RxNav${allsrc ? ' (all sources)' : ''}`, candidates: found };
    const props = (await rxnav(`/rxcui/${found[0]}/properties.json`))?.properties;
    const tty = props?.tty;
    if (tty === 'IN') return { status: 'mapped', via: `RxNav${allsrc ? ' (all sources)' : ''} IN`, ingredients: [found[0]], names: { [found[0]]: props.name }, multi: false };
    if (tty === 'PIN' || tty === 'MIN') {
      const rel = await rxnav(`/rxcui/${found[0]}/related.json?tty=IN`);
      const ins = (rel?.relatedGroup?.conceptGroup ?? []).flatMap((g) => g.conceptProperties ?? []);
      if (!ins.length) return { status: 'unmapped', via: `RxNav ${tty} without ingredient` };
      return {
        status: 'mapped',
        via: `RxNav${allsrc ? ' (all sources)' : ''} ${tty}`,
        ingredients: ins.map((c) => c.rxcui),
        names: Object.fromEntries(ins.map((c) => [c.rxcui, c.name])),
        multi: tty === 'MIN' || ins.length > 1,
      };
    }
    return { status: 'unmapped', via: `RxNav concept of type ${tty ?? 'unknown'}` };
  }
  return { status: 'unmapped', via: 'no exact or normalised match' };
}

/** ATC level-1 groups of an ingredient, from RxClass (ATC classes linked to RxNorm ingredients). */
export async function atcGroups(rxcui) {
  const body = await rxnav(`/rxclass/class/byRxcui.json?rxcui=${rxcui}&relaSource=ATC`);
  const items = body?.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
  return [...new Set(items.filter((x) => x.minConcept?.rxcui === rxcui).map((x) => x.rxclassMinConceptItem.classId[0]))].sort();
}

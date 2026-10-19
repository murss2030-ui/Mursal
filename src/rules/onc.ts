/**
 * The ONC high-priority interaction list as the administrator entered it
 * (owner decision, 19 October 2026; More → Reference tables). Each side of a
 * pair names single-ingredient drugs or drug classes. A name is resolved
 * exactly — the generic or brand name of one drug, or the exact name of an
 * FDA Established Pharmacologic Class or a VA antimicrobial class (a final
 * "s" is allowed: "proton pump inhibitors") — never by a guess.
 */
import { normaliseName, type DrugClass, type DrugVocabulary } from '../drugs/vocabulary';
import { matchDrug } from '../drugs/normalize';
import { splitList, type OncPair, type OncResolved, type OncSide } from '../domain/reference';

export type OncName =
  | { name: string; kind: 'ingredient'; rxcui: string; label: string }
  | { name: string; kind: 'class'; id: string; className: string; label: string; members: number }
  /** A product with several ingredients: each must be entered on its own. */
  | { name: string; kind: 'combination'; label: string }
  | { name: string; kind: 'unknown' };

/** The class with exactly this name (case and accents ignored; a final "s" allowed). */
export function classNamed(name: string, vocab: DrugVocabulary): DrugClass | undefined {
  const n = normaliseName(name);
  const forms = new Set([n, n.replace(/s$/, '')]);
  const words = n.replace(/s$/, '').split(' ').filter(Boolean);
  return vocab.classesNamed(words).find((c) => forms.has(normaliseName(c.name)));
}

export function resolveOncName(name: string, vocab: DrugVocabulary): OncName {
  const m = matchDrug(name, vocab);
  if (m.status === 'matched') {
    const only = m.ingredients.length === 1 ? m.ingredients[0] : undefined;
    return only ? { name, kind: 'ingredient', rxcui: only.rxcui, label: only.name } : { name, kind: 'combination', label: m.ingredients.map((i) => i.name).join(' + ') };
  }
  const c = classNamed(name, vocab);
  if (c) return { name, kind: 'class', id: c.id, className: c.name, label: `${c.name} (${c.source})`, members: vocab.members(c.id).length };
  return { name, kind: 'unknown' };
}

/** One side as typed (names separated by commas, semicolons or lines), resolved. */
export function resolveOncSide(text: string, vocab: DrugVocabulary): OncResolved & { names: OncName[] } {
  const names = splitList(text).map((n) => resolveOncName(n, vocab));
  const side: OncSide = {
    names: names.map((n) => n.name),
    ingredients: [...new Set(names.flatMap((n) => (n.kind === 'ingredient' ? [n.rxcui] : [])))],
    classes: names.flatMap((n) => (n.kind === 'class' ? [{ id: n.id, name: n.className }] : [])),
  };
  return { side, unrecognised: names.filter((n) => n.kind === 'unknown' || n.kind === 'combination').map((n) => n.name), names };
}

export interface OncEntry {
  pair: OncPair;
  a: ReadonlySet<string>;
  b: ReadonlySet<string>;
}

/** The active pairs, each side as the set of RxNorm ingredients it covers today. */
export function oncIndex(pairs: readonly OncPair[], vocab: DrugVocabulary | undefined): OncEntry[] {
  const expand = (s: OncSide) => new Set([...s.ingredients, ...s.classes.flatMap((c) => vocab?.members(c.id) ?? [])]);
  return pairs.filter((p) => p.status === 'active').map((pair) => ({ pair, a: expand(pair.sideA), b: expand(pair.sideB) }));
}

/** The pairs two medicines (their ingredients) fall under, in either order. */
export function oncMatches(index: readonly OncEntry[], x: readonly string[], y: readonly string[]): OncPair[] {
  const hit = (s: ReadonlySet<string>, ds: readonly string[]) => ds.some((d) => s.has(d));
  return index.filter((e) => (hit(e.a, x) && hit(e.b, y)) || (hit(e.b, x) && hit(e.a, y))).map((e) => e.pair);
}

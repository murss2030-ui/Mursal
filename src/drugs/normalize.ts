/**
 * Drug-name normalisation for the rules engine (Section 10: "through RxNorm
 * normalisation"). A name written in the chart — generic, brand, combination,
 * with or without strength and form — is resolved to RxNorm ingredients, or
 * reported as not checked. Matching is exact after cleaning: no fuzzy guess,
 * because a near-miss ("hydroxyzine" for "hydralazine") is worse than an
 * honest "not checked". Local brands come from the trainee's formulary.
 */
import { normaliseName, type DrugVocabulary, type MatchVia, type NameHit } from './vocabulary';

export interface MatchedIngredient {
  rxcui: string;
  name: string;
}

export type DrugMatch =
  | { status: 'matched'; ingredients: MatchedIngredient[]; via: MatchVia | 'combination'; matched: string; formularyItemId?: string }
  | { status: 'not_checked'; reason: 'empty' | 'unmatched' | 'no_vocabulary' };

/** A local alias from the formulary: a name (brand or generic) and the ingredients it stands for. */
export interface FormularyAlias {
  itemId: string;
  name: string;
  ingredients: string[];
}

const UNIT = String.raw`(?:mg|g|gm|gram|grams|mcg|µg|ug|microgram|micrograms|ml|l|units?|iu|meq|mmol|%|mg\/ml|mcg\/ml|mg\/kg|unit\/ml|units\/ml)`;
const STRENGTH = new RegExp(String.raw`\b\d+(?:[.,]\d+)?\s*${UNIT}(?:\s*\/\s*\d*(?:[.,]\d+)?\s*${UNIT})?(?=\s|$|[,;)/+])`, 'g');
const FORMS = [
  'tablets', 'tablet', 'tabs', 'tab', 'capsules', 'capsule', 'caps', 'cap', 'injection', 'inj', 'vials', 'vial', 'ampoules', 'ampoule', 'amp',
  'syrup', 'suspension', 'susp', 'solution', 'soln', 'cream', 'ointment', 'gel', 'drops', 'inhaler', 'nebuliser', 'nebulizer', 'nebules',
  'patch', 'sachet', 'suppository', 'suppositories', 'infusion', 'powder', 'for', 'oral', 'iv', 'im', 'po', 'subcut', 'sc', 'sl',
  'mr', 'sr', 'xr', 'er', 'cr', 'dr', 'ec', 'prefilled', 'syringe', 'pen', 'bottle',
];
const FORM_TAIL = new RegExp(String.raw`(?:\s+(?:${FORMS.join('|')}))+$`);

/** Text variants to try, most literal first. */
function variants(name: string): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const v = s.replace(/\s+/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
  };
  add(name);
  const outside = name.replace(/\([^)]*\)/g, ' ');
  add(outside);
  for (const m of name.matchAll(/\(([^)]*)\)/g)) add(m[1] ?? '');
  for (const base of [...out]) {
    const noStrength = base.replace(STRENGTH, ' ').replace(/\b\d+(?:[.,]\d+)?\b/g, ' ');
    add(noStrength);
    add(noStrength.replace(/\s+/g, ' ').trim().replace(FORM_TAIL, ''));
  }
  return out;
}

function hitToMatch(hit: NameHit, vocab: DrugVocabulary | undefined, extra: Partial<Extract<DrugMatch, { status: 'matched' }>> = {}): DrugMatch {
  return {
    status: 'matched',
    via: hit.via,
    matched: hit.name,
    ingredients: hit.ingredients.map((rxcui) => ({ rxcui, name: vocab?.ingredientName(rxcui) ?? rxcui })),
    ...extra,
  };
}

/** The longest run of leading words that names something in the vocabulary (e.g. "metformin hydrochloride 500"). */
function leading(v: string, find: (s: string) => NameHit | undefined): NameHit | undefined {
  const words = v.split(' ');
  for (let n = words.length - 1; n >= 1; n--) {
    const hit = find(words.slice(0, n).join(' '));
    if (hit) return hit;
  }
  return undefined;
}

export function matchDrug(text: string, vocab: DrugVocabulary | undefined, aliases?: ReadonlyMap<string, FormularyAlias>): DrugMatch {
  const name = normaliseName(text ?? '');
  if (!name) return { status: 'not_checked', reason: 'empty' };
  const find = (s: string): NameHit | undefined => {
    const a = aliases?.get(s);
    if (a) return { via: 'formulary', name: a.name, rxcui: a.ingredients[0] ?? '', ingredients: a.ingredients };
    return vocab?.lookup(s);
  };
  const formularyId = (s: string) => aliases?.get(s)?.itemId;
  if (!vocab && !aliases?.size) return { status: 'not_checked', reason: 'no_vocabulary' };

  const vs = variants(name);
  for (const v of vs) {
    const hit = find(v);
    if (hit) return hitToMatch(hit, vocab, formularyId(v) ? { formularyItemId: formularyId(v)! } : {});
  }
  // A combination written out: "amoxicillin / clavulanate", "piperacillin + tazobactam".
  for (const v of vs) {
    const parts = v.split(/\s*(?:\/|\+|,|&|\band\b|\bwith\b)\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const hits = parts.map((p) => find(p) ?? find(p.replace(FORM_TAIL, '')) ?? leading(p, find));
    if (hits.every((h): h is NameHit => !!h)) {
      const ingredients = [...new Set(hits.flatMap((h) => h.ingredients))];
      return {
        status: 'matched',
        via: 'combination',
        matched: hits.map((h) => h.name).join(' / '),
        ingredients: ingredients.map((rxcui) => ({ rxcui, name: vocab?.ingredientName(rxcui) ?? rxcui })),
      };
    }
  }
  for (const v of vs) {
    const hit = leading(v, find);
    if (hit) return hitToMatch(hit, vocab);
  }
  return { status: 'not_checked', reason: 'unmatched' };
}

/** Builds the alias map from formulary items: every generic and local brand name, normalised. */
export function aliasesFrom(items: readonly { id: string; genericName: string; brandNames: readonly string[]; ingredients?: readonly string[]; status: string }[]): Map<string, FormularyAlias> {
  const out = new Map<string, FormularyAlias>();
  for (const it of items) {
    if (it.status !== 'active' || !it.ingredients?.length) continue;
    for (const n of [it.genericName, ...it.brandNames]) {
      const k = normaliseName(n);
      if (k && !out.has(k)) out.set(k, { itemId: it.id, name: it.genericName, ingredients: [...it.ingredients] });
    }
  }
  return out;
}

/**
 * The offline drug vocabulary: RxNorm prescribable ingredients, precise
 * ingredients, combinations and brands, international names confirmed by
 * RxNav, FDA Established Pharmacologic Classes and the VA antimicrobial
 * classes (built by scripts/data/build-rxnorm.mjs), plus the RxNorm
 * ingredients outside that subset that DDInter or WHO AWaRe name (added by
 * their builders). Described in src/data/datasets.json.
 *
 * The file is served from the app's own origin and precached for offline
 * use; its SHA-256 is checked against the manifest before it is used, so a
 * corrupted or substituted file is refused rather than trusted.
 */

export interface RxnormSubset {
  dataset: 'rxnorm-subset';
  rxnormVersion: string;
  retrievedAt: string;
  source: string;
  ingredients: [rxcui: string, name: string][];
  precise: [rxcui: string, name: string, ingredients: string[]][];
  multi: [rxcui: string, name: string, ingredients: string[]][];
  brands: [rxcui: string, name: string, ingredients: string[]][];
  synonyms: [name: string, ingredient: string][];
  /** FDA EPC classes with the ingredients FDA assigns to them directly. */
  epc: [classId: string, name: string, members: string[]][];
  /** Grouping nodes of the EPC hierarchy with all their members, direct and through subclasses (scripts/data/build-epc.mjs). */
  epcGroups?: [classId: string, name: string, members: string[]][];
  vaAntimicrobial: [classId: string, name: string, members: string[]][];
  /** RxNorm ingredients outside the prescribable subset that an installed dataset names (e.g. acenocoumarol). */
  extra?: [rxcui: string, name: string][];
  extraSources?: string[];
}

export type MatchVia = 'ingredient' | 'precise' | 'multi' | 'brand' | 'synonym' | 'formulary';

export interface NameHit {
  via: MatchVia;
  /** The vocabulary name that matched. */
  name: string;
  rxcui: string;
  ingredients: string[];
}

export interface DrugClass {
  id: string;
  name: string;
  source: 'FDA EPC' | 'VA';
}

export interface DrugVocabulary {
  version: string;
  retrievedAt: string;
  /** Exact lookup of a normalised name (see normaliseName). */
  lookup(normalised: string): NameHit | undefined;
  ingredientName(rxcui: string): string | undefined;
  /** The FDA EPC classes an ingredient is directly assigned to (never a broad grouping node). */
  classesOf(ingredient: string): DrugClass[];
  /** VA antimicrobial classes of an ingredient (empty when it is not an antimicrobial in those classes). */
  antimicrobialClassesOf(ingredient: string): DrugClass[];
  /** Ingredients of an EPC class; for a grouping node, all of them, through its subclasses. */
  members(classId: string): readonly string[];
  classById(classId: string): DrugClass | undefined;
  /** Every class whose name contains all the words given (lower case), for allergy terms like "penicillin". */
  classesNamed(words: readonly string[]): DrugClass[];
}

/** Lower case, accents and punctuation simplified, spaces collapsed. */
export function normaliseName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildVocabulary(d: RxnormSubset): DrugVocabulary {
  const byName = new Map<string, NameHit>();
  const names = new Map<string, string>();
  // Earlier sources win: an ingredient name is never shadowed by a brand of the same spelling.
  const put = (name: string, hit: NameHit) => {
    const k = normaliseName(name);
    if (!byName.has(k)) byName.set(k, hit);
  };
  for (const [rxcui, name] of [...d.ingredients, ...(d.extra ?? [])]) {
    names.set(rxcui, name);
    put(name, { via: 'ingredient', name, rxcui, ingredients: [rxcui] });
  }
  for (const [rxcui, name, ins] of d.precise) put(name, { via: 'precise', name, rxcui, ingredients: ins });
  for (const [rxcui, name, ins] of d.multi) put(name, { via: 'multi', name, rxcui, ingredients: ins });
  for (const [term, rxcui] of d.synonyms) put(term, { via: 'synonym', name: names.get(rxcui) ?? term, rxcui, ingredients: [rxcui] });
  for (const [rxcui, name, ins] of d.brands) put(name, { via: 'brand', name, rxcui, ingredients: ins });

  const classes = new Map<string, DrugClass[]>();
  const amClasses = new Map<string, DrugClass[]>();
  const members = new Map<string, readonly string[]>();
  const allClasses: DrugClass[] = [];
  for (const [id, name, ms] of d.epc) {
    const c: DrugClass = { id, name, source: 'FDA EPC' };
    allClasses.push(c);
    members.set(id, ms);
    for (const m of ms) classes.set(m, [...(classes.get(m) ?? []), c]);
  }
  // A grouping node is a class for membership (an allergy to "opioids"), not one an ingredient is said to belong to.
  for (const [id, name, ms] of d.epcGroups ?? []) {
    if (!allClasses.some((c) => c.id === id)) allClasses.push({ id, name, source: 'FDA EPC' });
    members.set(id, [...new Set([...(members.get(id) ?? []), ...ms])]);
  }
  for (const [id, name, ms] of d.vaAntimicrobial) {
    const c: DrugClass = { id, name, source: 'VA' };
    for (const m of ms) amClasses.set(m, [...(amClasses.get(m) ?? []), c]);
  }
  return {
    version: d.rxnormVersion,
    retrievedAt: d.retrievedAt,
    lookup: (n) => byName.get(n),
    ingredientName: (id) => names.get(id),
    classesOf: (id) => classes.get(id) ?? [],
    antimicrobialClassesOf: (id) => amClasses.get(id) ?? [],
    members: (id) => members.get(id) ?? [],
    classById: (id) => allClasses.find((c) => c.id === id),
    classesNamed: (words) => allClasses.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))),
  };
}

/** SHA-256 of a text, hex (Web Crypto, available in the browser and in Node). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class DatasetIntegrityError extends Error {
  constructor(file: string) {
    super(`The dataset ${file} does not match its recorded checksum and was not used.`);
    this.name = 'DatasetIntegrityError';
  }
}

/** Fetch the vocabulary from the app's own origin and verify it before use. */
export async function loadVocabulary(file: string, expectedSha256: string, fetchFn: typeof fetch = fetch): Promise<DrugVocabulary> {
  const res = await fetchFn(file);
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status}).`);
  const text = await res.text();
  if ((await sha256Hex(text)) !== expectedSha256) throw new DatasetIntegrityError(file);
  return buildVocabulary(JSON.parse(text) as RxnormSubset);
}

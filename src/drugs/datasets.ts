/**
 * The file formats of the offline interaction, ONC and AWaRe datasets, and
 * their loaders (built by scripts/data/build-ddinter.mjs and build-aware.mjs;
 * described in src/data/datasets.json).
 *
 * Like the drug vocabulary, a file is served from the app's own origin,
 * precached for offline use, and refused when its SHA-256 does not match the
 * manifest. Ingredients are RxNorm ingredient RxCUIs, as in the vocabulary.
 */
import type { AwareCategory, AwareDataset, AwareMatch, AwareRoute, InteractionDataset, InteractionHit } from '../rules/types';
import { DatasetIntegrityError, sha256Hex } from './vocabulary';

/** DDInter, mapped to RxNorm ingredients. */
export interface InteractionFile {
  dataset: 'interactions';
  format: 2;
  version: string;
  citation: string;
  retrievedAt?: string;
  /** The ATC groups whose download files were used. */
  coverageGroups?: string[];
  /** Every ingredient the dataset knows, by index. */
  ingredients: string[];
  /** Indices (3 base-36 digits each) of the ingredients whose every DDInter pair is in the files. */
  anchored: string;
  /** Pairs, 7 characters each, sorted: index A (3 base-36 digits), index B (3, A < B), level (M major, o moderate, i minor, u unknown). */
  packed: string;
}

/** The ONC high-priority pairs (Phansalkar et al., JAMIA 2012): each side is a list of ingredients. */
export interface OncFile {
  dataset: 'onc';
  version: string;
  citation: string;
  /** [ingredients of side A, ingredients of side B, the pair as the paper names it] */
  pairs: [a: string[], b: string[], label: string][];
}

export interface AwareFile {
  dataset: 'aware';
  format: 2;
  version: string;
  citation: string;
  retrievedAt?: string;
  /** [ingredients joined by "+" in RxCUI order, category, route ("" when any), the WHO name] */
  categories: [key: string, category: AwareCategory, route: '' | AwareRoute, name: string][];
}

const LEVEL: Record<string, InteractionHit['severity']> = { M: 'major', o: 'moderate', i: 'minor', u: 'unknown' };
const RADIX = 36 ** 3;

/** Packs pairs in the file's format (used by tests and kept identical to the build script). */
export function packPairs(ingredients: readonly string[], pairs: readonly [string, string, InteractionHit['severity']][]): string {
  const idx = new Map(ingredients.map((r, i) => [r, i]));
  const code = { major: 'M', moderate: 'o', minor: 'i', unknown: 'u' } as const;
  const b36 = (n: number) => n.toString(36).padStart(3, '0');
  return pairs
    .map(([a, b, s]) => {
      const x = idx.get(a)!;
      const y = idx.get(b)!;
      return [Math.min(x, y), Math.max(x, y), code[s]] as const;
    })
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])
    .map(([x, y, c]) => `${b36(x)}${b36(y)}${c}`)
    .join('');
}

export function buildInteractions(f: InteractionFile, onc?: OncFile): InteractionDataset {
  if (f.format !== 2 || f.packed.length % 7 !== 0 || f.anchored.length % 3 !== 0) throw new Error('Unsupported interaction file format');
  const index = new Map(f.ingredients.map((r, i) => [r, i]));
  const n = f.packed.length / 7;
  const keys = new Uint32Array(n);
  const levels: InteractionHit['severity'][] = new Array(n);
  for (let k = 0; k < n; k++) {
    const a = parseInt(f.packed.slice(k * 7, k * 7 + 3), 36);
    const b = parseInt(f.packed.slice(k * 7 + 3, k * 7 + 6), 36);
    keys[k] = a * RADIX + b;
    levels[k] = LEVEL[f.packed[k * 7 + 6]!] ?? 'unknown';
  }
  const anchored = new Set<number>();
  for (let k = 0; k < f.anchored.length; k += 3) anchored.add(parseInt(f.anchored.slice(k, k + 3), 36));
  const find = (key: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (keys[mid]! < key) lo = mid + 1;
      else if (keys[mid]! > key) hi = mid - 1;
      else return mid;
    }
    return -1;
  };
  const oncLabel = (x: string, y: string) => onc?.pairs.find(([a, b]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x)))?.[2];
  return {
    version: onc ? `${f.version}; ${onc.version}` : f.version,
    citation: onc ? `${f.citation}; ${onc.citation}` : f.citation,
    oncInstalled: !!onc,
    lookup: (x, y) => {
      if (x === y) return [];
      const onList = oncLabel(x, y);
      const a = index.get(x);
      const b = index.get(y);
      const at = a === undefined || b === undefined ? -1 : find(Math.min(a, b) * RADIX + Math.max(a, b));
      if (at >= 0) return [{ severity: levels[at]!, onc: !!onList }];
      // On the ONC list but without a DDInter record: the panel judged the pair contraindicated.
      return onList ? [{ severity: 'major', onc: true }] : [];
    },
    knows: (x) => index.has(x),
    coverage: (x, y) => {
      const a = index.get(x);
      const b = index.get(y);
      if (a === undefined || b === undefined) return 'drug_not_in_dataset';
      return anchored.has(a) || anchored.has(b) ? 'checked' : 'outside_files';
    },
  };
}

export function buildAware(f: AwareFile): AwareDataset {
  if (f.format !== 2) throw new Error('Unsupported AWaRe file format');
  const byKey = new Map<string, AwareMatch[]>();
  for (const [key, category, route, name] of f.categories) {
    byKey.set(key, [...(byKey.get(key) ?? []), { category, name, ...(route ? { route } : {}) }]);
  }
  return {
    version: f.version,
    citation: f.citation,
    categoryOf: (ingredients, route) => {
      const key = [...new Set(ingredients)].sort((a, b) => Number(a) - Number(b)).join('+');
      const all = byKey.get(key) ?? [];
      if (!route) return all;
      const forRoute = all.filter((m) => !m.route || m.route === route);
      return forRoute.length ? forRoute : all;
    },
  };
}

/** Fetch a dataset file from the app's own origin and verify its checksum before it is parsed. */
export async function loadVerified<T>(file: string, expectedSha256: string, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(file);
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status}).`);
  const text = await res.text();
  if ((await sha256Hex(text)) !== expectedSha256) throw new DatasetIntegrityError(file);
  return JSON.parse(text) as T;
}

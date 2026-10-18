/**
 * The file formats of the offline interaction and AWaRe datasets, and their
 * loaders. Neither dataset is installed yet: DDInter 2.0, the ONC
 * high-priority list and the WHO AWaRe classification could not be
 * downloaded from the build environment, so the manifest does not list them
 * and the rules engine reports those checks as not made.
 *
 * Like the drug vocabulary, a file is served from the app's own origin,
 * precached for offline use, and refused when its SHA-256 does not match the
 * manifest. Ingredients are RxNorm ingredient RxCUIs, as in the vocabulary.
 */
import type { AwareDataset, InteractionDataset, InteractionHit } from '../rules/types';
import { DatasetIntegrityError, sha256Hex } from './vocabulary';

export interface InteractionFile {
  dataset: 'interactions';
  version: string;
  citation: string;
  /** [ingredient A, ingredient B, severity, on the ONC high-priority list, mechanism, management] */
  pairs: [a: string, b: string, severity: InteractionHit['severity'], onc: boolean, mechanism?: string, management?: string][];
}

export interface AwareFile {
  dataset: 'aware';
  version: string;
  citation: string;
  categories: [ingredient: string, category: 'access' | 'watch' | 'reserve'][];
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildInteractions(f: InteractionFile): InteractionDataset {
  const byPair = new Map<string, InteractionHit[]>();
  for (const [a, b, severity, onc, mechanism, management] of f.pairs) {
    const hit: InteractionHit = { severity, onc, ...(mechanism ? { mechanism } : {}), ...(management ? { management } : {}) };
    const k = pairKey(a, b);
    byPair.set(k, [...(byPair.get(k) ?? []), hit]);
  }
  return { version: f.version, citation: f.citation, lookup: (a, b) => (a === b ? [] : (byPair.get(pairKey(a, b)) ?? [])) };
}

export function buildAware(f: AwareFile): AwareDataset {
  const cat = new Map(f.categories);
  return { version: f.version, citation: f.citation, categoryOf: (i) => cat.get(i) };
}

/** Fetch a dataset file from the app's own origin and verify its checksum before it is parsed. */
export async function loadVerified<T>(file: string, expectedSha256: string, fetchFn: typeof fetch = fetch): Promise<T> {
  const res = await fetchFn(file);
  if (!res.ok) throw new Error(`Could not load ${file} (HTTP ${res.status}).`);
  const text = await res.text();
  if ((await sha256Hex(text)) !== expectedSha256) throw new DatasetIntegrityError(file);
  return JSON.parse(text) as T;
}

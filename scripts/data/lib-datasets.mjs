/**
 * Writing the dataset manifest (src/data/datasets.json) and adding to the
 * offline vocabulary the RxNorm ingredients that a dataset names but that are
 * outside RxNorm's prescribable subset (e.g. drugs no longer marketed in the
 * United States but still used elsewhere), so that an order for one of them
 * can be matched. Every change updates the file's size and SHA-256 in the
 * manifest; the app refuses a file whose checksum does not match.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, sha256 } from './lib-rxnav.mjs';

const MANIFEST = join(ROOT, 'src/data/datasets.json');
const SUBSET = join(ROOT, 'public/data/rxnorm-subset.json');

export function writeManifestEntry(id, entry) {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  manifest.datasets[id] = entry;
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Write the vocabulary file and record its new size and checksum (and counts) in the manifest. */
export function writeSubset(subset, updateCounts = (c) => c) {
  const json = JSON.stringify(subset);
  writeFileSync(SUBSET, json);
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const entry = manifest.datasets['rxnorm-subset'];
  entry.bytes = Buffer.byteLength(json);
  entry.sha256 = sha256(json);
  entry.counts = updateCounts({ ...entry.counts });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Add [rxcui, name] ingredients to the vocabulary's `extra` list, noting which dataset named them. */
export function mergeExtraIngredients(extra, sourceLabel) {
  const subset = JSON.parse(readFileSync(SUBSET, 'utf8'));
  const known = new Set(subset.ingredients.map(([r]) => r));
  const merged = new Map((subset.extra ?? []).map(([r, n]) => [r, n]));
  for (const [r, n] of extra) if (!known.has(r)) merged.set(r, n);
  subset.extra = [...merged].sort((a, b) => (a[1].toLowerCase() < b[1].toLowerCase() ? -1 : 1));
  subset.extraSources = [...new Set([...(subset.extraSources ?? []), sourceLabel])].sort();
  writeSubset(subset, (counts) => ({ ...counts, extraIngredients: subset.extra.length }));
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  manifest.datasets['rxnorm-subset'].title =
    'RxNorm prescribable ingredients and brands, with FDA EPC and VA antimicrobial classes, and the RxNorm ingredients the installed datasets name';
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`vocabulary: ${subset.extra.length} extra ingredients (${subset.extraSources.join(', ')})\n`);
}

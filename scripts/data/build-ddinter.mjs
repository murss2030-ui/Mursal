#!/usr/bin/env node
/**
 * Builds the offline drug–drug interaction file from DDInter's download files.
 *
 * Source: the eight CSV files DDInter offers for download (ATC groups A, B, D,
 * H, L, P, R and V), byte-identical on ddinter.scbdd.com (DDInter 1.0, 2021)
 * and ddinter2.scbdd.com (re-served 21 May 2024). Each row is a pair of
 * DDInter drugs and a risk level (Major, Moderate, Minor, Unknown); the files
 * carry no mechanism or management text. Licence: CC BY-NC-SA 4.0.
 *
 * What this script does, and what it refuses to do:
 * - maps each DDInter drug name to RxNorm ingredients, exactly (lib-rxnav.mjs);
 *   a name that does not resolve exactly is left out and listed;
 * - a combination product is left out (its interactions belong to one of its
 *   ingredients, which DDInter lists separately);
 * - a local-route entry ("(topical)", "(ophthalmic)", "(nasal)", "(otic)") is
 *   used only when DDInter has no systemic entry for the same ingredient;
 * - where several DDInter entries map to one ingredient pair, the highest
 *   level is kept;
 * - coverage: a file holds every pair in which at least one drug belongs to its
 *   ATC group, so pairs of two drugs outside these groups (e.g. two
 *   cardiovascular drugs) are absent. An ingredient is marked "anchored" when
 *   RxClass gives it an ATC group with a download file AND every DDInter
 *   partner of the drug appears in that file. The app reports a pair with no
 *   anchored drug and no record as "not checked", never as "no interaction".
 *
 * Writes public/data/ddinter-interactions.json and its manifest entry; adds to
 * public/data/rxnorm-subset.json the RxNorm ingredients outside the
 * prescribable subset that DDInter names; writes docs/m2/datasets/DDINTER-MAPPING.md.
 *
 * Run: NODE_USE_ENV_PROXY=1 node scripts/data/build-ddinter.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atcGroups, localIndex, pool, resolveName, ROOT, rxnav, saveCache, sha256 } from './lib-rxnav.mjs';
import { mergeExtraIngredients, writeManifestEntry } from './lib-datasets.mjs';

const BASE = 'https://ddinter2.scbdd.com/static/media/download';
const GROUPS = ['A', 'B', 'D', 'H', 'L', 'P', 'R', 'V'];
const CACHE_DIR = join(ROOT, 'node_modules/.cache/preceptor-data/ddinter');
const OUT = join(ROOT, 'public/data/ddinter-interactions.json');
const REPORT = join(ROOT, 'docs/m2/datasets/DDINTER-MAPPING.md');
const LOCAL_ROUTES = new Set(['topical', 'topiclal', 'ophthalmic', 'nasal', 'otic']);
const LEVELS = { Major: 'major', Moderate: 'moderate', Minor: 'minor', Unknown: 'unknown' };
const RANK = { major: 3, moderate: 2, minor: 1, unknown: 0 };
const CODE = { major: 'M', moderate: 'o', minor: 'i', unknown: 'u' };

/** RFC 4180 CSV (quoted fields may hold commas). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function download(group) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, `ddinter_downloads_code_${group}.csv`);
  if (!existsSync(file)) {
    const res = await fetch(`${BASE}/ddinter_downloads_code_${group}.csv`);
    if (!res.ok) throw new Error(`DDInter ${group}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(file);
  return { group, name: `ddinter_downloads_code_${group}.csv`, bytes: buf.length, sha256: sha256(buf), text: buf.toString('utf8') };
}

const b36 = (n, w) => {
  const s = n.toString(36);
  if (s.length > w) throw new Error(`index ${n} too large for ${w} base-36 digits`);
  return s.padStart(w, '0');
};

async function main() {
  const subset = JSON.parse(readFileSync(join(ROOT, 'public/data/rxnorm-subset.json'), 'utf8'));
  const local = localIndex(subset);
  const files = [];
  for (const g of GROUPS) files.push(await download(g));

  // ------------------------------------------------------------------ rows
  const names = new Map(); // DDInter id → name
  const partners = new Map(); // id → Set(id)
  const partnersIn = new Map(); // `${group}|${id}` → Set(id)
  const raw = new Map(); // `${a}|${b}` (sorted ids) → level
  let rows = 0;
  for (const f of files) {
    const [head, ...body] = parseCsv(f.text);
    const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
    for (const r of body) {
      const a = r[col.DDInterID_A];
      const b = r[col.DDInterID_B];
      const level = LEVELS[r[col.Level]?.trim()];
      if (!a || !b || !level) throw new Error(`Unexpected row in ${f.name}: ${r.join(',')}`);
      rows++;
      names.set(a, r[col.Drug_A].trim());
      names.set(b, r[col.Drug_B].trim());
      for (const [x, y] of [
        [a, b],
        [b, a],
      ]) {
        if (!partners.has(x)) partners.set(x, new Set());
        partners.get(x).add(y);
        const k = `${f.group}|${x}`;
        if (!partnersIn.has(k)) partnersIn.set(k, new Set());
        partnersIn.get(k).add(y);
      }
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const prev = raw.get(key);
      if (prev && prev !== level) throw new Error(`Conflicting levels for ${key}`);
      raw.set(key, level);
    }
  }
  process.stderr.write(`rows ${rows}, unique pairs ${raw.size}, drugs ${names.size}\n`);

  // ------------------------------------------------------------------ names → RxNorm ingredients
  const entries = [...names].sort((x, y) => (x[1] < y[1] ? -1 : 1));
  const resolved = await pool(entries, 4, async ([id, name]) => {
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);
    const qualifier = m ? m[2].trim().toLowerCase() : undefined;
    const base = m ? m[1].trim() : name;
    if (qualifier && LOCAL_ROUTES.has(qualifier)) return { id, name, kind: 'local', ...(await resolveName(base, local)) };
    if (qualifier) {
      const full = await resolveName(`${base} ${qualifier}`, local);
      if (full.status === 'mapped') return { id, name, kind: 'primary', ...full };
      return { id, name, kind: 'variant', ...(await resolveName(base, local)) };
    }
    return { id, name, kind: 'primary', ...(await resolveName(name, local)) };
  });
  saveCache();

  const used = new Map(); // DDInter id → ingredient rxcui
  const byIngredient = new Map(); // rxcui → entries
  const extraNames = {};
  const skipped = { unmapped: [], ambiguous: [], combination: [], localShadowed: [] };
  for (const r of resolved) {
    if (r.status === 'ambiguous') skipped.ambiguous.push(r);
    else if (r.status !== 'mapped') skipped.unmapped.push(r);
    else if (r.multi) skipped.combination.push(r);
    else {
      const ing = r.ingredients[0];
      if (!byIngredient.has(ing)) byIngredient.set(ing, []);
      byIngredient.get(ing).push(r);
      Object.assign(extraNames, r.names ?? {});
    }
  }
  for (const [ing, list] of byIngredient) {
    const systemic = list.filter((e) => e.kind !== 'local');
    for (const e of systemic.length ? systemic : list) used.set(e.id, ing);
    if (systemic.length) for (const e of list.filter((x) => x.kind === 'local')) skipped.localShadowed.push(e);
  }

  // ------------------------------------------------------------------ pairs, by ingredient
  const pairs = new Map(); // `${i}|${j}` → level
  let dropped = 0;
  for (const [key, level] of raw) {
    const [a, b] = key.split('|');
    const x = used.get(a);
    const y = used.get(b);
    if (!x || !y || x === y) {
      dropped++;
      continue;
    }
    const k = x < y ? `${x}|${y}` : `${y}|${x}`;
    const prev = pairs.get(k);
    if (!prev || RANK[level] > RANK[prev]) pairs.set(k, level);
  }

  // ------------------------------------------------------------------ coverage: anchored ingredients
  // Every ingredient DDInter knows (not only those with a pair): a pair with an unknown drug is not checked.
  const ingredients = [...new Set(used.values())].sort((a, b) => Number(a) - Number(b));
  const atc = new Map(await pool(ingredients, 4, async (i) => [i, await atcGroups(i)]));
  saveCache();
  const anchored = new Set();
  const notVerified = [];
  for (const [ing, list] of byIngredient) {
    if (!atc.has(ing)) continue;
    const covered = atc.get(ing).filter((g) => GROUPS.includes(g));
    const ok = list.some((e) => used.get(e.id) === ing && covered.some((g) => (partnersIn.get(`${g}|${e.id}`)?.size ?? 0) === partners.get(e.id).size));
    if (ok) anchored.add(ing);
    else if (covered.length) notVerified.push({ ing, groups: covered, names: list.map((e) => e.name) });
  }

  // ------------------------------------------------------------------ the file
  const index = new Map(ingredients.map((r, i) => [r, i]));
  const packed = [...pairs]
    .map(([k, level]) => {
      const [x, y] = k.split('|').map((r) => index.get(r));
      return [Math.min(x, y), Math.max(x, y), level];
    })
    .sort((p, q) => p[0] - q[0] || p[1] - q[1])
    .map(([x, y, level]) => `${b36(x, 3)}${b36(y, 3)}${CODE[level]}`)
    .join('');
  const retrievedAt = new Date().toISOString().slice(0, 10);
  const citation =
    'DDInter download files (Xiong G, et al. DDInter: an online drug–drug interaction database towards improving clinical decision-making and patient safety. Nucleic Acids Res 2022;50:D1200–D1207), CC BY-NC-SA 4.0';
  const data = {
    dataset: 'interactions',
    format: 2,
    version: 'DDInter download files (DDInter 1.0, 2021; re-served by DDInter 2.0, May 2024)',
    citation,
    retrievedAt,
    coverageGroups: GROUPS,
    ingredients,
    anchored: ingredients.filter((r) => anchored.has(r)).map((r) => b36(index.get(r), 3)).join(''),
    packed,
  };
  const json = JSON.stringify(data);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);

  const levelCounts = { major: 0, moderate: 0, minor: 0, unknown: 0 };
  for (const l of pairs.values()) levelCounts[l]++;
  writeManifestEntry('interactions', {
    file: 'data/ddinter-interactions.json',
    title: 'DDInter drug–drug interactions (download files), mapped to RxNorm ingredients',
    version: data.version,
    retrievedAt,
    bytes: Buffer.byteLength(json),
    sha256: sha256(json),
    counts: {
      sourceRows: rows,
      sourcePairs: raw.size,
      ddinterDrugs: names.size,
      drugsUsed: used.size,
      drugsNotMapped: skipped.unmapped.length + skipped.ambiguous.length,
      combinationsLeftOut: skipped.combination.length,
      ingredientPairs: pairs.size,
      major: levelCounts.major,
      moderate: levelCounts.moderate,
      minor: levelCounts.minor,
      unknown: levelCounts.unknown,
      ingredients: ingredients.length,
      anchoredIngredients: anchored.size,
    },
    source:
      'DDInter, Computational Biology & Drug Design Group (https://ddinter2.scbdd.com/download/): the eight download files, ATC groups A, B, D, H, L, P, R and V. Tian Y, et al. DDInter 2.0. Nucleic Acids Res 2025;53(D1):D1356–D1362; Xiong G, et al. DDInter. Nucleic Acids Res 2022;50:D1200–D1207.',
    licence:
      'DDInter data: Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0). This file is adapted from DDInter: drug names were mapped to RxNorm ingredients, unmapped names and combination products were left out, and where DDInter lists a drug in several forms the highest risk level is kept. It is shared under the same licence. DDInter states that it cannot guarantee the accuracy or completeness of its contents and that the absence of an interaction does not necessarily mean that no interaction exists. The download files hold no mechanism or management text.',
    sourceFiles: files.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256 })),
  });

  const extra = Object.entries(extraNames).filter(([r]) => !subset.ingredients.some(([x]) => x === r));
  mergeExtraIngredients(extra, 'DDInter');

  // ------------------------------------------------------------------ the review file
  const line = (e) => `| ${e.name} | ${e.kind} | ${e.via ?? ''} |`;
  const md = [
    '# DDInter → RxNorm mapping',
    '',
    `*Generated by \`scripts/data/build-ddinter.mjs\` on ${retrievedAt}. Do not edit by hand.*`,
    '',
    `Source rows ${rows}; unique DDInter pairs ${raw.size}; DDInter drugs ${names.size}; drugs used ${used.size}; ingredient pairs ${pairs.size} (major ${levelCounts.major}, moderate ${levelCounts.moderate}, minor ${levelCounts.minor}, unknown ${levelCounts.unknown}); DDInter pairs not used ${dropped}.`,
    '',
    `Anchored ingredients (a pair with one of them and no record is reported as checked): ${anchored.size} of ${ingredients.length}.`,
    '',
    `## Not mapped (${skipped.unmapped.length}) and ambiguous (${skipped.ambiguous.length})`,
    '',
    'These names did not resolve exactly to one RxNorm ingredient. Their pairs are not in the file; a medication with one of these names is reported as not checked.',
    '',
    '| DDInter name | entry | why |',
    '|---|---|---|',
    ...[...skipped.unmapped, ...skipped.ambiguous].map(line),
    '',
    `## Resolved through RxNav rather than the offline vocabulary (${resolved.filter((r) => r.status === 'mapped' && !r.via.startsWith('vocabulary')).length}) — for review`,
    '',
    '| DDInter name | entry | resolved as | RxNorm ingredient |',
    '|---|---|---|---|',
    ...resolved
      .filter((r) => r.status === 'mapped' && !r.via.startsWith('vocabulary'))
      .map((r) => `| ${r.name} | ${r.kind} | ${r.via} | ${r.ingredients.map((i) => `${r.names?.[i] ?? i} (${i})`).join(' + ')} |`),
    '',
    `## Combination products left out (${skipped.combination.length})`,
    '',
    '| DDInter name | entry | resolved as |',
    '|---|---|---|',
    ...skipped.combination.map(line),
    '',
    `## Local-route entries not used, because a systemic entry exists (${skipped.localShadowed.length})`,
    '',
    '| DDInter name | entry | resolved as |',
    '|---|---|---|',
    ...skipped.localShadowed.map(line),
    '',
    `## ATC group with a download file, but not every DDInter partner is in that file (${notVerified.length}) — treated as not anchored`,
    '',
    '| RxCUI | groups | DDInter names |',
    '|---|---|---|',
    ...notVerified.map((n) => `| ${n.ing} | ${n.groups.join(', ')} | ${n.names.join('; ')} |`),
    '',
  ].join('\n');
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, md);
  process.stderr.write(`wrote ${OUT} (${Buffer.byteLength(json)} bytes), ${pairs.size} pairs, ${anchored.size} anchored ingredients\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

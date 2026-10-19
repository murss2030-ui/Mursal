#!/usr/bin/env node
/**
 * Builds the offline WHO AWaRe file from the WHO spreadsheet "WHO Access,
 * Watch, Reserve (AWaRe) classification of antibiotics for evaluation and
 * monitoring of use, 2025" (B09489-eng.xlsx, WHO IRIS 10665/382244,
 * CC BY-NC-SA 3.0 IGO), sheet "AWaRe classification 2025".
 *
 * - Every antibiotic is mapped to RxNorm ingredients exactly (lib-rxnav.mjs);
 *   a combination ("Amoxicillin/clavulanic-acid") is kept as the set of its
 *   ingredients, so it is matched as a combination, not ingredient by ingredient.
 * - Route-specific entries ("Fosfomycin_IV", "Fosfomycin_oral") keep their
 *   route: the category can differ by route.
 * - A name that does not resolve exactly is left out and listed.
 *
 * Writes public/data/who-aware-2025.json and its manifest entry, adds to the
 * vocabulary the RxNorm ingredients outside the prescribable subset that AWaRe
 * names, and writes docs/m2/datasets/AWARE-MAPPING.md.
 *
 * Run: NODE_USE_ENV_PROXY=1 node scripts/data/build-aware.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { localIndex, pool, resolveName, ROOT, saveCache, sha256 } from './lib-rxnav.mjs';
import { mergeExtraIngredients, writeManifestEntry } from './lib-datasets.mjs';

const URL = 'https://iris.who.int/bitstreams/a8c53afc-fa43-4883-9a59-21a9e069f40c/download';
const CACHE = join(ROOT, 'node_modules/.cache/preceptor-data/aware/B09489-eng.xlsx');
const OUT = join(ROOT, 'public/data/who-aware-2025.json');
const REPORT = join(ROOT, 'docs/m2/datasets/AWARE-MAPPING.md');
const SHEET = 'AWaRe classification 2025';

// ------------------------------------------------------------------ a minimal .xlsx reader (zip + XML)

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip directory');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    files.set(name, method === 0 ? data : inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const xmlText = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function readSheet(buf, sheetName) {
  const files = unzip(buf);
  const text = (n) => files.get(n)?.toString('utf8') ?? '';
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
  const rels = new Map([...text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheet = [...text('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find((m) => xmlText(m[1]) === sheetName);
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found`);
  const target = rels.get(sheet[2]).replace(/^\/?(xl\/)?/, 'xl/');
  const rows = [];
  for (const r of text(target).matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /r="([A-Z]+)\d+"/.exec(c[1])[1];
      const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = /t="([^"]+)"/.exec(c[1])?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? '')?.[1];
      const inline = /<is>([\s\S]*?)<\/is>/.exec(c[2] ?? '')?.[1];
      row[col] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? xmlText(inline ?? '') : v !== undefined ? xmlText(v) : '';
    }
    rows.push(row.map((x) => (x ?? '').replace(/ /g, ' ').trim()));
  }
  return rows;
}

// ------------------------------------------------------------------ build

async function main() {
  if (!existsSync(CACHE)) {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`WHO IRIS: HTTP ${res.status}`);
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  const xlsx = readFileSync(CACHE);
  const rows = readSheet(xlsx, SHEET);
  const headAt = rows.findIndex((r) => r[0] === 'Antibiotic' && r[3] === 'Category');
  if (headAt < 0) throw new Error('Header row not found');
  const items = rows
    .slice(headAt + 1)
    .filter((r) => r[0])
    .map((r) => {
      const m = /^(.*)_(IV|oral)$/.exec(r[0]);
      return { who: r[0], name: m ? m[1] : r[0], route: m ? (m[2] === 'IV' ? 'parenteral' : 'oral') : '', klass: r[1], atc: r[2], category: r[3].toLowerCase(), eml: r[4] };
    });
  for (const it of items) if (!['access', 'watch', 'reserve'].includes(it.category)) throw new Error(`Unknown category ${it.category} for ${it.who}`);

  const subset = JSON.parse(readFileSync(join(ROOT, 'public/data/rxnorm-subset.json'), 'utf8'));
  const local = localIndex(subset);
  const extraNames = {};
  const mapped = await pool(items, 4, async (it) => {
    const parts = it.name.split('/').map((p) => p.replace(/-/g, ' ').trim());
    const res = [];
    for (const p of parts) res.push(await resolveName(p, local));
    const ok = res.every((r) => r.status === 'mapped' && !r.multi);
    for (const r of res) Object.assign(extraNames, r.names ?? {});
    return { ...it, parts, res, ok, ingredients: ok ? [...new Set(res.map((r) => r.ingredients[0]))].sort((a, b) => Number(a) - Number(b)) : [] };
  });
  saveCache();

  const categories = [];
  const conflicts = [];
  const seen = new Map();
  for (const m of mapped.filter((x) => x.ok)) {
    const key = `${m.ingredients.join('+')}|${m.route}`;
    if (seen.has(key)) {
      const prev = seen.get(key);
      if (prev.category !== m.category) conflicts.push([prev.who, m.who]);
      continue;
    }
    seen.set(key, m);
    categories.push([m.ingredients.join('+'), m.category, m.route, m.who.replace(/_(IV|oral)$/, ` (${m.route === 'oral' ? 'oral' : 'IV'})`)]);
  }
  if (conflicts.length) throw new Error(`Two WHO entries map to the same ingredients with different categories: ${JSON.stringify(conflicts)}`);

  const retrievedAt = new Date().toISOString().slice(0, 10);
  // WHO's suggested citation, as printed in the spreadsheet.
  const citation =
    'The selection and use of essential medicines, 2025: WHO AWaRe (access, watch, reserve) classification of antibiotics for evaluation and monitoring of use. Geneva: World Health Organization; 2025. https://doi.org/10.2471/B09489. Licence: CC BY-NC-SA 3.0 IGO';
  const data = { dataset: 'aware', format: 2, version: 'WHO AWaRe classification 2025', citation, retrievedAt, categories };
  const json = JSON.stringify(data);
  writeFileSync(OUT, json);
  const count = (c) => categories.filter((x) => x[1] === c).length;
  writeManifestEntry('aware', {
    file: 'data/who-aware-2025.json',
    title: 'WHO AWaRe classification of antibiotics, 2025, mapped to RxNorm ingredients',
    version: data.version,
    retrievedAt,
    bytes: Buffer.byteLength(json),
    sha256: sha256(json),
    counts: { whoEntries: items.length, mapped: categories.length, notMapped: mapped.filter((x) => !x.ok).length, access: count('access'), watch: count('watch'), reserve: count('reserve') },
    source: 'World Health Organization, IRIS https://iris.who.int/handle/10665/382244 — spreadsheet B09489-eng.xlsx, sheet "AWaRe classification 2025"',
    licence:
      `${citation}. This file is an adaptation of the WHO work: antibiotic names were mapped to RxNorm ingredients and names that did not map exactly were left out. It is shared under the same licence. The adaptation was not created by WHO; WHO is not responsible for its content or accuracy, and does not endorse PRECEPTOR.`,
    sourceFiles: [{ name: 'B09489-eng.xlsx', bytes: xlsx.length, sha256: sha256(xlsx) }],
  });
  const extra = Object.entries(extraNames).filter(([r]) => !subset.ingredients.some(([x]) => x === r));
  mergeExtraIngredients(extra, 'WHO AWaRe 2025');

  const nameOf = new Map([...subset.ingredients, ...(subset.extra ?? [])]);
  const md = [
    '# WHO AWaRe 2025 → RxNorm mapping',
    '',
    `*Generated by \`scripts/data/build-aware.mjs\` on ${retrievedAt}. Do not edit by hand.*`,
    '',
    `WHO entries ${items.length}; mapped ${categories.length} (Access ${count('access')}, Watch ${count('watch')}, Reserve ${count('reserve')}); not mapped ${mapped.filter((x) => !x.ok).length}.`,
    '',
    '## Mapped',
    '',
    '| WHO name | route | category | RxNorm ingredients | how |',
    '|---|---|---|---|---|',
    ...mapped.filter((x) => x.ok).map((m) => `| ${m.who} | ${m.route || 'any'} | ${m.category} | ${m.res.map((r) => `${r.names?.[r.ingredients[0]] ?? nameOf.get(r.ingredients[0]) ?? r.ingredients[0]} (${r.ingredients[0]})`).join(' + ')} | ${m.res.map((r) => r.via).join('; ')} |`),
    '',
    '## Not mapped — an order for these is listed as "AWaRe not assigned"',
    '',
    '| WHO name | category | why |',
    '|---|---|---|',
    ...mapped.filter((x) => !x.ok).map((m) => `| ${m.who} | ${m.category} | ${m.res.map((r, i) => `${m.parts[i]}: ${r.status === 'mapped' ? (r.multi ? 'combination' : 'mapped') : r.via}`).join('; ')} |`),
    '',
  ].join('\n');
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, md);
  process.stderr.write(`wrote ${OUT} (${Buffer.byteLength(json)} bytes): ${categories.length} of ${items.length} entries mapped\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

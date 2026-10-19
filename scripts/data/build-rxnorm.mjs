#!/usr/bin/env node
/**
 * Builds the offline drug vocabulary used by the rules engine (M2c/M2d):
 *
 * - RxNorm Current Prescribable Content (ingredients IN, precise ingredients
 *   PIN, multiple ingredients MIN, brand names BN), each mapped to its
 *   ingredient RxCUIs, from the NLM RxNav API (https://rxnav.nlm.nih.gov).
 * - Drug classes from RxClass: FDA Established Pharmacologic Classes (EPC,
 *   source FDASPL) for allergy and duplication matching, and the VA National
 *   Formulary antimicrobial classes (AM*) to identify antimicrobials.
 * - International names (INN/BAN) that RxNorm resolves to an ingredient by its
 *   normalised name search, kept only when RxNav itself confirms the match.
 *
 * Writes public/data/rxnorm-subset.json and records its version, retrieval
 * date, size, SHA-256 and attribution in src/data/datasets.json. The app
 * verifies the checksum before using the file and never fetches it from
 * anywhere but its own origin.
 *
 * Run: NODE_USE_ENV_PROXY=1 node scripts/data/build-rxnorm.mjs, then build-epc.mjs (direct EPC
 * membership and grouping nodes), build-ddinter.mjs and build-aware.mjs — `npm run data:build` runs all four.
 * This script rewrites the vocabulary file, so the other three must be run again after it.
 * RxNav asks for no more than 20 requests per second; this script stays below 12.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = 'https://rxnav.nlm.nih.gov/REST';
const OUT = join(ROOT, 'public/data/rxnorm-subset.json');
const MANIFEST = join(ROOT, 'src/data/datasets.json');

// ------------------------------------------------------------------ polite HTTP

const RATE = 12; // requests per second
let next = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, next);
  next = at + 1000 / RATE;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

async function get(path, attempt = 0) {
  await slot();
  try {
    const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${path}`), { fatal: true });
    return await res.json();
  } catch (e) {
    if (e.fatal || attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return get(path, attempt + 1);
  }
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  let done = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]);
      done++;
      if (done % 250 === 0) process.stderr.write(`  ${done}/${items.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

const concepts = (body) => body?.minConceptGroup?.minConcept ?? [];
const relatedIn = (body) =>
  (body?.relatedGroup?.conceptGroup ?? []).flatMap((g) => (g.tty === 'IN' ? g.conceptProperties ?? [] : [])).map((c) => c.rxcui);

// ------------------------------------------------------------------ vocabulary

async function main() {
  const version = await get('/version.json');
  process.stderr.write(`RxNorm ${version.version} (API ${version.apiVersion})\n`);

  const [ins, pins, mins, bns] = await Promise.all(['IN', 'PIN', 'MIN', 'BN'].map((t) => get(`/Prescribe/allconcepts.json?tty=${t}`).then(concepts)));
  process.stderr.write(`IN ${ins.length}, PIN ${pins.length}, MIN ${mins.length}, BN ${bns.length}\n`);

  const related = async (list, label) => {
    process.stderr.write(`${label}: mapping to ingredients\n`);
    return pool(list, 6, async (c) => ({ rxcui: c.rxcui, name: c.name, in: relatedIn(await get(`/Prescribe/rxcui/${c.rxcui}/related.json?tty=IN`)) }));
  };
  const pinMap = await related(pins, 'PIN');
  const minMap = await related(mins, 'MIN');
  const bnMap = await related(bns, 'BN');

  const inIds = new Set(ins.map((c) => c.rxcui));
  const pinToIn = new Map(pinMap.map((p) => [p.rxcui, p.in]));
  const inByName = new Map(ins.map((c) => [c.name.toLowerCase(), c.rxcui]));

  // ------------------------------------------------------------------ EPC classes (FDASPL)
  const epcs = (await get('/rxclass/allClasses.json?classTypes=EPC')).rxclassMinConceptList?.rxclassMinConcept ?? [];
  process.stderr.write(`EPC classes: ${epcs.length}\n`);
  const epcMembers = await pool(epcs, 6, async (c) => {
    const body = await get(`/rxclass/classMembers.json?classId=${encodeURIComponent(c.classId)}&relaSource=FDASPL&rela=has_epc&ttys=IN+PIN`);
    const ids = new Set();
    for (const m of body?.drugMemberGroup?.drugMember ?? []) {
      const { rxcui, tty } = m.minConcept;
      if (tty === 'IN' && inIds.has(rxcui)) ids.add(rxcui);
      if (tty === 'PIN') for (const i of pinToIn.get(rxcui) ?? []) if (inIds.has(i)) ids.add(i);
    }
    return { id: c.classId, name: c.className, members: [...ids].sort() };
  });

  // ------------------------------------------------------------------ VA antimicrobial classes (AM*)
  const vas = ((await get('/rxclass/allClasses.json?classTypes=VA')).rxclassMinConceptList?.rxclassMinConcept ?? []).filter(
    (c) => /^AM\d{3}$/.test(c.classId) && c.classId !== 'AM000',
  );
  process.stderr.write(`VA antimicrobial classes: ${vas.length}\n`);
  const vaMembers = await pool(vas, 4, async (c) => {
    const body = await get(`/rxclass/classMembers.json?classId=${encodeURIComponent(c.classId)}&relaSource=VA&rela=has_VAclass`);
    const ids = new Set();
    for (const m of body?.drugMemberGroup?.drugMember ?? []) {
      const { name, tty } = m.minConcept;
      if (tty !== 'SCD' && tty !== 'SBD') continue; // packs are skipped: they can mix drug classes
      const clinical = name.replace(/\s*\[[^\]]*\]\s*$/, ''); // drop a brand in brackets
      for (const part of clinical.split(' / ')) {
        const ingredient = part.replace(/\s+\d.*$/, '').trim().toLowerCase();
        const id = inByName.get(ingredient);
        if (id) ids.add(id);
      }
    }
    return { id: c.classId, name: c.className, members: [...ids].sort() };
  });

  // ------------------------------------------------------------------ international names confirmed by RxNav
  const intl = JSON.parse(readFileSync(join(ROOT, 'scripts/data/international-names.json'), 'utf8')).names;
  const synonyms = [];
  for (const term of intl) {
    const body = await get(`/rxcui.json?name=${encodeURIComponent(term)}&search=2`);
    const id = body?.idGroup?.rxnormId?.[0];
    if (id && inIds.has(id)) synonyms.push([term.toLowerCase(), id]);
  }
  process.stderr.write(`international names confirmed: ${synonyms.length}/${intl.length}\n`);

  const data = {
    dataset: 'rxnorm-subset',
    rxnormVersion: version.version,
    retrievedAt: new Date().toISOString().slice(0, 10),
    source: 'RxNorm Current Prescribable Content and RxClass, U.S. National Library of Medicine, via the RxNav API (https://rxnav.nlm.nih.gov)',
    ingredients: ins.map((c) => [c.rxcui, c.name]).sort((a, b) => (a[1] < b[1] ? -1 : 1)),
    precise: pinMap.filter((p) => p.in.length).map((p) => [p.rxcui, p.name, p.in]),
    multi: minMap.filter((p) => p.in.length).map((p) => [p.rxcui, p.name, p.in]),
    brands: bnMap.filter((p) => p.in.length).map((p) => [p.rxcui, p.name, p.in]),
    synonyms,
    epc: epcMembers.filter((c) => c.members.length).map((c) => [c.id, c.name, c.members]),
    vaAntimicrobial: vaMembers.filter((c) => c.members.length).map((c) => [c.id, c.name, c.members]),
  };
  const json = JSON.stringify(data);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  const sha256 = createHash('sha256').update(json).digest('hex');

  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : { datasets: {} };
  manifest.datasets['rxnorm-subset'] = {
    file: 'data/rxnorm-subset.json',
    title: 'RxNorm prescribable ingredients and brands, with FDA EPC and VA antimicrobial classes',
    version: `RxNorm ${version.version}`,
    retrievedAt: data.retrievedAt,
    bytes: Buffer.byteLength(json),
    sha256,
    counts: {
      ingredients: data.ingredients.length,
      preciseIngredients: data.precise.length,
      multipleIngredients: data.multi.length,
      brands: data.brands.length,
      internationalNames: data.synonyms.length,
      epcClasses: data.epc.length,
      vaAntimicrobialClasses: data.vaAntimicrobial.length,
    },
    source: data.source,
    licence:
      'RxNorm content from NLM (SAB=RXNORM) is free to use without a UMLS licence; FDA EPC and VA classes are U.S. Government works. This product uses publicly available data from the U.S. National Library of Medicine (NLM), National Institutes of Health, Department of Health and Human Services; NLM is not responsible for the product and does not endorse or recommend this or any other product.',
  };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  process.stderr.write(`wrote ${OUT} (${Buffer.byteLength(json)} bytes, sha256 ${sha256})\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

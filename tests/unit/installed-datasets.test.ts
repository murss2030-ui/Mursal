/**
 * The datasets the app ships, read from public/data exactly as the app reads
 * them: each file matches the SHA-256 in the manifest, and known records from
 * the sources come out as they are published — DDInter's levels for
 * well-known pairs, DDInter's coverage gaps reported as gaps, WHO's AWaRe
 * categories (including a combination and the route-specific fosfomycin), and
 * drugs outside the US prescribable list recognised by name.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../src/data/datasets.json';
import { buildAware, buildInteractions, type AwareFile, type InteractionFile } from '../../src/drugs/datasets';
import { matchDrug } from '../../src/drugs/normalize';
import { buildVocabulary, sha256Hex, type RxnormSubset } from '../../src/drugs/vocabulary';
import { classesForAllergen } from '../../src/rules/allergy-terms';
import { evaluateRules } from '../../src/rules/engine';
import type { TimelineEntry } from '../../src/domain/types';

const read = (f: string) => readFileSync(`public/${f}`, 'utf8');
const entries = manifest.datasets as Record<string, { file: string; sha256: string; bytes: number }>;

const vocab = buildVocabulary(JSON.parse(read(entries['rxnorm-subset']!.file)) as RxnormSubset);
const rx = (name: string) => {
  const m = matchDrug(name, vocab);
  if (m.status !== 'matched' || m.ingredients.length !== 1) throw new Error(`${name} did not match one ingredient`);
  return m.ingredients[0]!.rxcui;
};

describe('installed dataset files', () => {
  it.each(['rxnorm-subset', 'interactions', 'aware'])('%s matches its manifest checksum and size', async (id) => {
    const e = entries[id]!;
    const text = read(e.file);
    expect(Buffer.byteLength(text)).toBe(e.bytes);
    expect(await sha256Hex(text)).toBe(e.sha256);
  });

  it('DDInter: published levels of well-known pairs (download files of DDInter)', () => {
    const ds = buildInteractions(JSON.parse(read(entries.interactions!.file)) as InteractionFile);
    expect(ds.lookup(rx('warfarin'), rx('amiodarone'))).toEqual([{ severity: 'major', onc: false }]);
    expect(ds.lookup(rx('clarithromycin'), rx('simvastatin'))).toEqual([{ severity: 'major', onc: false }]);
    expect(ds.lookup(rx('enoxaparin'), rx('ibuprofen'))).toEqual([{ severity: 'major', onc: false }]);
    expect(ds.lookup(rx('omeprazole'), rx('clopidogrel'))).toEqual([{ severity: 'major', onc: false }]);
    expect(ds.oncInstalled).toBe(false);
  });

  it('DDInter: a pair the download files do not hold is reported as outside them, not as no interaction', () => {
    const ds = buildInteractions(JSON.parse(read(entries.interactions!.file)) as InteractionFile);
    // Both cardiovascular (ATC C): not in the files, although DDInter has such pairs online.
    expect(ds.lookup(rx('amiodarone'), rx('digoxin'))).toEqual([]);
    expect(ds.coverage(rx('amiodarone'), rx('digoxin'))).toBe('outside_files');
    // Warfarin (ATC B) is anchored: its pairs are all in the files.
    expect(ds.coverage(rx('warfarin'), rx('digoxin'))).toBe('checked');
  });

  it('the vocabulary recognises drugs DDInter names that are outside the US prescribable list', () => {
    expect(vocab.lookup('acenocoumarol')?.via).toBe('ingredient');
    const ds = buildInteractions(JSON.parse(read(entries.interactions!.file)) as InteractionFile);
    expect(ds.knows(rx('acenocoumarol'))).toBe(true);
  });

  it('WHO AWaRe 2025: categories as published, a combination as a whole, and fosfomycin by route', () => {
    const ds = buildAware(JSON.parse(read(entries.aware!.file)) as AwareFile);
    const cat = (names: string[], route?: 'oral' | 'parenteral') => ds.categoryOf(names.map(rx), route).map((m) => m.category);
    expect(cat(['amoxicillin'])).toEqual(['access']);
    expect(cat(['amoxicillin', 'clavulanate'])).toEqual(['access']);
    expect(cat(['ceftriaxone'])).toEqual(['watch']);
    expect(cat(['piperacillin', 'tazobactam'])).toEqual(['watch']);
    expect(cat(['meropenem'])).toEqual(['watch']);
    expect(cat(['linezolid'])).toEqual(['reserve']);
    expect(cat(['fosfomycin'], 'oral')).toEqual(['watch']);
    expect(cat(['fosfomycin'], 'parenteral')).toEqual(['reserve']);
  });

  it('classes: an ingredient is filed only under its own FDA classes, never under a broad grouping node', () => {
    const names = (r: string) => vocab.classesOf(r).map((c) => c.name);
    for (const d of ['enoxaparin', 'furosemide', 'ceftriaxone', 'ibuprofen', 'amoxicillin']) {
      expect(names(rx(d))).not.toContain('Established Pharmacologic Classes');
      expect(names(rx(d))).not.toContain('Anti-infective');
      expect(names(rx(d))).not.toContain('Cardiovascular Agent');
    }
    const shared = vocab.classesOf(rx('enoxaparin')).filter((c) => vocab.classesOf(rx('furosemide')).some((d) => d.id === c.id));
    expect(shared).toEqual([]);
    // Two proton pump inhibitors do share their class.
    const ppi = vocab.classesOf(rx('omeprazole')).filter((c) => vocab.classesOf(rx('pantoprazole')).some((d) => d.id === c.id));
    expect(ppi.map((c) => c.name)).toContain('Proton Pump Inhibitor');
  });

  it('an allergy word that names a broad class still covers its subclasses ("opioid", "penicillin")', () => {
    const covers = (term: string, drug: string) => classesForAllergen(term, vocab).some((c) => vocab.members(c.id).includes(rx(drug)));
    for (const d of ['morphine', 'oxycodone', 'fentanyl', 'hydromorphone']) expect(covers('opioid allergy', d)).toBe(true);
    for (const d of ['amoxicillin', 'piperacillin', 'penicillin G']) expect(covers('penicillin', d)).toBe(true);
    expect(covers('penicillin', 'ceftriaxone')).toBe(false);
  });

  it('no false "same class" note between unrelated drugs (regression)', () => {
    let n = 0;
    const med = (drug: string): TimelineEntry =>
      ({ id: `e${++n}`, caseId: 'C', hospitalDay: 0, recordedAt: `2026-10-18T00:00:0${n}Z`, author: 'user', provenance: 'user_entered', type: 'med_start', payload: { medId: `m${n}`, drug, dose: { kind: 'structured', value: 1, unit: 'mg' }, route: 'IV', frequency: 'once daily' } }) as TimelineEntry;
    const current = [med('enoxaparin'), med('furosemide'), med('ceftriaxone'), med('ibuprofen')];
    const out = evaluateRules({ today: 0, current, items: [], tasks: [], calcResults: [], isCurrent: () => true, formulary: [], adjustments: [], thresholds: [], gather: { demographics: { ageYears: 60, sex: 'M' }, current }, vocab });
    expect(out.alerts.filter((a) => a.ruleId === 'duplication')).toEqual([]);
  });
});


/**
 * The shipped offline vocabulary (public/data/rxnorm-subset.json): its
 * checksum matches the manifest, and names used on the wards resolve to the
 * right RxNorm ingredients. Expected answers are the RxNorm concepts as
 * published by NLM (RxCUI 723 amoxicillin, 48203 clavulanate, 161
 * acetaminophen, 2193 ceftriaxone).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../src/data/datasets.json';
import { matchDrug } from '../../src/drugs/normalize';
import { buildVocabulary, DatasetIntegrityError, loadVocabulary, sha256Hex, type RxnormSubset } from '../../src/drugs/vocabulary';
import { ALLERGY_CLASS_TERMS, classesForAllergen } from '../../src/rules/allergy-terms';

const META = manifest.datasets['rxnorm-subset'];
const TEXT = readFileSync(`public/${META.file}`, 'utf8');
const VOCAB = buildVocabulary(JSON.parse(TEXT) as RxnormSubset);
const ids = (name: string) => {
  const m = matchDrug(name, VOCAB);
  return m.status === 'matched' ? m.ingredients.map((i) => i.rxcui).sort() : m.reason;
};

describe('the shipped RxNorm subset', () => {
  it('matches the checksum recorded in the manifest', async () => {
    expect(await sha256Hex(TEXT)).toBe(META.sha256);
    expect(Buffer.byteLength(TEXT)).toBe(META.bytes);
  });

  it('is refused when its content does not match the checksum', async () => {
    const fetchFn = (async () => new Response(TEXT.replace('amoxicillin', 'amoxicillim'))) as typeof fetch;
    await expect(loadVocabulary(`/${META.file}`, META.sha256, fetchFn)).rejects.toBeInstanceOf(DatasetIntegrityError);
    const ok = (async () => new Response(TEXT)) as typeof fetch;
    expect((await loadVocabulary(`/${META.file}`, META.sha256, ok)).version).toBe(META.version.replace('RxNorm ', ''));
  });

  it('resolves generic, brand, combination, salt and international names', () => {
    expect(ids('amoxicillin')).toEqual(['723']);
    expect(ids('Amoxicillin 500 mg capsules')).toEqual(['723']);
    expect(ids('Augmentin 1 g tab')).toEqual(['48203', '723']);
    expect(ids('amoxicillin/clavulanate 875 mg/125 mg')).toEqual(['48203', '723']);
    expect(ids('Ceftriaxone sodium 1 g vial')).toEqual(['2193']);
    expect(ids('Paracetamol 500mg')).toEqual(['161']);
    expect(ids('Panadol')).toEqual(['161']);
  });

  it('reports a name it does not know as not checked — no fuzzy guess', () => {
    expect(ids('Fantasimab 10 mg')).toBe('unmatched');
    expect(ids('hydralazin')).toBe('unmatched');
    expect(ids('')).toBe('empty');
  });

  it('every class in the allergy-term table exists in the shipped classes', () => {
    const missing = [...new Set(Object.values(ALLERGY_CLASS_TERMS).flat())].filter((id) => !VOCAB.classById(id));
    expect(missing).toEqual([]);
  });

  it('a penicillin allergy names the penicillin class, which contains amoxicillin', () => {
    const classes = classesForAllergen('Penicillin allergy', VOCAB);
    expect(classes.map((c) => c.name)).toEqual(['Penicillin-class Antibacterial']);
    expect(VOCAB.members(classes[0]!.id)).toContain('723');
  });

  it('identifies antimicrobials from the VA classes', () => {
    expect(VOCAB.antimicrobialClassesOf('723').map((c) => c.id)).toContain('AM111');
    expect(VOCAB.antimicrobialClassesOf('2193').length).toBeGreaterThan(0);
    expect(VOCAB.antimicrobialClassesOf('161')).toEqual([]);
  });
});

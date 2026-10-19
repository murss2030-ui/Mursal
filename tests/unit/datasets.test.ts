/**
 * The interaction, ONC and AWaRe loaders: lookups are symmetric and exact; a
 * pair without a record is "checked" only when the dataset really covers it;
 * a combination is matched as a whole and the route chooses a route-specific
 * entry; and a file whose checksum does not match is refused before parsing.
 */
import { describe, expect, it } from 'vitest';
import { buildAware, buildInteractions, loadVerified, packPairs, type AwareFile, type InteractionFile, type OncFile } from '../../src/drugs/datasets';
import { DatasetIntegrityError, sha256Hex } from '../../src/drugs/vocabulary';

// Synthetic records for the loaders only: not clinical data.
const INGREDIENTS = ['100', '200', '300', '400', '500'];
const FILE: InteractionFile = {
  dataset: 'interactions',
  format: 2,
  version: 'synthetic 1',
  citation: 'synthetic test file',
  ingredients: INGREDIENTS,
  // 100 is anchored (its every pair is in the file); 200–500 are not.
  anchored: '000',
  packed: packPairs(INGREDIENTS, [
    ['200', '100', 'major'],
    ['100', '300', 'moderate'],
    ['400', '300', 'unknown'],
  ]),
};

const fetchOf = (text: string, status = 200) => (async () => new Response(text, { status })) as unknown as typeof fetch;

describe('interaction dataset', () => {
  it('looks a pair up in either order', () => {
    const ds = buildInteractions(FILE);
    expect(ds.lookup('100', '200')).toEqual([{ severity: 'major', onc: false }]);
    expect(ds.lookup('200', '100')).toEqual(ds.lookup('100', '200'));
    expect(ds.lookup('300', '400')).toEqual([{ severity: 'unknown', onc: false }]);
    expect(ds.lookup('100', '100')).toEqual([]);
    expect(ds.lookup('100', '999')).toEqual([]);
    expect(ds).toMatchObject({ version: 'synthetic 1', citation: 'synthetic test file', oncInstalled: false });
  });

  it('a pair without a record is checked only when one drug is anchored and both are known', () => {
    const ds = buildInteractions(FILE);
    expect(ds.coverage('100', '400')).toBe('checked');
    expect(ds.coverage('500', '100')).toBe('checked');
    expect(ds.coverage('200', '500')).toBe('outside_files');
    expect(ds.coverage('200', '999')).toBe('drug_not_in_dataset');
    expect(ds.knows('500')).toBe(true);
    expect(ds.knows('999')).toBe(false);
  });

  it('the ONC list raises a recorded pair, and adds a pair DDInter does not record', () => {
    const onc: OncFile = { dataset: 'onc', version: 'onc test', citation: 'synthetic ONC', pairs: [[['200'], ['100'], 'A – B'], [['500'], ['400', '300'], 'C – D']] };
    const ds = buildInteractions(FILE, onc);
    expect(ds.oncInstalled).toBe(true);
    expect(ds.lookup('100', '200')).toEqual([{ severity: 'major', onc: true }]);
    expect(ds.lookup('300', '500')).toEqual([{ severity: 'major', onc: true }]);
    expect(ds.lookup('100', '300')).toEqual([{ severity: 'moderate', onc: false }]);
    expect(ds.version).toBe('synthetic 1; onc test');
  });

  it('refuses a file in another format', () => {
    expect(() => buildInteractions({ ...FILE, format: 1 as 2 })).toThrow('Unsupported');
    expect(() => buildInteractions({ ...FILE, packed: `${FILE.packed}x` })).toThrow('Unsupported');
  });
});

describe('AWaRe dataset', () => {
  const file: AwareFile = {
    dataset: 'aware',
    format: 2,
    version: 'v',
    citation: 'c',
    categories: [
      ['723', 'access', '', 'Amoxicillin'],
      ['723+48203', 'access', '', 'Amoxicillin/clavulanic-acid'],
      ['4550', 'reserve', 'parenteral', 'Fosfomycin (IV)'],
      ['4550', 'watch', 'oral', 'Fosfomycin (oral)'],
    ],
  };
  const ds = buildAware(file);

  it('matches a single antibiotic and a combination as a whole, in any ingredient order', () => {
    expect(ds.categoryOf(['723'])).toEqual([{ category: 'access', name: 'Amoxicillin' }]);
    expect(ds.categoryOf(['48203', '723'])).toEqual([{ category: 'access', name: 'Amoxicillin/clavulanic-acid' }]);
    expect(ds.categoryOf(['48203'])).toEqual([]);
    expect(ds.categoryOf(['1'])).toEqual([]);
  });

  it('chooses the route-specific entry by route, and returns both without a route', () => {
    expect(ds.categoryOf(['4550'], 'oral')).toEqual([{ category: 'watch', name: 'Fosfomycin (oral)', route: 'oral' }]);
    expect(ds.categoryOf(['4550'], 'parenteral')).toEqual([{ category: 'reserve', name: 'Fosfomycin (IV)', route: 'parenteral' }]);
    expect(ds.categoryOf(['4550']).map((m) => m.category).sort()).toEqual(['reserve', 'watch']);
  });
});

describe('verified loading', () => {
  it('parses a file whose SHA-256 matches', async () => {
    const text = JSON.stringify(FILE);
    await expect(loadVerified<InteractionFile>('data/x.json', await sha256Hex(text), fetchOf(text))).resolves.toEqual(FILE);
  });

  it('refuses a file whose SHA-256 does not match, and an HTTP error', async () => {
    const text = JSON.stringify(FILE);
    const other = await sha256Hex(`${text} `);
    await expect(loadVerified('data/x.json', other, fetchOf(text))).rejects.toBeInstanceOf(DatasetIntegrityError);
    await expect(loadVerified('data/x.json', other, fetchOf('', 404))).rejects.toThrow('HTTP 404');
  });
});

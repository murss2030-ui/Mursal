/**
 * The interaction and AWaRe dataset loaders: lookups are symmetric and exact,
 * and a file whose checksum does not match the manifest is refused before
 * it is parsed (the same rule as the drug vocabulary).
 */
import { describe, expect, it } from 'vitest';
import { buildAware, buildInteractions, loadVerified, type InteractionFile } from '../../src/drugs/datasets';
import { DatasetIntegrityError, sha256Hex } from '../../src/drugs/vocabulary';

// Synthetic records for the loader only: not clinical data.
const FILE: InteractionFile = {
  dataset: 'interactions',
  version: 'synthetic 1',
  citation: 'synthetic test file',
  pairs: [
    ['100', '200', 'major', false, 'mech A', 'manage A'],
    ['200', '100', 'minor', false],
    ['300', '100', 'moderate', true],
  ],
};

const fetchOf = (text: string, status = 200) => (async () => new Response(text, { status })) as unknown as typeof fetch;

describe('interaction dataset', () => {
  it('looks a pair up in either order and keeps every record of the pair', () => {
    const ds = buildInteractions(FILE);
    expect(ds.lookup('100', '200')).toEqual([
      { severity: 'major', onc: false, mechanism: 'mech A', management: 'manage A' },
      { severity: 'minor', onc: false },
    ]);
    expect(ds.lookup('200', '100')).toEqual(ds.lookup('100', '200'));
    expect(ds.lookup('100', '300')).toEqual([{ severity: 'moderate', onc: true }]);
    expect(ds.lookup('100', '100')).toEqual([]);
    expect(ds.lookup('100', '999')).toEqual([]);
    expect(ds).toMatchObject({ version: 'synthetic 1', citation: 'synthetic test file' });
  });
});

describe('AWaRe dataset', () => {
  it('gives the category of a listed ingredient and nothing for others', () => {
    const ds = buildAware({ dataset: 'aware', version: 'v', citation: 'c', categories: [['723', 'access'], ['2193', 'watch']] });
    expect(ds.categoryOf('723')).toBe('access');
    expect(ds.categoryOf('2193')).toBe('watch');
    expect(ds.categoryOf('1')).toBeUndefined();
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

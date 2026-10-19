/** Provided at build time by scripts/datasets-plugin.ts (the content of src/data/datasets.json). */
declare module 'virtual:preceptor-datasets' {
  export interface DatasetEntry {
    file: string;
    title: string;
    version: string;
    retrievedAt: string;
    bytes: number;
    sha256: string;
    counts?: Record<string, number>;
    source: string;
    licence: string;
    /** Set only in the test manifest of an end-to-end test: the file is test data, not clinical data. */
    testFixture?: boolean;
    sourceFiles?: { name: string; bytes: number; sha256: string }[];
  }
  export const datasets: Partial<Record<'rxnorm-subset' | 'interactions' | 'onc' | 'aware', DatasetEntry>>;
}

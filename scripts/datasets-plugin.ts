/**
 * The offline dataset manifest (src/data/datasets.json) as the virtual module
 * `virtual:preceptor-datasets`, read by src/drugs/useVocabulary.ts and the
 * About screen.
 *
 * PRECEPTOR_TEST_DATASETS=<path> makes a build use another manifest and copy
 * into the build every file it lists with a `fixture` path. It exists for one
 * end-to-end test: no interaction dataset is installed yet (the DDInter hosts
 * are not reachable from the build environment), so that test checks the
 * interaction display with a file marked as a test fixture. Production builds
 * never set it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

export const DATASETS_PATH = 'src/data/datasets.json';
const VIRTUAL_ID = 'virtual:preceptor-datasets';

interface ManifestFile {
  datasets: Record<string, { file: string; fixture?: string }>;
}

export function datasetsPlugin(): Plugin {
  let root = process.cwd();
  const manifestPath = () => resolve(root, process.env.PRECEPTOR_TEST_DATASETS ?? DATASETS_PATH);
  const read = (): ManifestFile => JSON.parse(readFileSync(manifestPath(), 'utf8')) as ManifestFile;
  return {
    name: 'preceptor-datasets',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined;
    },
    load(id) {
      if (id !== `\0${VIRTUAL_ID}`) return undefined;
      this.addWatchFile(manifestPath());
      const m = read();
      // The fixture's location on disk is a build detail, not part of the app.
      const datasets = Object.fromEntries(Object.entries(m.datasets).map(([k, { fixture: _fixture, ...d }]) => [k, d]));
      return `export const datasets = ${JSON.stringify(datasets)};\n`;
    },
    generateBundle() {
      if (!process.env.PRECEPTOR_TEST_DATASETS) return;
      for (const d of Object.values(read().datasets)) {
        if (d.fixture) this.emitFile({ type: 'asset', fileName: d.file, source: readFileSync(resolve(root, d.fixture), 'utf8') });
      }
    },
  };
}

/**
 * The calculator validation manifest (Section 9: "a calculator whose unit
 * tests do not pass has validated: false and is hidden from the UI").
 *
 * The test run writes src/calc/validation-manifest.json (see
 * calc-manifest-reporter.ts): per calculator, its formula version and how
 * many of its tests passed and failed, plus a hash of the calculation engine's
 * source and tests. The build reads the manifest through the virtual module
 * below and recomputes the hash: if the engine changed after its last passing
 * test run, every calculator is hidden until the tests are run again.
 *
 * PRECEPTOR_CALC_MANIFEST=<path> makes a build read another manifest (used by
 * the end-to-end test that checks a failing calculator is hidden).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export const MANIFEST_PATH = 'src/calc/validation-manifest.json';
export const ENGINE_DIRS = ['src/calc', 'tests/calc'];
const VIRTUAL_ID = 'virtual:preceptor-calc-validation';

export interface ManifestEntry {
  formulaVersion: string;
  passed: number;
  failed: number;
}

export interface ValidationManifest {
  version: 1;
  generatedAt: string;
  engineHash: string;
  engineTests: { passed: number; failed: number };
  calculators: Record<string, ManifestEntry>;
}

function filesUnder(root: string, dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|json)$/.test(name)) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  walk(abs);
  return out;
}

/** The files the hash covers: the engine and its tests, without the manifest itself. */
export function engineFiles(root: string): string[] {
  return ENGINE_DIRS.flatMap((d) => filesUnder(root, d)).filter((f) => f !== MANIFEST_PATH);
}

/** SHA-256 over every engine file's path and content (line endings normalised). */
export function engineHash(root: string): string {
  const h = createHash('sha256');
  for (const f of engineFiles(root)) {
    h.update(f);
    h.update('\0');
    h.update(readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex');
}

export function readManifest(path: string): ValidationManifest | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ValidationManifest;
  } catch {
    return null;
  }
}

/** Provides `{ manifest, engineHash }` to src/calc/registry.ts at build time. */
export function calcValidationPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'preceptor-calc-validation',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined;
    },
    load(id) {
      if (id !== `\0${VIRTUAL_ID}`) return undefined;
      const manifestPath = resolve(root, process.env.PRECEPTOR_CALC_MANIFEST ?? MANIFEST_PATH);
      this.addWatchFile(manifestPath);
      for (const f of engineFiles(root)) this.addWatchFile(join(root, f));
      const manifest = readManifest(manifestPath);
      return `export const manifest = ${JSON.stringify(manifest)};\nexport const engineHash = ${JSON.stringify(engineHash(root))};\n`;
    },
  };
}

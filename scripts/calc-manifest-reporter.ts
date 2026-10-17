/**
 * Vitest reporter that writes the calculator validation manifest after a run
 * (see calc-validation.ts).
 *
 * Calculator suites are named `calc:<calculator id>@<formula version>`;
 * suites that test the shared engine (units, input gathering, the Verify gate)
 * are named `engine:<topic>`. The manifest is written only after a run that
 * included every file in tests/calc and skipped none of their tests — a
 * partial or filtered run cannot mark a calculator as validated.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { File, Reporter, Task } from 'vitest';
import { MANIFEST_PATH, engineHash, readManifest, type ValidationManifest } from './calc-validation';

interface Count {
  passed: number;
  failed: number;
  skipped: number;
}

function tests(task: Task): Task[] {
  if (task.type === 'test') return [task];
  return 'tasks' in task ? task.tasks.flatMap(tests) : [];
}

function add(c: Count, t: Task): void {
  const state = t.result?.state;
  if (t.mode === 'skip' || t.mode === 'todo' || state === 'skip' || state === 'todo') c.skipped++;
  else if (state === 'pass') c.passed++;
  else c.failed++;
}

export default class CalcManifestReporter implements Reporter {
  private root = process.cwd();

  onInit(ctx: { config: { root: string } }): void {
    this.root = ctx.config.root;
  }

  onFinished(files: File[] = []): void {
    const rel = (p: string) => relative(this.root, p).split(sep).join('/');
    const dir = join(this.root, 'tests/calc');
    let expected: string[];
    try {
      expected = readdirSync(dir)
        .filter((n) => n.endsWith('.test.ts'))
        .map((n) => `tests/calc/${n}`);
    } catch {
      return;
    }
    const calcFiles = files.filter((f) => rel(f.filepath).startsWith('tests/calc/'));
    const ran = new Set(calcFiles.map((f) => rel(f.filepath)));
    if (!expected.length || !expected.every((e) => ran.has(e))) {
      if (calcFiles.length) console.log('[calc-manifest] not updated: not every calculator test file ran.');
      return;
    }

    const engine: Count = { passed: 0, failed: 0, skipped: 0 };
    const calcs = new Map<string, Count & { formulaVersion: string }>();
    for (const f of calcFiles) {
      // A file that failed to load has no tests: count it against the engine.
      if (f.result?.state === 'fail' && tests(f).length === 0) engine.failed++;
      for (const top of f.tasks) {
        const m = /^calc:([a-z0-9_]+)@(.+)$/.exec(top.name);
        let target: Count = engine;
        if (m) {
          const id = m[1]!;
          const entry = calcs.get(id) ?? { passed: 0, failed: 0, skipped: 0, formulaVersion: m[2]! };
          calcs.set(id, entry);
          target = entry;
        }
        for (const t of tests(top)) add(target, t);
      }
    }
    const skipped = engine.skipped + [...calcs.values()].reduce((s, c) => s + c.skipped, 0);
    if (skipped > 0) {
      console.log(`[calc-manifest] not updated: ${skipped} calculator test(s) skipped. Calculator tests may not be skipped.`);
      return;
    }

    const next: ValidationManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      engineHash: engineHash(this.root),
      engineTests: { passed: engine.passed, failed: engine.failed },
      calculators: Object.fromEntries(
        [...calcs.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([id, c]) => [id, { formulaVersion: c.formulaVersion, passed: c.passed, failed: c.failed }]),
      ),
    };
    const path = join(this.root, MANIFEST_PATH);
    const prev = readManifest(path);
    const same = prev && JSON.stringify({ ...prev, generatedAt: '' }) === JSON.stringify({ ...next, generatedAt: '' });
    if (same) return;
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    const failed = Object.entries(next.calculators).filter(([, c]) => c.failed > 0 || c.passed === 0).map(([id]) => id);
    console.log(
      `[calc-manifest] written: ${Object.keys(next.calculators).length} calculators` +
        (failed.length ? `; failing (hidden in the app): ${failed.join(', ')}` : '; all passing') +
        (engine.failed ? `; ENGINE TESTS FAILING — every calculator is hidden` : ''),
    );
  }
}

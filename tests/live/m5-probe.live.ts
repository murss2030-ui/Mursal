/**
 * M5 preparation — the live probe, at the owner's request of 20 October 2026:
 * the real model on the 30 tasks, with the meaning of every claim checked.
 * Synthetic Teaching Cases only; opt-in; never part of `npm test`.
 *
 *   PRECEPTOR_LIVE=1 PRECEPTOR_LIVE_DRAFT=<model> PRECEPTOR_LIVE_VERIFY=<model>[,<model>…] \
 *   PRECEPTOR_LIVE_PRICES=<model>:<in>:<out>[,…] [PRECEPTOR_LIVE_BUDGET_USD=3] \
 *   [PRECEPTOR_LIVE_PARTS=bench,cases,reverify] [PRECEPTOR_LIVE_CASES=A,B] [PRECEPTOR_LIVE_FROM=<probe json>] \
 *   [PRECEPTOR_LIVE_SKIP=A:collect,…] [PRECEPTOR_LIVE_ATTEMPTS=3] [PRECEPTOR_LIVE_UNCHECKED_ONLY=1] \
 *   [PRECEPTOR_LIVE_KEY_CLASS=paid] NODE_USE_ENV_PROXY=1 \
 *   npx vitest run --config vitest.live.config.ts
 *
 * 1. The semantic benchmark (tests/fixtures/semantic-benchmark.ts): each
 *    verifier model, twice, against the expected verdicts.
 * 2. The 30 tasks: two synthetic cases drafted module by module with the
 *    app's own code (payload, prompt analyse-v3, checks in code), then every
 *    statement that rests on case data verified against the data it cites,
 *    by every verifier model of the run.
 * 3. The claims of an earlier run (PRECEPTOR_LIVE_FROM), through every
 *    verifier model again, without drafting anything.
 *
 * The path is the deployed one without the browser: the app's modules →
 * callModel → the relay code (allow-list, spending cap, rate limits) → the
 * Gemini adapter → Google. The key is never here: it comes from
 * GEMINI_API_KEY or is added by the environment's egress proxy. The relay's
 * spending cap (PRECEPTOR_LIVE_BUDGET_USD at the configured prices) stops the
 * run. Results: docs/m5/live/.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeCalculator } from '../../src/calc/engine';
import { CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import { buildCasePayload } from '../../src/ai/analysis/payload';
import { analyseModule } from '../../src/ai/analysis/run';
import { AiError, type CallDeps } from '../../src/ai/client';
import type { ClaimVerdict } from '../../src/ai/verification/check';
import { claimsFromSuggestions } from '../../src/ai/verification/claims';
import type { VerifyInput } from '../../src/ai/verification/contract';
import { verifyClaims, type VerifyRun } from '../../src/ai/verification/run';
import { MODULE_BY_ID, MODULES } from '../../src/domain/workflow/catalogue';
import type { Suggestion } from '../../src/domain/types';
import type { Store } from '../../src/store/store';
import { readConfig } from '../../relay/config';
import { handleModel, handleStatus } from '../../relay/handler';
import { geminiProvider } from '../../relay/providers/gemini';
import { memoryStore } from '../../relay/usage';
import { BENCH_ITEMS, BENCH_SOURCES } from '../fixtures/semantic-benchmark';
import { newSession } from '../unit/helpers';
import { caseA, caseB, type SyntheticCase } from './cases';

const LIVE = process.env.PRECEPTOR_LIVE === '1';
const DRAFT = process.env.PRECEPTOR_LIVE_DRAFT ?? '';
const VERIFY = (process.env.PRECEPTOR_LIVE_VERIFY ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const PRICES = process.env.PRECEPTOR_LIVE_PRICES ?? '';
const BUDGET = process.env.PRECEPTOR_LIVE_BUDGET_USD ?? '3';
const PARTS = new Set((process.env.PRECEPTOR_LIVE_PARTS ?? 'bench,cases').split(','));
const CASES = new Set((process.env.PRECEPTOR_LIVE_CASES ?? 'A,B').split(','));
/** Modules already drafted in an earlier run, as `A:collect,A:review` (a free-tier key allows 20 requests per model per day). */
const SKIP = new Set((process.env.PRECEPTOR_LIVE_SKIP ?? '').split(',').filter(Boolean));
const ATTEMPTS = Number(process.env.PRECEPTOR_LIVE_ATTEMPTS ?? '3');
const UNCHECKED_ONLY = process.env.PRECEPTOR_LIVE_UNCHECKED_ONLY === '1';
const RUN = process.env.PRECEPTOR_LIVE_RUN ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const OUT = 'docs/m5/live';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'live probe' })]));

interface LiveCall {
  task?: string;
  model?: string;
  status: number;
  ms: number;
  usage?: { prompt: number; output: number; thoughts: number };
  finishReason?: string;
  error?: string;
}

/** The relay, in this process, with the real Gemini adapter; every provider call is recorded (never the key). */
function liveRelay(calls: LiveCall[]) {
  const read = readConfig({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'supplied-by-the-environment',
    PRECEPTOR_MODELS: PRICES,
    PRECEPTOR_SUGGESTED: `analyse=${DRAFT},verify=${VERIFY[0] ?? DRAFT}`,
    PRECEPTOR_KEY_CLASS: process.env.PRECEPTOR_LIVE_KEY_CLASS ?? 'free',
    PRECEPTOR_MONTHLY_BUDGET_USD: BUDGET,
    PRECEPTOR_RATE_PER_MINUTE: '30',
    PRECEPTOR_RATE_PER_DAY: '500',
    PRECEPTOR_THINKING: process.env.PRECEPTOR_LIVE_THINKING ?? 'analyse=low,verify=low',
    ...(process.env.PRECEPTOR_LIVE_TIMEOUT_MS ? { PRECEPTOR_PROVIDER_TIMEOUT_MS: process.env.PRECEPTOR_LIVE_TIMEOUT_MS } : {}),
  });
  if (!read.ok) throw new Error(read.problems.join(' '));
  expect(read.problems).toEqual([]);
  let task: string | undefined;
  const recording = (async (input: string | URL | Request, init?: RequestInit) => {
    const t0 = Date.now();
    const model = String(input).match(/models\/([^:]+):/)?.[1];
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (e) {
      // The relay gave up (its timeout) or the network failed: recorded too.
      calls.push({ task, model, status: 0, ms: Date.now() - t0, error: `${(e as Error).name}: ${(e as Error).message}`.slice(0, 300) });
      throw e;
    }
    const entry: LiveCall = { task, model, status: res.status, ms: Date.now() - t0 };
    try {
      const body = (await res.clone().json()) as {
        candidates?: { finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        error?: { message?: string; status?: string };
      };
      const u = body.usageMetadata;
      if (u) entry.usage = { prompt: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 };
      entry.finishReason = body.candidates?.[0]?.finishReason;
      if (body.error) entry.error = `${body.error.status ?? ''} ${body.error.message ?? ''}`.trim().slice(0, 300);
    } catch {
      entry.error = `HTTP ${res.status} (no JSON body)`;
    }
    calls.push(entry);
    return res;
  }) as typeof fetch;
  const deps = { config: read.config, store: memoryStore(), provider: geminiProvider(read.config.apiKey!, recording) };
  const relayFetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { task?: string }) : undefined;
    task = body?.task;
    const req = new Request(`https://probe.invalid${url}`, init);
    return url.endsWith('/api/status') ? handleStatus(req, deps) : handleModel(req, deps);
  }) as unknown as typeof fetch;
  return { relayFetch, budget: () => handleStatus(new Request('https://probe.invalid/api/status'), deps).then((r) => r.json() as Promise<{ budget: { spentUsd: number; byTask: Record<string, number>; calls: number } }>) };
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One module, retried twice after a pause when the provider refuses for the moment (high demand, timeout). */
async function draftModule(store: Store, caseId: string, moduleId: string, deps: CallDeps) {
  const errors: string[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return { analysis: await analyseModule(store, caseId, moduleId, deps), errors };
    } catch (e) {
      const code = e instanceof AiError ? e.code : 'error';
      errors.push(`${code}: ${(e as Error).message}`);
      if (!(e instanceof AiError) || !['provider_unavailable', 'provider_timeout', 'provider_rate_limited', 'invalid_shape', 'output_truncated', 'provider_blocked'].includes(e.code)) break;
      await pause(attempt * 20_000);
    }
  }
  return { analysis: undefined, errors };
}

/** The verifier over a set of claims; batches the service could not answer are tried again twice, after a pause. */
async function verifyWithRetry(store: Store, caseId: string, input: VerifyInput, deps: CallDeps) {
  const errors: string[] = [];
  const scope = { caseId, caseKind: 'teaching' as const };
  let run: VerifyRun;
  try {
    run = await verifyClaims(store, scope, input, deps);
  } catch (e) {
    errors.push(`${e instanceof AiError ? e.code : 'error'}: ${(e as Error).message}`);
    return { run: undefined, errors };
  }
  for (let attempt = 1; attempt <= 2 && run.failures.length; attempt++) {
    errors.push(...run.failures.map((f) => `${f.code}: ${f.message}`));
    await pause(attempt * 20_000);
    const ids = new Set(run.failures.flatMap((f) => f.claimIds));
    const again = await verifyClaims(store, scope, { claims: input.claims.filter((c) => ids.has(c.id)), sources: input.sources }, deps);
    const byId = new Map(again.verdicts.map((v) => [v.claimId, v]));
    run = { verdicts: run.verdicts.map((v) => byId.get(v.claimId) ?? v), calls: [...run.calls, ...again.calls], failures: again.failures };
  }
  return { run, errors };
}

/** The same claims through every verifier model of the run. */
async function verifyEach(store: Store, caseId: string, input: VerifyInput, deps: CallDeps) {
  const out: Record<string, { run?: VerifyRun; errors: string[] }> = {};
  for (const model of VERIFY) {
    await store.updateAiSettings({ models: { analyse: DRAFT, verify: model } });
    out[model] = input.claims.length ? await verifyWithRetry(store, caseId, input, deps) : { errors: [] };
  }
  await store.updateAiSettings({ models: { analyse: DRAFT, verify: VERIFY[0]! } });
  return out;
}

function claimByModel(byModel: Record<string, { run?: VerifyRun }>, claimId: string) {
  return Object.fromEntries(
    Object.entries(byModel).map(([model, x]) => {
      const r = x.run?.verdicts.find((v) => v.claimId === claimId);
      return [model, r ? { verdict: r.verdict, answered: r.answered, quotes: r.quotes, unsupportedParts: r.unsupportedParts, flags: r.flags } : null];
    }),
  );
}

/** The header every claim of a case may use, for results saved before the probe kept each module's input. */
const HEADERS: Record<string, string> = {
  A: 'Case: {"kind":"teaching","age":67,"sex":"M","heightCm":170,"status":"active","hospitalDayToday":2}',
  B: 'Case: {"kind":"teaching","age":74,"sex":"F","heightCm":158,"status":"active","hospitalDayToday":2}',
};

interface SavedClaim {
  id: string;
  text: string;
  sources: string[];
  verdict?: string;
}
interface SavedModule {
  moduleId: string;
  ok: boolean;
  input?: VerifyInput;
  claims?: SavedClaim[];
}

/** A saved module's claims as the verifier received them (rebuilt from the saved texts when the input was not kept). */
function savedInput(m: SavedModule, caseName: string): VerifyInput {
  if (m.input) return m.input;
  const sources: VerifyInput['sources'] = [{ id: 'H', label: 'Case header', text: HEADERS[caseName.slice(0, 1)]!, context: true }];
  const idOf = new Map<string, string>();
  const claims = (m.claims ?? []).map((c) => ({
    id: c.id,
    text: c.text,
    sourceIds: [
      'H',
      ...c.sources.map((t) => {
        let id = idOf.get(t);
        if (!id) {
          id = `S${sources.length}`;
          idOf.set(t, id);
          sources.push({ id, label: id, text: t });
        }
        return id;
      }),
    ],
  }));
  return { claims, sources };
}

const describeLive = LIVE && DRAFT && VERIFY.length && PRICES ? describe : describe.skip;

describeLive('M5 live probe (synthetic data only)', () => {
  it('runs the semantic benchmark and the 30 tasks with every claim verified', async () => {
    mkdirSync(OUT, { recursive: true });
    const calls: LiveCall[] = [];
    const relay = liveRelay(calls);
    const deps: CallDeps = { fetch: relay.relayFetch, online: () => true, sleep: pause };
    const { store } = await newSession({ calculators: ALL_VALID });
    const results: Record<string, unknown> = {
      run: RUN,
      date: new Date().toISOString(),
      data: 'synthetic Teaching Cases and the synthetic benchmark only',
      models: { draft: DRAFT, verify: VERIFY },
      pricesUsdPerMillion: PRICES,
      thinking: process.env.PRECEPTOR_LIVE_THINKING ?? 'analyse=low,verify=low',
      budgetCapUsd: Number(BUDGET),
    };
    const save = async () => {
      const b = await relay.budget();
      writeFileSync(`${OUT}/probe-${RUN}.json`, JSON.stringify({ ...results, relaySpend: b.budget, calls }, null, 2));
    };

    // ---------------------------------------------------------------- 1. the benchmark
    if (PARTS.has('bench')) {
      const input: VerifyInput = { sources: [...BENCH_SOURCES], claims: BENCH_ITEMS.map((b) => ({ id: b.id, text: b.claim, sourceIds: b.sources })) };
      const bench: Record<string, unknown> = {};
      const rot = await store.createRotation({ department: 'internal_medicine', startDate: '2026-10-01', endDate: '2026-10-31', competencies: ['direct_patient_care'] });
      const benchCase = await store.createCase({ kind: 'teaching', rotationId: rot.id, ageYears: 67, sex: 'M', admissionDay0: '2026-10-11', syntheticDataAttested: true });
      for (const model of VERIFY) {
        await store.updateAiSettings({ models: { analyse: DRAFT, verify: model } });
        const runs = [];
        for (let rep = 1; rep <= 2; rep++) {
          const { run, errors } = await verifyWithRetry(store, benchCase.id, input, deps);
          const verdicts = run?.verdicts ?? [];
          runs.push({
            errors,
            calls: run?.calls ?? [],
            items: BENCH_ITEMS.map((b) => {
              const v = verdicts.find((x) => x.claimId === b.id);
              return { id: b.id, kind: b.kind, expected: b.expected, got: v?.verdict, ok: v ? b.expected.includes(v.verdict) : false, answered: v?.answered, quotes: v?.quotes, unsupportedParts: v?.unsupportedParts, flags: v?.flags };
            }),
          });
          bench[model] = { runs };
          results.benchmark = bench;
          await save();
        }
      }
    }

    // ---------------------------------------------------------------- 2. the 30 tasks, then every claim on case data
    if (PARTS.has('cases')) {
      await store.updateAiSettings({ models: { analyse: DRAFT, verify: VERIFY[0]! } });
      const cases: SyntheticCase[] = [...(CASES.has('A') ? [await caseA(store)] : []), ...(CASES.has('B') ? [await caseB(store)] : [])];
      const out: unknown[] = [];
      results.cases = out;
      for (const k of cases) {
        const c = (await store.getCase(k.caseId))!;
        const modules: unknown[] = [];
        out.push({ name: k.name, modules });
        for (const m of MODULES.filter((x) => !SKIP.has(`${k.name.slice(0, 1)}:${x.id}`))) {
          const { analysis, errors } = await draftModule(store, k.caseId, m.id, deps);
          if (!analysis) {
            modules.push({ moduleId: m.id, ok: false, errors });
            await save();
            continue;
          }
          // The payload the drafting model received (built again from the same record).
          const cards = await store.cardContext(k.caseId);
          const payload = buildCasePayload({
            case: c,
            entries: await store.listEntries(k.caseId),
            items: await store.listItems(k.caseId),
            tasks: await store.listTasks(k.caseId),
            module: MODULE_BY_ID.get(m.id)!,
            today: store.today(),
            calcResults: cards.calcResults,
            calcOutOfDate: cards.calcOutOfDate,
          });
          const { input, origin } = claimsFromSuggestions(analysis.suggestions, payload);
          const byModel = await verifyEach(store, k.caseId, input, deps);
          const first = byModel[VERIFY[0]!]!;
          const verdict = new Map<string, ClaimVerdict>((first.run?.verdicts ?? []).map((x) => [x.claimId, x]));
          const sourceText = new Map(input.sources.map((s) => [s.id, s]));
          modules.push({
            moduleId: m.id,
            draftModel: analysis.model,
            ok: true,
            errors: [...errors, ...Object.values(byModel).flatMap((x) => x.errors)],
            usage: analysis.usage,
            dropped: analysis.dropped,
            suggestions: analysis.suggestions.map((s: Suggestion) => ({
              id: s.id,
              taskId: s.taskId,
              kind: s.kind,
              ...(s.checkId ? { checkId: s.checkId, answer: s.answer } : {}),
              ...(s.register ? { register: s.register, fields: s.fields } : {}),
              ...(s.noteKind ? { noteKind: s.noteKind, text: s.text } : {}),
              reason: s.reason,
              basis: s.basis,
              refs: s.refs.map((r) => r.label),
              checks: s.checks,
            })),
            verification: Object.fromEntries(Object.entries(byModel).map(([model, x]) => [model, { calls: x.run?.calls ?? [], failures: x.run?.failures ?? [] }])),
            input,
            claims: input.claims.map((cl) => {
              const o = origin.get(cl.id)!;
              const r = verdict.get(cl.id);
              return {
                id: cl.id,
                taskId: o.taskId,
                suggestionId: o.suggestionId,
                part: o.part,
                text: cl.text,
                sources: cl.sourceIds.filter((id) => id !== 'H').map((id) => sourceText.get(id)!.text),
                verdict: r?.verdict,
                answered: r?.answered,
                quotes: r?.quotes,
                unsupportedParts: r?.unsupportedParts,
                flags: r?.flags,
                byModel: claimByModel(byModel, cl.id),
              };
            }),
          });
          await save();
        }
      }
    }
    // ---------------------------------------------------------------- 3. the claims of an earlier run, through every verifier model
    if (PARTS.has('reverify')) {
      const from = JSON.parse(readFileSync(process.env.PRECEPTOR_LIVE_FROM!, 'utf8')) as { run: string; cases: { name: string; modules: SavedModule[] }[] };
      const rot = await store.createRotation({ department: 'internal_medicine', startDate: '2026-10-01', endDate: '2026-10-31', competencies: ['direct_patient_care'] });
      const k = await store.createCase({ kind: 'teaching', rotationId: rot.id, ageYears: 67, sex: 'M', admissionDay0: '2026-10-11', syntheticDataAttested: true });
      const out: unknown[] = [];
      results.reverified = { from: from.run, cases: out };
      for (const c of from.cases) {
        const modules: unknown[] = [];
        out.push({ name: c.name, modules });
        for (const m of c.modules.filter((x) => x.ok && (!UNCHECKED_ONLY || (x.claims ?? []).some((cl) => cl.verdict === 'not_checked')))) {
          const all = savedInput(m, c.name);
          // With PRECEPTOR_LIVE_UNCHECKED_ONLY, only the claims the earlier run could not check (the free tier's daily limit).
          const keep = UNCHECKED_ONLY ? new Set((m.claims ?? []).filter((cl) => cl.verdict === 'not_checked').map((cl) => cl.id)) : undefined;
          const input = keep ? { ...all, claims: all.claims.filter((cl) => keep.has(cl.id)) } : all;
          const byModel = await verifyEach(store, k.id, input, deps);
          modules.push({
            moduleId: m.moduleId,
            input,
            verification: Object.fromEntries(Object.entries(byModel).map(([model, x]) => [model, { calls: x.run?.calls ?? [], failures: x.run?.failures ?? [], errors: x.errors }])),
            claims: input.claims.map((cl) => ({ id: cl.id, text: cl.text, byModel: claimByModel(byModel, cl.id) })),
          });
          await save();
        }
      }
    }
    await save();
    // What left for the model: no identifier exists in these synthetic cases; the only checks are that calls succeeded.
    expect(calls.filter((x) => x.status === 200).length).toBeGreaterThan(0);
  });
});

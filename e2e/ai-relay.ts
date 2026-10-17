/**
 * The model relay for end-to-end tests. The browser calls /api/model and
 * /api/status on its own origin exactly as on the deployed site; these calls
 * are handed to the real relay code (relay/handler.ts) — configuration from
 * environment-style variables, the allow-list, the free-key refusal, the rate
 * limits and the spending cap — with the real Gemini adapter, whose HTTPS
 * call alone is answered by the stand-in in ai-fixtures.ts. Only the Netlify
 * wiring differs: usage counters live in memory instead of Netlify Blobs.
 *
 * RxNav (RxNorm) is answered here too, in its recorded format: this test
 * environment has no route to the internet.
 *
 * Live mode (the opt-in live run, e2e/m3-live.spec.ts) uses the same relay
 * code with Google's real service and the real RxNav, recording each call
 * the relay makes (never the key).
 */
import type { Page, Route } from '@playwright/test';
import { readConfig } from '../relay/config';
import { handleModel, handleStatus } from '../relay/handler';
import { geminiProvider } from '../relay/providers/gemini';
import { memoryStore, update, type MonthUsage } from '../relay/usage';
import { describeGeminiRequest, fakeGemini, rxnavAnswer, type ProviderCall } from './ai-fixtures';

export const TEST_KEY = 'test-key-not-a-real-key';

export const RELAY_ENV: Record<string, string> = {
  GEMINI_API_KEY: TEST_KEY,
  // reader-test-0 is on the allow-list but retired at the provider (the stand-in answers 404).
  PRECEPTOR_MODELS: 'reader-test-1:0.30:2.50,drafter-test-1:1.25:10.00,reader-test-0:0.10:0.40',
  PRECEPTOR_SUGGESTED: 'extract=reader-test-1,analyse=drafter-test-1',
  PRECEPTOR_KEY_CLASS: 'free',
  PRECEPTOR_MONTHLY_BUDGET_USD: '5',
  PRECEPTOR_RATE_PER_MINUTE: '60',
  PRECEPTOR_RATE_PER_DAY: '500',
};

export interface TestRelay {
  env: Record<string, string>;
  /** Every request that reached the provider stand-in: what actually left the relay. */
  provider: ProviderCall[];
  /** Every request the app made to the relay, with the answer's status and error code. */
  relay: { path: string; status: number; error?: string; body?: Record<string, unknown> }[];
  /** Every RxNav query (the full URL). */
  rxnav: string[];
  /** Sets this month's spend, as if earlier calls had used it. */
  spend(usd: number): Promise<void>;
}

/** One real call to the provider, as recorded in live mode (synthetic data only). */
export interface LiveCall extends ProviderCall {
  status: number;
  ms: number;
  usage?: { prompt: number; output: number; thoughts: number };
  finishReason?: string;
  /** The model's answer, unparsed. */
  output?: string;
  error?: string;
}

/** The real fetch, recording what left the relay and what came back. The key is never recorded. */
export function recordingFetch(calls: LiveCall[], real: typeof fetch = fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const { call } = describeGeminiRequest(input, init);
    const t0 = Date.now();
    const res = await real(input, init);
    const entry: LiveCall = { ...call, apiKey: null, status: res.status, ms: Date.now() - t0 };
    try {
      const body = (await res.clone().json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        error?: { message?: string; status?: string };
      };
      const u = body.usageMetadata;
      if (u) entry.usage = { prompt: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, thoughts: u.thoughtsTokenCount ?? 0 };
      entry.finishReason = body.candidates?.[0]?.finishReason;
      entry.output = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (body.error) entry.error = `${body.error.status ?? ''} ${body.error.message ?? ''}`.trim();
    } catch {
      entry.error = `HTTP ${res.status} (no JSON body)`;
    }
    calls.push(entry);
    return res;
  }) as typeof fetch;
}

const pick = (h: Record<string, string>, names: string[]) => Object.fromEntries(names.filter((n) => h[n] !== undefined).map((n) => [n, h[n]!]));

export async function installTestRelay(page: Page, env: Record<string, string> = {}, live?: { calls: LiveCall[] }): Promise<TestRelay> {
  const store = memoryStore();
  const t: TestRelay = {
    env: { ...RELAY_ENV, ...env },
    provider: [],
    relay: [],
    rxnav: [],
    async spend(usd) {
      const month = new Date().toISOString().slice(0, 7);
      await update<MonthUsage>(store, `budget-${month}`, (prev) => ({
        spentUsd: usd,
        calls: (prev?.calls ?? 0) + 40,
        inputTokens: prev?.inputTokens ?? 0,
        outputTokens: prev?.outputTokens ?? 0,
        byTask: { ...(prev?.byTask ?? {}), analyse: usd },
      }));
    },
  };

  const forward = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const read = readConfig(t.env);
    if (!read.ok) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_configured', message: read.problems.join(' ') } }) });
      return;
    }
    const config = read.config;
    const send = live ? recordingFetch(live.calls) : fakeGemini(t.provider, TEST_KEY);
    const deps = { config, store, provider: config.apiKey ? geminiProvider(config.apiKey, send) : undefined };
    const body = req.postDataBuffer();
    const web = new Request(url.toString(), {
      method: req.method(),
      headers: pick(req.headers(), ['content-type', 'x-preceptor-access']),
      ...(body && req.method() !== 'GET' ? { body } : {}),
    });
    const res = url.pathname === '/api/status' ? await handleStatus(web, deps) : await handleModel(web, deps);
    const text = await res.text();
    const error = res.ok ? undefined : (JSON.parse(text) as { error?: { code?: string } }).error?.code;
    t.relay.push({ path: url.pathname, status: res.status, ...(error ? { error } : {}), ...(body ? { body: JSON.parse(body.toString('utf8')) as Record<string, unknown> } : {}) });
    await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text });
  };
  await page.route('**/api/model', forward);
  await page.route('**/api/status', forward);
  if (live) return t; // the browser reaches the real RxNav
  await page.route('https://rxnav.nlm.nih.gov/**', async (route) => {
    const u = new URL(route.request().url());
    t.rxnav.push(u.toString());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rxnavAnswer(u.searchParams.get('term') ?? '')) });
  });
  return t;
}

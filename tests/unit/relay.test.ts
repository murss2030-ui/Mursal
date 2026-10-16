import { afterEach, describe, expect, it, vi } from 'vitest';
import { priceOf, readConfig, type RelayConfig } from '../../relay/config';
import { estimateCost, handleModel, handleStatus } from '../../relay/handler';
import { buildGeminiBody, geminiProvider, readGeminiResponse, toGeminiSchema } from '../../relay/providers/gemini';
import { ProviderError, type GenerateInput, type Provider } from '../../relay/providers/types';
import { memoryStore, update, type CounterStore } from '../../relay/usage';
import { ACCESS_HEADER, type ModelRequest, type RelayErrorBody, type RelayStatus, type ModelResponse } from '../../src/ai/protocol';
import { S, type OutputSchema } from '../../src/ai/schema';

const SECRET_MARKER = 'SYNTHETIC-PAYLOAD-MARKER-7731';
const SCHEMA: OutputSchema = S.obj({ answer: S.str(), items: S.arr(S.obj({ v: S.numOrNull() })) });

function config(over: Record<string, string> = {}): RelayConfig {
  const r = readConfig({
    GEMINI_API_KEY: 'test-key-not-real',
    PRECEPTOR_MODELS: 'model-a:1:4,model-b:0.1:0.4',
    PRECEPTOR_MONTHLY_BUDGET_USD: '5',
    ...over,
  });
  if (!r.ok) throw new Error(r.problems.join(' '));
  return r.config;
}

function body(over: Partial<ModelRequest> = {}): ModelRequest {
  return {
    task: 'extract',
    model: 'model-a',
    promptVersion: 'extract-v1',
    caseKind: 'teaching',
    installId: 'install-0001',
    system: 'Return JSON only.',
    parts: [{ text: `Creatinine 2.1 mg/dL ${SECRET_MARKER}` }],
    schema: SCHEMA,
    maxOutputTokens: 1000,
    temperature: 0,
    ...over,
  };
}

function post(b: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://relay.test/api/model', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) });
}

function provider(fn: (input: GenerateInput) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>): Provider & { calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  return {
    name: 'test',
    calls,
    async generate(input) {
      calls.push(input);
      return fn(input);
    },
  };
}

const ok = () => provider(async () => ({ text: JSON.stringify({ answer: 'fine', items: [{ v: 2.1 }] }), usage: { inputTokens: 1000, outputTokens: 500 } }));
const NOW = new Date('2026-10-16T10:15:30Z');

async function errorOf(res: Response): Promise<RelayErrorBody['error']> {
  return ((await res.json()) as RelayErrorBody).error;
}

afterEach(() => vi.restoreAllMocks());

describe('relay configuration', () => {
  it('reads models with prices, suggestions and safe defaults; model ids are never built in', () => {
    const r = readConfig({ GEMINI_API_KEY: 'k', PRECEPTOR_MODELS: 'm1:0.5:2, m2:0.1:0.4', PRECEPTOR_SUGGESTED: 'extract=m2, analyse=m1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.config.models.keys()]).toEqual(['m1', 'm2']);
    expect(r.config.models.get('m1')).toEqual({ inputPerM: 0.5, outputPerM: 2 });
    expect(r.config.suggested).toEqual({ extract: 'm2', analyse: 'm1' });
    expect(r.config.keyClass).toBe('free'); // unknown key class is treated as free
    expect(r.config.monthlyBudgetUsd).toBe(5);
    expect(r.problems).toEqual([]);
    expect(readConfig({}).ok && readConfig({}).ok).toBe(true); // empty config is valid but unconfigured
  });

  it('reports bad entries instead of guessing', () => {
    const r = readConfig({ PRECEPTOR_MODELS: 'nopricemodel,bad model:1:1,m3:x:1', PRECEPTOR_KEY_CLASS: 'gold', PRECEPTOR_MONTHLY_BUDGET_USD: '-1' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.models.size).toBe(0);
    expect(r.config.keyClass).toBe('free');
    expect(r.config.monthlyBudgetUsd).toBe(5);
    expect(r.problems.length).toBeGreaterThanOrEqual(5);
  });

  it('lets the trainee type a newer model id only when the operator allows a pattern with a default price', () => {
    const c = config({ PRECEPTOR_MODEL_PATTERN: 'model-[a-z0-9.-]+', PRECEPTOR_DEFAULT_PRICE: '2:8' });
    expect(priceOf(c, 'model-a')).toEqual({ inputPerM: 1, outputPerM: 4 });
    expect(priceOf(c, 'model-next-9')).toEqual({ inputPerM: 2, outputPerM: 8 });
    expect(priceOf(c, 'other-model')).toBeUndefined();
    const noPrice = readConfig({ PRECEPTOR_MODEL_PATTERN: 'model-.*' });
    expect(noPrice.ok && noPrice.config.modelPattern).toBeFalsy();
  });
});

describe('relay: model calls', () => {
  it('returns the parsed JSON with tokens and cost, and charges the actual cost to the month', async () => {
    const store = memoryStore();
    const p = ok();
    const res = await handleModel(post(body()), { config: config(), store, provider: p, now: () => NOW });
    expect(res.status).toBe(200);
    const r = (await res.json()) as ModelResponse;
    expect(r.output).toEqual({ answer: 'fine', items: [{ v: 2.1 }] });
    // 1000 input tokens at $1/M + 500 output tokens at $4/M
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 500, costUsd: 0.003 });
    expect(r.budget).toEqual({ month: '2026-10', budgetUsd: 5, spentUsd: 0.003 });
    expect(p.calls[0]!.model).toBe('model-a');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses when the server has no API key', async () => {
    const res = await handleModel(post(body()), { config: config({ GEMINI_API_KEY: '' }), store: memoryStore(), now: () => NOW });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('not_configured');
  });

  it('requires the access code when one is configured', async () => {
    const c = config({ PRECEPTOR_ACCESS_CODE: 'open-sesame-42' });
    const deps = { config: c, store: memoryStore(), provider: ok(), now: () => NOW };
    expect((await handleModel(post(body()), deps)).status).toBe(401);
    expect((await handleModel(post(body(), { [ACCESS_HEADER]: 'open-sesame-41' }), deps)).status).toBe(401);
    expect((await handleModel(post(body(), { [ACCESS_HEADER]: 'open-sesame-42' }), deps)).status).toBe(200);
  });

  it('accepts only models on the allow-list', async () => {
    const res = await handleModel(post(body({ model: 'something-else' })), { config: config(), store: memoryStore(), provider: ok(), now: () => NOW });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('model_not_allowed');
  });

  it('rejects malformed requests without calling the model', async () => {
    const p = ok();
    const deps = { config: config(), store: memoryStore(), provider: p, now: () => NOW };
    for (const bad of [
      { ...body(), task: 'diagnose' },
      { ...body(), installId: 'x' },
      { ...body(), schema: { type: 'object', properties: { a: { type: 'date' } } } },
      { ...body(), parts: [] },
      { ...body(), parts: [{ image: { mime: 'image/png', data: 'AAAA' } }] },
      { ...body(), temperature: 2 },
    ]) {
      const res = await handleModel(post(bad), deps);
      expect(res.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
    expect(p.calls).toHaveLength(0);
  });

  it('never sends a Clinical Case with a free-tier key, and allows it with a paid key', async () => {
    const p = ok();
    const free = await handleModel(post(body({ caseKind: 'clinical' })), { config: config(), store: memoryStore(), provider: p, now: () => NOW });
    expect(free.status).toBe(403);
    const err = await errorOf(free);
    expect(err.code).toBe('free_key_clinical');
    expect(err.message).toContain('Teaching Case');
    expect(p.calls).toHaveLength(0);
    const paid = await handleModel(post(body({ caseKind: 'clinical' })), { config: config({ PRECEPTOR_KEY_CLASS: 'paid' }), store: memoryStore(), provider: p, now: () => NOW });
    expect(paid.status).toBe(200);
  });

  it('refuses at the monthly cap with a clear message, before calling the model', async () => {
    const req = body();
    const estimate = estimateCost(req, { inputPerM: 1, outputPerM: 4 }, 1600).costUsd;
    // Exactly enough budget for this request's worst case: allowed.
    const p1 = ok();
    const atCap = await handleModel(post(req), { config: config({ PRECEPTOR_MONTHLY_BUDGET_USD: String(estimate) }), store: memoryStore(), provider: p1, now: () => NOW });
    expect(atCap.status).toBe(200);
    // A hair less: refused, and the model is not called.
    const p2 = ok();
    const over = await handleModel(post(req), { config: config({ PRECEPTOR_MONTHLY_BUDGET_USD: String(estimate * 0.999) }), store: memoryStore(), provider: p2, now: () => NOW });
    expect(over.status).toBe(402);
    const err = await errorOf(over);
    expect(err.code).toBe('budget_exhausted');
    expect(err.message).toMatch(/monthly AI budget is reached: US\$0\.00 of US\$0\.00 used/);
    expect(err.message).toContain('resets on 2026-11-01');
    expect(p2.calls).toHaveLength(0);
  });

  it('keeps refusing once the month is spent, and starts again next month', async () => {
    const store = memoryStore();
    const c = config({ PRECEPTOR_MONTHLY_BUDGET_USD: '0.02' });
    const deps = (now: Date) => ({ config: c, store, provider: ok(), now: () => now });
    let refused = 0;
    for (let i = 0; i < 10; i++) {
      const res = await handleModel(post(body({ installId: `install-${1000 + i}` })), deps(NOW));
      if (res.status === 402) refused++;
    }
    expect(refused).toBeGreaterThan(0);
    const month = (store.dump()['budget-2026-10'] as { spentUsd: number }).spentUsd;
    expect(month).toBeLessThanOrEqual(0.02);
    const next = await handleModel(post(body()), deps(new Date('2026-11-01T00:00:05Z')));
    expect(next.status).toBe(200);
  });

  it('releases the reservation when the provider fails without charging, and charges what it reports otherwise', async () => {
    const store = memoryStore();
    const failing = provider(async () => {
      throw new ProviderError('provider_unavailable', 'down');
    });
    const r1 = await handleModel(post(body()), { config: config(), store, provider: failing, now: () => NOW });
    expect(r1.status).toBe(502);
    expect(store.dump()['budget-2026-10']).toMatchObject({ spentUsd: 0, calls: 0 });

    const truncated = provider(async () => {
      throw new ProviderError('output_truncated', 'cut', { inputTokens: 2000, outputTokens: 1000 });
    });
    const r2 = await handleModel(post(body()), { config: config(), store, provider: truncated, now: () => NOW });
    expect((await errorOf(r2)).code).toBe('output_truncated');
    expect((store.dump()['budget-2026-10'] as { spentUsd: number }).spentUsd).toBeCloseTo(0.006, 9);
  });

  it('treats non-JSON model output as an error, still counting its cost', async () => {
    const store = memoryStore();
    const p = provider(async () => ({ text: 'Sure! Here is the answer: creatinine is high', usage: { inputTokens: 100, outputTokens: 100 } }));
    const res = await handleModel(post(body()), { config: config(), store, provider: p, now: () => NOW });
    expect(res.status).toBe(502);
    expect((await errorOf(res)).code).toBe('invalid_output');
    expect((store.dump()['budget-2026-10'] as { spentUsd: number }).spentUsd).toBeCloseTo(0.0005, 9);
  });

  it('limits requests per installation per minute and per day', async () => {
    const store = memoryStore();
    const c = config({ PRECEPTOR_RATE_PER_MINUTE: '2', PRECEPTOR_RATE_PER_DAY: '3' });
    const call = (now: Date, id = 'install-aaaa') => handleModel(post(body({ installId: id })), { config: c, store, provider: ok(), now: () => now });
    expect((await call(NOW)).status).toBe(200);
    expect((await call(NOW)).status).toBe(200);
    const third = await call(NOW);
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBe('30');
    expect((await call(NOW, 'install-bbbb')).status).toBe(200); // another installation is independent
    expect((await call(new Date('2026-10-16T10:16:01Z'))).status).toBe(200); // next minute; day count is now 3
    const day = await call(new Date('2026-10-16T10:17:01Z'));
    expect(day.status).toBe(429);
    expect((await errorOf(day)).message).toContain('daily request limit');
  });

  it('logs nothing and stores nothing of the payload', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const store = memoryStore();
    await handleModel(post(body()), { config: config(), store, provider: ok(), now: () => NOW });
    await handleModel(post(body({ caseKind: 'clinical' })), { config: config(), store, provider: ok(), now: () => NOW });
    await handleModel(post(body()), {
      config: config(),
      store,
      provider: provider(async () => {
        throw new Error(`boom ${SECRET_MARKER}`);
      }),
      now: () => NOW,
    });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    expect(JSON.stringify(store.dump())).not.toContain(SECRET_MARKER);
    expect(JSON.stringify(store.dump())).not.toContain('Creatinine');
  });
});

describe('relay: status', () => {
  it('reports configuration, key class, models, budget and limits — never the key', async () => {
    const store = memoryStore();
    const c = config({ PRECEPTOR_SUGGESTED: 'extract=model-b', PRECEPTOR_ACCESS_CODE: 'code-123456' });
    await handleModel(post(body(), { [ACCESS_HEADER]: 'code-123456' }), { config: c, store, provider: ok(), now: () => NOW });
    const denied = await handleStatus(new Request('https://relay.test/api/status'), { config: c, store, provider: ok(), now: () => NOW });
    expect(denied.status).toBe(401);
    const res = await handleStatus(new Request('https://relay.test/api/status', { headers: { [ACCESS_HEADER]: 'code-123456' } }), { config: c, store, provider: ok(), now: () => NOW });
    const text = await res.text();
    expect(text).not.toContain('test-key-not-real');
    const s = JSON.parse(text) as RelayStatus;
    expect(s.configured).toBe(true);
    expect(s.keyClass).toBe('free');
    expect(s.models).toEqual([
      { id: 'model-a', inputPerM: 1, outputPerM: 4 },
      { id: 'model-b', inputPerM: 0.1, outputPerM: 0.4 },
    ]);
    expect(s.suggested).toEqual({ extract: 'model-b' });
    expect(s.budget).toMatchObject({ month: '2026-10', budgetUsd: 5, spentUsd: 0.003, calls: 1, byTask: { extract: 0.003 } });
    expect(s.accessCodeRequired).toBe(true);
  });
});

describe('usage counters', () => {
  it('retry a write that lost a race instead of losing an increment', async () => {
    const inner = memoryStore();
    let raced = false;
    const racy: CounterStore = {
      read: (k) => inner.read(k),
      async write(k, v, e) {
        if (!raced) {
          raced = true;
          await inner.write(k, 100, { etag: (await inner.read(k)).etag }); // another request got there first
          return false;
        }
        return inner.write(k, v, e);
      },
    };
    await inner.write('n', 1, {});
    const next = await update<number>(racy, 'n', (prev) => (prev ?? 0) + 1);
    expect(next).toBe(101);
  });
});

describe('Gemini adapter', () => {
  it('translates the schema dialect to Gemini types', () => {
    expect(toGeminiSchema(S.obj({ a: S.enumOf(['x', 'y']), b: S.numOrNull(), c: S.arr(S.str(), 5) }))).toEqual({
      type: 'OBJECT',
      properties: {
        a: { type: 'STRING', format: 'enum', enum: ['x', 'y'] },
        b: { type: 'NUMBER', nullable: true },
        c: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 5 },
      },
      required: ['a', 'b', 'c'],
      propertyOrdering: ['a', 'b', 'c'],
    });
  });

  it('builds a JSON-mode request with the image inline and the system instruction separate', () => {
    const b = buildGeminiBody({
      model: 'm',
      system: 'sys',
      parts: [{ text: 'read this' }, { image: { mime: 'image/jpeg', data: 'QUJD' } }],
      schema: SCHEMA,
      maxOutputTokens: 500,
      temperature: 0,
    }) as Record<string, any>;
    expect(b.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(b.contents[0].parts).toEqual([{ text: 'read this' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }]);
    expect(b.generationConfig).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 500, temperature: 0 });
    expect(b.generationConfig.responseSchema.type).toBe('OBJECT');
  });

  it('reads answers and usage, including thinking tokens as output', () => {
    const out = readGeminiResponse(200, {
      candidates: [{ content: { parts: [{ text: '{"answer":' }, { text: '"x","items":[]}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, thoughtsTokenCount: 50 },
    });
    expect(out).toEqual({ text: '{"answer":"x","items":[]}', usage: { inputTokens: 120, outputTokens: 80 } });
  });

  it('maps provider failures to clear codes', () => {
    const code = (status: number, body: unknown) => {
      try {
        readGeminiResponse(status, body);
        return 'none';
      } catch (e) {
        return (e as ProviderError).code;
      }
    };
    expect(code(404, { error: { status: 'NOT_FOUND', message: 'models/old is not found' } })).toBe('model_unavailable');
    expect(code(403, { error: { message: 'API key not valid' } })).toBe('provider_auth');
    expect(code(429, {})).toBe('provider_rate_limited');
    expect(code(503, {})).toBe('provider_unavailable');
    expect(code(400, { error: { message: 'bad schema' } })).toBe('provider_rejected');
    expect(code(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a' }] } }] })).toBe('output_truncated');
    expect(code(200, { candidates: [{ finishReason: 'SAFETY' }] })).toBe('provider_blocked');
    expect(code(200, { promptFeedback: { blockReason: 'OTHER' } })).toBe('provider_blocked');
  });

  it('sends the key in a header to the model chosen by the request, never in the body', async () => {
    let url = '';
    let init: RequestInit = {};
    const fake = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }], usageMetadata: {} }), { status: 200 });
    }) as unknown as typeof fetch;
    await geminiProvider('secret-key-xyz', fake).generate({ model: 'some-model-1', system: 's', parts: [{ text: 't' }], schema: SCHEMA, maxOutputTokens: 100, temperature: 0 });
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/some-model-1:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key-xyz');
    expect(String(init.body)).not.toContain('secret-key-xyz');
  });
});

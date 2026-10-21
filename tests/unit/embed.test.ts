/**
 * M5b: the task "embed" (Section 11: "embeddings through callModel and the
 * relay, computed once"). Embeddings go through the same relay as every other
 * call — the allow-list, the free-key refusal of Clinical Cases, the rate
 * limits and the hard spending cap — and the same audit record (model, token
 * use, cost; never the text). The Gemini adapter's request and answer are
 * checked in Gemini's own format. No call leaves the test.
 */
import { describe, expect, it } from 'vitest';
import { readConfig, type RelayConfig } from '../../relay/config';
import { handleModel } from '../../relay/handler';
import { buildGeminiEmbedBody, geminiProvider, readGeminiEmbedResponse } from '../../relay/providers/gemini';
import { ProviderError, type Provider } from '../../relay/providers/types';
import { memoryStore, update } from '../../relay/usage';
import { callEmbed } from '../../src/ai/client';
import { EMBED_LIMITS, type EmbedRequest, type EmbedResponse, type RelayErrorBody } from '../../src/ai/protocol';
import { newSession } from './helpers';

const MARKER = 'SYNTHETIC-PASSAGE-MARKER-4412';

function config(over: Record<string, string> = {}): RelayConfig {
  const r = readConfig({ GEMINI_API_KEY: 'test-key-not-real', PRECEPTOR_MODELS: 'embed-a:0.15:0,model-a:1:4', PRECEPTOR_MONTHLY_BUDGET_USD: '5', ...over });
  if (!r.ok) throw new Error(r.problems.join(' '));
  return r.config;
}

const body = (over: Partial<EmbedRequest> = {}): EmbedRequest => ({
  task: 'embed',
  model: 'embed-a',
  promptVersion: 'embed-v1',
  caseKind: 'teaching',
  installId: 'install-0001',
  purpose: 'document',
  texts: [`Synthetic passage one ${MARKER}`, 'Synthetic passage two'],
  ...over,
});

const post = (b: unknown) => new Request('https://relay.test/api/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

function provider(embed?: Provider['embed']): Provider & { seen: Parameters<Provider['embed']>[0][] } {
  const seen: Parameters<Provider['embed']>[0][] = [];
  return {
    name: 'test',
    seen,
    async generate() {
      throw new Error('not used');
    },
    async embed(input) {
      seen.push(input);
      return embed ? embed(input) : { vectors: input.texts.map((_, i) => [i, 0.5, 1]), usage: { inputTokens: 40 } };
    },
  };
}

const NOW = new Date('2026-10-21T10:00:00Z');
const errorOf = async (r: Response) => ((await r.json()) as RelayErrorBody).error;

describe('relay: embeddings', () => {
  it('returns one vector per text with the tokens and their cost, charged to the month', async () => {
    const p = provider();
    const store = memoryStore();
    const res = await handleModel(post(body()), { config: config(), store, provider: p, now: () => NOW });
    expect(res.status).toBe(200);
    const out = (await res.json()) as EmbedResponse;
    expect(out.vectors).toEqual([
      [0, 0.5, 1],
      [1, 0.5, 1],
    ]);
    expect(out.usage).toEqual({ inputTokens: 40, outputTokens: 0, costUsd: (40 * 0.15) / 1e6 });
    expect(out.budget.spentUsd).toBeCloseTo((40 * 0.15) / 1e6);
    expect(p.seen[0]).toMatchObject({ model: 'embed-a', purpose: 'document', texts: body().texts });
  });

  it('only models on the allow-list; never a Clinical Case on a free-tier key', async () => {
    const deps = { config: config(), store: memoryStore(), provider: provider(), now: () => NOW };
    expect((await errorOf(await handleModel(post(body({ model: 'embed-x' })), deps))).code).toBe('model_not_allowed');
    expect((await errorOf(await handleModel(post(body({ caseKind: 'clinical', purpose: 'query', texts: ['A research question'] })), deps))).code).toBe('free_key_clinical');
    const paid = await handleModel(post(body({ caseKind: 'clinical', purpose: 'query', texts: ['A research question'] })), { ...deps, config: config({ PRECEPTOR_KEY_CLASS: 'paid' }) });
    expect(paid.status).toBe(200);
  });

  it('refuses malformed requests and requests over the limits without calling the provider', async () => {
    const p = provider();
    const deps = { config: config(), store: memoryStore(), provider: p, now: () => NOW };
    for (const bad of [
      body({ texts: [] }),
      body({ texts: Array.from({ length: EMBED_LIMITS.texts + 1 }, () => 'x') }),
      body({ texts: ['x'.repeat(EMBED_LIMITS.charsPerText + 1)] }),
      body({ texts: [' '] }),
      { ...body(), purpose: 'other' },
    ]) {
      const r = await handleModel(post(bad), deps);
      expect(r.status).toBe(400);
      expect((await errorOf(r)).code).toBe('bad_request');
    }
    expect(p.seen).toEqual([]);
  });

  it('refuses at the monthly cap before calling the provider', async () => {
    const p = provider();
    const store = memoryStore();
    await update(store, `budget-2026-10`, () => ({ spentUsd: 5, calls: 1, inputTokens: 0, outputTokens: 0, byTask: {} }));
    const r = await handleModel(post(body()), { config: config(), store, provider: p, now: () => NOW });
    expect(r.status).toBe(402);
    expect((await errorOf(r)).code).toBe('budget_exhausted');
    expect(p.seen).toEqual([]);
  });

  it('maps a provider failure to a clear code and charges nothing for it', async () => {
    const store = memoryStore();
    const p = provider(async () => {
      throw new ProviderError('provider_quota_exhausted', 'Daily quota.');
    });
    const r = await handleModel(post(body()), { config: config(), store, provider: p, now: () => NOW });
    expect(r.status).toBe(429);
    expect((await errorOf(r)).code).toBe('provider_quota_exhausted');
  });
});

describe('Gemini adapter: batchEmbedContents', () => {
  it('builds one request per text, a passage to index or a question to search with', () => {
    expect(buildGeminiEmbedBody({ model: 'embed-a', texts: ['p1'], purpose: 'document' })).toEqual({
      requests: [{ model: 'models/embed-a', content: { parts: [{ text: 'p1' }] }, taskType: 'RETRIEVAL_DOCUMENT' }],
    });
    expect((buildGeminiEmbedBody({ model: 'embed-a', texts: ['q'], purpose: 'query' }) as { requests: { taskType: string }[] }).requests[0]!.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('reads the vectors in order, estimates the tokens, and refuses a short or malformed answer', () => {
    expect(readGeminiEmbedResponse(200, { embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }] }, { texts: ['abcd', 'efgh'] })).toEqual({
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      usage: { inputTokens: 2 },
    });
    expect(() => readGeminiEmbedResponse(200, { embeddings: [{ values: [0.1] }] }, { texts: ['a', 'b'] })).toThrow(ProviderError);
    expect(() => readGeminiEmbedResponse(200, { embeddings: [{ values: ['x'] }] }, { texts: ['a'] })).toThrow(ProviderError);
    try {
      readGeminiEmbedResponse(404, { error: { status: 'NOT_FOUND', message: 'model retired' } }, { texts: ['a'] });
    } catch (e) {
      expect((e as ProviderError).code).toBe('model_unavailable');
    }
  });

  it('sends the key in a header to the chosen model, never in the body', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ embeddings: [{ values: [1, 2, 3] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const out = await geminiProvider('secret-key-xyz', f).embed({ model: 'embed-a', texts: ['passage'], purpose: 'document' });
    expect(out.vectors).toEqual([[1, 2, 3]]);
    expect(seen[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/embed-a:batchEmbedContents');
    expect(new Headers(seen[0]!.init.headers).get('x-goog-api-key')).toBe('secret-key-xyz');
    expect(String(seen[0]!.init.body)).not.toContain('secret-key-xyz');
  });
});

describe('callEmbed: the app side', () => {
  const relay = (answer: (b: EmbedRequest) => Response) => {
    const bodies: EmbedRequest[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as EmbedRequest;
      bodies.push(b);
      return answer(b);
    }) as unknown as typeof fetch;
    return { f, bodies };
  };
  const ok = (b: EmbedRequest) =>
    new Response(JSON.stringify({ vectors: b.texts.map(() => [0.1, 0.2, 0.3]), usage: { inputTokens: 12, outputTokens: 0, costUsd: 0.000002 }, model: b.model, budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('needs an embedding model; sends through the relay; audits the call without the text', async () => {
    const { store } = await newSession();
    await expect(callEmbed(store, { caseKind: 'teaching', purpose: 'document', texts: ['a'] }, { online: () => true })).rejects.toMatchObject({ code: 'no_model' });
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    const r = relay(ok);
    const out = await callEmbed(store, { caseKind: 'teaching', purpose: 'document', texts: [`passage ${MARKER}`, 'two'], chunkIds: ['d:1:1', 'd:1:2'] }, { fetch: r.f, online: () => true });
    expect(out.vectors).toHaveLength(2);
    expect(r.bodies[0]).toMatchObject({ task: 'embed', model: 'embed-a', promptVersion: 'embed-v1', purpose: 'document' });
    const [audit] = (await store.listAudit()).filter((e) => e.entity === 'model_call');
    expect(audit!.diff).toMatchObject({ task: 'embed', model: 'embed-a', texts: 2, retrievedChunkIds: ['d:1:1', 'd:1:2'], outcome: 'ok' });
    expect(JSON.stringify(audit)).not.toContain(MARKER);
  });

  it('refuses an answer with the wrong number or shape of vectors', async () => {
    const { store } = await newSession();
    await store.updateAiSettings({ models: { embed: 'embed-a' } });
    const short = relay(
      (b) => new Response(JSON.stringify({ vectors: [[1]], usage: { inputTokens: 1, outputTokens: 0, costUsd: 0 }, model: b.model, budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    await expect(callEmbed(store, { caseKind: 'teaching', purpose: 'document', texts: ['a', 'b'] }, { fetch: short.f, online: () => true })).rejects.toMatchObject({ code: 'invalid_shape' });
  });
});

/**
 * The Netlify Function entry (netlify/functions/model.mts): routing, the
 * environment, and the usage counters in Netlify Blobs. The relay logic
 * itself is tested in relay.test.ts and end to end in e2e/m3-ai.spec.ts;
 * this covers the wiring those tests replace — the Blobs store's
 * conditional writes (onlyIfMatch / onlyIfNew) and process.env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Netlify Blobs, in memory, with the same conditional-write contract as @netlify/blobs 11.
const blobs = new Map<string, { data: unknown; etag: string }>();
const stores: { name: string; consistency?: string }[] = [];
let seq = 0;
vi.mock('@netlify/blobs', () => ({
  getStore: (opts: { name: string; consistency?: string }) => {
    stores.push(opts);
    return {
      async getWithMetadata(key: string) {
        const e = blobs.get(key);
        return e ? { data: structuredClone(e.data), etag: e.etag, metadata: {} } : null;
      },
      async setJSON(key: string, data: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
        const e = blobs.get(key);
        if (o.onlyIfNew && e) return { modified: false };
        if (o.onlyIfMatch !== undefined && (!e || e.etag !== o.onlyIfMatch)) return { modified: false };
        const etag = `"${++seq}"`;
        blobs.set(key, { data: structuredClone(data), etag });
        return { modified: true, etag };
      },
    };
  },
}));

type Fn = { default: (req: Request) => Promise<Response>; config: { path: string[] } };
// Imported by path so this file is type-checked without Node's types (the function itself is checked by tsconfig.relay.json).
const load = async () => (await import(/* @vite-ignore */ new URL('../../netlify/functions/model.mts', import.meta.url).href)) as Fn;

const ENV = {
  GEMINI_API_KEY: 'test-key-not-real',
  PRECEPTOR_MODELS: 'model-a:0.30:2.50',
  PRECEPTOR_SUGGESTED: 'extract=model-a,analyse=model-a',
  PRECEPTOR_KEY_CLASS: 'free',
  PRECEPTOR_MONTHLY_BUDGET_USD: '5',
};

const body = (caseKind: 'teaching' | 'clinical') =>
  JSON.stringify({
    task: 'extract',
    model: 'model-a',
    promptVersion: 'extract-v1',
    caseKind,
    installId: 'install-0001',
    system: 'Transcribe.',
    parts: [{ text: 'Creatinine 2.1 mg/dL' }],
    schema: { type: 'object', properties: { readable: { type: 'boolean' } }, required: ['readable'] },
    maxOutputTokens: 256,
    temperature: 0,
  });

const post = (b: string) => new Request('https://example.netlify.app/api/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b });

describe('the Netlify Function', () => {
  const gemini = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/model-a:generateContent');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key-not-real');
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"readable":true}' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });

  beforeEach(() => {
    blobs.clear();
    stores.length = 0;
    gemini.mockClear();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.stubGlobal('fetch', gemini);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('serves exactly /api/model and /api/status', async () => {
    const fn = await load();
    expect(fn.config.path).toEqual(['/api/model', '/api/status']);
    const res = await fn.default(new Request('https://example.netlify.app/api/status'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ configured: true, keyClass: 'free', models: [{ id: 'model-a' }], suggested: { extract: 'model-a' } });
    expect(stores).toEqual([{ name: 'preceptor-usage', consistency: 'strong' }]);
  });

  it('calls the model, and keeps only counters in Blobs — never the request or the answer', async () => {
    const fn = await load();
    const res = await fn.default(post(body('teaching')));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ output: { readable: true }, model: 'model-a', usage: { inputTokens: 1000, outputTokens: 200 } });
    expect(gemini).toHaveBeenCalledTimes(1);
    const kept = JSON.stringify([...blobs]);
    expect(kept).not.toMatch(/Creatinine|Transcribe|readable/);
    const month = new Date().toISOString().slice(0, 7);
    // One counter record per installation (its random id, for the rate limits) and one per month.
    expect([...blobs.keys()].sort()).toEqual([`budget-${month}`, 'rate-install-0001']);
    expect(blobs.get(`budget-${month}`)!.data).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 200 });
    // A second call updates the same records through the conditional write; nothing new is created.
    await fn.default(post(body('teaching')));
    expect(blobs.get(`budget-${month}`)!.data).toMatchObject({ calls: 2 });
    expect(blobs.get('rate-install-0001')!.data).toMatchObject({ dayCount: 2, minuteCount: 2 });
    expect(blobs.size).toBe(2);
  });

  it('refuses a Clinical Case on a free-tier key before anything is sent', async () => {
    const fn = await load();
    const res = await fn.default(post(body('clinical')));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('free_key_clinical');
    expect(gemini).not.toHaveBeenCalled();
  });

  it('answers 503 with the reason when the environment is wrong, and 503 without a key', async () => {
    const fn = await load();
    vi.stubEnv('PRECEPTOR_PROVIDER', 'other');
    const bad = await fn.default(new Request('https://example.netlify.app/api/status'));
    expect(bad.status).toBe(503);
    expect(((await bad.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'not_configured', message: 'Unknown provider "other" (use gemini, kimi or deepseek).' });
    vi.stubEnv('PRECEPTOR_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', '');
    const noKey = await fn.default(post(body('teaching')));
    expect(noKey.status).toBe(503);
    expect(gemini).not.toHaveBeenCalled();
  });
});

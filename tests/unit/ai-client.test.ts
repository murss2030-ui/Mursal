import { describe, expect, it } from 'vitest';
import { AiError, callModel, clinicalCaseBlocked, fetchRelayStatus } from '../../src/ai/client';
import { ACCESS_HEADER, type ModelResponse, type RelayStatus } from '../../src/ai/protocol';
import { S } from '../../src/ai/schema';
import { ValidationError } from '../../src/domain/validation';
import { newCase, newSession, rawDump } from './helpers';

const SCHEMA = S.obj({ answer: S.str() });
const MARKER = 'Lepidodendron-payload-5521';

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const okResponse = (output: unknown): Response =>
  new Response(
    JSON.stringify({
      output,
      usage: { inputTokens: 1200, outputTokens: 300, costUsd: 0.0021 },
      model: 'model-a',
      budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0.5 },
    } satisfies ModelResponse),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

async function setup() {
  const ctx = await newSession();
  const c = await newCase(ctx.store);
  return { ...ctx, c };
}

const input = (caseId: string) => ({
  task: 'extract' as const,
  promptVersion: 'extract-v1',
  caseId,
  caseKind: 'teaching' as const,
  system: 'Return JSON.',
  parts: [{ text: `Creatinine 2.1 mg/dL ${MARKER}` }],
  schema: SCHEMA,
  maxOutputTokens: 500,
});

describe('AI settings', () => {
  it('creates one installation id, keeps model choices, and never writes the access code to the audit log', async () => {
    const { store, db } = await setup();
    const a = await store.getAiSettings();
    const b = await store.getAiSettings();
    expect(a.installId).toMatch(/^[a-z0-9-]{8,64}$/);
    expect(b.installId).toBe(a.installId);
    expect(a.models).toEqual({});

    await expect(store.updateAiSettings({ models: { extract: 'bad model id' } })).rejects.toBeInstanceOf(ValidationError);
    const s = await store.updateAiSettings({ accessCode: 'Ophiuchus-code-9091', models: { extract: 'model-a', analyse: 'model-b' } });
    expect(s).toEqual({ installId: a.installId, accessCode: 'Ophiuchus-code-9091', models: { extract: 'model-a', analyse: 'model-b' } });
    expect(await store.getAiSettings()).toEqual(s);

    const audit = JSON.stringify(await store.listAudit());
    expect(audit).toContain('model-a');
    expect(audit).not.toContain('Ophiuchus-code-9091');
    expect(await rawDump(db)).not.toContain('Ophiuchus-code-9091'); // encrypted at rest
  });
});

describe('callModel — the single entry point', () => {
  it('sends the chosen model through the relay, checks the answer, and audits the call without its content', async () => {
    const { store, c } = await setup();
    await store.updateAiSettings({ accessCode: 'code-123456', models: { extract: 'model-a' } });
    const { f, calls } = fakeFetch(() => okResponse({ answer: 'ok' }));
    const r = await callModel<{ answer: string }>(store, input(c.id), { fetch: f, online: () => true });
    expect(r.output).toEqual({ answer: 'ok' });
    expect(r.usage.costUsd).toBe(0.0021);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/model');
    expect((calls[0]!.init.headers as Record<string, string>)[ACCESS_HEADER]).toBe('code-123456');
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({ task: 'extract', model: 'model-a', promptVersion: 'extract-v1', caseKind: 'teaching', temperature: 0 });
    expect(sent.installId).toBe((await store.getAiSettings()).installId);

    const ev = (await store.listAudit(c.id)).find((e) => e.entity === 'model_call');
    expect(ev).toMatchObject({ action: 'call', actor: 'model' });
    expect(ev!.diff).toEqual({
      task: 'extract',
      model: 'model-a',
      promptVersion: 'extract-v1',
      retrievedChunkIds: [],
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.0021,
      outcome: 'ok',
    });
    expect(JSON.stringify(ev)).not.toContain(MARKER);
  });

  it('does not call anything when offline or when no model is chosen', async () => {
    const { store, c } = await setup();
    const { f, calls } = fakeFetch(() => okResponse({ answer: 'x' }));
    await expect(callModel(store, input(c.id), { fetch: f, online: () => false })).rejects.toMatchObject({ code: 'offline' });
    await expect(callModel(store, input(c.id), { fetch: f, online: () => true })).rejects.toMatchObject({ code: 'no_model' });
    expect(calls).toHaveLength(0);
  });

  it('passes the relay’s refusal through with its message, and audits it', async () => {
    const { store, c } = await setup();
    await store.updateAiSettings({ models: { extract: 'model-a' } });
    const { f } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'budget_exhausted', message: 'The monthly AI budget is reached: US$5.00 of US$5.00 used.', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 5 } } }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
    );
    const err = (await callModel(store, input(c.id), { fetch: f, online: () => true }).catch((e) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('budget_exhausted');
    expect(err.message).toContain('monthly AI budget is reached');
    expect(err.detail.budget?.spentUsd).toBe(5);
    const ev = (await store.listAudit(c.id)).find((e) => e.entity === 'model_call');
    expect((ev!.diff as { outcome: string }).outcome).toBe('budget_exhausted');
  });

  it('retries once, after a pause, when the provider is briefly unavailable — and audits both attempts', async () => {
    const { store, c } = await setup();
    await store.updateAiSettings({ models: { extract: 'model-a' } });
    const busy = () => new Response(JSON.stringify({ error: { code: 'provider_unavailable', message: 'This model is currently experiencing high demand.' } }), { status: 502, headers: { 'content-type': 'application/json' } });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    let n = 0;
    const { f, calls } = fakeFetch(() => (++n === 1 ? busy() : okResponse({ answer: 'fine' })));
    await expect(callModel(store, input(c.id), { fetch: f, online: () => true, sleep })).resolves.toMatchObject({ output: { answer: 'fine' } });
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([4000]);
    const outcomes = (await store.listAudit(c.id)).filter((e) => e.entity === 'model_call').map((e) => (e.diff as { outcome: string }).outcome);
    expect(outcomes.sort()).toEqual(['ok', 'provider_unavailable']);
    // A second failure is reported, not retried again; other refusals are never retried.
    const always = fakeFetch(() => busy());
    await expect(callModel(store, input(c.id), { fetch: always.f, online: () => true, sleep })).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(always.calls).toHaveLength(2);
    const quota = fakeFetch(() => new Response(JSON.stringify({ error: { code: 'provider_quota_exhausted', message: 'Daily quota.' } }), { status: 429, headers: { 'content-type': 'application/json' } }));
    await expect(callModel(store, input(c.id), { fetch: quota.f, online: () => true, sleep })).rejects.toMatchObject({ code: 'provider_quota_exhausted' });
    expect(quota.calls).toHaveLength(1);
  });

  it('refuses an answer that does not match the schema', async () => {
    const { store, c } = await setup();
    await store.updateAiSettings({ models: { extract: 'model-a' } });
    const { f } = fakeFetch(() => okResponse({ answer: 42 }));
    await expect(callModel(store, input(c.id), { fetch: f, online: () => true })).rejects.toMatchObject({ code: 'invalid_shape' });
  });

  it('tells a missing relay apart from a network failure', async () => {
    const { store, c } = await setup();
    await store.updateAiSettings({ models: { extract: 'model-a' } });
    const missing = fakeFetch(() => new Response('<html>not found</html>', { status: 404, headers: { 'content-type': 'text/html' } }));
    await expect(callModel(store, input(c.id), { fetch: missing.f, online: () => true })).rejects.toMatchObject({ code: 'relay_missing' });
    const down = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(callModel(store, input(c.id), { fetch: down.f, online: () => true })).rejects.toMatchObject({ code: 'network' });
  });

  it('reads the relay status, and recognises a host without a relay', async () => {
    const { store } = await setup();
    const status: Partial<RelayStatus> = { configured: true, keyClass: 'free', models: [] };
    const good = fakeFetch(() => new Response(JSON.stringify(status), { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await fetchRelayStatus(store, { fetch: good.f, online: () => true })).toMatchObject({ configured: true, keyClass: 'free' });
    const spa = fakeFetch(() => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(fetchRelayStatus(store, { fetch: spa.f, online: () => true })).rejects.toMatchObject({ code: 'relay_missing' });
  });

  it('blocks Clinical Cases unless the key is paid', () => {
    expect(clinicalCaseBlocked({ keyClass: 'free' }, 'clinical')).toBe(true);
    expect(clinicalCaseBlocked(undefined, 'clinical')).toBe(true);
    expect(clinicalCaseBlocked({ keyClass: 'paid' }, 'clinical')).toBe(false);
    expect(clinicalCaseBlocked({ keyClass: 'free' }, 'teaching')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { readConfig } from '../../relay/config';
import { buildKimiBody, kimiProvider, readKimiResponse, toJsonSchema } from '../../relay/providers/kimi';
import { ProviderError, type GenerateInput } from '../../relay/providers/types';
import { S } from '../../src/ai/schema';

const input = (over: Partial<GenerateInput> = {}): GenerateInput => ({
  model: 'kimi-k3',
  system: 'Read the note.',
  parts: [{ text: 'Creatinine 2.1' }, { image: { mime: 'image/jpeg', data: 'QUJD' } }],
  schema: S.obj({ answer: S.str(), v: S.numOrNull() }),
  maxOutputTokens: 1000,
  temperature: 0,
  ...over,
});

describe('kimi provider', () => {
  it('is chosen by PRECEPTOR_PROVIDER and reads its own key', () => {
    const r = readConfig({ PRECEPTOR_PROVIDER: 'kimi', MOONSHOT_API_KEY: 'k', GEMINI_API_KEY: 'g', PRECEPTOR_MODELS: 'kimi-k3:1:4' });
    expect(r.ok && r.config.provider).toBe('kimi');
    expect(r.ok && r.config.apiKey).toBe('k');
  });

  it('builds an OpenAI-style body with JSON mode, the schema in the prompt, and no fixed parameters', () => {
    const b = buildKimiBody(input()) as Record<string, any>;
    expect(b.response_format).toEqual({ type: 'json_object' });
    expect(b.messages[0].content).toContain('"answer"');
    expect(b.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,QUJD');
    expect(b.temperature).toBeUndefined();
    expect(b.reasoning_effort).toBe('low');
    expect(buildKimiBody(input({ model: 'kimi-k2.6' }) ) as Record<string, any>).not.toHaveProperty('reasoning_effort');
  });

  it('marks nullable fields in the schema', () => {
    expect(JSON.stringify(toJsonSchema(S.obj({ v: S.numOrNull() })))).toContain('["number","null"]');
  });

  it('reads answers and maps errors', () => {
    const ok = readKimiResponse(200, { choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    expect(ok).toEqual({ text: '{"a":1}', usage: { inputTokens: 5, outputTokens: 3 } });
    const code = (s: number, b: unknown = {}) => {
      try {
        readKimiResponse(s, b);
      } catch (e) {
        return (e as ProviderError).code;
      }
    };
    expect(code(401)).toBe('provider_auth');
    expect(code(429)).toBe('provider_rate_limited');
    expect(code(429, { error: { type: 'exceeded_current_quota_error' } })).toBe('provider_quota_exhausted');
    expect(code(200, { choices: [{ message: { content: '{' }, finish_reason: 'length' }] })).toBe('output_truncated');
  });

  it('sends the key as a bearer token to Moonshot', async () => {
    let seen: { url: string; auth: string } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).authorization! };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }));
    }) as unknown as typeof fetch;
    await kimiProvider('secret-test', fake).generate(input());
    expect(seen).toEqual({ url: 'https://api.moonshot.ai/v1/chat/completions', auth: 'Bearer secret-test' });
  });
});

describe('the trainee\'s own Kimi key', () => {
  it('switches a request to Kimi with a Kimi model pattern and leaves the key class alone', async () => {
    const { withUserKimiKey } = await import('../../relay/config');
    const r = readConfig({});
    if (!r.ok) throw new Error('config');
    const c = withUserKimiKey(r.config, 'sk-test-1234567890');
    expect(c.provider).toBe('kimi');
    expect(c.apiKey).toBe('sk-test-1234567890');
    expect(c.keyClass).toBe('free');
    expect(c.modelPattern?.test('kimi-k3')).toBe(true);
    expect(c.modelPattern?.test('gemini-x')).toBe(false);
    expect(withUserKimiKey(r.config, 'bad key')).toBe(r.config);
  });
});

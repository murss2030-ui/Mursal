import { describe, expect, it } from 'vitest';
import { readConfig, withUserKey } from '../../relay/config';
import { buildDeepseekBody, deepseekProvider } from '../../relay/providers/deepseek';
import { ProviderError, type GenerateInput } from '../../relay/providers/types';
import { activeKey } from '../../src/ai/settings';
import { S } from '../../src/ai/schema';

const input = (over: Partial<GenerateInput> = {}): GenerateInput => ({
  model: 'deepseek-chat',
  system: 'Read the note.',
  parts: [{ text: 'Creatinine 2.1' }],
  schema: S.obj({ answer: S.str() }),
  maxOutputTokens: 20000,
  temperature: 0,
  ...over,
});

describe('deepseek provider', () => {
  it('builds a text-only JSON-mode body and caps the output', () => {
    const b = buildDeepseekBody(input()) as Record<string, any>;
    expect(b.response_format).toEqual({ type: 'json_object' });
    expect(b.max_tokens).toBe(8192);
    expect(b.messages[1].content).toBe('Creatinine 2.1');
  });

  it('refuses page images with a plain message', () => {
    expect(() => buildDeepseekBody(input({ parts: [{ image: { mime: 'image/jpeg', data: 'QUJD' } }] }))).toThrow(ProviderError);
  });

  it('sends the key to DeepSeek and maps an empty balance to a spent quota', async () => {
    let seen: { url: string; auth: string } | undefined;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, auth: (init.headers as Record<string, string>).authorization! };
      return new Response(JSON.stringify({ error: { message: 'Insufficient Balance' } }), { status: 402 });
    }) as unknown as typeof fetch;
    await expect(deepseekProvider('secret-test', fake).generate(input())).rejects.toMatchObject({ code: 'provider_quota_exhausted' });
    expect(seen).toEqual({ url: 'https://api.deepseek.com/chat/completions', auth: 'Bearer secret-test' });
  });
});

describe('the trainee\'s own key for any service', () => {
  const base = () => {
    const r = readConfig({});
    if (!r.ok) throw new Error('config');
    return r.config;
  };
  it('switches the request to the chosen service with that service\'s models', () => {
    for (const [p, ok, no] of [['deepseek', 'deepseek-chat', 'kimi-k3'], ['gemini', 'gemini-3.5-flash', 'deepseek-chat'], ['kimi', 'kimi-k3', 'gemini-3.5-flash']] as const) {
      const c = withUserKey(base(), 'sk-test-1234567890', p);
      expect(c.provider).toBe(p);
      expect(c.keyClass).toBe('free');
      expect(c.modelPattern?.test(ok)).toBe(true);
      expect(c.modelPattern?.test(no)).toBe(false);
    }
  });
  it('picks the chosen service, or the first one with a key', () => {
    const s = { installId: 'i', models: {}, kimiKey: 'k', deepseekKey: 'd', geminiKey: 'g' };
    expect(activeKey(s)).toEqual({ service: 'kimi', key: 'k' });
    expect(activeKey({ ...s, service: 'gemini' })).toEqual({ service: 'gemini', key: 'g' });
    expect(activeKey({ installId: 'i', models: {}, geminiKey: 'g' })).toEqual({ service: 'gemini', key: 'g' });
    expect(activeKey({ installId: 'i', models: {} })).toBeUndefined();
  });
});

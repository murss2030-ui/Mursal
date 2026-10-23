/**
 * Kimi (Moonshot AI) through its OpenAI-compatible chat completions API. Like gemini.ts it is the only module
 * that knows its provider's wire format; the model id comes from the request, already checked against the allow-list.
 *
 * Kimi has JSON mode (`json_object`) but no response schema, so the schema is written into the system
 * instruction and the app checks the answer itself (validateOutput). It has no embeddings endpoint.
 */
import type { OutputSchema } from '../../src/ai/schema';
import { ProviderError, type EmbedInput, type EmbedOutput, type GenerateInput, type GenerateOutput, type Provider, type ThinkingLevel } from './types';

const BASE = 'https://api.moonshot.ai/v1';

/** Our schema dialect → plain JSON Schema, for the prompt. */
export function toJsonSchema(s: OutputSchema): Record<string, unknown> {
  const common = { ...(s.description ? { description: s.description } : {}) };
  const type = (t: string) => (s.nullable ? [t, 'null'] : t);
  switch (s.type) {
    case 'object':
      return {
        type: type('object'),
        properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)])),
        ...(s.required?.length ? { required: [...s.required] } : {}),
        ...common,
      };
    case 'array':
      return { type: type('array'), items: toJsonSchema(s.items), ...(s.maxItems ? { maxItems: s.maxItems } : {}), ...common };
    case 'string':
      return { type: type('string'), ...(s.enum ? { enum: [...s.enum] } : {}), ...common };
    default:
      return { type: type(s.type), ...common };
  }
}

/** K3 reasons at "max" by default, which does not fit the 25 s the hosting platform allows; the relay asks for less. */
export function reasoningEffort(level: ThinkingLevel | undefined): 'low' | 'high' {
  return level === 'medium' || level === 'high' ? 'high' : 'low';
}

export function buildKimiBody(input: GenerateInput): unknown {
  const system = `${input.system}\n\nReply with one JSON object only, no other text, that follows this JSON Schema exactly:\n${JSON.stringify(toJsonSchema(input.schema))}`;
  return {
    model: input.model,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: input.parts.map((p) => ('text' in p ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.image.mime};base64,${p.image.data}` } })),
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: input.maxOutputTokens,
    // temperature, top_p and the like are fixed per model by Kimi and an other value is an error: none is sent.
    ...(input.model.startsWith('kimi-k3') ? { reasoning_effort: reasoningEffort(input.thinking) } : {}),
  };
}

interface KimiResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function shortMessage(body: unknown, status: number): string {
  const e = (body as { error?: { message?: string; type?: string } })?.error;
  const text = [e?.type, e?.message].filter(Boolean).join(': ') || `HTTP ${status}`;
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** Interprets a Kimi response (exported for tests with recorded responses). */
export function readKimiResponse(status: number, body: unknown): GenerateOutput {
  if (status < 200 || status >= 300) {
    const message = shortMessage(body, status);
    const type = (body as { error?: { type?: string } })?.error?.type ?? '';
    if (status === 404) throw new ProviderError('model_unavailable', message);
    if (status === 401 || status === 403) throw new ProviderError('provider_auth', message);
    // 402 / exceeded_current_quota: the account balance is spent, which will not clear in a minute.
    if (status === 402 || /exceeded_current_quota|insufficient/i.test(type)) throw new ProviderError('provider_quota_exhausted', message);
    if (status === 429) throw new ProviderError('provider_rate_limited', message);
    if (status >= 500) throw new ProviderError('provider_unavailable', message);
    throw new ProviderError('provider_rejected', message);
  }
  const r = body as KimiResponse;
  const usage = { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 };
  const choice = r.choices?.[0];
  if (!choice) throw new ProviderError('provider_blocked', 'The model returned no answer.', usage);
  const reason = choice.finish_reason ?? 'stop';
  if (reason === 'length') throw new ProviderError('output_truncated', 'The answer was cut off at the output limit.', usage);
  if (reason === 'content_filter') throw new ProviderError('provider_blocked', 'The model stopped: content filter.', usage);
  const text = choice.message?.content ?? '';
  if (!text) throw new ProviderError('provider_blocked', 'The model returned an empty answer.', usage);
  return { text, usage };
}

export function kimiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: 'kimi',
    async embed(_input: EmbedInput): Promise<EmbedOutput> {
      throw new ProviderError('provider_rejected', 'Kimi has no embeddings service, so the evidence-library search is not available with this provider.');
    },
    async generate(input: GenerateInput): Promise<GenerateOutput> {
      let res: Response;
      try {
        res = await fetchImpl(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildKimiBody(input)),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch {
        if (input.signal?.aborted) throw new ProviderError('provider_timeout', 'The model took too long to answer.');
        throw new ProviderError('provider_unavailable', 'The model service could not be reached.');
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        if (input.signal?.aborted) throw new ProviderError('provider_timeout', 'The model took too long to answer.');
      }
      return readKimiResponse(res.status, body);
    },
  };
}

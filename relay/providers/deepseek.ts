/**
 * DeepSeek through its OpenAI-compatible chat completions API. Like kimi.ts it is the only module that knows its
 * provider's wire format. DeepSeek has JSON mode but no response schema (the schema goes into the system
 * instruction), takes text only (no page images) and has no embeddings endpoint.
 */
import { readKimiResponse, toJsonSchema } from './kimi';
import { ProviderError, type EmbedInput, type EmbedOutput, type GenerateInput, type GenerateOutput, type Provider } from './types';

const BASE = 'https://api.deepseek.com';
/** The most DeepSeek's chat model writes in one answer. */
const MAX_OUTPUT = 8192;

export function buildDeepseekBody(input: GenerateInput): unknown {
  if (input.parts.some((p) => 'image' in p)) {
    throw new ProviderError('provider_rejected', 'DeepSeek reads text only, not photos. Paste the text of the page, or choose Kimi or Gemini for photos.');
  }
  const system = `${input.system}\n\nReply with one JSON object only, no other text, that follows this JSON Schema exactly:\n${JSON.stringify(toJsonSchema(input.schema))}`;
  return {
    model: input.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: input.parts.map((p) => ('text' in p ? p.text : '')).join('\n\n') },
    ],
    response_format: { type: 'json_object' },
    max_tokens: Math.min(input.maxOutputTokens, MAX_OUTPUT),
    temperature: input.temperature,
  };
}

export function deepseekProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: 'deepseek',
    async embed(_input: EmbedInput): Promise<EmbedOutput> {
      throw new ProviderError('provider_rejected', 'DeepSeek has no embeddings service, so the evidence-library search is not available with this provider.');
    },
    async generate(input: GenerateInput): Promise<GenerateOutput> {
      const body = buildDeepseekBody(input);
      let res: Response;
      try {
        res = await fetchImpl(`${BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      } catch {
        if (input.signal?.aborted) throw new ProviderError('provider_timeout', 'The model took too long to answer.');
        throw new ProviderError('provider_unavailable', 'The model service could not be reached.');
      }
      let out: unknown = null;
      try {
        out = await res.json();
      } catch {
        if (input.signal?.aborted) throw new ProviderError('provider_timeout', 'The model took too long to answer.');
      }
      // DeepSeek answers 402 "Insufficient Balance" when the account has no credit: readKimiResponse maps it to a spent quota.
      return readKimiResponse(res.status, out);
    },
  };
}

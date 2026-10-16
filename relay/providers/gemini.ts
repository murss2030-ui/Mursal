/**
 * Gemini (Decision 3) through its REST API. The only module that knows the
 * provider's wire format; the model id always comes from the request, which
 * the relay has already checked against its configured allow-list.
 */
import type { OutputSchema } from '../../src/ai/schema';
import { ProviderError, type GenerateInput, type GenerateOutput, type Provider } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

type GeminiSchema = Record<string, unknown>;

/** Our schema dialect → Gemini's OpenAPI subset. */
export function toGeminiSchema(s: OutputSchema): GeminiSchema {
  const common = { ...(s.nullable ? { nullable: true } : {}), ...(s.description ? { description: s.description } : {}) };
  switch (s.type) {
    case 'object':
      return {
        type: 'OBJECT',
        properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)])),
        ...(s.required?.length ? { required: [...s.required] } : {}),
        propertyOrdering: Object.keys(s.properties),
        ...common,
      };
    case 'array':
      return { type: 'ARRAY', items: toGeminiSchema(s.items), ...(s.maxItems ? { maxItems: s.maxItems } : {}), ...common };
    case 'string':
      return s.enum ? { type: 'STRING', format: 'enum', enum: [...s.enum], ...common } : { type: 'STRING', ...common };
    case 'number':
      return { type: 'NUMBER', ...common };
    case 'integer':
      return { type: 'INTEGER', ...common };
    case 'boolean':
      return { type: 'BOOLEAN', ...common };
  }
}

export function buildGeminiBody(input: GenerateInput): unknown {
  return {
    systemInstruction: { parts: [{ text: input.system }] },
    contents: [
      {
        role: 'user',
        parts: input.parts.map((p) => ('text' in p ? { text: p.text } : { inlineData: { mimeType: p.image.mime, data: p.image.data } })),
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(input.schema),
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
    },
  };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

function shortMessage(body: unknown, status: number): string {
  const msg = (body as { error?: { message?: string; status?: string } })?.error;
  const text = [msg?.status, msg?.message].filter(Boolean).join(': ') || `HTTP ${status}`;
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/** Interprets a Gemini response (exported for tests with recorded responses). */
export function readGeminiResponse(status: number, body: unknown): GenerateOutput {
  if (status < 200 || status >= 300) {
    const message = shortMessage(body, status);
    if (status === 404) throw new ProviderError('model_unavailable', message);
    if (status === 401 || status === 403) throw new ProviderError('provider_auth', message);
    if (status === 429) throw new ProviderError('provider_rate_limited', message);
    if (status >= 500) throw new ProviderError('provider_unavailable', message);
    throw new ProviderError('provider_rejected', message);
  }
  const r = body as GeminiResponse;
  const meta = r.usageMetadata ?? {};
  const usage = {
    inputTokens: meta.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
  };
  if (r.promptFeedback?.blockReason) throw new ProviderError('provider_blocked', `Blocked: ${r.promptFeedback.blockReason}`, usage);
  const cand = r.candidates?.[0];
  if (!cand) throw new ProviderError('provider_blocked', 'The model returned no answer.', usage);
  const reason = cand.finishReason ?? 'STOP';
  if (reason === 'MAX_TOKENS') throw new ProviderError('output_truncated', 'The answer was cut off at the output limit.', usage);
  if (reason !== 'STOP') throw new ProviderError('provider_blocked', `The model stopped: ${reason}.`, usage);
  const text = (cand.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) throw new ProviderError('provider_blocked', 'The model returned an empty answer.', usage);
  return { text, usage };
}

export function geminiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  return {
    name: 'gemini',
    async generate(input: GenerateInput): Promise<GenerateOutput> {
      let res: Response;
      try {
        res = await fetchImpl(`${BASE}/${encodeURIComponent(input.model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(buildGeminiBody(input)),
        });
      } catch {
        throw new ProviderError('provider_unavailable', 'The model service could not be reached.');
      }
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return readGeminiResponse(res.status, body);
    },
  };
}

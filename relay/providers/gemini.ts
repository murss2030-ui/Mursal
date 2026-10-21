/**
 * Gemini (Decision 3) through its REST API. The only module that knows the
 * provider's wire format; the model id always comes from the request, which
 * the relay has already checked against its configured allow-list.
 */
import type { OutputSchema } from '../../src/ai/schema';
import { ProviderError, type EmbedInput, type EmbedOutput, type GenerateInput, type GenerateOutput, type Provider } from './types';

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
      // maxItems is not sent: in the live run of 16 October 2026 Gemini refused the reading schema with it
      // ("Request contains an invalid argument") and accepted it without. The app still enforces every
      // maximum itself when it checks the answer (validateOutput).
      return { type: 'ARRAY', items: toGeminiSchema(s.items), ...common };
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
      // In the live run, thinking made up most of the tokens and the time: reading a short note took 26 s by default
      // and under 4 s at "low", with the same values read.
      ...(input.thinking ? { thinkingConfig: { thinkingLevel: input.thinking } } : {}),
    },
  };
}

interface GeminiError {
  error?: { message?: string; status?: string; details?: { '@type'?: string; violations?: { quotaId?: string }[]; retryDelay?: string }[] };
}

/** A 429 that is the day's quota (it will not clear in a minute), from the provider's quota details. */
function dailyQuota(body: unknown): boolean {
  const details = (body as GeminiError)?.error?.details ?? [];
  return details.some((d) => (d.violations ?? []).some((v) => /PerDay/i.test(v.quotaId ?? '')));
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
    if (status === 429) throw new ProviderError(dailyQuota(body) ? 'provider_quota_exhausted' : 'provider_rate_limited', message);
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

/** M5: the batchEmbedContents body: one request per text, typed as a passage to index or a question to search with. */
export function buildGeminiEmbedBody(input: EmbedInput): unknown {
  return {
    requests: input.texts.map((text) => ({
      model: `models/${input.model}`,
      content: { parts: [{ text }] },
      taskType: input.purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    })),
  };
}

/** Interprets a batchEmbedContents response: one vector per text, in order. The service reports no token count, so it is estimated (4 characters a token). */
export function readGeminiEmbedResponse(status: number, body: unknown, input: Pick<EmbedInput, 'texts'>): EmbedOutput {
  if (status < 200 || status >= 300) readGeminiResponse(status, body); // throws the same errors as generateContent
  const vectors = ((body as { embeddings?: { values?: unknown }[] })?.embeddings ?? []).map((e) => e.values);
  if (vectors.length !== input.texts.length || vectors.some((v) => !Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'number' || !Number.isFinite(x)))) {
    throw new ProviderError('provider_rejected', 'The embedding service returned no vector, or the wrong number of vectors.');
  }
  return { vectors: vectors as number[][], usage: { inputTokens: Math.ceil(input.texts.reduce((n, t) => n + t.length, 0) / 4) } };
}

export function geminiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): Provider {
  const post = async (url: string, body: unknown, signal?: AbortSignal): Promise<{ status: number; body: unknown }> => {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    } catch {
      if (signal?.aborted) throw new ProviderError('provider_timeout', 'The model took too long to answer.');
      throw new ProviderError('provider_unavailable', 'The model service could not be reached.');
    }
    try {
      return { status: res.status, body: await res.json() };
    } catch {
      if (signal?.aborted) throw new ProviderError('provider_timeout', 'The model took too long to answer.');
      return { status: res.status, body: null };
    }
  };
  return {
    name: 'gemini',
    async embed(input: EmbedInput): Promise<EmbedOutput> {
      const r = await post(`${BASE}/${encodeURIComponent(input.model)}:batchEmbedContents`, buildGeminiEmbedBody(input), input.signal);
      return readGeminiEmbedResponse(r.status, r.body, input);
    },
    async generate(input: GenerateInput): Promise<GenerateOutput> {
      let res: Response;
      try {
        res = await fetchImpl(`${BASE}/${encodeURIComponent(input.model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(buildGeminiBody(input)),
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
        body = null;
      }
      return readGeminiResponse(res.status, body);
    },
  };
}

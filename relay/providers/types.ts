/** The provider-agnostic interface (Section 6): swapping provider means writing one module like gemini.ts. */
import type { RequestPart } from '../../src/ai/protocol';
import type { OutputSchema } from '../../src/ai/schema';

/** How much the model may reason before answering, where the provider supports it; unset means the model's default. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface GenerateInput {
  model: string;
  system: string;
  parts: RequestPart[];
  schema: OutputSchema;
  maxOutputTokens: number;
  temperature: number;
  thinking?: ThinkingLevel;
  /** Aborts the call (the relay's deadline, below the hosting platform's limit). */
  signal?: AbortSignal;
}

export interface GenerateOutput {
  /** The model's JSON text, not yet parsed. */
  text: string;
  usage: { inputTokens: number; outputTokens: number };
}

export type ProviderErrorCode =
  | 'model_unavailable'
  | 'provider_auth'
  | 'provider_rate_limited'
  | 'provider_rejected'
  | 'provider_blocked'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_quota_exhausted'
  | 'output_truncated';

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    /** Tokens the provider reports as used, when it still charged for the call. */
    readonly usage?: { inputTokens: number; outputTokens: number },
  ) {
    super(message);
  }
}

export interface EmbedInput {
  model: string;
  texts: string[];
  purpose: 'document' | 'query';
  signal?: AbortSignal;
}

export interface EmbedOutput {
  vectors: number[][];
  /** Tokens as the provider reports them; estimated when it reports none. */
  usage: { inputTokens: number };
}

export interface Provider {
  readonly name: string;
  generate(input: GenerateInput): Promise<GenerateOutput>;
  /** M5: text embeddings (the evidence library). */
  embed(input: EmbedInput): Promise<EmbedOutput>;
}

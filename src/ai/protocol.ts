/**
 * The wire contract between the app and its model relay (Section 6). Shared by
 * the client (src/ai) and the serverless function (relay/), so both sides
 * check the same shapes. Nothing here names a provider or a model.
 */
import type { OutputSchema } from './schema';

/** Task routing (Section 12): extraction and verification on cheap tiers, reasoning on the stronger one. */
export const MODEL_TASKS = ['extract', 'analyse', 'verify'] as const;
export type ModelTask = (typeof MODEL_TASKS)[number];

export type RequestPart = { text: string } | { image: { mime: 'image/jpeg'; data: string } };

export interface ModelRequest {
  task: ModelTask;
  /** Chosen by the trainee from the relay's allow-list; never a literal in the code. */
  model: string;
  promptVersion: string;
  /** Lets the relay refuse a Clinical Case on a free-tier key (Section 18). */
  caseKind: 'teaching' | 'clinical';
  /** Random id of this installation, used only for rate limits. */
  installId: string;
  system: string;
  parts: RequestPart[];
  schema: OutputSchema;
  maxOutputTokens: number;
  temperature: number;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface BudgetState {
  month: string; // YYYY-MM
  budgetUsd: number;
  spentUsd: number;
}

export interface ModelResponse {
  output: unknown;
  usage: ModelUsage;
  model: string;
  budget: BudgetState;
}

export const RELAY_ERROR_CODES = [
  'not_configured',
  'access_denied',
  'bad_request',
  'too_large',
  'model_not_allowed',
  'price_not_configured',
  'free_key_clinical',
  'rate_limited',
  'budget_exhausted',
  'model_unavailable',
  'provider_auth',
  'provider_rate_limited',
  'provider_rejected',
  'provider_blocked',
  'provider_unavailable',
  'provider_timeout',
  'provider_quota_exhausted',
  'output_truncated',
  'invalid_output',
] as const;
export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export interface RelayErrorBody {
  error: { code: RelayErrorCode; message: string; retryAfterSeconds?: number; budget?: BudgetState };
}

export interface RelayModelInfo {
  id: string;
  /** USD per million tokens, as configured by the operator. */
  inputPerM: number;
  outputPerM: number;
}

export interface RelayStatus {
  configured: boolean;
  provider: string;
  keyClass: 'free' | 'paid';
  /** Models the operator listed, with their prices. */
  models: RelayModelInfo[];
  /** Other model ids the trainee may type (a regular expression), priced at the default price. */
  modelPattern?: string;
  /** The operator's suggested model per task; the trainee's own choice is stored in the app. */
  suggested: Partial<Record<ModelTask, string>>;
  budget: BudgetState & { byTask: Partial<Record<ModelTask, number>>; calls: number };
  limits: { perMinute: number; perDay: number };
  accessCodeRequired: boolean;
}

export const ACCESS_HEADER = 'x-preceptor-access';
export const MODEL_PATH = '/api/model';
export const STATUS_PATH = '/api/status';

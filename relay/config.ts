/**
 * Relay configuration, read only from the environment of the serverless
 * function. Model ids and prices are configuration, never code (Section 6):
 * the operator lists them, the trainee chooses among them in the app, and a
 * retired model is replaced without rebuilding anything.
 */
import { MODEL_TASKS, type ModelTask } from '../src/ai/protocol';
import { THINKING_LEVELS, type ThinkingLevel } from './providers/types';

export interface Price {
  inputPerM: number;
  outputPerM: number;
}

export interface RelayConfig {
  provider: 'gemini' | 'kimi';
  apiKey?: string;
  /** The provider offers no way to ask a key's class; the operator declares it, and "free" is assumed otherwise. */
  keyClass: 'free' | 'paid';
  models: ReadonlyMap<string, Price>;
  modelPattern?: RegExp;
  defaultPrice?: Price;
  suggested: Partial<Record<ModelTask, string>>;
  monthlyBudgetUsd: number;
  perMinute: number;
  perDay: number;
  accessCode?: string;
  maxOutputTokens: number;
  imageTokenEstimate: number;
  maxRequestBytes: number;
  /** Thinking level per task (PRECEPTOR_THINKING); unset tasks use the model's default. */
  thinking: Partial<Record<ModelTask, ThinkingLevel>>;
  /** The relay gives up on the provider after this long, so the hosting platform's own limit is never reached. */
  providerTimeoutMs: number;
}

export type ConfigResult = { ok: true; config: RelayConfig; problems: string[] } | { ok: false; problems: string[] };

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function parsePrice(s: string): Price | undefined {
  const [a, b, ...rest] = s.split(':').map((x) => x.trim());
  if (rest.length || a === undefined || b === undefined) return undefined;
  const inputPerM = Number(a);
  const outputPerM = Number(b);
  if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM) || inputPerM < 0 || outputPerM < 0) return undefined;
  return { inputPerM, outputPerM };
}

function positive(raw: string | undefined, fallback: number, problems: string[], name: string, integer = false): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) {
    problems.push(`${name} must be a positive ${integer ? 'whole ' : ''}number.`);
    return fallback;
  }
  return n;
}

/**
 * PRECEPTOR_MODELS is a comma-separated list of `model-id:inputUsdPerMillion:outputUsdPerMillion`.
 * PRECEPTOR_SUGGESTED is a comma-separated list of `task=model-id` (task: extract, analyse, verify, research).
 * PRECEPTOR_THINKING is a comma-separated list of `task=level` (minimal, low, medium, high).
 */
export function readConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];
  const provider = (env.PRECEPTOR_PROVIDER ?? 'gemini').trim();
  if (provider !== 'gemini' && provider !== 'kimi') return { ok: false, problems: [`Unknown provider "${provider}" (use gemini or kimi).`] };

  const models = new Map<string, Price>();
  for (const item of (env.PRECEPTOR_MODELS ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = item.indexOf(':');
    const id = i < 0 ? item : item.slice(0, i);
    const price = i < 0 ? undefined : parsePrice(item.slice(i + 1));
    if (!MODEL_ID.test(id)) problems.push(`"${id}" is not a valid model id.`);
    else if (!price) problems.push(`Model "${id}" needs a price as id:input:output (USD per million tokens).`);
    else models.set(id, price);
  }

  let modelPattern: RegExp | undefined;
  let defaultPrice: Price | undefined;
  if (env.PRECEPTOR_MODEL_PATTERN?.trim()) {
    try {
      modelPattern = new RegExp(`^(?:${env.PRECEPTOR_MODEL_PATTERN.trim()})$`);
    } catch {
      problems.push('PRECEPTOR_MODEL_PATTERN is not a valid regular expression.');
    }
    defaultPrice = env.PRECEPTOR_DEFAULT_PRICE ? parsePrice(env.PRECEPTOR_DEFAULT_PRICE) : undefined;
    if (!defaultPrice) {
      problems.push('PRECEPTOR_DEFAULT_PRICE (input:output) is required with PRECEPTOR_MODEL_PATTERN; the pattern is ignored.');
      modelPattern = undefined;
    }
  }

  const suggested: Partial<Record<ModelTask, string>> = {};
  for (const item of (env.PRECEPTOR_SUGGESTED ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [task, id] = item.split('=').map((x) => x.trim());
    if (!task || !id || !(MODEL_TASKS as readonly string[]).includes(task)) problems.push(`PRECEPTOR_SUGGESTED: "${item}" is not task=model-id.`);
    else suggested[task as ModelTask] = id;
  }

  const thinking: Partial<Record<ModelTask, ThinkingLevel>> = {};
  for (const item of (env.PRECEPTOR_THINKING ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [task, level] = item.split('=').map((x) => x.trim().toLowerCase());
    if (!task || !level || !(MODEL_TASKS as readonly string[]).includes(task) || !(THINKING_LEVELS as readonly string[]).includes(level)) {
      problems.push(`PRECEPTOR_THINKING: "${item}" is not task=level (levels: ${THINKING_LEVELS.join(', ')}).`);
    } else thinking[task as ModelTask] = level as ThinkingLevel;
  }

  const keyClassRaw = (env.PRECEPTOR_KEY_CLASS ?? 'free').trim().toLowerCase();
  if (keyClassRaw !== 'free' && keyClassRaw !== 'paid') problems.push('PRECEPTOR_KEY_CLASS must be "free" or "paid"; "free" is assumed.');

  const config: RelayConfig = {
    provider,
    // The key is read from the environment only: MOONSHOT_API_KEY for Kimi, GEMINI_API_KEY for Gemini.
    apiKey: (provider === 'kimi' ? env.MOONSHOT_API_KEY : env.GEMINI_API_KEY)?.trim() || undefined,
    keyClass: keyClassRaw === 'paid' ? 'paid' : 'free',
    models,
    modelPattern,
    defaultPrice,
    suggested,
    monthlyBudgetUsd: positive(env.PRECEPTOR_MONTHLY_BUDGET_USD, 5, problems, 'PRECEPTOR_MONTHLY_BUDGET_USD'),
    perMinute: positive(env.PRECEPTOR_RATE_PER_MINUTE, 10, problems, 'PRECEPTOR_RATE_PER_MINUTE', true),
    perDay: positive(env.PRECEPTOR_RATE_PER_DAY, 200, problems, 'PRECEPTOR_RATE_PER_DAY', true),
    accessCode: env.PRECEPTOR_ACCESS_CODE?.trim() || undefined,
    maxOutputTokens: positive(env.PRECEPTOR_MAX_OUTPUT_TOKENS, 8192, problems, 'PRECEPTOR_MAX_OUTPUT_TOKENS', true),
    imageTokenEstimate: positive(env.PRECEPTOR_IMAGE_TOKENS, 1600, problems, 'PRECEPTOR_IMAGE_TOKENS', true),
    // Netlify refuses a function request over about 6 MB with its own error; the relay answers clearly below that.
    maxRequestBytes: positive(env.PRECEPTOR_MAX_REQUEST_BYTES, 5 * 1024 * 1024, problems, 'PRECEPTOR_MAX_REQUEST_BYTES', true),
    thinking,
    // Netlify stops a synchronous function after 30 seconds; the relay answers clearly before that.
    providerTimeoutMs: positive(env.PRECEPTOR_PROVIDER_TIMEOUT_MS, 25_000, problems, 'PRECEPTOR_PROVIDER_TIMEOUT_MS', true),
  };
  return { ok: true, config, problems };
}

/** The price of a model the trainee may use, or undefined when it is not allowed. */
export function priceOf(config: RelayConfig, model: string): Price | undefined {
  const listed = config.models.get(model);
  if (listed) return listed;
  if (config.modelPattern && config.defaultPrice && MODEL_ID.test(model) && config.modelPattern.test(model)) return config.defaultPrice;
  return undefined;
}

/** What the relay offers when the trainee brings their own Kimi key and the operator listed no Kimi model. Prices are estimates for the spending cap; PRECEPTOR_DEFAULT_PRICE (input:output) replaces them. */
export const KIMI_DEFAULT_MODEL = 'kimi-k3';
const KIMI_FALLBACK_PRICE: Price = { inputPerM: 3, outputPerM: 15 };

/**
 * The trainee's own Kimi key (sent in KEY_HEADER) makes the relay use Kimi for that request, with no change to the
 * server's environment. Everything else (key class, limits, budget, access code) stays the operator's, so a Clinical
 * Case is still refused unless the server is declared "paid".
 */
export function withUserKimiKey(config: RelayConfig, key: string | null | undefined, env: Record<string, string | undefined> = {}): RelayConfig {
  const k = key?.trim();
  if (!k || !/^[\x21-\x7e]{8,300}$/.test(k)) return config;
  const price = (env.PRECEPTOR_DEFAULT_PRICE ? parsePrice(env.PRECEPTOR_DEFAULT_PRICE) : undefined) ?? KIMI_FALLBACK_PRICE;
  const kimiListed = config.provider === 'kimi' && config.models.size > 0;
  const suggested = kimiListed ? config.suggested : { extract: KIMI_DEFAULT_MODEL, analyse: KIMI_DEFAULT_MODEL, verify: KIMI_DEFAULT_MODEL, research: KIMI_DEFAULT_MODEL };
  return {
    ...config,
    provider: 'kimi',
    apiKey: k,
    models: kimiListed ? config.models : new Map(),
    modelPattern: kimiListed ? config.modelPattern : /^(?:kimi-[A-Za-z0-9._-]+)$/,
    defaultPrice: kimiListed ? config.defaultPrice : price,
    suggested,
  };
}

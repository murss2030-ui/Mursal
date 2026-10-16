/**
 * The stateless model relay (Section 6). Framework-independent: a web
 * Request in, a Response out, so the same code runs in the Netlify Function,
 * in unit tests and in the local test relay.
 *
 * It never logs or stores a payload. It holds the API key, checks the model
 * against the allow-list, refuses Clinical Cases on a free-tier key, applies
 * per-installation rate limits and the hard monthly spending cap, and returns
 * the model's JSON with the tokens used and their cost.
 */
import {
  ACCESS_HEADER,
  MODEL_TASKS,
  type BudgetState,
  type ModelRequest,
  type ModelResponse,
  type RelayErrorBody,
  type RelayErrorCode,
  type RelayStatus,
  type RequestPart,
} from '../src/ai/protocol';
import { isOutputSchema } from '../src/ai/schema';
import { priceOf, type Price, type RelayConfig } from './config';
import { ProviderError, type Provider } from './providers/types';
import { readMonth, reconcile, reserve, takeRate, monthKey, type CounterStore } from './usage';

export interface RelayDeps {
  config: RelayConfig;
  store: CounterStore;
  provider?: Provider;
  now?: () => Date;
}

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function fail(status: number, code: RelayErrorCode, message: string, more: Partial<RelayErrorBody['error']> = {}): Response {
  const extra: Record<string, string> = more.retryAfterSeconds ? { 'retry-after': String(more.retryAfterSeconds) } : {};
  return json(status, { error: { code, message, ...more } } satisfies RelayErrorBody, extra);
}

/** Constant-time comparison, so the access code cannot be guessed by timing. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function accessOk(req: Request, config: RelayConfig): boolean {
  if (!config.accessCode) return true;
  return sameSecret(req.headers.get(ACCESS_HEADER) ?? '', config.accessCode);
}

const usd = (n: number) => `US$${n.toFixed(2)}`;

function nextMonthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ request checks

const INSTALL_ID = /^[a-z0-9-]{8,64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parseParts(x: unknown): RequestPart[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > 12) return null;
  const out: RequestPart[] = [];
  for (const p of x) {
    if (typeof p !== 'object' || p === null) return null;
    const o = p as Record<string, unknown>;
    if (typeof o.text === 'string' && o.text.length <= 250_000) out.push({ text: o.text });
    else if (typeof o.image === 'object' && o.image !== null) {
      const img = o.image as Record<string, unknown>;
      if (img.mime !== 'image/jpeg' || typeof img.data !== 'string' || img.data.length === 0 || !BASE64.test(img.data)) return null;
      out.push({ image: { mime: 'image/jpeg', data: img.data } });
    } else return null;
  }
  return out;
}

function parseRequest(body: unknown, config: RelayConfig): { ok: true; req: ModelRequest } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, message: 'The request is not a JSON object.' };
  const b = body as Record<string, unknown>;
  if (!(MODEL_TASKS as readonly unknown[]).includes(b.task)) return { ok: false, message: 'Unknown task.' };
  if (typeof b.model !== 'string' || b.model.length > 100) return { ok: false, message: 'A model id is required.' };
  if (typeof b.promptVersion !== 'string' || !/^[a-z0-9._-]{1,40}$/.test(b.promptVersion)) return { ok: false, message: 'A prompt version is required.' };
  if (b.caseKind !== 'teaching' && b.caseKind !== 'clinical') return { ok: false, message: 'The case kind is required.' };
  if (typeof b.installId !== 'string' || !INSTALL_ID.test(b.installId)) return { ok: false, message: 'An installation id is required.' };
  if (typeof b.system !== 'string' || b.system.length < 1 || b.system.length > 40_000) return { ok: false, message: 'A system instruction is required.' };
  const parts = parseParts(b.parts);
  if (!parts) return { ok: false, message: 'The request parts are not valid.' };
  if (!isOutputSchema(b.schema)) return { ok: false, message: 'The output schema is not valid.' };
  const maxOut = b.maxOutputTokens;
  if (typeof maxOut !== 'number' || !Number.isInteger(maxOut) || maxOut < 64) return { ok: false, message: 'maxOutputTokens must be a whole number of at least 64.' };
  const temperature = b.temperature;
  if (typeof temperature !== 'number' || temperature < 0 || temperature > 1) return { ok: false, message: 'temperature must be between 0 and 1.' };
  return {
    ok: true,
    req: {
      task: b.task as ModelRequest['task'],
      model: b.model,
      promptVersion: b.promptVersion,
      caseKind: b.caseKind,
      installId: b.installId,
      system: b.system,
      parts,
      schema: b.schema,
      maxOutputTokens: Math.min(maxOut, config.maxOutputTokens),
      temperature,
    },
  };
}

/** A deliberately generous estimate: 2.5 characters per token for text (Arabic tokenises densely), a fixed allowance per image, and the full output allowance. */
export function estimateCost(req: ModelRequest, price: Price, imageTokens: number): { inputTokens: number; costUsd: number } {
  let chars = req.system.length + JSON.stringify(req.schema).length;
  let images = 0;
  for (const p of req.parts) {
    if ('text' in p) chars += p.text.length;
    else images++;
  }
  const inputTokens = Math.ceil(chars / 2.5) + images * imageTokens;
  const costUsd = (inputTokens * price.inputPerM + req.maxOutputTokens * price.outputPerM) / 1e6;
  return { inputTokens, costUsd };
}

export const costOf = (usage: { inputTokens: number; outputTokens: number }, price: Price) =>
  (usage.inputTokens * price.inputPerM + usage.outputTokens * price.outputPerM) / 1e6;

// ------------------------------------------------------------------ handlers

export async function handleModel(httpReq: Request, deps: RelayDeps): Promise<Response> {
  const { config, store } = deps;
  const now = deps.now?.() ?? new Date();
  if (httpReq.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');
  if (!accessOk(httpReq, config)) return fail(401, 'access_denied', 'The access code is missing or wrong. Enter it in Settings → AI service.');
  if (!config.apiKey || !deps.provider) return fail(503, 'not_configured', 'The AI service is not set up on the server yet (no API key).');

  const length = Number(httpReq.headers.get('content-length') ?? '0');
  if (length > config.maxRequestBytes) return fail(413, 'too_large', 'The request is too large. Send fewer or smaller pages at a time.');
  const raw = await httpReq.text();
  if (raw.length > config.maxRequestBytes) return fail(413, 'too_large', 'The request is too large. Send fewer or smaller pages at a time.');
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'bad_request', 'The request is not valid JSON.');
  }
  const parsed = parseRequest(body, config);
  if (!parsed.ok) return fail(400, 'bad_request', parsed.message);
  const req = parsed.req;

  const price = priceOf(config, req.model);
  if (!price) return fail(400, 'model_not_allowed', `The model "${req.model}" is not on this server's allow-list. Choose another in Settings → AI service.`);

  // Section 18: a free-tier key may let the provider reuse the data, so a Clinical Case is never sent to one.
  if (req.caseKind === 'clinical' && config.keyClass !== 'paid') {
    return fail(403, 'free_key_clinical', 'This server uses a free-tier key. Clinical Cases are never sent with a free-tier key; use a Teaching Case, or configure a paid key.');
  }

  const rate = await takeRate(store, now, req.installId, config.perMinute, config.perDay);
  if (!rate.ok) {
    return fail(429, 'rate_limited', rate.window === 'minute' ? 'Too many requests this minute. Wait a moment and try again.' : 'The daily request limit is reached. Try again tomorrow.', {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const estimate = estimateCost(req, price, config.imageTokenEstimate);
  const reservation = await reserve(store, now, config.monthlyBudgetUsd, estimate.costUsd, req.task);
  if (!reservation.ok) {
    const b = reservation.budget;
    return fail(402, 'budget_exhausted', `The monthly AI budget is reached: ${usd(b.spentUsd)} of ${usd(b.budgetUsd)} used, and this request could cost up to ${usd(estimate.costUsd)}. It resets on ${nextMonthStart(now)}.`, {
      budget: b,
    });
  }

  let usage: { inputTokens: number; outputTokens: number } | null = null;
  try {
    const out = await deps.provider.generate({
      model: req.model,
      system: req.system,
      parts: req.parts,
      schema: req.schema,
      maxOutputTokens: req.maxOutputTokens,
      temperature: req.temperature,
    });
    usage = out.usage;
    let output: unknown;
    try {
      output = JSON.parse(out.text);
    } catch {
      const after = await reconcile(store, reservation.month, req.task, estimate.costUsd, { ...usage, costUsd: costOf(usage, price) });
      return fail(502, 'invalid_output', 'The model did not return valid JSON. Try again.', { budget: budgetState(config, reservation.month, after.spentUsd) });
    }
    const costUsd = costOf(usage, price);
    const after = await reconcile(store, reservation.month, req.task, estimate.costUsd, { ...usage, costUsd });
    const response: ModelResponse = {
      output,
      usage: { ...usage, costUsd },
      model: req.model,
      budget: budgetState(config, reservation.month, after.spentUsd),
    };
    return json(200, response);
  } catch (e) {
    const charged = e instanceof ProviderError ? (e.usage ?? null) : usage;
    await reconcile(store, reservation.month, req.task, estimate.costUsd, charged ? { ...charged, costUsd: costOf(charged, price) } : null);
    if (e instanceof ProviderError) {
      const status = e.code === 'provider_rate_limited' ? 429 : e.code === 'model_unavailable' ? 404 : 502;
      const message =
        e.code === 'model_unavailable'
          ? `The model "${req.model}" is not available (it may have been retired). Choose another in Settings → AI service. (${e.message})`
          : e.message;
      return fail(status, e.code, message);
    }
    return fail(502, 'provider_unavailable', 'The model service failed. Try again later.');
  }
}

function budgetState(config: RelayConfig, month: string, spentUsd: number): BudgetState {
  return { month, budgetUsd: config.monthlyBudgetUsd, spentUsd };
}

export async function handleStatus(httpReq: Request, deps: RelayDeps): Promise<Response> {
  const { config, store } = deps;
  const now = deps.now?.() ?? new Date();
  if (httpReq.method !== 'GET') return fail(405, 'bad_request', 'Use GET.');
  if (!accessOk(httpReq, config)) return fail(401, 'access_denied', 'The access code is missing or wrong. Enter it in Settings → AI service.');
  const month = await readMonth(store, now);
  const status: RelayStatus = {
    configured: Boolean(config.apiKey && deps.provider),
    provider: config.provider,
    keyClass: config.keyClass,
    models: [...config.models].map(([id, p]) => ({ id, ...p })),
    modelPattern: config.modelPattern ? config.modelPattern.source.replace(/^\^\(\?:/, '').replace(/\)\$$/, '') : undefined,
    suggested: config.suggested,
    budget: { month: monthKey(now), budgetUsd: config.monthlyBudgetUsd, spentUsd: month.spentUsd, byTask: month.byTask, calls: month.calls },
    limits: { perMinute: config.perMinute, perDay: config.perDay },
    accessCodeRequired: Boolean(config.accessCode),
  };
  return json(200, status);
}

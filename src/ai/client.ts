/**
 * callModel — the single entry point for every model call in the app
 * (Section 6). No component talks to a provider or to the relay directly.
 *
 * It sends the request through the relay (same origin, so the
 * Content-Security-Policy still allows nothing else), checks the response
 * against the schema, and records every call in the audit log with the model
 * id, prompt version, retrieved chunk ids, token use and cost — never the
 * payload or the answer.
 */
import type { CaseKind } from '../domain/types';
import type { Store } from '../store/store';
import {
  ACCESS_HEADER,
  KEY_HEADER,
  EMBED_LIMITS,
  MODEL_PATH,
  STATUS_PATH,
  type BudgetState,
  type EmbedRequest,
  type EmbedResponse,
  type GenerateTask,
  type ModelRequest,
  type ModelResponse,
  type ModelUsage,
  type RelayErrorBody,
  type RelayErrorCode,
  type RelayStatus,
  type RequestPart,
} from './protocol';
import { validateOutput, type OutputSchema } from './schema';

export type AiErrorCode = RelayErrorCode | 'offline' | 'no_model' | 'network' | 'invalid_shape' | 'relay_missing';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly detail: { retryAfterSeconds?: number; budget?: BudgetState } = {},
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export interface CallModelInput {
  task: GenerateTask;
  promptVersion: string;
  caseId: string;
  caseKind: CaseKind;
  system: string;
  parts: RequestPart[];
  schema: OutputSchema;
  maxOutputTokens: number;
  temperature?: number;
  /** Evidence chunks the prompt was built from (none until the evidence library exists). */
  retrievedChunkIds?: string[];
  /** A model other than the task's chosen one (one of its fallbacks); the relay's allow-list still applies. */
  model?: string;
}

export interface CallModelResult<T> {
  output: T;
  usage: ModelUsage;
  model: string;
  budget: BudgetState;
}

export interface CallDeps {
  fetch?: typeof fetch;
  online?: () => boolean;
  /** Waits before the one automatic retry (replaced in tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Google's "high demand" refusals were frequent in the live run and usually clear within seconds: retried once. */
const RETRY_ONCE: ReadonlySet<AiErrorCode> = new Set(['provider_unavailable']);
const RETRY_AFTER_MS = 4000;

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

async function relayError(res: Response): Promise<AiError> {
  let body: RelayErrorBody | null = null;
  try {
    body = (await res.json()) as RelayErrorBody;
  } catch {
    body = null;
  }
  if (body?.error?.code) return new AiError(body.error.code, body.error.message, { retryAfterSeconds: body.error.retryAfterSeconds, budget: body.error.budget });
  // No JSON error from our relay: the static host answered (no relay deployed here).
  if (res.status === 404 || res.status === 405) return new AiError('relay_missing', 'No AI service is deployed with this copy of the app.');
  return new AiError('provider_unavailable', `The AI service answered with HTTP ${res.status}.`);
}

export async function callModel<T>(store: Store, input: CallModelInput, deps: CallDeps = {}): Promise<CallModelResult<T>> {
  if (!(deps.online ?? isOnline)()) throw new AiError('offline', 'You are offline. Reading documents and drafting need a connection; everything else keeps working.');
  const settings = await store.getAiSettings();
  const model = input.model ?? settings.models[input.task];
  if (!model) throw new AiError('no_model', 'Choose a model for this task in Settings → AI service.');
  const request: ModelRequest = {
    task: input.task,
    model,
    promptVersion: input.promptVersion,
    caseKind: input.caseKind,
    installId: settings.installId,
    system: input.system,
    parts: input.parts,
    schema: input.schema,
    maxOutputTokens: input.maxOutputTokens,
    temperature: input.temperature ?? 0,
  };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.accessCode) headers[ACCESS_HEADER] = settings.accessCode;
  if (settings.kimiKey) headers[KEY_HEADER] = settings.kimiKey;

  const audit = (outcome: string, usage?: ModelUsage) =>
    store.appendAudit({
      entity: 'model_call',
      entityId: crypto.randomUUID(),
      caseId: input.caseId,
      action: 'call',
      actor: 'model',
      diff: {
        task: input.task,
        model,
        promptVersion: input.promptVersion,
        retrievedChunkIds: input.retrievedChunkIds ?? [],
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        costUsd: usage?.costUsd ?? 0,
        outcome,
      },
    });

  let res: Response | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await (deps.fetch ?? fetch)(MODEL_PATH, { method: 'POST', headers, body: JSON.stringify(request) });
    } catch {
      await audit('network');
      throw new AiError('network', 'The AI service could not be reached. Check the connection and try again.');
    }
    if (res.ok) break;
    const err = await relayError(res);
    await audit(err.code); // every attempt is in the audit log
    if (attempt === 1 && RETRY_ONCE.has(err.code)) {
      await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(RETRY_AFTER_MS);
      continue;
    }
    throw err;
  }
  const body = (await res.json()) as ModelResponse;
  const issues = validateOutput(body.output, input.schema);
  if (issues.length) {
    await audit('invalid_shape', body.usage);
    throw new AiError('invalid_shape', `The model's answer did not have the expected structure (${issues[0]!.path}: ${issues[0]!.problem}).`);
  }
  await audit('ok', body.usage);
  return { output: body.output as T, usage: body.usage, model: body.model, budget: body.budget };
}

export interface CallEmbedInput {
  /** The case a research question comes from; a library passage belongs to no case. */
  caseId?: string;
  caseKind: CaseKind;
  purpose: 'document' | 'query';
  texts: string[];
  /** The library chunks being embedded, for the audit log (their ids, never their text). */
  chunkIds?: string[];
}

export const EMBED_PROMPT_VERSION = 'embed-v1';

/**
 * M5: vectors for the evidence library (Section 11: "embeddings through
 * callModel, computed once"). The same path as every other call — the relay's
 * allow-list, key class, rate limits and spending cap — and the same audit
 * record: model, token use and cost, never the text.
 */
export async function callEmbed(store: Store, input: CallEmbedInput, deps: CallDeps = {}): Promise<{ vectors: number[][]; usage: ModelUsage; model: string }> {
  if (!(deps.online ?? isOnline)()) throw new AiError('offline', 'You are offline. Computing search vectors needs a connection; lexical search keeps working.');
  const settings = await store.getAiSettings();
  const model = settings.models.embed;
  if (!model) throw new AiError('no_model', 'Choose a model for search vectors in Settings → AI service.');
  if (!input.texts.length || input.texts.length > EMBED_LIMITS.texts) throw new AiError('bad_request', `Between 1 and ${EMBED_LIMITS.texts} texts are embedded at a time.`);
  const request: EmbedRequest = { task: 'embed', model, promptVersion: EMBED_PROMPT_VERSION, caseKind: input.caseKind, installId: settings.installId, purpose: input.purpose, texts: input.texts };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (settings.accessCode) headers[ACCESS_HEADER] = settings.accessCode;
  if (settings.kimiKey) headers[KEY_HEADER] = settings.kimiKey;
  const audit = (outcome: string, usage?: ModelUsage) =>
    store.appendAudit({
      entity: 'model_call',
      entityId: crypto.randomUUID(),
      ...(input.caseId ? { caseId: input.caseId } : {}),
      action: 'call',
      actor: 'model',
      diff: { task: 'embed', model, promptVersion: EMBED_PROMPT_VERSION, purpose: input.purpose, texts: input.texts.length, retrievedChunkIds: input.chunkIds ?? [], inputTokens: usage?.inputTokens ?? 0, outputTokens: 0, costUsd: usage?.costUsd ?? 0, outcome },
    });
  let res: Response | undefined;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await (deps.fetch ?? fetch)(MODEL_PATH, { method: 'POST', headers, body: JSON.stringify(request) });
    } catch {
      await audit('network');
      throw new AiError('network', 'The AI service could not be reached. Check the connection and try again.');
    }
    if (res.ok) break;
    const err = await relayError(res);
    await audit(err.code);
    if (attempt === 1 && RETRY_ONCE.has(err.code)) {
      await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(RETRY_AFTER_MS);
      continue;
    }
    throw err;
  }
  const body = (await res.json()) as EmbedResponse;
  const ok = Array.isArray(body.vectors) && body.vectors.length === input.texts.length && body.vectors.every((v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number' && Number.isFinite(x)));
  if (!ok || new Set(body.vectors.map((v) => v.length)).size !== 1) {
    await audit('invalid_shape', body.usage);
    throw new AiError('invalid_shape', 'The embedding service returned vectors of the wrong number or shape.');
  }
  await audit('ok', body.usage);
  return { vectors: body.vectors, usage: body.usage, model: body.model };
}

/** The relay's configuration and this month's spend (Section 19, usage screen). */
export async function fetchRelayStatus(store: Store, deps: CallDeps = {}): Promise<RelayStatus> {
  if (!(deps.online ?? isOnline)()) throw new AiError('offline', 'You are offline.');
  const settings = await store.getAiSettings();
  const headers: Record<string, string> = {};
  if (settings.accessCode) headers[ACCESS_HEADER] = settings.accessCode;
  if (settings.kimiKey) headers[KEY_HEADER] = settings.kimiKey;
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(STATUS_PATH, { headers });
  } catch {
    throw new AiError('network', 'The AI service could not be reached.');
  }
  if (!res.ok) throw await relayError(res);
  const type = res.headers.get('content-type') ?? '';
  // A static host without the relay answers index.html for unknown paths.
  if (!type.includes('application/json')) throw new AiError('relay_missing', 'No AI service is deployed with this copy of the app.');
  return (await res.json()) as RelayStatus;
}

/**
 * Section 18: the app itself refuses to send a Clinical Case to a free-tier
 * key and offers Teaching Cases instead (the relay refuses it too).
 */
export function clinicalCaseBlocked(status: Pick<RelayStatus, 'keyClass'> | undefined, caseKind: CaseKind): boolean {
  return caseKind === 'clinical' && status?.keyClass !== 'paid';
}

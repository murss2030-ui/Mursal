/**
 * The trainee's AI settings, kept in the encrypted settings table (Section 6:
 * "Store them in a settings record with an allow-list"). The model per task is
 * chosen from the relay's allow-list; nothing here is a built-in model name.
 */
import { MODEL_TASKS, type ModelTask } from './protocol';

export interface AiSettings {
  /** Random id of this installation; the relay uses it only for rate limits. */
  installId: string;
  /** The relay's optional access code (not the provider's API key, which never reaches the browser). */
  accessCode?: string;
  models: Partial<Record<ModelTask, string>>;
  /** M5: models tried in order when the task's model is busy or unavailable (the live probe: "high demand" for hours). */
  fallbacks?: Partial<Record<ModelTask, string[]>>;
}

/** At most this many fallback models per task. */
export const MAX_FALLBACKS = 3;

/** The models to try for a task, in order: the chosen one, then its fallbacks. */
export const modelsFor = (s: Pick<AiSettings, 'models' | 'fallbacks'>, task: ModelTask): string[] => {
  const first = s.models[task];
  return first ? [first, ...(s.fallbacks?.[task] ?? []).filter((m) => m !== first)] : [];
};

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function newInstallId(random: () => string = () => crypto.randomUUID()): string {
  return random().toLowerCase();
}

export type AiSettingsInput = {
  accessCode?: string;
  models: Partial<Record<ModelTask, string>>;
  /** Fallback model ids per task, as a list or as text separated by commas. */
  fallbacks?: Partial<Record<ModelTask, string | readonly string[]>>;
};

/** Trims and checks; an invalid model id is an error, never silently replaced. */
export function normalizeAiSettings(prev: AiSettings, input: AiSettingsInput): { ok: true; value: AiSettings } | { ok: false; errors: Record<string, 'modelId' | 'tooLong' | 'tooMany'> } {
  const errors: Record<string, 'modelId' | 'tooLong' | 'tooMany'> = {};
  const models: Partial<Record<ModelTask, string>> = {};
  for (const t of MODEL_TASKS) {
    const v = input.models[t]?.trim();
    if (!v) continue;
    if (!MODEL_ID.test(v)) errors[`model_${t}`] = 'modelId';
    else models[t] = v;
  }
  const fallbacks: Partial<Record<ModelTask, string[]>> = {};
  for (const t of MODEL_TASKS) {
    const raw = input.fallbacks?.[t];
    const ids = [...new Set((typeof raw === 'string' ? raw.split(',') : (raw ?? [])).map((x) => x.trim()).filter(Boolean))].filter((x) => x !== models[t]);
    if (!ids.length) continue;
    if (ids.some((x) => !MODEL_ID.test(x))) errors[`fallback_${t}`] = 'modelId';
    else if (ids.length > MAX_FALLBACKS) errors[`fallback_${t}`] = 'tooMany';
    else fallbacks[t] = ids;
  }
  const code = input.accessCode?.trim();
  if (code && code.length > 200) errors.accessCode = 'tooLong';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { installId: prev.installId, ...(code ? { accessCode: code } : {}), models, ...(Object.keys(fallbacks).length ? { fallbacks } : {}) } };
}

/** What the audit log may show: the models, and only whether an access code is set. */
export function auditView(s: AiSettings | undefined): Record<string, unknown> {
  if (!s) return {};
  return { models: s.models, ...(s.fallbacks ? { fallbacks: s.fallbacks } : {}), accessCode: s.accessCode ? 'set' : 'none' };
}

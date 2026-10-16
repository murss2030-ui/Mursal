/**
 * Task worksheets: validation of what the trainee saves, and progress.
 *
 * Keys: a case-level item uses its id; an item repeated per medication or per
 * problem uses `${id}@${scopeId}`; the "does this apply?" answer of a scoped
 * section is stored as `applies@${scopeId}` ("yes" | "no").
 *
 * Progress counts checklist items and tracked choice fields. It measures how
 * much of the worksheet has been answered — never whether the answers are right.
 * Whether a task is done is the trainee's own statement (status).
 */
import type { CheckValue, TaskRecord, TaskStatus } from '../types';
import { MAX_LONGTEXT, MAX_TEXT } from './registers';
import { MODULE_BY_ID, TASK_ORDER, TASKS, type ModuleId, type ScopedSection, type TaskDef, type TaskFieldDef } from './catalogue';

export const TASK_STATUSES: readonly TaskStatus[] = ['not_started', 'in_progress', 'done', 'not_applicable'];
export const CHECK_VALUES: readonly CheckValue[] = ['ok', 'issue', 'na'];

export interface TaskInput {
  status: TaskStatus;
  naReason?: string;
  checks: Record<string, CheckValue>;
  fields: Record<string, string>;
  notes?: string;
}

export type TaskFieldError = 'required' | 'invalidChoice' | 'tooLong' | 'unknownField' | 'unknownTask';
export type TaskErrors = Record<string, TaskFieldError>;

export const scopedKey = (id: string, scope: string): string => `${id}@${scope}`;
export const appliesKey = (scope: string): string => `applies@${scope}`;

function splitKey(key: string): { id: string; scope?: string } {
  const at = key.indexOf('@');
  if (at < 0) return { id: key };
  return { id: key.slice(0, at), scope: key.slice(at + 1) };
}

const validScope = (s: string | undefined): s is string => !!s && s.length <= 100 && !s.includes('@');

function scopedSections(def: TaskDef): ScopedSection[] {
  return [def.perMedication, def.perProblem].filter((s): s is ScopedSection => !!s);
}

function checkValue(v: unknown): v is CheckValue {
  return typeof v === 'string' && (CHECK_VALUES as readonly string[]).includes(v);
}

function fieldError(f: TaskFieldDef, v: string): TaskFieldError | undefined {
  switch (f.kind) {
    case 'text':
      return v.length > MAX_TEXT ? 'tooLong' : undefined;
    case 'longtext':
      return v.length > MAX_LONGTEXT ? 'tooLong' : undefined;
    case 'choice':
      return f.options?.some((o) => o.value === v) ? undefined : 'invalidChoice';
    case 'multi': {
      const parts = v.split('|').filter(Boolean);
      if (!parts.length || new Set(parts).size !== parts.length) return 'invalidChoice';
      return parts.every((p) => f.options?.some((o) => o.value === p)) ? undefined : 'invalidChoice';
    }
  }
}

/** Trims, drops empty values, and rejects anything the task does not define. */
export function normalizeTaskInput(taskId: string, input: TaskInput): { ok: true; value: TaskInput } | { ok: false; errors: TaskErrors } {
  const def = TASKS.get(taskId);
  if (!def) return { ok: false, errors: { task: 'unknownTask' } };
  const errors: TaskErrors = {};

  if (!TASK_STATUSES.includes(input.status)) errors.status = 'invalidChoice';
  const naReason = input.naReason?.trim() ?? '';
  if (input.status === 'not_applicable' && !naReason) errors.naReason = 'required';
  if (naReason.length > MAX_TEXT) errors.naReason = 'tooLong';

  const checks: Record<string, CheckValue> = {};
  const caseChecks = new Set(def.case?.checks.map((c) => c.id) ?? []);
  const scopedChecks = new Set(scopedSections(def).flatMap((s) => s.checks.map((c) => c.id)));
  for (const [key, v] of Object.entries(input.checks ?? {})) {
    const { id, scope } = splitKey(key);
    const known = scope === undefined ? caseChecks.has(id) : validScope(scope) && scopedChecks.has(id);
    if (!known) errors[key] = 'unknownField';
    else if (!checkValue(v)) errors[key] = 'invalidChoice';
    else checks[key] = v;
  }

  const fields: Record<string, string> = {};
  const caseFields = new Map((def.case?.fields ?? []).map((f) => [f.id, f]));
  const scopedFields = new Map(scopedSections(def).flatMap((s) => (s.fields ?? []).map((f) => [f.id, f] as const)));
  const hasApplies = scopedSections(def).some((s) => s.applies);
  for (const [key, raw] of Object.entries(input.fields ?? {})) {
    const v = (raw ?? '').trim();
    const { id, scope } = splitKey(key);
    if (id === 'applies' && scope !== undefined) {
      if (!hasApplies || !validScope(scope)) errors[key] = 'unknownField';
      else if (v && v !== 'yes' && v !== 'no') errors[key] = 'invalidChoice';
      else if (v) fields[key] = v;
      continue;
    }
    const f = scope === undefined ? caseFields.get(id) : validScope(scope) ? scopedFields.get(id) : undefined;
    if (!f) {
      errors[key] = 'unknownField';
      continue;
    }
    if (!v) continue;
    const e = fieldError(f, v);
    if (e) errors[key] = e;
    else fields[key] = v;
  }

  const notes = input.notes?.trim() ?? '';
  if (notes.length > MAX_LONGTEXT) errors.notes = 'tooLong';
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      status: input.status,
      ...(input.status === 'not_applicable' ? { naReason } : {}),
      checks,
      fields,
      ...(notes ? { notes } : {}),
    },
  };
}

// ---------------------------------------------------------------- progress

export interface ScopeIds {
  medIds: readonly string[];
  problemIds: readonly string[];
}

export interface TaskProgress {
  answered: number;
  total: number;
  /** Checklist items answered "problem found". */
  issues: number;
}

function countSection(
  checks: readonly { id: string }[],
  fields: readonly TaskFieldDef[] | undefined,
  rec: Pick<TaskRecord, 'checks' | 'fields'> | undefined,
  key: (id: string) => string,
  acc: TaskProgress,
): void {
  for (const c of checks) {
    acc.total++;
    const v = rec?.checks[key(c.id)];
    if (v) acc.answered++;
    if (v === 'issue') acc.issues++;
  }
  for (const f of fields ?? []) {
    if (!f.tracked) continue;
    acc.total++;
    if (rec?.fields[key(f.id)]) acc.answered++;
  }
}

function countScoped(sec: ScopedSection | undefined, ids: readonly string[], rec: Pick<TaskRecord, 'checks' | 'fields'> | undefined, acc: TaskProgress): void {
  if (!sec) return;
  for (const scope of ids) {
    if (sec.applies) {
      acc.total++;
      const a = rec?.fields[appliesKey(scope)];
      if (a) acc.answered++;
      if (a !== 'yes') continue;
    }
    countSection(sec.checks, sec.fields, rec, (id) => scopedKey(id, scope), acc);
  }
}

export function taskProgress(def: TaskDef, rec: Pick<TaskRecord, 'checks' | 'fields'> | undefined, scope: ScopeIds): TaskProgress {
  const acc: TaskProgress = { answered: 0, total: 0, issues: 0 };
  if (def.case) countSection(def.case.checks, def.case.fields, rec, (id) => id, acc);
  countScoped(def.perMedication, scope.medIds, rec, acc);
  countScoped(def.perProblem, scope.problemIds, rec, acc);
  return acc;
}

export const statusOf = (rec: Pick<TaskRecord, 'status'> | undefined): TaskStatus => rec?.status ?? 'not_started';
export const isComplete = (s: TaskStatus): boolean => s === 'done' || s === 'not_applicable';

export interface Tally {
  complete: number;
  inProgress: number;
  notStarted: number;
  total: number;
}

function tally(defs: readonly TaskDef[], byTask: ReadonlyMap<string, Pick<TaskRecord, 'status'>>): Tally {
  const t: Tally = { complete: 0, inProgress: 0, notStarted: 0, total: defs.length };
  for (const d of defs) {
    const s = statusOf(byTask.get(d.id));
    if (isComplete(s)) t.complete++;
    else if (s === 'in_progress') t.inProgress++;
    else t.notStarted++;
  }
  return t;
}

export function indexTasks<T extends Pick<TaskRecord, 'taskId'>>(records: readonly T[]): Map<string, T> {
  return new Map(records.map((r) => [r.taskId, r]));
}

export function caseTally(records: readonly Pick<TaskRecord, 'taskId' | 'status'>[]): Tally {
  return tally(TASK_ORDER, indexTasks(records));
}

export function moduleTally(moduleId: ModuleId, records: readonly Pick<TaskRecord, 'taskId' | 'status'>[]): Tally {
  const m = MODULE_BY_ID.get(moduleId)!;
  return tally(
    m.tasks.map((id) => TASKS.get(id)!),
    indexTasks(records),
  );
}

/** The first task, in working order, that is not complete — one already started comes first. */
export function nextTask(records: readonly Pick<TaskRecord, 'taskId' | 'status'>[]): TaskDef | undefined {
  const by = indexTasks(records);
  return TASK_ORDER.find((d) => statusOf(by.get(d.id)) === 'in_progress') ?? TASK_ORDER.find((d) => !isComplete(statusOf(by.get(d.id))));
}

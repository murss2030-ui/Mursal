/**
 * Reading calculator inputs from the case record.
 *
 * Laboratory values, vital signs and weights come from timeline entries and
 * keep the entry id; age, sex and height come from the case record; chart
 * findings that have no structured entry (confusion, ascites, an ECG report's
 * QT interval, a dose's start time) are answered by the trainee in the
 * calculator. Nothing is defaulted or estimated: an input that is not there
 * is named as missing, a value still `extracted_unverified` is refused, and
 * a unit that is not accepted is rejected.
 */
import { compareEntries } from '../domain/timeline';
import type { Sex, TimelineEntry, VitalKind } from '../domain/types';
import { isValidHospitalDay, isValidTimeOfDay } from '../domain/dates';
import type { CalcInputs, InputSpec, InputValue, Problem } from './types';
import { BUN_UNIT, normaliseUnit, toCanonical, type QuantityId } from './units';

export interface CaseFacts {
  ageYears: number;
  sex: Sex;
  heightCm?: number;
}

/** A value read from a document that the trainee has not confirmed yet. It is never used. */
export interface PendingValue {
  kind: 'lab' | 'vital' | 'weight';
  analyte?: string;
  vital?: VitalKind;
}

export interface GatherContext {
  demographics: CaseFacts;
  /** The effective timeline (current entries, corrections applied). */
  current: readonly TimelineEntry[];
  pending?: readonly PendingValue[];
}

export type Answer =
  | { kind: 'number'; value: number; unit: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'choice'; value: string }
  | { kind: 'time'; day: number; time: string };

export interface GatherRequest {
  /** The timeline entry the trainee chose for an input; the most recent one otherwise. */
  picks?: Readonly<Record<string, string>>;
  answers?: Readonly<Record<string, Answer>>;
  /** Out-of-range values the trainee confirmed, as produced by `confirmationKey`. */
  confirmed?: readonly string[];
}

export interface Gathered {
  inputs: CalcInputs;
  problems: Problem[];
  /** Inputs for which a value read from a document is still waiting for confirmation (not used). */
  pendingKeys: string[];
}

export const MINUTES_PER_DAY = 1440;

/** Minutes from 00:00 of hospital day 0. */
export function minutesOf(day: number, time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return day * MINUTES_PER_DAY + h * 60 + m;
}

/** Identifies one confirmation: the input and the exact recorded value and unit it was given for. */
export function confirmationKey(v: Pick<InputValue, 'key' | 'value' | 'unit' | 'recorded'>): string {
  const r = v.recorded ?? { value: v.value, unit: v.unit };
  return `${v.key}=${r.value} ${r.unit}`;
}

/** Timeline entries that can supply an input, most recent first. */
export function candidates(spec: InputSpec, current: readonly TimelineEntry[]): TimelineEntry[] {
  const s = spec.source;
  const matching = current.filter((e) => {
    if (s.kind === 'lab') return e.type === 'lab' && s.analytes.includes(e.payload.analyte);
    if (s.kind === 'vital') return e.type === 'vital' && e.payload.vital === s.vital;
    if (s.kind === 'weight') return e.type === 'weight';
    return false;
  });
  return matching.sort(compareEntries).reverse();
}

function fromEntry(spec: InputSpec, e: TimelineEntry): { value?: InputValue; problem?: Problem } {
  const base = { entryId: e.id, day: e.hospitalDay, provenance: e.provenance, ...(e.timeOfDay ? { time: e.timeOfDay } : {}) };
  const source = { kind: 'entry' as const, ...base };
  if (e.provenance === 'extracted_unverified') return { problem: { kind: 'unverified', key: spec.key, entryId: e.id } };
  if (spec.needsTime && !e.timeOfDay) {
    return {
      problem: {
        kind: 'missing',
        key: spec.key,
        detail: { en: 'its clock time on the timeline entry', ar: 'وقت السحب في مدخل الخط الزمني' },
      },
    };
  }
  let recordedValue: number | undefined;
  let recordedUnit = '';
  if (e.type === 'lab') {
    if (e.payload.result.kind !== 'numeric') {
      return { problem: { kind: 'invalid', key: spec.key, reason: { en: 'the result is text, not a number', ar: 'النتيجة نص وليست رقماً' } } };
    }
    recordedValue = e.payload.result.value;
    recordedUnit = e.payload.analyte === 'bun' && normaliseUnit(e.payload.unit) === 'mg/dL' ? BUN_UNIT : e.payload.unit;
  } else if (e.type === 'vital') {
    const part = spec.source.kind === 'vital' ? spec.source.part : undefined;
    recordedValue = part === 'systolic' ? e.payload.systolic : part === 'diastolic' ? e.payload.diastolic : e.payload.value;
    recordedUnit = e.payload.unit;
  } else if (e.type === 'weight') {
    recordedValue = e.payload.value;
    recordedUnit = e.payload.unit;
  }
  if (recordedValue === undefined) return { problem: { kind: 'missing', key: spec.key } };
  return numeric(spec, recordedValue, recordedUnit, source);
}

function numeric(spec: InputSpec, value: number, unit: string, source: InputValue['source']): { value?: InputValue; problem?: Problem } {
  const c = toCanonical(spec.kind as QuantityId, value, unit);
  if (!c.ok) return { problem: { kind: 'unit', key: spec.key, unit, accepted: c.accepted } };
  const converted = c.unit !== normaliseUnit(unit) || c.rule !== undefined;
  return {
    value: {
      key: spec.key,
      value: c.value,
      unit: c.unit,
      ...(converted ? { recorded: { value, unit: normaliseUnit(unit), ...(c.rule ? { rule: c.rule } : {}) } } : {}),
      source,
    },
  };
}

function fromCase(spec: InputSpec, facts: CaseFacts): { value?: InputValue; problem?: Problem } {
  if (spec.source.kind !== 'case') return {};
  const source = { kind: 'case' as const, field: spec.source.field };
  switch (spec.source.field) {
    case 'ageYears':
      return { value: { key: spec.key, value: facts.ageYears, unit: 'years', source } };
    case 'sex':
      return { value: { key: spec.key, value: facts.sex === 'F' ? 1 : 0, unit: 'sex', choice: facts.sex, source } };
    case 'heightCm':
      return facts.heightCm === undefined
        ? { problem: { kind: 'missing', key: spec.key } }
        : { value: { key: spec.key, value: facts.heightCm, unit: 'cm', source } };
  }
}

function fromAnswer(spec: InputSpec, a: Answer | undefined): { value?: InputValue; problem?: Problem } {
  const source = { kind: 'answer' as const };
  if (!a) return { problem: { kind: 'missing', key: spec.key } };
  switch (spec.kind) {
    case 'boolean':
      return a.kind === 'boolean'
        ? { value: { key: spec.key, value: a.value ? 1 : 0, unit: 'yes/no', choice: a.value ? 'yes' : 'no', source } }
        : { problem: { kind: 'missing', key: spec.key } };
    case 'choice': {
      const opt = a.kind === 'choice' ? spec.options?.find((o) => o.value === a.value) : undefined;
      return opt
        ? { value: { key: spec.key, value: opt.points, unit: 'points', choice: opt.value, source } }
        : { problem: { kind: 'missing', key: spec.key } };
    }
    case 'time': {
      if (a.kind !== 'time') return { problem: { kind: 'missing', key: spec.key } };
      if (!isValidHospitalDay(a.day) || !isValidTimeOfDay(a.time)) {
        return { problem: { kind: 'invalid', key: spec.key, reason: { en: 'not a valid day and clock time', ar: 'اليوم أو الوقت غير صالح' } } };
      }
      return { value: { key: spec.key, value: minutesOf(a.day, a.time), unit: 'min', source: { kind: 'answer' } } };
    }
    case 'sex':
      return { problem: { kind: 'missing', key: spec.key } };
    default:
      return a.kind === 'number' ? numeric(spec, a.value, a.unit, source) : { problem: { kind: 'missing', key: spec.key } };
  }
}

/**
 * Collect the values for a calculator's inputs. Optional inputs that are
 * absent are simply left out; required ones are named as missing.
 */
/** Whether an input applies, given the answers so far (see InputSpec.showIf). */
export function applies(spec: InputSpec, answers: GatherRequest['answers']): boolean {
  if (!spec.showIf) return true;
  const a = answers?.[spec.showIf.key];
  const value = a?.kind === 'choice' ? a.value : a?.kind === 'boolean' ? (a.value ? 'yes' : 'no') : undefined;
  return value !== undefined && spec.showIf.in.includes(value);
}

export function gather(
  required: readonly InputSpec[],
  optional: readonly InputSpec[],
  ctx: GatherContext,
  req: GatherRequest = {},
): Gathered {
  const inputs: Record<string, InputValue> = {};
  const problems: Problem[] = [];
  const pendingKeys: string[] = [];
  const confirmed = new Set(req.confirmed ?? []);

  const one = (spec: InputSpec, isRequired: boolean) => {
    if (!applies(spec, req.answers)) return;
    let got: { value?: InputValue; problem?: Problem };
    const s = spec.source;
    if (s.kind === 'case') got = fromCase(spec, ctx.demographics);
    else if (s.kind === 'answer') got = fromAnswer(spec, req.answers?.[spec.key]);
    else {
      const list = candidates(spec, ctx.current);
      const pickId = req.picks?.[spec.key];
      const picked = pickId ? list.find((e) => e.id === pickId) : spec.pickRequired ? undefined : list[0];
      const pending = (ctx.pending ?? []).some(
        (p) =>
          (s.kind === 'lab' && p.kind === 'lab' && p.analyte !== undefined && s.analytes.includes(p.analyte)) ||
          (s.kind === 'vital' && p.kind === 'vital' && p.vital === s.vital) ||
          (s.kind === 'weight' && p.kind === 'weight'),
      );
      if (pending) pendingKeys.push(spec.key);
      if (!picked) {
        got = pending
          ? { problem: { kind: 'unverified', key: spec.key } }
          : { problem: { kind: 'missing', key: spec.key } };
      } else got = fromEntry(spec, picked);
    }
    if (got.value) {
      const v = got.value;
      inputs[spec.key] = confirmed.has(confirmationKey(v)) ? { ...v, confirmedOutOfRange: true } : v;
    } else if (got.problem && (isRequired || got.problem.kind !== 'missing')) problems.push(got.problem);
  };

  for (const spec of required) one(spec, true);
  for (const spec of optional) one(spec, false);
  return { inputs, problems, pendingKeys };
}

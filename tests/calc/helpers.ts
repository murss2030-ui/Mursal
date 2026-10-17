/**
 * Builders for calculator tests: timeline entries as the store would hold
 * them, and a run helper that treats the calculator as validated (the
 * registry's manifest is tested separately).
 */
import { makeCalculator, run, type RunOutcome } from '../../src/calc/engine';
import type { Answer, CaseFacts, GatherContext, GatherRequest, PendingValue } from '../../src/calc/gather';
import type { CalcResult, CalculatorDef, Problem } from '../../src/calc/types';
import type { ProvenanceState, TimelineEntry, VitalKind } from '../../src/domain/types';

let seq = 0;
const nextId = () => `entry-${++seq}`;

interface Opts {
  day?: number;
  time?: string;
  provenance?: ProvenanceState;
  id?: string;
}

function base(opts: Opts) {
  return {
    id: opts.id ?? nextId(),
    caseId: 'CASE-TEST',
    hospitalDay: opts.day ?? 1,
    ...(opts.time ? { timeOfDay: opts.time } : {}),
    recordedAt: `2026-10-17T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    author: 'user' as const,
    provenance: opts.provenance ?? ('user_entered' as const),
  };
}

export function lab(analyte: string, value: number, unit: string, opts: Opts = {}): TimelineEntry {
  return {
    ...base(opts),
    type: 'lab',
    payload: { analyte, analyteName: analyte, result: { kind: 'numeric', value }, unit },
    unit,
  };
}

export function textLab(analyte: string, text: string, unit: string, opts: Opts = {}): TimelineEntry {
  return { ...base(opts), type: 'lab', payload: { analyte, analyteName: analyte, result: { kind: 'text', text }, unit }, unit };
}

export function vital(kind: VitalKind, value: number, unit: string, opts: Opts = {}): TimelineEntry {
  return { ...base(opts), type: 'vital', payload: { vital: kind, value, unit }, unit };
}

export function bp(systolic: number, diastolic: number, opts: Opts = {}): TimelineEntry {
  return { ...base(opts), type: 'vital', payload: { vital: 'blood_pressure', systolic, diastolic, unit: 'mmHg' }, unit: 'mmHg' };
}

export function weight(kg: number, opts: Opts = {}): TimelineEntry {
  return { ...base(opts), type: 'weight', payload: { value: kg, unit: 'kg', method: 'measured' }, unit: 'kg' };
}

export const male = (ageYears: number, heightCm?: number): CaseFacts => ({ ageYears, sex: 'M', ...(heightCm ? { heightCm } : {}) });
export const female = (ageYears: number, heightCm?: number): CaseFacts => ({ ageYears, sex: 'F', ...(heightCm ? { heightCm } : {}) });

export function ctx(demographics: CaseFacts, current: TimelineEntry[], pending?: PendingValue[]): GatherContext {
  return { demographics, current, ...(pending ? { pending } : {}) };
}

export const yesA = (value: boolean): Answer => ({ kind: 'boolean', value });
export const num = (value: number, unit: string): Answer => ({ kind: 'number', value, unit });
export const pick = (value: string): Answer => ({ kind: 'choice', value });
export const at = (day: number, time: string): Answer => ({ kind: 'time', day, time });

export function validated(def: CalculatorDef) {
  return makeCalculator(def, { validated: true, passed: 1, at: 'test' });
}

const env = { caseId: 'CASE-TEST', now: () => new Date('2026-10-17T12:00:00Z'), uuid: () => 'calc-1' };

export function attempt(def: CalculatorDef, c: GatherContext, req: GatherRequest = {}): RunOutcome {
  return run(validated(def), c, req, env);
}

export function ok(def: CalculatorDef, c: GatherContext, req: GatherRequest = {}): CalcResult {
  const r = attempt(def, c, req);
  if (!r.ok) throw new Error(`expected a result, got problems: ${JSON.stringify(r.problems)}`);
  return r.result;
}

export function refused(def: CalculatorDef, c: GatherContext, req: GatherRequest = {}): Problem[] {
  const r = attempt(def, c, req);
  if (r.ok) throw new Error(`expected a refusal, got ${r.result.value} ${r.result.unit}`);
  return r.problems;
}

/** The keys a refusal names, by kind. */
export function named(problems: Problem[], kind: Problem['kind']): string[] {
  return problems.filter((p) => p.kind === kind).map((p) => ('key' in p ? p.key : 'calculator'));
}

export function secondary(r: CalcResult, key: string): number {
  const s = r.secondary?.find((x) => x.key === key);
  if (!s) throw new Error(`no secondary value ${key}`);
  return s.value;
}

/** Relative closeness for floating-point results. */
export function close(actual: number, expected: number, tol = 1e-9): boolean {
  return Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected));
}

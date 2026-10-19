/**
 * The calculator contract (Section 9) and the calculation result (Section 7, CalcResult).
 *
 * Calculators are plain TypeScript: no network, no model. A formula is never
 * remembered by a language model; it is implemented here, documented and
 * unit-tested, and a calculator whose tests have not passed is hidden from
 * the interface (src/calc/registry.ts reads the validation manifest written
 * by the test run).
 */
import type { L } from '../domain/label';
import type { ProvenanceState, TimelineEntry, VitalKind } from '../domain/types';
import type { CalcReferences } from './gather';
import type { QuantityId } from './units';

export const CALCULATOR_IDS = [
  'crcl_cg',
  'egfr_ckdepi2021',
  'bsa_mosteller',
  'ibw_adjbw',
  'qtc_bazett',
  'qtc_fridericia',
  'anion_gap',
  'corrected_calcium',
  'phenytoin_corrected',
  'child_pugh',
  'curb65',
  'qsofa',
  'cha2ds2vasc',
  'has_bled',
  'anc',
  'vancomycin_auc',
  // Proposed seventeenth calculator (M2 plan, decision 5): form Section 1 needs BMI as a calculated value.
  'bmi',
  // Owner decision 9 (18 October 2026): infusion rates for Task 9, weight-based and volume over time.
  'infusion_rate_weight',
  'infusion_rate_volume',
  // Owner decision 6 (18 October 2026): vancomycin without levels, interval from the department's table.
  'vancomycin_empiric',
] as const;
export type CalculatorId = (typeof CALCULATOR_IDS)[number];

/** Where an input comes from. Timeline inputs keep the id of the entry they were read from. */
export type InputSourceSpec =
  | { kind: 'case'; field: 'ageYears' | 'sex' | 'heightCm' }
  | { kind: 'lab'; analytes: readonly string[] }
  | { kind: 'vital'; vital: VitalKind; part?: 'systolic' | 'diastolic' }
  | { kind: 'weight' }
  /** Answered by the trainee in the calculator (a finding from the chart, an ECG report value, a dosing time). */
  | { kind: 'answer' }
  /** Read from one of the trainee's reference tables by the calculator's `fromReference`, once the other inputs are valid. */
  | { kind: 'reference'; table: ReferenceTableId };

/** Reference tables a calculator can read. */
export type ReferenceTableId = 'vancomycin_interval';

export interface ChoiceOption {
  value: string;
  label: L;
  /** The number the formula uses for this choice (points, or 1/0). */
  points: number;
}

/** Non-numeric input kinds. `time` is minutes from 00:00 of hospital day 0, entered as a day and a clock time. */
export type InputKind = QuantityId | 'boolean' | 'choice' | 'sex' | 'time';

export interface InputSpec {
  key: string;
  label: L;
  kind: InputKind;
  source: InputSourceSpec;
  /** Physiologic plausibility, in the canonical unit: a value outside needs the trainee's confirmation. */
  plausible?: readonly [number, number];
  /** Definitional limits, in the canonical unit: a value outside is impossible and rejected. */
  limits?: readonly [number, number];
  integer?: boolean;
  options?: readonly ChoiceOption[];
  hint?: L;
  /** A timeline input that also needs the clock time it was taken (e.g. a drug level). */
  needsTime?: boolean;
  /** A timeline input the trainee must pick explicitly (no default to the most recent entry), e.g. each of two drug levels. */
  pickRequired?: boolean;
  /** Asked, and used, only when another input's answer is one of these (e.g. the AdjBW factor when AdjBW is chosen). */
  showIf?: { key: string; in: readonly string[] };
  /** A choice whose points are part of the score and are shown with the answer (Child–Pugh items). */
  showPoints?: boolean;
}

export type InputSource =
  | { kind: 'entry'; entryId: string; day: number; time?: string; provenance: ProvenanceState }
  | { kind: 'case'; field: 'ageYears' | 'sex' | 'heightCm' }
  | { kind: 'answer' }
  /** The record of a reference table that was used, at its version, with what it says and its source (kept in the result). */
  | { kind: 'reference'; table: ReferenceTableId; id: string; version: number; text: L; source: string };

export interface InputValue {
  key: string;
  /** In the canonical unit. Booleans are 1/0, a choice is its points, sex is 1 for female, a time is minutes. */
  value: number;
  unit: string;
  /** The value and unit as recorded, when a conversion took place. */
  recorded?: { value: number; unit: string; rule?: string };
  /** The chosen option of a choice input. */
  choice?: string;
  source: InputSource;
  /** The trainee confirmed a value outside the plausible range (the confirmation is recorded). */
  confirmedOutOfRange?: boolean;
}

export type CalcInputs = Readonly<Record<string, InputValue>>;

/** Why a calculation cannot run yet. Every problem names the input it is about. */
export type Problem =
  | { kind: 'missing'; key: string; detail?: L }
  /** A value still `extracted_unverified` (on the timeline, or read from a document and waiting for confirmation). */
  | { kind: 'unverified'; key: string; entryId?: string }
  | { kind: 'unit'; key: string; unit: string; accepted: readonly string[] }
  | { kind: 'invalid'; key: string; reason: L }
  | { kind: 'out_of_range'; key: string; value: number; unit: string; range: readonly [number, number] }
  | { kind: 'refused'; reason: L };

export interface CalcValidation {
  /** True when nothing blocks the calculation. */
  ok: boolean;
  problems: Problem[];
}

export interface SecondaryValue {
  key: string;
  label: L;
  value: number;
  unit: string;
  decimals: number;
}

export interface CalcOutput {
  value: number;
  unit: string;
  /** Decimals for display; the stored value keeps full precision. */
  decimals: number;
  secondary?: SecondaryValue[];
  category?: { value: string; label: L };
  assumptions: L[];
  warnings: L[];
  /** The formula with every value substituted, one line per step (clinical English). */
  steps: string[];
}

/**
 * A persisted result (Section 7). APPEND-ONLY: recomputation after new data
 * creates a new result and the old one remains readable.
 *
 * M2 extensions: `inputs.units` and `inputs.detail` (the unit and source of
 * every value, so the result explains itself without the timeline);
 * bilingual assumptions and warnings; `steps`, `secondary`, `category`;
 * `groupId` for calculators shown together (QTc Bazett and Fridericia).
 */
export interface CalcResult {
  id: string;
  caseId: string;
  calc: CalculatorId;
  formulaVersion: string;
  inputs: {
    entryIds: string[];
    values: Record<string, number>;
    units: Record<string, string>;
    detail: Record<string, InputValue>;
  };
  value: number;
  unit: string;
  decimals: number;
  secondary?: SecondaryValue[];
  category?: { value: string; label: L };
  assumptions: L[];
  warnings: L[];
  steps: string[];
  computedAt: string;
  /** The hospital day of the most recent timeline input. */
  day?: number;
  groupId?: string;
}

/** Everything about a calculator except whether it passed its tests. */
export interface CalculatorDef {
  id: CalculatorId;
  name: string;
  nameAr: string;
  /** What it is for, in one sentence. */
  purpose: L;
  formulaVersion: string;
  /** The published source of the formula. */
  citation: string;
  /** The formula as written in the source. */
  formula: string;
  requiredInputs: readonly InputSpec[];
  optionalInputs: readonly InputSpec[];
  /** Calculator-specific checks (ranges between inputs, populations it is not valid in). */
  check?: (inputs: CalcInputs) => Problem[];
  /**
   * The input read from a reference table (an input whose source is
   * `reference`), chosen with the other inputs once they are all valid — e.g.
   * the band of the department's table that the patient's creatinine
   * clearance falls in — or the problem that blocks it.
   */
  fromReference?: (inputs: CalcInputs, refs: CalcReferences) => { input: InputValue } | { problem: Problem };
  /** Warnings that need more of the record than the inputs (e.g. whether creatinine is stable). */
  contextWarnings?: (inputs: CalcInputs, current: readonly TimelineEntry[]) => L[];
  compute(inputs: CalcInputs): CalcOutput;
  /** When this calculator must not be used. */
  limitations: readonly L[];
  /** Always shown together with this calculator, never alone (QTc). */
  pairedWith?: CalculatorId;
  /** Vancomycin AUC and phenytoin correction: extended tests and an escalation message outside the validated range. */
  highRisk?: boolean;
}

export interface Calculator extends CalculatorDef {
  validate(inputs: CalcInputs): CalcValidation;
  explain(result: Pick<CalcResult, 'steps' | 'assumptions' | 'warnings' | 'value' | 'unit' | 'decimals'>): string;
  /** False ⇒ hidden in the interface, with the reason. */
  validated: boolean;
  validation: CalcValidationStatus;
}

export type CalcValidationStatus =
  | { validated: true; passed: number; at: string }
  | { validated: false; reason: 'not_tested' | 'tests_failed' | 'engine_changed' | 'formula_changed' | 'engine_tests_failed' };

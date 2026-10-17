/**
 * Running a calculator: gather → validate → compute → a CalcResult.
 *
 * A calculation is refused, with every blocking input named, when a
 * required input is absent, still unverified, in an unknown unit or outside
 * its definitional limits. A value outside the plausible range blocks until
 * the trainee confirms it (the confirmation is kept in the result). No result
 * is produced without its formula, substituted values, units and assumptions.
 */
import { L } from '../domain/label';
import { formatNumber } from '../domain/numbers';
import { gather, type GatherContext, type GatherRequest } from './gather';
import type {
  CalcInputs,
  CalcOutput,
  CalcResult,
  CalcValidation,
  CalcValidationStatus,
  Calculator,
  CalculatorDef,
  InputSpec,
  Problem,
} from './types';
import { round, show } from './units';

/** Range and presence checks every calculator shares; the calculator's own checks follow. */
export function validateInputs(def: CalculatorDef, inputs: CalcInputs): CalcValidation {
  const problems: Problem[] = [];
  const specs: InputSpec[] = [...def.requiredInputs, ...def.optionalInputs];
  for (const spec of def.requiredInputs) if (!inputs[spec.key]) problems.push({ kind: 'missing', key: spec.key });
  for (const spec of specs) {
    const v = inputs[spec.key];
    if (!v) continue;
    if (!Number.isFinite(v.value)) {
      problems.push({ kind: 'invalid', key: spec.key, reason: L('not a number', 'ليس رقماً') });
      continue;
    }
    if (spec.integer && !Number.isInteger(v.value)) {
      problems.push({ kind: 'invalid', key: spec.key, reason: L('must be a whole number', 'يجب أن يكون عدداً صحيحاً') });
      continue;
    }
    if (spec.limits && (v.value < spec.limits[0] || v.value > spec.limits[1])) {
      problems.push({
        kind: 'invalid',
        key: spec.key,
        reason: L(
          `${show(v.value, v.unit)} is outside ${formatNumber(spec.limits[0])}–${formatNumber(spec.limits[1])} ${v.unit}`,
          `${show(v.value, v.unit)} خارج النطاق ${formatNumber(spec.limits[0])}–${formatNumber(spec.limits[1])} ${v.unit}`,
        ),
      });
      continue;
    }
    if (spec.plausible && !v.confirmedOutOfRange && (v.value < spec.plausible[0] || v.value > spec.plausible[1])) {
      problems.push({ kind: 'out_of_range', key: spec.key, value: v.value, unit: v.unit, range: spec.plausible });
    }
  }
  if (problems.some((p) => p.kind === 'missing' || p.kind === 'invalid')) return { ok: false, problems };
  const own = def.check?.(inputs) ?? [];
  const all = [...problems, ...own];
  return { ok: all.length === 0, problems: all };
}

export function explainResult(
  def: Pick<CalculatorDef, 'name' | 'formula' | 'citation'>,
  r: Pick<CalcResult, 'steps' | 'assumptions' | 'warnings' | 'value' | 'unit' | 'decimals'>,
): string {
  const lines = [
    `${def.name}: ${show(r.value, r.unit, r.decimals)}`,
    `Formula: ${def.formula}`,
    ...r.steps.map((s) => `  ${s}`),
    ...(r.assumptions.length ? ['Assumptions:', ...r.assumptions.map((a) => `  - ${a.en}`)] : []),
    ...(r.warnings.length ? ['Warnings:', ...r.warnings.map((w) => `  - ${w.en}`)] : []),
    `Source: ${def.citation}`,
  ];
  return lines.join('\n');
}

export function makeCalculator(def: CalculatorDef, status: CalcValidationStatus): Calculator {
  return {
    ...def,
    validate: (inputs) => validateInputs(def, inputs),
    explain: (r) => explainResult(def, r),
    validated: status.validated,
    validation: status,
  };
}

export type RunOutcome =
  | { ok: true; result: CalcResult; inputs: CalcInputs; pendingKeys: string[] }
  | { ok: false; problems: Problem[]; inputs: CalcInputs; pendingKeys: string[] };

export interface RunEnv {
  caseId: string;
  now: () => Date;
  uuid: () => string;
  groupId?: string;
}

/** Inputs and problems for a calculator, before anything is computed (used to show the Verify gate). */
export function prepare(def: CalculatorDef, ctx: GatherContext, req: GatherRequest = {}) {
  const g = gather(def.requiredInputs, def.optionalInputs, ctx, req);
  const v = g.problems.length ? { ok: false, problems: [] as Problem[] } : validateInputs(def, g.inputs);
  const problems = [...g.problems, ...v.problems];
  return { inputs: g.inputs, problems, pendingKeys: g.pendingKeys };
}

function resultDay(inputs: CalcInputs): number | undefined {
  const days = Object.values(inputs)
    .map((v) => (v.source.kind === 'entry' ? v.source.day : undefined))
    .filter((d): d is number => d !== undefined);
  return days.length ? Math.max(...days) : undefined;
}

export function toResult(def: CalculatorDef, inputs: CalcInputs, out: CalcOutput, env: RunEnv): CalcResult {
  const values: Record<string, number> = {};
  const units: Record<string, string> = {};
  const entryIds: string[] = [];
  const assumptions = [...out.assumptions];
  const labels = new Map([...def.requiredInputs, ...def.optionalInputs].map((s) => [s.key, s.label]));
  for (const v of Object.values(inputs)) {
    values[v.key] = v.value;
    units[v.key] = v.unit;
    if (v.source.kind === 'entry' && !entryIds.includes(v.source.entryId)) entryIds.push(v.source.entryId);
    if (v.confirmedOutOfRange) {
      const shown = v.recorded ? show(v.recorded.value, v.recorded.unit, 4) : show(v.value, v.unit, 4);
      const label = labels.get(v.key) ?? L(v.key, v.key);
      assumptions.push(
        L(
          `${label.en}: ${shown} is outside the plausible range; confirmed by the trainee as correct.`,
          `${label.ar}: القيمة ${shown} خارج النطاق المعقول؛ أكّد المتدرب أنها صحيحة.`,
        ),
      );
    }
  }
  const day = resultDay(inputs);
  return {
    id: env.uuid(),
    caseId: env.caseId,
    calc: def.id,
    formulaVersion: def.formulaVersion,
    inputs: { entryIds, values, units, detail: { ...inputs } },
    value: out.value,
    unit: out.unit,
    decimals: out.decimals,
    ...(out.secondary?.length ? { secondary: out.secondary } : {}),
    ...(out.category ? { category: out.category } : {}),
    assumptions,
    warnings: out.warnings,
    steps: out.steps,
    computedAt: env.now().toISOString(),
    ...(day !== undefined ? { day } : {}),
    ...(env.groupId ? { groupId: env.groupId } : {}),
  };
}

/** Gather, validate and compute. Refuses (naming every problem) unless the calculator passed its tests. */
export function run(calc: Calculator, ctx: GatherContext, req: GatherRequest, env: RunEnv): RunOutcome {
  const p = prepare(calc, ctx, req);
  if (!calc.validated) {
    return {
      ok: false,
      problems: [{ kind: 'refused', reason: L('This calculator has not passed its tests and is disabled.', 'هذه الحاسبة لم تجتز اختباراتها وهي معطّلة.') }],
      inputs: p.inputs,
      pendingKeys: p.pendingKeys,
    };
  }
  if (p.problems.length) return { ok: false, problems: p.problems, inputs: p.inputs, pendingKeys: p.pendingKeys };
  const computed = calc.compute(p.inputs);
  const extra = calc.contextWarnings?.(p.inputs, ctx.current) ?? [];
  const out = extra.length ? { ...computed, warnings: [...computed.warnings, ...extra] } : computed;
  if (!Number.isFinite(out.value)) {
    return {
      ok: false,
      problems: [{ kind: 'refused', reason: L('The inputs do not give a finite result.', 'المدخلات لا تعطي نتيجة محددة.') }],
      inputs: p.inputs,
      pendingKeys: p.pendingKeys,
    };
  }
  return { ok: true, result: toResult(calc, p.inputs, out, env), inputs: p.inputs, pendingKeys: p.pendingKeys };
}

/** Shorthand used by calculators to write a step: "name = value unit". */
export function step(name: string, value: number, unit: string, decimals = 2): string {
  return `${name} = ${show(round(value, decimals), unit, decimals)}`;
}

/** Small helpers shared by the calculator definitions. */
import { L } from '../../domain/label';
import type { CalcInputs, InputValue, Problem } from '../types';
import { show } from '../units';

export const val = (inputs: CalcInputs, key: string): number => inputs[key]!.value;
export const has = (inputs: CalcInputs, key: string): boolean => inputs[key] !== undefined;
export const yes = (inputs: CalcInputs, key: string): boolean => inputs[key]?.value === 1;
export const isFemale = (inputs: CalcInputs): boolean => inputs.sex?.value === 1;

/** "1.2 mg/dL", with the recorded value and conversion when one was made. */
export function valueText(v: InputValue, decimals = 2): string {
  const main = show(v.value, v.unit, decimals);
  if (!v.recorded || v.recorded.unit === v.unit) return main;
  return `${main} (recorded ${show(v.recorded.value, v.recorded.unit, 4)}${v.recorded.rule ? `, ${v.recorded.rule}` : ''})`;
}

/** "SCr = 1.2 mg/dL", with the recorded value and conversion when one was made. */
export function given(name: string, v: InputValue, decimals = 2): string {
  return `${name} = ${valueText(v, decimals)}`;
}

/** Where a value came from, for an explanation line. */
export function whence(v: InputValue): string {
  const s = v.source;
  if (s.kind === 'entry') return `Day ${s.day}${s.time ? ` ${s.time}` : ''}`;
  if (s.kind === 'case') return 'case record';
  return 'answered in the calculator';
}

/** Adult-only formulas refuse patients under 18 instead of extrapolating. */
export function adultsOnly(inputs: CalcInputs, name: string): Problem[] {
  return inputs.age && inputs.age.value < 18
    ? [
        {
          kind: 'refused',
          reason: L(
            `${name} is validated in adults only (18 years or older). It is not used for younger patients.`,
            `معادلة ${name} مُعتمدة للبالغين فقط (18 سنة فأكثر)، ولا تُستخدم لمن هم أصغر.`,
          ),
        },
      ]
    : [];
}

/**
 * A warning when laboratory inputs that should come from one sample come from
 * different days or clock times.
 */
export function sameSample(inputs: CalcInputs, keys: readonly string[]): L | undefined {
  const stamps = keys
    .map((k) => inputs[k]?.source)
    .filter((s): s is Extract<InputValue['source'], { kind: 'entry' }> => s?.kind === 'entry')
    .map((s) => `Day ${s.day}${s.time ? ` ${s.time}` : ''}`);
  const distinct = [...new Set(stamps)];
  if (distinct.length <= 1) return undefined;
  return L(
    `The values come from different samples (${distinct.join(', ')}). The formula assumes one sample; values drawn at different times may not belong together.`,
    `القيم مأخوذة من عينات مختلفة (${distinct.join('، ')}). تفترض المعادلة عينة واحدة؛ والقيم المسحوبة في أوقات مختلفة قد لا تتوافق.`,
  );
}

export function entryIdOf(inputs: CalcInputs, key: string): string | undefined {
  const s = inputs[key]?.source;
  return s?.kind === 'entry' ? s.entryId : undefined;
}

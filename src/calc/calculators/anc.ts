/** Absolute neutrophil count from the white cell count and the differential. */
import { L } from '../../domain/label';
import { step } from '../engine';
import { BANDS_PCT, NEUT_PCT, WBC } from '../inputs';
import type { CalculatorDef, Problem } from '../types';
import { show } from '../units';
import { given, has, sameSample, val } from './common';

export const anc: CalculatorDef = {
  id: 'anc',
  name: 'Absolute neutrophil count (ANC)',
  nameAr: 'العدد المطلق للعدلات',
  purpose: L('Neutrophils per volume of blood, from the WBC and the differential.', 'عدد العدلات في حجم الدم، من عدد الكريات البيض والصيغة التفريقية.'),
  formulaVersion: '1',
  citation: 'ANC = WBC × (segmented neutrophils % + band neutrophils %) ÷ 100 (standard haematology definition).',
  formula: 'ANC (×10⁹/L) = WBC (×10⁹/L) × (neutrophils % + bands %) ÷ 100',
  requiredInputs: [WBC, NEUT_PCT],
  optionalInputs: [BANDS_PCT],
  check(inputs): Problem[] {
    const total = val(inputs, 'neutPct') + (has(inputs, 'bandsPct') ? val(inputs, 'bandsPct') : 0);
    return total > 100
      ? [{ kind: 'invalid', key: 'bandsPct', reason: L('neutrophils % and bands % add up to more than 100%', 'مجموع نسبة العدلات والشريطية يتجاوز 100%') }]
      : [];
  },
  compute(inputs) {
    const wbc = val(inputs, 'wbc');
    const neut = val(inputs, 'neutPct');
    const bands = has(inputs, 'bandsPct') ? val(inputs, 'bandsPct') : 0;
    const value = (wbc * (neut + bands)) / 100;
    const assumptions: L[] = [];
    if (!has(inputs, 'bandsPct'))
      assumptions.push(
        L('No band count recorded: the result includes segmented neutrophils only.', 'لا يوجد عدّ للعدلات الشريطية: النتيجة تشمل العدلات المقطعة فقط.'),
      );
    const warnings: L[] = [];
    const sample = sameSample(inputs, ['wbc', 'neutPct', 'bandsPct']);
    if (sample) warnings.push(sample);
    return {
      value,
      unit: '×10⁹/L',
      decimals: 2,
      secondary: [{ key: 'perUl', label: L('ANC in cells/µL', 'العدد المطلق بوحدة خلية/ميكرولتر'), value: value * 1000, unit: 'cells/µL', decimals: 0 }],
      assumptions,
      warnings,
      steps: [
        given('WBC', inputs.wbc!),
        `Neutrophils = ${show(neut, '%', 1)}${has(inputs, 'bandsPct') ? `; bands = ${show(bands, '%', 1)}` : ''}`,
        step(`ANC = ${show(wbc, '', 2)} × (${show(neut, '', 1)}${has(inputs, 'bandsPct') ? ` + ${show(bands, '', 1)}` : ''}) ÷ 100`, value, '×10⁹/L', 2),
      ],
    };
  },
  limitations: [
    L(
      'If the laboratory’s neutrophil percentage already includes band forms, do not enter bands separately.',
      'إذا كانت نسبة العدلات في المختبر تشمل العدلات الشريطية، فلا تُدخل الشريطية مرة أخرى.',
    ),
    L('Use the WBC and differential from the same sample.', 'استخدم عدد الكريات البيض والصيغة التفريقية من العينة نفسها.'),
  ],
};

/**
 * Body size: BMI (proposed seventeenth calculator, M2 plan decision 5), body
 * surface area (Mosteller) and ideal and adjusted body weight (Devine).
 */
import { L } from '../../domain/label';
import { step } from '../engine';
import { HEIGHT, SEX, WEIGHT, AGE } from '../inputs';
import type { CalcInputs, CalculatorDef, InputSpec } from '../types';
import { CM_PER_IN, show } from '../units';
import { adultsOnly, given, isFemale, val } from './common';

export const ADJ_FACTOR: InputSpec = {
  key: 'adjFactor',
  label: L('Adjustment factor for adjusted body weight', 'معامل التعديل لوزن الجسم المعدَّل'),
  kind: 'factor',
  source: { kind: 'answer' },
  limits: [0.01, 1],
  plausible: [0.2, 0.5],
  hint: L(
    'The factor your reference uses for this drug — commonly 0.4. It is recorded with the result.',
    'المعامل الذي يستخدمه مرجعك لهذا الدواء — غالباً 0.4. يُسجَّل مع النتيجة.',
  ),
};

/** Devine ideal body weight in kg. Defined for heights of 5 feet (152.4 cm) and above. */
export function devineIbw(heightCm: number, female: boolean): number {
  const inches = heightCm / CM_PER_IN;
  return (female ? 45.5 : 50) + 2.3 * (inches - 60);
}

export const DEVINE_CITATION = 'Devine BJ. Gentamicin therapy. Drug Intell Clin Pharm 1974;8:650–655.';

export const SHORT_STATURE_WARNING = L(
  'Height is under 152.4 cm (5 feet). The Devine formula is defined from 5 feet upwards; below it the result is an extrapolation.',
  'الطول أقل من 152.4 سم (5 أقدام). معادلة Devine معرّفة ابتداءً من 5 أقدام؛ وما دونها استقراء غير مؤكد.',
);

export function devineSteps(heightCm: number, female: boolean): string[] {
  const inches = heightCm / CM_PER_IN;
  const ibw = devineIbw(heightCm, female);
  return [
    `Height in inches = ${show(heightCm, 'cm')} ÷ 2.54 = ${show(inches, 'in')}`,
    `IBW (Devine, ${female ? 'female' : 'male'}) = ${female ? '45.5' : '50'} + 2.3 × (${show(inches, '', 2)} − 60) = ${show(ibw, 'kg', 1)}`,
  ];
}

export const bmi: CalculatorDef = {
  id: 'bmi',
  name: 'Body mass index (BMI)',
  nameAr: 'مؤشر كتلة الجسم',
  purpose: L('Weight relative to height; form Section 1 asks for it.', 'الوزن نسبةً إلى الطول؛ يطلبه القسم 1 من النموذج.'),
  formulaVersion: '1',
  citation:
    'Quetelet index. Adult categories: World Health Organization. Obesity: preventing and managing the global epidemic. WHO Technical Report Series 894. Geneva: WHO; 2000.',
  formula: 'BMI = weight (kg) ÷ height (m)²',
  requiredInputs: [WEIGHT, HEIGHT],
  optionalInputs: [AGE],
  compute(inputs: CalcInputs) {
    const kg = val(inputs, 'weight');
    const m = val(inputs, 'height') / 100;
    const value = kg / (m * m);
    const adult = !inputs.age || inputs.age.value >= 18;
    const category = !adult
      ? undefined
      : value < 18.5
        ? { value: 'underweight', label: L('Underweight (< 18.5)', 'نقص الوزن (أقل من 18.5)') }
        : value < 25
          ? { value: 'normal', label: L('Normal range (18.5–24.9)', 'المدى الطبيعي (18.5–24.9)') }
          : value < 30
            ? { value: 'overweight', label: L('Overweight (25–29.9)', 'زيادة الوزن (25–29.9)') }
            : { value: 'obese', label: L('Obesity (≥ 30)', 'السمنة (30 فأكثر)') };
    return {
      value,
      unit: 'kg/m²',
      decimals: 1,
      ...(category ? { category } : {}),
      assumptions: [],
      warnings: adult
        ? []
        : [L('Adult BMI categories do not apply under 18 years; use BMI-for-age charts.', 'تصنيفات مؤشر كتلة الجسم للبالغين لا تنطبق تحت 18 سنة؛ استخدم مخططات المؤشر حسب العمر.')],
      steps: [
        given('Weight', inputs.weight!),
        `Height = ${show(val(inputs, 'height'), 'cm')} = ${show(m, 'm', 3)}`,
        step(`BMI = ${show(kg, 'kg')} ÷ (${show(m, 'm', 3)})²`, value, 'kg/m²', 1),
      ],
    };
  },
  limitations: [
    L(
      'BMI does not distinguish fat from muscle or fluid; oedema and ascites raise it.',
      'لا يميز مؤشر كتلة الجسم بين الدهون والعضلات والسوائل؛ الوذمة والاستسقاء ترفعانه.',
    ),
    L('Adult categories only; not for children or pregnancy.', 'تصنيفات للبالغين فقط؛ لا تنطبق على الأطفال أو الحمل.'),
  ],
};

export const bsaMosteller: CalculatorDef = {
  id: 'bsa_mosteller',
  name: 'Body surface area (Mosteller)',
  nameAr: 'مساحة سطح الجسم (Mosteller)',
  purpose: L('Body surface area for drugs dosed per m².', 'مساحة سطح الجسم للأدوية التي تُحسب جرعتها لكل متر مربع.'),
  formulaVersion: '1',
  citation: 'Mosteller RD. Simplified calculation of body-surface area. N Engl J Med 1987;317(17):1098.',
  formula: 'BSA (m²) = √(height (cm) × weight (kg) ÷ 3600)',
  requiredInputs: [HEIGHT, WEIGHT],
  optionalInputs: [],
  compute(inputs) {
    const cm = val(inputs, 'height');
    const kg = val(inputs, 'weight');
    const value = Math.sqrt((cm * kg) / 3600);
    return {
      value,
      unit: 'm²',
      decimals: 2,
      assumptions: [],
      warnings: [],
      steps: [
        `Height = ${show(cm, 'cm')}`,
        given('Weight', inputs.weight!),
        step(`BSA = √(${show(cm, '', 2)} × ${show(kg, '', 2)} ÷ 3600)`, value, 'm²', 2),
      ],
    };
  },
  limitations: [
    L(
      'Uses total body weight. Whether to cap or adjust BSA in obesity depends on the drug and its protocol.',
      'تستخدم وزن الجسم الكلي. تحديد سقف لمساحة سطح الجسم أو تعديلها في السمنة يعتمد على الدواء وبروتوكوله.',
    ),
  ],
};

export const ibwAdjbw: CalculatorDef = {
  id: 'ibw_adjbw',
  name: 'Ideal and adjusted body weight (Devine)',
  nameAr: 'وزن الجسم المثالي والمعدَّل (Devine)',
  purpose: L('Weights used by many dosing references instead of total body weight.', 'أوزان تستخدمها مراجع كثيرة للجرعات بدلاً من وزن الجسم الكلي.'),
  formulaVersion: '1',
  citation: `${DEVINE_CITATION} Adjusted body weight = IBW + factor × (TBW − IBW), with the factor of the reference in use.`,
  formula: 'IBW = 50 kg (male) or 45.5 kg (female) + 2.3 kg × (height in inches − 60); AdjBW = IBW + factor × (TBW − IBW)',
  requiredInputs: [AGE, SEX, HEIGHT, WEIGHT, ADJ_FACTOR],
  optionalInputs: [],
  check: (inputs) => adultsOnly(inputs, 'Devine'),
  compute(inputs) {
    const female = isFemale(inputs);
    const cm = val(inputs, 'height');
    const tbw = val(inputs, 'weight');
    const f = val(inputs, 'adjFactor');
    const ibw = devineIbw(cm, female);
    const adj = ibw + f * (tbw - ibw);
    const pct = (tbw / ibw) * 100;
    const warnings: L[] = [];
    if (cm < 152.4) warnings.push(SHORT_STATURE_WARNING);
    if (tbw <= ibw)
      warnings.push(
        L(
          'Total body weight is not above IBW, so adjusted body weight is not meaningful; references usually use total body weight then.',
          'وزن الجسم الكلي لا يزيد على الوزن المثالي، لذا لا معنى للوزن المعدَّل؛ وتستخدم المراجع عادةً الوزن الكلي في هذه الحالة.',
        ),
      );
    return {
      value: ibw,
      unit: 'kg',
      decimals: 1,
      secondary: [
        { key: 'adjbw', label: L('Adjusted body weight', 'وزن الجسم المعدَّل'), value: adj, unit: 'kg', decimals: 1 },
        { key: 'pctIbw', label: L('Total body weight as % of IBW', 'الوزن الكلي كنسبة من الوزن المثالي'), value: pct, unit: '%', decimals: 0 },
      ],
      assumptions: [
        L(`Adjustment factor ${show(f, '', 2)}, entered by the trainee.`, `معامل التعديل ${show(f, '', 2)}، أدخله المتدرب.`),
        L(`Sex: ${female ? 'female' : 'male'} (case record).`, `الجنس: ${female ? 'أنثى' : 'ذكر'} (سجل الحالة).`),
      ],
      warnings,
      steps: [
        ...devineSteps(cm, female),
        given('TBW', inputs.weight!),
        step(`AdjBW = ${show(ibw, '', 1)} + ${show(f, '', 2)} × (${show(tbw, '', 1)} − ${show(ibw, '', 1)})`, adj, 'kg', 1),
        step(`TBW ÷ IBW = ${show(tbw, '', 1)} ÷ ${show(ibw, '', 1)} × 100`, pct, '%', 0),
      ],
    };
  },
  limitations: [
    L(
      'Which weight a drug is dosed on, and which adjustment factor, comes from the drug’s reference — not from this calculator.',
      'الوزن الذي تُحسب عليه جرعة الدواء ومعامل التعديل يحددهما مرجع الدواء — لا هذه الحاسبة.',
    ),
    L('Not for children: the Devine formula is for adults.', 'لا تُستخدم للأطفال: معادلة Devine للبالغين.'),
  ],
};

/** Anion gap with albumin correction, and calcium corrected for albumin. */
import { L } from '../../domain/label';
import { step } from '../engine';
import { ALBUMIN, BICARBONATE, CALCIUM, CHLORIDE, SODIUM } from '../inputs';
import type { CalculatorDef } from '../types';
import { CALCIUM_MGDL_PER_MMOL, show } from '../units';
import { given, has, sameSample, val } from './common';

export const anionGap: CalculatorDef = {
  id: 'anion_gap',
  name: 'Anion gap (with albumin correction)',
  nameAr: 'الفجوة الأنيونية (مع تصحيح الألبومين)',
  purpose: L(
    'Unmeasured anions, to help classify a metabolic acidosis; corrected for a low albumin.',
    'الأنيونات غير المقاسة، للمساعدة في تصنيف الحماض الاستقلابي؛ مع التصحيح لانخفاض الألبومين.',
  ),
  formulaVersion: '1',
  citation:
    'Anion gap = Na − (Cl + HCO₃). Albumin correction: Figge J, Jabor A, Kazda A, Fencl V. Anion gap and hypoalbuminemia. Crit Care Med 1998;26(11):1807–1810.',
  formula: 'AG = Na − (Cl + HCO₃); albumin-corrected AG = AG + 2.5 × (4.0 − albumin (g/dL))',
  requiredInputs: [SODIUM, CHLORIDE, BICARBONATE],
  optionalInputs: [ALBUMIN],
  compute(inputs) {
    const na = val(inputs, 'na');
    const cl = val(inputs, 'cl');
    const hco3 = val(inputs, 'hco3');
    const value = na - (cl + hco3);
    const steps = [
      given('Na', inputs.na!, 1),
      given('Cl', inputs.cl!, 1),
      given('HCO₃', inputs.hco3!, 1),
      step(`AG = ${show(na, '', 1)} − (${show(cl, '', 1)} + ${show(hco3, '', 1)})`, value, 'mmol/L', 1),
    ];
    const warnings: L[] = [];
    const assumptions = [L('Potassium is not included in this form of the anion gap.', 'لا يدخل البوتاسيوم في هذه الصيغة من الفجوة الأنيونية.')];
    const secondary = [];
    if (has(inputs, 'albumin')) {
      const alb = val(inputs, 'albumin');
      const corrected = value + 2.5 * (4.0 - alb);
      steps.push(given('Albumin', inputs.albumin!, 2));
      steps.push(step(`Corrected AG = ${show(value, '', 1)} + 2.5 × (4.0 − ${show(alb, '', 2)})`, corrected, 'mmol/L', 1));
      secondary.push({ key: 'agCorrected', label: L('Albumin-corrected anion gap', 'الفجوة الأنيونية المصححة للألبومين'), value: corrected, unit: 'mmol/L', decimals: 1 });
      assumptions.push(L('Normal albumin taken as 4.0 g/dL, as in the correction formula.', 'اعتُبر الألبومين الطبيعي 4.0 g/dL كما في معادلة التصحيح.'));
    } else {
      warnings.push(
        L(
          'No albumin recorded: the gap is not corrected. A low albumin lowers the gap and can hide a raised one.',
          'لا يوجد ألبومين مسجل: لم تُصحَّح الفجوة. انخفاض الألبومين يخفض الفجوة وقد يخفي ارتفاعها.',
        ),
      );
    }
    const sample = sameSample(inputs, ['na', 'cl', 'hco3', 'albumin']);
    if (sample) warnings.push(sample);
    return { value, unit: 'mmol/L', decimals: 1, ...(secondary.length ? { secondary } : {}), assumptions, warnings, steps };
  },
  limitations: [
    L(
      'The normal range depends on the laboratory’s analyser; interpret against your laboratory’s range.',
      'يعتمد المدى الطبيعي على جهاز المختبر؛ فسّرها وفق مدى مختبرك.',
    ),
    L('A gap does not identify the cause; the clinical picture does.', 'الفجوة لا تحدد السبب؛ الصورة السريرية هي التي تحدده.'),
  ],
};

export const correctedCalcium: CalculatorDef = {
  id: 'corrected_calcium',
  name: 'Calcium corrected for albumin',
  nameAr: 'الكالسيوم المصحح للألبومين',
  purpose: L('Total calcium adjusted for a low or high albumin.', 'الكالسيوم الكلي معدّلاً لانخفاض الألبومين أو ارتفاعه.'),
  formulaVersion: '1',
  citation:
    'Payne RB, Little AJ, Williams RB, Milner JR. Interpretation of serum calcium in patients with abnormal serum proteins. Br Med J 1973;4(5893):643–646.',
  formula: 'Corrected Ca (mg/dL) = Ca (mg/dL) + 0.8 × (4.0 − albumin (g/dL))  [equivalent: Ca (mmol/L) + 0.02 × (40 − albumin (g/L))]',
  requiredInputs: [CALCIUM, ALBUMIN],
  optionalInputs: [],
  compute(inputs) {
    const ca = val(inputs, 'calcium');
    const alb = val(inputs, 'albumin');
    const value = ca + 0.8 * (4.0 - alb);
    const mmol = value / CALCIUM_MGDL_PER_MMOL;
    const warnings: L[] = [];
    const sample = sameSample(inputs, ['calcium', 'albumin']);
    if (sample) warnings.push(sample);
    return {
      value,
      unit: 'mg/dL',
      decimals: 1,
      secondary: [{ key: 'mmol', label: L('Corrected calcium in mmol/L', 'الكالسيوم المصحح بوحدة mmol/L'), value: mmol, unit: 'mmol/L', decimals: 2 }],
      assumptions: [L('Normal albumin taken as 4.0 g/dL, as in the formula.', 'اعتُبر الألبومين الطبيعي 4.0 g/dL كما في المعادلة.')],
      warnings,
      steps: [
        given('Calcium', inputs.calcium!, 2),
        given('Albumin', inputs.albumin!, 2),
        step(`Corrected Ca = ${show(ca, '', 2)} + 0.8 × (4.0 − ${show(alb, '', 2)})`, value, 'mg/dL', 2),
        step(`In mmol/L = ${show(value, '', 2)} ÷ ${CALCIUM_MGDL_PER_MMOL}`, mmol, 'mmol/L', 2),
      ],
    };
  },
  limitations: [
    L(
      'Agrees poorly with measured ionised calcium, especially in critical illness and kidney disease. Where ionised calcium can be measured, use it.',
      'يتوافق بشكل ضعيف مع الكالسيوم المتأين المقاس، خاصة في الحالات الحرجة وأمراض الكلى. حين يمكن قياس الكالسيوم المتأين فاعتمد عليه.',
    ),
    L(
      'Laboratories that use a different albumin method may use a local correction.',
      'المختبرات التي تستخدم طريقة مختلفة لقياس الألبومين قد تعتمد تصحيحاً محلياً.',
    ),
  ],
};

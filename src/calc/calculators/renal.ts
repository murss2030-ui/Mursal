/**
 * Kidney function: creatinine clearance by Cockcroft–Gault (for drug dosing,
 * where the drug's reference uses it) and eGFR by CKD-EPI 2021 (a staging
 * tool). The two are never interchangeable and neither is ever substituted
 * for the other (Section 9).
 */
import { L } from '../../domain/label';
import { step } from '../engine';
import { AGE, HEIGHT, SCR, SEX, WEIGHT } from '../inputs';
import { scrStabilityWarnings } from '../kdigo';
import type { CalcInputs, CalculatorDef, InputSpec, Problem } from '../types';
import { show } from '../units';
import { ADJ_FACTOR, DEVINE_CITATION, SHORT_STATURE_WARNING, devineIbw, devineSteps } from './body';
import { adultsOnly, entryIdOf, given, isFemale, val } from './common';

export const WEIGHT_BASIS: InputSpec = {
  key: 'weightBasis',
  label: L('Weight used in the formula', 'الوزن المستخدم في المعادلة'),
  kind: 'choice',
  source: { kind: 'answer' },
  options: [
    { value: 'tbw', label: L('Total body weight (TBW)', 'وزن الجسم الكلي (TBW)'), points: 0 },
    { value: 'ibw', label: L('Ideal body weight (IBW, Devine)', 'وزن الجسم المثالي (IBW، Devine)'), points: 1 },
    { value: 'adjbw', label: L('Adjusted body weight (AdjBW)', 'وزن الجسم المعدَّل (AdjBW)'), points: 2 },
  ],
  hint: L(
    'Choose the weight your dosing reference uses. Your choice is recorded with the result.',
    'اختر الوزن الذي يستخدمه مرجع الجرعات. يُسجَّل اختيارك مع النتيجة.',
  ),
};

const OPTIONAL_HEIGHT: InputSpec = { ...HEIGHT };
const OPTIONAL_FACTOR: InputSpec = { ...ADJ_FACTOR };

function cgCheck(inputs: CalcInputs): Problem[] {
  const problems: Problem[] = [...adultsOnly(inputs, 'Cockcroft–Gault')];
  const basis = inputs.weightBasis?.choice;
  if ((basis === 'ibw' || basis === 'adjbw') && !inputs.height) {
    problems.push({ kind: 'missing', key: 'height', detail: L('needed for ideal body weight', 'لازم لحساب الوزن المثالي') });
  }
  if (basis === 'adjbw' && !inputs.adjFactor) {
    problems.push({ kind: 'missing', key: 'adjFactor', detail: L('needed for adjusted body weight', 'لازم لحساب الوزن المعدَّل') });
  }
  return problems;
}

export const crclCg: CalculatorDef = {
  id: 'crcl_cg',
  name: 'Creatinine clearance (Cockcroft–Gault)',
  nameAr: 'تصفية الكرياتينين (Cockcroft–Gault)',
  purpose: L(
    'Estimated creatinine clearance, used for drug dosing where the drug’s reference uses it.',
    'تقدير تصفية الكرياتينين، ويُستخدم لتحديد الجرعات حين يعتمده مرجع الدواء.',
  ),
  formulaVersion: '1',
  citation: `Cockcroft DW, Gault MH. Prediction of creatinine clearance from serum creatinine. Nephron 1976;16(1):31–41. Ideal body weight: ${DEVINE_CITATION}`,
  formula: 'CrCl (mL/min) = (140 − age) × weight (kg) ÷ (72 × SCr (mg/dL)), × 0.85 if female',
  requiredInputs: [AGE, SEX, WEIGHT, SCR, WEIGHT_BASIS],
  optionalInputs: [OPTIONAL_HEIGHT, OPTIONAL_FACTOR],
  check: cgCheck,
  contextWarnings: (inputs, current) => scrStabilityWarnings(entryIdOf(inputs, 'scr'), current),
  compute(inputs) {
    const age = val(inputs, 'age');
    const female = isFemale(inputs);
    const tbw = val(inputs, 'weight');
    const scr = val(inputs, 'scr');
    const basis = inputs.weightBasis!.choice as 'tbw' | 'ibw' | 'adjbw';
    const steps: string[] = [given('Weight (TBW)', inputs.weight!)];
    const warnings: L[] = [];
    const assumptions: L[] = [];
    let weight = tbw;
    let ibw: number | undefined;
    if (basis !== 'tbw' || inputs.height) {
      const cm = val(inputs, 'height');
      ibw = devineIbw(cm, female);
      if (basis !== 'tbw') {
        steps.push(...devineSteps(cm, female));
        if (cm < 152.4) warnings.push(SHORT_STATURE_WARNING);
      }
    }
    if (basis === 'ibw') {
      weight = ibw!;
      assumptions.push(L('Ideal body weight (Devine) used, as chosen by the trainee.', 'استُخدم وزن الجسم المثالي (Devine) باختيار المتدرب.'));
      if (tbw < ibw!)
        warnings.push(
          L(
            'Total body weight is below ideal body weight; references usually use total body weight in that case.',
            'وزن الجسم الكلي أقل من الوزن المثالي؛ وتستخدم المراجع عادةً الوزن الكلي في هذه الحالة.',
          ),
        );
    } else if (basis === 'adjbw') {
      const f = val(inputs, 'adjFactor');
      weight = ibw! + f * (tbw - ibw!);
      steps.push(step(`AdjBW = ${show(ibw!, '', 1)} + ${show(f, '', 2)} × (${show(tbw, '', 1)} − ${show(ibw!, '', 1)})`, weight, 'kg', 1));
      assumptions.push(
        L(
          `Adjusted body weight used, with factor ${show(f, '', 2)}, as chosen by the trainee.`,
          `استُخدم وزن الجسم المعدَّل بمعامل ${show(f, '', 2)} باختيار المتدرب.`,
        ),
      );
    } else {
      assumptions.push(L('Total body weight used, as chosen by the trainee.', 'استُخدم وزن الجسم الكلي باختيار المتدرب.'));
    }
    steps.push(given('SCr', inputs.scr!));
    const male = ((140 - age) * weight) / (72 * scr);
    const value = female ? male * 0.85 : male;
    steps.push(
      step(
        `CrCl = (140 − ${show(age, '', 0)}) × ${show(weight, '', 1)} ÷ (72 × ${show(scr, '', 2)})${female ? ' × 0.85' : ''}`,
        value,
        'mL/min',
        1,
      ),
    );
    assumptions.push(L(`Sex: ${female ? 'female (× 0.85)' : 'male'} (case record).`, `الجنس: ${female ? 'أنثى (× 0.85)' : 'ذكر'} (سجل الحالة).`));
    if (age > 92)
      warnings.push(
        L(
          'Age is above the range of the original study population (18–92 years).',
          'العمر أعلى من نطاق المجموعة التي اشتُقت منها المعادلة (18–92 سنة).',
        ),
      );
    if (inputs.height) {
      const m = val(inputs, 'height') / 100;
      const bmi = tbw / (m * m);
      if (bmi >= 30)
        warnings.push(
          L(
            `BMI is ${show(bmi, '', 1)} kg/m² (obesity): total body weight overestimates creatinine clearance; the choice of weight changes the result substantially.`,
            `مؤشر كتلة الجسم ${show(bmi, '', 1)} (سمنة): وزن الجسم الكلي يبالغ في تقدير التصفية؛ واختيار الوزن يغيّر النتيجة كثيراً.`,
          ),
        );
      else if (bmi < 18.5)
        warnings.push(
          L(
            `BMI is ${show(bmi, '', 1)} kg/m² (underweight): low muscle mass makes the estimate less reliable.`,
            `مؤشر كتلة الجسم ${show(bmi, '', 1)} (نقص وزن): قلة الكتلة العضلية تجعل التقدير أقل موثوقية.`,
          ),
        );
    } else {
      warnings.push(
        L(
          'Height is not recorded, so extremes of body weight (obesity, underweight) could not be checked.',
          'الطول غير مسجل، فلم يمكن التحقق من تطرف الوزن (السمنة أو النحافة).',
        ),
      );
    }
    return { value, unit: 'mL/min', decimals: 0, assumptions, warnings, steps };
  },
  limitations: [
    L(
      'Assumes stable creatinine; unreliable in acute kidney injury and in patients on dialysis.',
      'تفترض ثبات الكرياتينين؛ ولا يُعتمد عليها في الإصابة الكلوية الحادة ولا لدى مرضى الغسيل الكلوي.',
    ),
    L(
      'Derived in adult men; the 0.85 factor for women was an assumption of the authors.',
      'اشتُقت لدى رجال بالغين؛ ومعامل 0.85 للنساء افتراض من المؤلفَين.',
    ),
    L(
      'Low muscle mass (older age, malnutrition, amputation) can make creatinine low and the estimate high. Do not round creatinine up automatically — follow your reference.',
      'قلة الكتلة العضلية (التقدم في السن، سوء التغذية، البتر) قد تخفض الكرياتينين وترفع التقدير. لا تقرّب الكرياتينين تلقائياً — اتبع مرجعك.',
    ),
    L(
      'Not the same as eGFR: do not substitute one for the other in drug dosing.',
      'ليست مثل eGFR: لا تستبدل إحداهما بالأخرى في تحديد الجرعات.',
    ),
  ],
};

export const egfrCkdEpi2021: CalculatorDef = {
  id: 'egfr_ckdepi2021',
  name: 'eGFR (CKD-EPI 2021, creatinine)',
  nameAr: 'معدل الترشيح الكبيبي المقدَّر (CKD-EPI 2021)',
  purpose: L(
    'Estimated GFR for staging kidney function. A staging tool — not interchangeable with CrCl for drug dosing.',
    'تقدير معدل الترشيح الكبيبي لتصنيف مراحل وظيفة الكلى. أداة تصنيف — لا تحل محل CrCl في تحديد الجرعات.',
  ),
  formulaVersion: '1',
  citation:
    'Inker LA, Eneanya ND, Coresh J, et al. New creatinine- and cystatin C–based equations to estimate GFR without race. N Engl J Med 2021;385(19):1737–1749.',
  formula:
    'eGFR = 142 × min(SCr/κ, 1)^α × max(SCr/κ, 1)^−1.200 × 0.9938^age × 1.012 (if female); κ = 0.7 (female) or 0.9 (male); α = −0.241 (female) or −0.302 (male); SCr in mg/dL',
  requiredInputs: [AGE, SEX, SCR],
  optionalInputs: [],
  check: (inputs) => adultsOnly(inputs, 'CKD-EPI 2021'),
  contextWarnings: (inputs, current) => scrStabilityWarnings(entryIdOf(inputs, 'scr'), current),
  compute(inputs) {
    const age = val(inputs, 'age');
    const female = isFemale(inputs);
    const scr = val(inputs, 'scr');
    const k = female ? 0.7 : 0.9;
    const a = female ? -0.241 : -0.302;
    const r = scr / k;
    const value = 142 * Math.min(r, 1) ** a * Math.max(r, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1);
    return {
      value,
      unit: 'mL/min/1.73 m²',
      decimals: 0,
      assumptions: [
        L(`Sex: ${female ? 'female' : 'male'} (case record); no race coefficient (2021 equation).`, `الجنس: ${female ? 'أنثى' : 'ذكر'} (سجل الحالة)؛ دون معامل العرق (معادلة 2021).`),
      ],
      warnings: [
        L(
          'Staging tool: indexed to 1.73 m² of body surface area. Do not use it in place of creatinine clearance for drug dosing.',
          'أداة تصنيف: منسوبة إلى 1.73 م² من مساحة سطح الجسم. لا تستخدمها بدلاً من تصفية الكرياتينين في تحديد الجرعات.',
        ),
      ],
      steps: [
        given('SCr', inputs.scr!),
        `κ = ${k}, α = ${a} (${female ? 'female' : 'male'})`,
        `SCr/κ = ${show(scr, '', 3)} ÷ ${k} = ${show(r, '', 3)}`,
        step(
          `eGFR = 142 × ${show(Math.min(r, 1), '', 3)}^${a} × ${show(Math.max(r, 1), '', 3)}^−1.200 × 0.9938^${show(age, '', 0)}${female ? ' × 1.012' : ''}`,
          value,
          'mL/min/1.73 m²',
          1,
        ),
      ],
    };
  },
  limitations: [
    L(
      'Assumes stable creatinine; not valid in acute kidney injury or on dialysis.',
      'تفترض ثبات الكرياتينين؛ ولا تصح في الإصابة الكلوية الحادة أو أثناء الغسيل الكلوي.',
    ),
    L(
      'Less accurate at extremes of muscle mass (amputation, cachexia, very high muscle mass).',
      'أقل دقة عند تطرف الكتلة العضلية (البتر، الهزال، الكتلة العضلية الكبيرة جداً).',
    ),
    L('Adults only (18 years or older).', 'للبالغين فقط (18 سنة فأكثر).'),
  ],
};

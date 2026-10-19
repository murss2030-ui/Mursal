/**
 * Infusion rates for Task 9 (owner decision 9, 18 October 2026):
 *
 * - weight-based continuous infusion (for example an inotrope or a
 *   vasopressor): rate (mL/h) = dose rate (mcg/kg/min) × weight (kg) × 60 ÷
 *   concentration (mcg/mL);
 * - a volume over a time: rate (mL/h) = volume (mL) ÷ time (h).
 *
 * The calculator checks arithmetic only. The dose rate, the drug and its
 * concentration are entered by the trainee from the order and the
 * preparation; PRECEPTOR has no drug-specific concentrations or doses.
 */
import { L } from '../../domain/label';
import { step } from '../engine';
import { AGE, WEIGHT } from '../inputs';
import type { CalculatorDef, InputSpec } from '../types';
import { show } from '../units';
import { given, val } from './common';

const DECISION = 'Formula set by the department (owner decision 9, 18 October 2026): dimensional analysis of a continuous infusion.';

const DOSE_RATE: InputSpec = {
  key: 'doseRate',
  label: L('Prescribed dose rate', 'معدل الجرعة الموصوف'),
  kind: 'dose_rate',
  source: { kind: 'answer' },
  limits: [0.0001, 1000],
  plausible: [0.01, 100],
  hint: L('As written in the order, per kilogram.', 'كما هو مكتوب في الطلب، لكل كيلوغرام.'),
};

const CONCENTRATION: InputSpec = {
  key: 'concentration',
  label: L('Concentration of the prepared solution', 'تركيز المحلول المحضّر'),
  kind: 'concentration',
  source: { kind: 'answer' },
  limits: [0.001, 1_000_000],
  plausible: [1, 100_000],
  hint: L(
    'Drug amount ÷ final volume, as prepared. For example 50 mg in 50 mL = 1 mg/mL = 1000 mcg/mL.',
    'كمية الدواء ÷ الحجم النهائي كما حُضّر. مثلاً 50 mg في 50 mL = 1 mg/mL = 1000 mcg/mL.',
  ),
};

const VOLUME: InputSpec = {
  key: 'volume',
  label: L('Volume to give', 'الحجم المطلوب إعطاؤه'),
  kind: 'volume',
  source: { kind: 'answer' },
  limits: [0.1, 20_000],
  plausible: [5, 5000],
};

const TIME: InputSpec = {
  key: 'time',
  label: L('Over this time', 'خلال هذه المدة'),
  kind: 'duration',
  source: { kind: 'answer' },
  limits: [1 / 60, 168],
  plausible: [0.25, 48],
};

const CHECK_PUMP = L(
  'Pump programming and the preparation must be independently double-checked before any infusion.',
  'يجب التحقق المزدوج المستقل من برمجة المضخة ومن التحضير قبل أي تسريب.',
);

export const PAEDIATRIC_ESCALATE = L(
  'Weight-based dose in a child: a high-risk calculation. Check every input twice and discuss the result with your preceptor before it is used.',
  'جرعة محسوبة بالوزن لطفل: حساب عالي الخطورة. تحقق من كل مدخل مرتين وناقش النتيجة مع مشرفك قبل استخدامها.',
);

export const infusionRateWeight: CalculatorDef = {
  id: 'infusion_rate_weight',
  name: 'Infusion rate, weight-based (mcg/kg/min → mL/h)',
  nameAr: 'معدل التسريب حسب الوزن: من mcg/kg/min إلى mL/h',
  purpose: L('The pump rate that delivers a prescribed weight-based dose rate.', 'معدل المضخة الذي يعطي معدل الجرعة الموصوف حسب الوزن.'),
  formulaVersion: '1',
  citation: DECISION,
  formula: 'Rate (mL/h) = dose rate (mcg/kg/min) × weight (kg) × 60 ÷ concentration (mcg/mL)',
  requiredInputs: [DOSE_RATE, WEIGHT, CONCENTRATION],
  optionalInputs: [AGE],
  highRisk: true,
  compute(inputs) {
    const dose = val(inputs, 'doseRate');
    const kg = val(inputs, 'weight');
    const conc = val(inputs, 'concentration');
    const perMin = dose * kg;
    const value = (perMin * 60) / conc;
    const warnings: L[] = [];
    if (inputs.age && val(inputs, 'age') < 18) warnings.push(PAEDIATRIC_ESCALATE);
    if (value < 0.5 || value > 500)
      warnings.push(
        L(
          `A pump rate of ${show(value, 'mL/h', 2)} is unusual: check the dose rate, the weight and the concentration, and their units.`,
          `معدل مضخة قدره ${show(value, 'mL/h', 2)} غير معتاد: تحقق من معدل الجرعة والوزن والتركيز ووحداتها.`,
        ),
      );
    return {
      value,
      unit: 'mL/h',
      decimals: 1,
      secondary: [
        { key: 'mcgPerMin', label: L('Drug delivered', 'كمية الدواء المعطاة'), value: perMin, unit: 'mcg/min', decimals: 1 },
        { key: 'mgPerHour', label: L('Drug delivered per hour', 'كمية الدواء المعطاة في الساعة'), value: (perMin * 60) / 1000, unit: 'mg/h', decimals: 2 },
      ],
      assumptions: [L('Weight: the weight recorded in the case (total body weight).', 'الوزن: الوزن المسجل في الحالة (وزن الجسم الكلي).')],
      warnings,
      steps: [
        given('Dose rate', inputs.doseRate!, 3),
        given('Weight', inputs.weight!, 1),
        given('Concentration', inputs.concentration!, 2),
        `Drug delivered = ${show(dose, '', 3)} mcg/kg/min × ${show(kg, '', 1)} kg = ${show(perMin, '', 2)} mcg/min`,
        step(`Rate = ${show(dose, '', 3)} × ${show(kg, '', 1)} × 60 ÷ ${show(conc, '', 2)}`, value, 'mL/h', 1),
      ],
    };
  },
  limitations: [
    L(
      'Checks arithmetic only: the dose rate, the drug, its dilution and concentration come from the order and your hospital’s preparation protocol.',
      'يتحقق من الحساب فقط: معدل الجرعة والدواء وتخفيفه وتركيزه تأتي من الطلب ومن بروتوكول التحضير في مستشفاك.',
    ),
    L(
      'Uses the weight recorded in the case; some drugs are dosed on another weight — follow the drug’s reference.',
      'يستخدم الوزن المسجل في الحالة؛ وبعض الأدوية تُحسب بوزن آخر — اتبع مرجع الدواء.',
    ),
    CHECK_PUMP,
  ],
};

export const infusionRateVolume: CalculatorDef = {
  id: 'infusion_rate_volume',
  name: 'Infusion rate, volume over time (mL/h)',
  nameAr: 'معدل التسريب: الحجم خلال مدة (mL/h)',
  purpose: L('The pump rate that gives a volume over a set time.', 'معدل المضخة الذي يعطي حجماً خلال مدة محددة.'),
  formulaVersion: '1',
  citation: 'Formula set by the department (owner decision 9, 18 October 2026): volume divided by time.',
  formula: 'Rate (mL/h) = volume (mL) ÷ time (h)',
  requiredInputs: [VOLUME, TIME],
  optionalInputs: [],
  compute(inputs) {
    const mL = val(inputs, 'volume');
    const h = val(inputs, 'time');
    const value = mL / h;
    return {
      value,
      unit: 'mL/h',
      decimals: 1,
      assumptions: [],
      warnings: [],
      steps: [given('Volume', inputs.volume!, 1), given('Time', inputs.time!, 3), step(`Rate = ${show(mL, '', 1)} ÷ ${show(h, '', 3)}`, value, 'mL/h', 1)],
    };
  },
  limitations: [
    L('Checks arithmetic only: the fluid, the volume and the time come from the order.', 'يتحقق من الحساب فقط: السائل والحجم والمدة تأتي من الطلب.'),
    CHECK_PUMP,
  ],
};

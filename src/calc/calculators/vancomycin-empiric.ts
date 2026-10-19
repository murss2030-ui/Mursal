/**
 * Vancomycin without levels (Section 9: "a documented no-level nomogram path
 * for the low-resource setting"), by the department's method and table:
 *
 * - owner decision 6 (18 October 2026): empiric weight-based dosing, 15 to
 *   20 mg/kg of actual body weight per dose, with the dosing interval set
 *   from creatinine clearance by Cockcroft–Gault;
 * - the department's interval table (owner decision, 19 October 2026):
 *     CrCl above 90 mL/min ........................ every 8 h
 *     CrCl 50 to 90 mL/min ........................ every 12 h
 *     CrCl 20 to 49 mL/min ........................ every 24 h
 *     CrCl below 20 mL/min, or on intermittent haemodialysis or peritoneal
 *     dialysis ..................................... one dose, then dosing by levels;
 * - CRRT (owner decision, 19 October 2026): not calculated — CRRT removes
 *   vancomycin continuously, and the dose follows the intensive-care protocol
 *   from the effluent rate.
 *
 * Creatinine clearance is the CrCl calculator's own formula and inputs (the
 * weight basis chosen and recorded), compared with the table as a whole
 * number, as it is shown, so that the bands meet without a gap (49 → 24 h,
 * 50 → 12 h). On renal replacement therapy Cockcroft–Gault does not describe
 * the clearance: it is neither asked for nor used.
 */
import { L } from '../../domain/label';
import { step } from '../engine';
import { AGE, SCR, SEX, WEIGHT } from '../inputs';
import type { CalcInputs, CalculatorDef, InputSpec, Problem } from '../types';
import { show } from '../units';
import { given, val } from './common';
import { WEIGHT_BASIS, crclCg } from './renal';

export const DOSE_RANGE: readonly [number, number] = [15, 20];

export type Regimen = { kind: 'interval'; hours: number } | { kind: 'single' };

export interface DepartmentBand {
  /** Creatinine clearance as a whole number (mL/min): from this value, inclusive. */
  min?: number;
  /** Up to this value, inclusive. */
  max?: number;
  regimen: Regimen;
  text: L;
}

/** The department's table (owner decision, 19 October 2026). */
export const DEPARTMENT_TABLE: readonly DepartmentBand[] = [
  { min: 91, regimen: { kind: 'interval', hours: 8 }, text: L('CrCl above 90 mL/min → every 8 h', 'تصفية الكرياتينين أعلى من 90 mL/min ← كل 8 h') },
  { min: 50, max: 90, regimen: { kind: 'interval', hours: 12 }, text: L('CrCl 50–90 mL/min → every 12 h', 'تصفية الكرياتينين 50–90 mL/min ← كل 12 h') },
  { min: 20, max: 49, regimen: { kind: 'interval', hours: 24 }, text: L('CrCl 20–49 mL/min → every 24 h', 'تصفية الكرياتينين 20–49 mL/min ← كل 24 h') },
  {
    max: 19,
    regimen: { kind: 'single' },
    text: L('CrCl below 20 mL/min → one dose, then dosing by levels', 'تصفية الكرياتينين أقل من 20 mL/min ← جرعة واحدة، ثم الجرعات حسب المستويات'),
  },
];

export const DIALYSIS_BAND: DepartmentBand = {
  regimen: { kind: 'single' },
  text: L(
    'On intermittent haemodialysis or peritoneal dialysis → one dose, then dosing by levels',
    'على الغسيل الدموي المتقطع أو الغسيل البريتوني ← جرعة واحدة، ثم الجرعات حسب المستويات',
  ),
};

/** The band of the department's table that holds a creatinine clearance (a whole number, mL/min). */
export function bandFor(crcl: number): DepartmentBand {
  const b = DEPARTMENT_TABLE.find((x) => (x.min === undefined || crcl >= x.min) && (x.max === undefined || crcl <= x.max));
  if (!b) throw new Error(`No band of the department's table holds ${crcl} mL/min`);
  return b;
}

const DECISION = L('the department’s table (owner decision, 19 October 2026)', 'جدول القسم (قرار المالك، 19 أكتوبر 2026)');

const MG_PER_KG: InputSpec = {
  key: 'mgPerKg',
  label: L('Dose per kilogram of actual body weight', 'الجرعة لكل كيلوغرام من الوزن الفعلي'),
  kind: 'dose_per_kg',
  source: { kind: 'answer' },
  limits: DOSE_RANGE,
  hint: L('The department’s range: 15 to 20 mg/kg per dose (owner decision 6).', 'نطاق القسم: من 15 إلى 20 mg/kg للجرعة (قرار المالك 6).'),
};

/** Renal replacement therapy, with the options of the case's own record (its renal replacement therapy entry). */
const RRT: InputSpec = {
  key: 'rrt',
  label: L('Renal replacement therapy', 'العلاج البديل للكلى'),
  kind: 'choice',
  source: { kind: 'answer' },
  options: [
    { value: 'none', label: L('None (not on dialysis)', 'لا يوجد (ليس على الغسيل)'), points: 0 },
    { value: 'intermittent_hd', label: L('Intermittent haemodialysis', 'غسيل دموي متقطع'), points: 1 },
    { value: 'peritoneal', label: L('Peritoneal dialysis', 'غسيل بريتوني'), points: 2 },
    { value: 'crrt', label: L('Continuous renal replacement therapy (CRRT)', 'علاج بديل مستمر للكلى (CRRT)'), points: 3 },
  ],
  hint: L('Answer from the record (its renal replacement therapy entry).', 'أجب من السجل (إدخال العلاج البديل للكلى).'),
};

/** Asked, and used, only when the patient is not on renal replacement therapy: the inputs of Cockcroft–Gault. */
const offDialysis = (s: InputSpec): InputSpec => ({ ...s, showIf: { key: 'rrt', in: ['none'] } });
/** Not asked on CRRT, which is refused as soon as it is chosen. */
const notCrrt = (s: InputSpec): InputSpec => ({ ...s, showIf: { key: 'rrt', in: ['none', 'intermittent_hd', 'peritoneal'] } });

const rrtOf = (inputs: CalcInputs) => inputs.rrt?.choice;

/** The owner's message for a patient on CRRT (19 October 2026). */
export const CRRT_PROTOCOL = L(
  'Patients on CRRT need the intensive care unit’s own protocol, which sets the dose from the effluent rate: refer to your hospital’s protocol.',
  'مرضى CRRT يتطلبون بروتوكولاً خاصاً بالعناية المركزة لحساب الجرعة بناءً على معدلات الترشيح (Effluent rates)، يرجى الرجوع لبروتوكول المستشفى.',
);

export const POPULATION_ESTIMATE = L(
  'A population-based starting regimen for a setting where levels cannot be measured, not a patient-specific one. When levels can be measured, use the AUC calculator.',
  'نظام جرعات ابتدائي مبني على متوسط السكان لمكان يتعذر فيه قياس المستويات، وليس خاصاً بالمريض. حين يمكن قياس المستويات استخدم حاسبة AUC.',
);

export const ONE_DOSE_THEN_LEVELS = L(
  'The department’s table gives this one dose only: measure the level, and set the next doses from it with your preceptor.',
  'يعطي جدول القسم هذه الجرعة الواحدة فقط: قِس المستوى، وحدّد الجرعات التالية منه مع مشرفك.',
);

const ADULTS_ONLY = L(
  'The department’s vancomycin table is for adults (18 years or older). It is not used for younger patients.',
  'جدول القسم للفانكومايسين مخصص للبالغين (18 سنة فأكثر)، ولا يُستخدم لمن هم أصغر.',
);

function check(inputs: CalcInputs): Problem[] {
  if (rrtOf(inputs) === 'crrt') return [{ kind: 'refused', reason: CRRT_PROTOCOL }];
  if (inputs.age && inputs.age.value < 18) return [{ kind: 'refused', reason: ADULTS_ONLY }];
  return rrtOf(inputs) === 'none' ? (crclCg.check?.(inputs) ?? []) : [];
}

export const vancomycinEmpiric: CalculatorDef = {
  id: 'vancomycin_empiric',
  name: 'Vancomycin without levels (empiric dose and interval)',
  nameAr: 'الفانكومايسين دون مستويات (جرعة وفاصل تجريبيان)',
  purpose: L(
    'A starting regimen where vancomycin levels cannot be measured: the dose from actual body weight, the interval from the department’s creatinine clearance table.',
    'نظام جرعات ابتدائي حيث يتعذر قياس مستويات الفانكومايسين: الجرعة من الوزن الفعلي، والفاصل من جدول القسم حسب تصفية الكرياتينين.',
  ),
  formulaVersion: '3',
  citation: `Method and table set by the department: owner decision 6 (18 October 2026) — empiric weight-based dosing, 15–20 mg/kg of actual body weight per dose, the interval from Cockcroft–Gault creatinine clearance — and the department’s interval table, with CRRT left to the intensive-care protocol (owner decisions, 19 October 2026). Creatinine clearance: ${crclCg.citation}`,
  formula:
    'Dose (mg) = dose per kg (15–20 mg/kg) × actual body weight (kg). Interval, by the department’s table (CrCl by Cockcroft–Gault, as a whole number): above 90 mL/min every 8 h; 50–90 every 12 h; 20–49 every 24 h; below 20, or on intermittent haemodialysis or peritoneal dialysis, one dose, then dosing by levels; CRRT is not calculated. Daily dose (mg/24 h) = dose × 24 ÷ interval (h)',
  requiredInputs: [RRT, AGE, notCrrt(WEIGHT), notCrrt(MG_PER_KG), offDialysis(SEX), offDialysis(SCR), offDialysis(WEIGHT_BASIS)],
  optionalInputs: crclCg.optionalInputs.map((s) => (s.showIf ? s : offDialysis(s))),
  highRisk: true,
  check,
  contextWarnings: (inputs, current) => (rrtOf(inputs) === 'none' ? (crclCg.contextWarnings?.(inputs, current) ?? []) : []),
  compute(inputs) {
    const cg = rrtOf(inputs) === 'none' ? crclCg.compute(inputs) : undefined;
    const crcl = cg ? Math.round(cg.value) : undefined;
    const band = crcl === undefined ? DIALYSIS_BAND : bandFor(crcl);
    const kg = val(inputs, 'weight');
    const perKg = val(inputs, 'mgPerKg');
    const dose = perKg * kg;
    const r = band.regimen;
    const daily = r.kind === 'interval' ? (dose * 24) / r.hours : undefined;
    const every = r.kind === 'interval' ? show(r.hours, 'h', 0) : '';
    return {
      value: dose,
      unit: 'mg',
      decimals: 0,
      category:
        r.kind === 'interval'
          ? { value: `every_${r.hours}_h`, label: L(`Every ${every} (department’s table)`, `كل ${every} (جدول القسم)`) }
          : { value: 'one_dose_then_levels', label: L('One dose, then dosing by levels (department’s table)', 'جرعة واحدة، ثم الجرعات حسب المستويات (جدول القسم)') },
      secondary: [
        ...(r.kind === 'interval' && daily !== undefined
          ? [
              { key: 'interval', label: L('Dosing interval', 'الفاصل بين الجرعات'), value: r.hours, unit: 'h', decimals: 0 },
              { key: 'daily', label: L('Total daily dose', 'الجرعة اليومية الكلية'), value: daily, unit: 'mg/24 h', decimals: 0 },
            ]
          : []),
        ...(cg ? [{ key: 'crcl', label: L('Creatinine clearance (Cockcroft–Gault)', 'تصفية الكرياتينين (Cockcroft–Gault)'), value: cg.value, unit: 'mL/min', decimals: 0 }] : []),
      ],
      assumptions: [
        ...(cg?.assumptions ?? []),
        L(
          'Dose on actual body weight: the total body weight recorded in the case, as the department’s method uses.',
          'الجرعة على الوزن الفعلي: وزن الجسم الكلي المسجل في الحالة، كما تستخدمه طريقة القسم.',
        ),
        L(`Interval from ${DECISION.en}: ${band.text.en}.`, `الفاصل من ${DECISION.ar}: ${band.text.ar}.`),
        L('The dose is not rounded: round it as your hospital does.', 'الجرعة غير مقرّبة: قرّبها كما يفعل مستشفاك.'),
      ],
      warnings: [...(cg?.warnings ?? []), POPULATION_ESTIMATE, ...(r.kind === 'single' ? [ONE_DOSE_THEN_LEVELS] : [])],
      steps: [
        ...(cg ? [...cg.steps, `CrCl compared with the table as a whole number: ${crcl} mL/min`] : ['On dialysis: Cockcroft–Gault is not used']),
        `Department’s table: ${band.text.en}`,
        given('Dose per kg', inputs.mgPerKg!, 1),
        step(`Dose = ${show(perKg, '', 1)} mg/kg × ${show(kg, '', 1)} kg`, dose, 'mg', 0),
        ...(r.kind === 'interval' && daily !== undefined ? [step(`Daily dose = ${show(dose, '', 0)} mg × 24 ÷ ${every}`, daily, 'mg/24 h', 0)] : []),
      ],
    };
  },
  limitations: [
    L(
      'The interval is the department’s table (owner decisions, 19 October 2026), for adults: above 90 mL/min every 8 h; 50–90 every 12 h; 20–49 every 24 h; below 20 mL/min, or on intermittent haemodialysis or peritoneal dialysis, one dose, then dosing by levels. CRRT is not calculated: the intensive-care protocol sets the dose from the effluent rate.',
      'الفاصل من جدول القسم (قرارات المالك، 19 أكتوبر 2026)، للبالغين: أعلى من 90 mL/min كل 8 h؛ 50–90 كل 12 h؛ 20–49 كل 24 h؛ أقل من 20 mL/min أو على الغسيل الدموي المتقطع أو البريتوني جرعة واحدة، ثم الجرعات حسب المستويات. لا يُحسب CRRT: يحدد بروتوكول العناية المركزة الجرعة من معدل الترشيح.',
    ),
    POPULATION_ESTIMATE,
    L(
      'No loading dose and no maximum single dose are applied: follow your hospital’s protocol.',
      'لا تُحسب جرعة تحميل ولا يُطبَّق حد أقصى للجرعة الواحدة: اتبع بروتوكول مستشفاك.',
    ),
    L(
      'Unreliable when creatinine is changing (acute kidney injury): Cockcroft–Gault assumes a stable creatinine. Adults only.',
      'لا يُعتمد عليه حين يتغير الكرياتينين (إصابة كلوية حادة): معادلة Cockcroft–Gault تفترض كرياتينيناً مستقراً. للبالغين فقط.',
    ),
  ],
};

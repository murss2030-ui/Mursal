/**
 * Vancomycin without levels (Section 9: "a documented no-level nomogram path
 * for the low-resource setting"), as the department decided (owner decision
 * 6, 18 October 2026):
 *
 * - empiric weight-based dosing: 15 to 20 mg/kg of actual body weight per
 *   dose;
 * - the dosing interval set from creatinine clearance by Cockcroft–Gault.
 *
 * The decision names the method, not the creatinine clearance bands, so the
 * bands are the department's own table (More → Reference tables), each with
 * its source — none are shipped, as for the high-alert list and the critical
 * values (decisions 3 and 4). The calculator chooses the band the patient's
 * creatinine clearance falls in, shows it with its source and version, and
 * refuses when the table is empty, has no band or two bands for that value,
 * or says to dose by levels.
 *
 * Creatinine clearance is the CrCl calculator's own formula, with the same
 * inputs (the weight basis chosen and recorded); it is compared with the
 * table as a whole number, as it is shown.
 */
import { L } from '../../domain/label';
import { bandCovers, bandRange } from '../../domain/reference';
import { step } from '../engine';
import type { CalcReferences } from '../gather';
import { finding } from '../inputs';
import type { CalcInputs, CalculatorDef, InputSource, InputSpec, InputValue, Problem } from '../types';
import { show } from '../units';
import { given, val, yes } from './common';
import { crclCg } from './renal';

export const DOSE_RANGE: readonly [number, number] = [15, 20];

const MG_PER_KG: InputSpec = {
  key: 'mgPerKg',
  label: L('Dose per kilogram of actual body weight', 'الجرعة لكل كيلوغرام من الوزن الفعلي'),
  kind: 'dose_per_kg',
  source: { kind: 'answer' },
  limits: DOSE_RANGE,
  hint: L('The department’s range: 15 to 20 mg/kg per dose (owner decision 6).', 'نطاق القسم: من 15 إلى 20 mg/kg للجرعة (قرار المالك 6).'),
};

const NO_RRT = finding('noRrt', L('Not on dialysis or CRRT', 'ليس على غسيل كلوي ولا CRRT'));

const INTERVAL: InputSpec = {
  key: 'interval',
  label: L('Dosing interval, from your department’s table', 'الفاصل بين الجرعات، من جدول قسمك'),
  kind: 'duration',
  source: { kind: 'reference', table: 'vancomycin_interval' },
};

export const POPULATION_ESTIMATE = L(
  'A population-based starting regimen for a setting where levels cannot be measured, not a patient-specific one. When levels can be measured, use the AUC calculator.',
  'نظام جرعات ابتدائي مبني على متوسط السكان لمكان يتعذر فيه قياس المستويات، وليس خاصاً بالمريض. حين يمكن قياس المستويات استخدم حاسبة AUC.',
);

/** The creatinine clearance compared with the table: the Cockcroft–Gault value, as a whole number. */
const crclForTable = (inputs: CalcInputs) => Math.round(crclCg.compute(inputs).value);

function check(inputs: CalcInputs): Problem[] {
  const problems = [...(crclCg.check?.(inputs) ?? [])];
  if (inputs.noRrt && !yes(inputs, 'noRrt'))
    problems.push({
      kind: 'refused',
      reason: L(
        'Cockcroft–Gault does not describe the clearance of a patient on dialysis or CRRT, so the interval cannot be set from it. Dose by levels, with your preceptor.',
        'معادلة Cockcroft–Gault لا تصف تصفية مريض على الغسيل أو CRRT، فلا يمكن تحديد الفاصل منها. حدّد الجرعات بالمستويات مع مشرفك.',
      ),
    });
  return problems;
}

function fromReference(inputs: CalcInputs, refs: CalcReferences): { input: InputValue } | { problem: Problem } {
  const bands = (refs.vancomycinIntervals ?? []).filter((b) => b.status === 'active');
  if (!bands.length)
    return {
      problem: {
        kind: 'missing',
        key: 'interval',
        detail: L(
          'your department’s vancomycin interval table is empty: add its bands, with their source, in More → Reference tables',
          'جدول فواصل الفانكومايسين لقسمك فارغ: أضف فئاته مع مصدرها في المزيد ← الجداول المرجعية',
        ),
      },
    };
  const crcl = crclForTable(inputs);
  const hits = bands.filter((b) => bandCovers(b, crcl));
  if (!hits.length)
    return {
      problem: {
        kind: 'missing',
        key: 'interval',
        detail: L(
          `no band of your department’s table holds a creatinine clearance of ${crcl} mL/min`,
          `لا توجد في جدول قسمك فئة تشمل تصفية كرياتينين قدرها ${crcl} mL/min`,
        ),
      },
    };
  if (hits.length > 1)
    return {
      problem: {
        kind: 'invalid',
        key: 'interval',
        reason: L(
          `${hits.length} bands of your department’s table hold ${crcl} mL/min (${hits.map((b) => bandRange(b).en).join('; ')}): correct the table`,
          `${hits.length} فئات في جدول قسمك تشمل ${crcl} mL/min (${hits.map((b) => bandRange(b).ar).join('؛ ')}): صحّح الجدول`,
        ),
      },
    };
  const b = hits[0]!;
  if (b.action === 'levels' || b.intervalHours === undefined)
    return {
      problem: {
        kind: 'refused',
        reason: L(
          `Your department’s table gives no fixed interval for a creatinine clearance of ${crcl} mL/min (band ${bandRange(b).en}): dose by levels. Source: ${b.source}.`,
          `لا يعطي جدول قسمك فاصلاً ثابتاً لتصفية كرياتينين قدرها ${crcl} mL/min (الفئة ${bandRange(b).ar}): حدّد الجرعات بالمستويات. المصدر: ${b.source}.`,
        ),
      },
    };
  const every = show(b.intervalHours, 'h', 1);
  return {
    input: {
      key: 'interval',
      value: b.intervalHours,
      unit: 'h',
      source: {
        kind: 'reference',
        table: 'vancomycin_interval',
        id: b.id,
        version: b.version,
        text: L(`creatinine clearance ${bandRange(b).en} → every ${every}`, `تصفية الكرياتينين ${bandRange(b).ar} ← كل ${every}`),
        source: b.source,
      },
    },
  };
}

export const vancomycinEmpiric: CalculatorDef = {
  id: 'vancomycin_empiric',
  name: 'Vancomycin without levels (empiric dose and interval)',
  nameAr: 'الفانكومايسين دون مستويات (جرعة وفاصل تجريبيان)',
  purpose: L(
    'A starting regimen where vancomycin levels cannot be measured: the dose from actual body weight, the interval from your department’s creatinine clearance table.',
    'نظام جرعات ابتدائي حيث يتعذر قياس مستويات الفانكومايسين: الجرعة من الوزن الفعلي، والفاصل من جدول قسمك حسب تصفية الكرياتينين.',
  ),
  formulaVersion: '1',
  citation: `Method set by the department (owner decision 6, 18 October 2026): empiric weight-based dosing, 15–20 mg/kg of actual body weight per dose, with the dosing interval set from creatinine clearance (Cockcroft–Gault) by the department’s own table, whose source is shown with each result. Creatinine clearance: ${crclCg.citation}`,
  formula:
    'Dose (mg) = dose per kg (15–20 mg/kg) × actual body weight (kg); interval = the band of the department’s table that holds CrCl (Cockcroft–Gault, mL/min, as a whole number); daily dose (mg/24 h) = dose × 24 ÷ interval (h)',
  requiredInputs: [...crclCg.requiredInputs, MG_PER_KG, NO_RRT, INTERVAL],
  optionalInputs: crclCg.optionalInputs,
  highRisk: true,
  check,
  fromReference,
  contextWarnings: crclCg.contextWarnings,
  compute(inputs) {
    const cg = crclCg.compute(inputs);
    const crcl = Math.round(cg.value);
    const kg = val(inputs, 'weight');
    const perKg = val(inputs, 'mgPerKg');
    const dose = perKg * kg;
    const tau = val(inputs, 'interval');
    const daily = (dose * 24) / tau;
    const band = inputs.interval!.source as Extract<InputSource, { kind: 'reference' }>;
    return {
      value: dose,
      unit: 'mg',
      decimals: 0,
      category: { value: `every_${tau}_h`, label: L(`Every ${show(tau, 'h', 1)} (your department’s table)`, `كل ${show(tau, 'h', 1)} (جدول قسمك)`) },
      secondary: [
        { key: 'interval', label: L('Dosing interval', 'الفاصل بين الجرعات'), value: tau, unit: 'h', decimals: 1 },
        { key: 'daily', label: L('Total daily dose', 'الجرعة اليومية الكلية'), value: daily, unit: 'mg/24 h', decimals: 0 },
        { key: 'crcl', label: L('Creatinine clearance (Cockcroft–Gault)', 'تصفية الكرياتينين (Cockcroft–Gault)'), value: cg.value, unit: 'mL/min', decimals: 0 },
      ],
      assumptions: [
        ...cg.assumptions,
        L(
          'Dose on actual body weight: the total body weight recorded in the case, as the department’s method uses.',
          'الجرعة على الوزن الفعلي: وزن الجسم الكلي المسجل في الحالة، كما تستخدمه طريقة القسم.',
        ),
        L(
          `Interval from your department’s table (band version ${band.version}): ${band.text.en}. Source: ${band.source}.`,
          `الفاصل من جدول قسمك (إصدار الفئة ${band.version}): ${band.text.ar}. المصدر: ${band.source}.`,
        ),
        L('The dose is not rounded: round it as your hospital does.', 'الجرعة غير مقرّبة: قرّبها كما يفعل مستشفاك.'),
      ],
      warnings: [...cg.warnings, POPULATION_ESTIMATE],
      steps: [
        ...cg.steps,
        `CrCl compared with the table as a whole number: ${crcl} mL/min`,
        `Band of your department’s table (version ${band.version}): ${band.text.en} (source: ${band.source})`,
        given('Dose per kg', inputs.mgPerKg!, 1),
        step(`Dose = ${show(perKg, '', 1)} mg/kg × ${show(kg, '', 1)} kg`, dose, 'mg', 0),
        step(`Daily dose = ${show(dose, '', 0)} mg × 24 ÷ ${show(tau, '', 1)} h`, daily, 'mg/24 h', 0),
      ],
    };
  },
  limitations: [
    L(
      'The creatinine clearance bands are your department’s table, entered in More → Reference tables with their source; PRECEPTOR ships none and checks only that one band holds the value.',
      'فئات تصفية الكرياتينين هي جدول قسمك، تُدخل في المزيد ← الجداول المرجعية مع مصدرها؛ لا يأتي PRECEPTOR بأي فئة، ويتحقق فقط من أن فئة واحدة تشمل القيمة.',
    ),
    POPULATION_ESTIMATE,
    L(
      'No loading dose and no maximum single dose are applied: follow your hospital’s protocol.',
      'لا تُحسب جرعة تحميل ولا يُطبَّق حد أقصى للجرعة الواحدة: اتبع بروتوكول مستشفاك.',
    ),
    L(
      'Not for patients on dialysis or CRRT, and unreliable when creatinine is changing (acute kidney injury): Cockcroft–Gault does not describe their clearance. Adults only.',
      'لا يصلح لمرضى الغسيل أو CRRT، ولا يُعتمد عليه حين يتغير الكرياتينين (إصابة كلوية حادة): معادلة Cockcroft–Gault لا تصف تصفيتهم. للبالغين فقط.',
    ),
  ],
};

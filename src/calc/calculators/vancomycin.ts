/**
 * Vancomycin AUC₂₄ from two levels in one dosing interval at steady state
 * (Sawchuk–Zaske), Section 9:
 *
 * - target AUC₂₄/MIC 400–600, assuming an MIC of 1 mg/L (2020 consensus);
 * - warnings above an AUC of 800 or an estimated trough above 15 mg/L;
 * - the statement that evidence is insufficient for AUC targeting in
 *   non-invasive infection;
 * - refused without both levels and their exact draw times relative to the dose.
 *
 * The no-level nomogram path of the specification needs a citable source
 * chosen by the owner (M2 plan, decision 6) and is not implemented yet.
 *
 * Equations (one-compartment model, intermittent infusion, steady state):
 *   ke   = ln(C1 ÷ C2) ÷ (t2 − t1)
 *   Cmax = C1 × e^(ke × (t1 − end of infusion))       (back-extrapolated peak)
 *   Cmin = C2 × e^(−ke × (next dose − t2))            (forward-extrapolated trough)
 *   V    = (Dose ÷ tinf) × (1 − e^(−ke × tinf)) ÷ (ke × (Cmax − Cmin × e^(−ke × tinf)))
 *   CL   = ke × V;  AUC₂₄ = (Dose × 24 ÷ τ) ÷ CL
 */
import { L } from '../../domain/label';
import { MINUTES_PER_DAY } from '../gather';
import { step } from '../engine';
import { WEIGHT, finding } from '../inputs';
import type { CalcInputs, CalculatorDef, InputSpec, InputValue, Problem } from '../types';
import { show } from '../units';
import { has, val, yes } from './common';

const level = (key: 'level1' | 'level2', en: string, ar: string): InputSpec => ({
  key,
  label: L(en, ar),
  kind: 'vancomycin',
  source: { kind: 'lab', analytes: ['vanco'] },
  limits: [0.01, 300],
  plausible: [1, 100],
  needsTime: true,
  pickRequired: true,
});

const LEVEL1 = level('level1', 'First level (after the end of the infusion)', 'المستوى الأول (بعد انتهاء التسريب)');
const LEVEL2 = level('level2', 'Second level (later in the same interval, e.g. the trough)', 'المستوى الثاني (لاحقاً في الفترة نفسها، مثل القاع)');

const DOSE: InputSpec = {
  key: 'dose',
  label: L('Dose given before the levels', 'الجرعة المعطاة قبل المستويين'),
  kind: 'dose',
  source: { kind: 'answer' },
  limits: [1, 10000],
  plausible: [250, 4000],
};

const TINF: InputSpec = {
  key: 'tinf',
  label: L('Infusion duration', 'مدة التسريب'),
  kind: 'duration',
  source: { kind: 'answer' },
  limits: [0.05, 24],
  plausible: [0.5, 4],
};

const TAU: InputSpec = {
  key: 'tau',
  label: L('Dosing interval (τ)', 'الفاصل بين الجرعات (τ)'),
  kind: 'duration',
  source: { kind: 'answer' },
  limits: [1, 168],
  plausible: [6, 72],
};

const DOSE_START: InputSpec = {
  key: 'doseStart',
  label: L('Start of that infusion (day and clock time)', 'بداية ذلك التسريب (اليوم والساعة)'),
  kind: 'time',
  source: { kind: 'answer' },
  hint: L('From the administration record, not the prescribed time.', 'من سجل الإعطاء، لا من الوقت المكتوب في الوصفة.'),
};

const STEADY = finding(
  'steadyState',
  L('Levels are at steady state: unchanged regimen, at least the 4th dose', 'المستويان في الحالة المستقرة: نظام جرعات دون تغيير، ابتداءً من الجرعة الرابعة'),
);
const NO_RRT = finding(
  'noRrt',
  L('No dialysis or CRRT during this dosing interval', 'لا غسيل كلوي ولا CRRT خلال هذه الفترة بين الجرعات'),
);

export const AUC_TARGET: readonly [number, number] = [400, 600];
export const AUC_WARN = 800;
export const TROUGH_WARN = 15;

const CONSENSUS =
  'Rybak MJ, Le J, Lodise TP, et al. Therapeutic monitoring of vancomycin for serious methicillin-resistant Staphylococcus aureus infections: a revised consensus guideline and review by the American Society of Health-System Pharmacists, the Infectious Diseases Society of America, the Pediatric Infectious Diseases Society, and the Society of Infectious Diseases Pharmacists. Am J Health Syst Pharm 2020;77(11):835–864.';

export const ESCALATE_VANCO = L(
  'Outside the validated range: check the draw times, the dose and the infusion record, and discuss with your preceptor before using this result.',
  'خارج النطاق المُعتمد: تحقق من أوقات السحب والجرعة وسجل التسريب، وناقش مشرفك قبل استخدام هذه النتيجة.',
);

function timeOf(v: InputValue): number | undefined {
  const s = v.source;
  if (s.kind !== 'entry' || !s.time) return undefined;
  const [h, m] = s.time.split(':').map(Number) as [number, number];
  return s.day * MINUTES_PER_DAY + h * 60 + m;
}

const at = (min: number) => {
  const day = Math.floor(min / MINUTES_PER_DAY);
  const rest = min - day * MINUTES_PER_DAY;
  return `Day ${day} ${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
};

function check(inputs: CalcInputs): Problem[] {
  const problems: Problem[] = [];
  if (inputs.steadyState && !yes(inputs, 'steadyState'))
    problems.push({
      kind: 'refused',
      reason: L(
        'This calculator uses the steady-state equations only. Levels drawn before steady state cannot be used here.',
        'تستخدم هذه الحاسبة معادلات الحالة المستقرة فقط. لا يمكن استخدام مستويات سُحبت قبل الوصول إليها.',
      ),
    });
  if (inputs.noRrt && !yes(inputs, 'noRrt'))
    problems.push({
      kind: 'refused',
      reason: L('Not valid when dialysis or CRRT removes vancomycin between the levels.', 'لا تصح حين يزيل الغسيل أو CRRT الفانكومايسين بين المستويين.'),
    });
  const l1 = inputs.level1;
  const l2 = inputs.level2;
  const start = inputs.doseStart?.value;
  if (!l1 || !l2 || start === undefined || !inputs.tinf || !inputs.tau) return problems;
  if (l1.source.kind === 'entry' && l2.source.kind === 'entry' && l1.source.entryId === l2.source.entryId) {
    problems.push({ kind: 'invalid', key: 'level2', reason: L('the same result was chosen for both levels', 'اختيرت النتيجة نفسها للمستويين') });
    return problems;
  }
  const t1 = timeOf(l1);
  const t2 = timeOf(l2);
  if (t1 === undefined || t2 === undefined) return problems; // gather already named the missing clock time
  const end = start + val(inputs, 'tinf') * 60;
  const next = start + val(inputs, 'tau') * 60;
  if (val(inputs, 'tinf') >= val(inputs, 'tau'))
    problems.push({ kind: 'invalid', key: 'tinf', reason: L('the infusion is not shorter than the dosing interval', 'مدة التسريب ليست أقصر من الفاصل بين الجرعات') });
  if (t1 < end)
    problems.push({
      kind: 'invalid',
      key: 'level1',
      reason: L(`drawn at ${at(t1)}, before the infusion ended (${at(end)})`, `سُحب في ${at(t1)} قبل انتهاء التسريب (${at(end)})`),
    });
  if (t2 <= t1)
    problems.push({ kind: 'invalid', key: 'level2', reason: L('not drawn after the first level', 'لم يُسحب بعد المستوى الأول') });
  if (t2 > next)
    problems.push({
      kind: 'invalid',
      key: 'level2',
      reason: L(`drawn at ${at(t2)}, after the next dose was due (${at(next)}); both levels must be in the same interval`, `سُحب في ${at(t2)} بعد موعد الجرعة التالية (${at(next)})؛ يجب أن يكون المستويان في الفترة نفسها`),
    });
  if (l2.value >= l1.value)
    problems.push({
      kind: 'invalid',
      key: 'level2',
      reason: L('not lower than the first level; elimination cannot be calculated', 'ليس أقل من المستوى الأول؛ لا يمكن حساب الإطراح'),
    });
  return problems;
}

export const vancomycinAuc: CalculatorDef = {
  id: 'vancomycin_auc',
  name: 'Vancomycin AUC₂₄ (two levels, Sawchuk–Zaske)',
  nameAr: 'المساحة تحت المنحنى AUC₂₄ للفانكومايسين (مستويان، Sawchuk–Zaske)',
  purpose: L(
    'Patient-specific vancomycin exposure from a peak and a trough drawn in one dosing interval.',
    'تعرّض المريض للفانكومايسين من مستوى ذروة ومستوى قاع سُحبا في فترة جرعة واحدة.',
  ),
  formulaVersion: '1',
  citation: `Sawchuk RJ, Zaske DE. Pharmacokinetics of dosing regimens which utilize multiple intravenous infusions: gentamicin in burn patients. J Pharmacokinet Biopharm 1976;4(2):183–195. Targets and warnings: ${CONSENSUS}`,
  formula:
    'ke = ln(C1/C2) ÷ (t2 − t1); Cmax = C1·e^(ke·(t1 − end of infusion)); Cmin = C2·e^(−ke·(next dose − t2)); V = (Dose/tinf)·(1 − e^(−ke·tinf)) ÷ (ke·(Cmax − Cmin·e^(−ke·tinf))); CL = ke·V; AUC₂₄ = (Dose × 24/τ) ÷ CL',
  requiredInputs: [DOSE, TINF, TAU, DOSE_START, LEVEL1, LEVEL2, STEADY, NO_RRT],
  optionalInputs: [WEIGHT],
  highRisk: true,
  check,
  compute(inputs) {
    const dose = val(inputs, 'dose');
    const tinf = val(inputs, 'tinf');
    const tau = val(inputs, 'tau');
    const start = val(inputs, 'doseStart');
    const c1 = val(inputs, 'level1');
    const c2 = val(inputs, 'level2');
    const t1 = timeOf(inputs.level1!)!;
    const t2 = timeOf(inputs.level2!)!;
    const end = start + tinf * 60;
    const next = start + tau * 60;
    const dt = (t2 - t1) / 60;
    const ke = Math.log(c1 / c2) / dt;
    const half = Math.LN2 / ke;
    const afterEnd = (t1 - end) / 60;
    const beforeNext = (next - t2) / 60;
    const cmax = c1 * Math.exp(ke * afterEnd);
    const cmin = c2 * Math.exp(-ke * beforeNext);
    const decay = Math.exp(-ke * tinf);
    const v = ((dose / tinf) * (1 - decay)) / (ke * (cmax - cmin * decay));
    const cl = ke * v;
    const daily = (dose * 24) / tau;
    const value = daily / cl;

    const warnings: L[] = [];
    if (value > AUC_WARN)
      warnings.push(
        L(
          `AUC₂₄ above ${AUC_WARN} mg·h/L: the risk of nephrotoxicity rises (2020 consensus).`,
          `AUC₂₄ أعلى من ${AUC_WARN} mg·h/L: يرتفع خطر السمية الكلوية (إجماع 2020).`,
        ),
      );
    if (cmin > TROUGH_WARN)
      warnings.push(
        L(
          `Estimated trough ${show(cmin, 'mg/L', 1)} is above ${TROUGH_WARN} mg/L: associated with nephrotoxicity (2020 consensus).`,
          `القاع المقدَّر ${show(cmin, 'mg/L', 1)} أعلى من ${TROUGH_WARN} mg/L: يرتبط بالسمية الكلوية (إجماع 2020).`,
        ),
      );
    if (afterEnd < 1)
      warnings.push(
        L(
          `The first level was drawn ${show(afterEnd * 60, 'min', 0)} after the end of the infusion; within the first hour it may still be in the distribution phase, which overestimates the peak.`,
          `سُحب المستوى الأول بعد ${show(afterEnd * 60, 'min', 0)} من انتهاء التسريب؛ وخلال الساعة الأولى قد يكون الدواء ما زال في طور التوزع مما يبالغ في تقدير الذروة.`,
        ),
      );
    const perKg = has(inputs, 'weight') ? v / val(inputs, 'weight') : undefined;
    const unusual = ke < 0.02 || ke > 0.5 || (perKg !== undefined && (perKg < 0.3 || perKg > 1.5));
    if (unusual) warnings.push(ESCALATE_VANCO);
    warnings.push(
      L(
        'Evidence is insufficient to recommend AUC targeting in non-invasive infection (2020 consensus).',
        'الأدلة غير كافية للتوصية باستهداف AUC في العدوى غير الغازية (إجماع 2020).',
      ),
    );

    const category =
      value < AUC_TARGET[0]
        ? { value: 'below', label: L('Below the 400–600 target range', 'أقل من المدى المستهدف 400–600') }
        : value <= AUC_TARGET[1]
          ? { value: 'within', label: L('Within the 400–600 target range', 'ضمن المدى المستهدف 400–600') }
          : { value: 'above', label: L('Above the 400–600 target range', 'أعلى من المدى المستهدف 400–600') };

    const secondary = [
      { key: 'ke', label: L('Elimination rate constant (ke)', 'ثابت معدل الإطراح (ke)'), value: ke, unit: '/h', decimals: 3 },
      { key: 'halfLife', label: L('Half-life', 'نصف العمر'), value: half, unit: 'h', decimals: 1 },
      { key: 'cmax', label: L('Peak at the end of the infusion (Cmax)', 'الذروة عند نهاية التسريب (Cmax)'), value: cmax, unit: 'mg/L', decimals: 1 },
      { key: 'cmin', label: L('Trough at the next dose (Cmin)', 'القاع عند الجرعة التالية (Cmin)'), value: cmin, unit: 'mg/L', decimals: 1 },
      { key: 'v', label: L('Volume of distribution (V)', 'حجم التوزع (V)'), value: v, unit: 'L', decimals: 1 },
      ...(perKg !== undefined ? [{ key: 'vPerKg', label: L('V per kg of body weight', 'حجم التوزع لكل كغ'), value: perKg, unit: 'L/kg', decimals: 2 }] : []),
      { key: 'cl', label: L('Clearance (CL)', 'التصفية (CL)'), value: cl, unit: 'L/h', decimals: 2 },
    ];

    return {
      value,
      unit: 'mg·h/L',
      decimals: 0,
      secondary,
      category,
      assumptions: [
        L('Steady state, confirmed by the trainee.', 'الحالة المستقرة، بتأكيد المتدرب.'),
        L('No dialysis or CRRT during the interval, confirmed by the trainee.', 'لا غسيل ولا CRRT خلال الفترة، بتأكيد المتدرب.'),
        L('Target assumes an MIC of 1 mg/L (2020 consensus).', 'المدى المستهدف يفترض MIC يساوي 1 mg/L (إجماع 2020).'),
        L('One-compartment model with first-order elimination.', 'نموذج حجرة واحدة مع إطراح من الدرجة الأولى.'),
      ],
      warnings,
      steps: [
        `Dose ${show(dose, 'mg', 0)} over ${show(tinf, 'h', 2)}, every ${show(tau, 'h', 1)}; infusion started ${at(start)}, ended ${at(end)}; next dose ${at(next)}`,
        `C1 = ${show(c1, 'mg/L', 1)} at ${at(t1)} (${show(afterEnd, 'h', 2)} after the end of the infusion)`,
        `C2 = ${show(c2, 'mg/L', 1)} at ${at(t2)} (${show(beforeNext, 'h', 2)} before the next dose)`,
        step(`ke = ln(${show(c1, '', 1)} ÷ ${show(c2, '', 1)}) ÷ ${show(dt, '', 2)} h`, ke, '/h', 4),
        step(`t½ = 0.693 ÷ ${show(ke, '', 4)}`, half, 'h', 2),
        step(`Cmax = ${show(c1, '', 1)} × e^(${show(ke, '', 4)} × ${show(afterEnd, '', 2)})`, cmax, 'mg/L', 2),
        step(`Cmin = ${show(c2, '', 1)} × e^(−${show(ke, '', 4)} × ${show(beforeNext, '', 2)})`, cmin, 'mg/L', 2),
        step(
          `V = (${show(dose, '', 0)} ÷ ${show(tinf, '', 2)}) × (1 − e^(−${show(ke, '', 4)} × ${show(tinf, '', 2)})) ÷ (${show(ke, '', 4)} × (${show(cmax, '', 2)} − ${show(cmin, '', 2)} × e^(−${show(ke, '', 4)} × ${show(tinf, '', 2)})))`,
          v,
          'L',
          2,
        ),
        step(`CL = ${show(ke, '', 4)} × ${show(v, '', 2)}`, cl, 'L/h', 3),
        step(`AUC₂₄ = (${show(dose, '', 0)} × 24 ÷ ${show(tau, '', 1)}) ÷ ${show(cl, '', 3)}`, value, 'mg·h/L', 1),
      ],
    };
  },
  limitations: [
    L(
      'Needs two levels in the same dosing interval, both after the end of the infusion, with exact draw times and the exact start of the infusion.',
      'يحتاج مستويين في فترة الجرعة نفسها، كلاهما بعد انتهاء التسريب، مع أوقات السحب الدقيقة ووقت بدء التسريب الدقيق.',
    ),
    L('Not for patients on dialysis or CRRT, and not before steady state.', 'لا يصلح لمرضى الغسيل أو CRRT، ولا قبل الحالة المستقرة.'),
    L(
      'The no-level estimate for settings where levels cannot be measured is not available yet: it needs a published method chosen by the department.',
      'التقدير دون مستويات للأماكن التي يتعذر فيها القياس غير متاح بعد: يحتاج طريقة منشورة يختارها القسم.',
    ),
  ],
};

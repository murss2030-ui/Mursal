/**
 * Phenytoin total concentration corrected for a low albumin (Sheiner–Tozer),
 * with the separate renal-failure form (Section 9). High-risk: it carries an
 * extended test suite, and an escalation message when inputs fall outside
 * the range in which the correction is reasonable.
 */
import { L } from '../../domain/label';
import { step } from '../engine';
import { ALBUMIN, finding } from '../inputs';
import type { CalculatorDef, InputSpec } from '../types';
import { show } from '../units';
import { given, sameSample, val, yes } from './common';

const LEVEL: InputSpec = {
  key: 'level',
  label: L('Phenytoin level (total)', 'مستوى الفينيتوين (الكلي)'),
  kind: 'phenytoin',
  source: { kind: 'lab', analytes: ['phenytoin'] },
  limits: [0.01, 200],
  plausible: [0.5, 60],
};

const RENAL_FAILURE = finding(
  'renalFailure',
  L(
    'Severe renal failure: creatinine clearance below 10 mL/min, or on haemodialysis',
    'قصور كلوي شديد: تصفية الكرياتينين أقل من 10 mL/min، أو على الغسيل الدموي',
  ),
  L(
    'Answer from the record. "Yes" uses the renal-failure form of the equation; sources differ on the cut-off (10–25 mL/min).',
    'أجب من السجل. «نعم» يستخدم صيغة القصور الكلوي من المعادلة؛ وتختلف المصادر في الحد الفاصل (10–25 mL/min).',
  ),
);

export const ESCALATE = L(
  'Outside the range where this correction is reasonable: measure a free (unbound) phenytoin level if possible, and discuss with your preceptor before using the corrected value.',
  'خارج النطاق الذي يكون فيه هذا التصحيح معقولاً: قِس مستوى الفينيتوين الحر إن أمكن، وناقش مشرفك قبل استخدام القيمة المصححة.',
);

export const phenytoinCorrected: CalculatorDef = {
  id: 'phenytoin_corrected',
  name: 'Phenytoin corrected for albumin (Sheiner–Tozer)',
  nameAr: 'الفينيتوين المصحح للألبومين (Sheiner–Tozer)',
  purpose: L(
    'Estimates the total phenytoin level the patient would have with a normal albumin.',
    'يقدّر مستوى الفينيتوين الكلي لو كان الألبومين طبيعياً.',
  ),
  formulaVersion: '1',
  citation:
    'Sheiner LB, Tozer TN. Clinical pharmacokinetics: the use of plasma concentrations of drugs. In: Melmon KL, Morrelli HF, eds. Clinical Pharmacology: Basic Principles in Therapeutics. 2nd ed. New York: Macmillan; 1978. Renal-failure form: Liponi DF, Winter ME, Tozer TN. Renal function and therapeutic concentrations of phenytoin. Neurology 1984;34(3):395–397.',
  formula:
    'Corrected level = measured level ÷ (0.2 × albumin (g/dL) + 0.1); in severe renal failure: measured level ÷ (0.1 × albumin (g/dL) + 0.1)',
  requiredInputs: [LEVEL, ALBUMIN, RENAL_FAILURE],
  optionalInputs: [],
  highRisk: true,
  compute(inputs) {
    const c = val(inputs, 'level');
    const alb = val(inputs, 'albumin');
    const renal = yes(inputs, 'renalFailure');
    const k = renal ? 0.1 : 0.2;
    const denom = k * alb + 0.1;
    const value = c / denom;
    const warnings: L[] = [];
    if (renal) {
      warnings.push(
        L(
          'The renal-failure form was found inaccurate in haemodialysis patients (Soriano VV, Tesoro EP, Kane SP. Ann Pharmacother 2017;51(8):669–674).',
          'وُجد أن صيغة القصور الكلوي غير دقيقة لدى مرضى الغسيل الدموي (Soriano وآخرون، Ann Pharmacother 2017؛ 51(8):669–674).',
        ),
        ESCALATE,
      );
    } else if (alb < 2) {
      warnings.push(
        L(
          `Albumin ${show(alb, 'g/dL')} is very low; the correction becomes less reliable as albumin falls.`,
          `الألبومين ${show(alb, 'g/dL')} منخفض جداً؛ ويقل الاعتماد على التصحيح كلما انخفض الألبومين.`,
        ),
        ESCALATE,
      );
    }
    if (alb >= 4)
      warnings.push(
        L(
          'Albumin is not low: the correction is meant for a low albumin.',
          'الألبومين ليس منخفضاً: هذا التصحيح مخصص لانخفاض الألبومين.',
        ),
      );
    const sample = sameSample(inputs, ['level', 'albumin']);
    if (sample) warnings.push(sample);
    return {
      value,
      unit: 'mg/L',
      decimals: 1,
      assumptions: [
        renal
          ? L('Renal-failure form used (answered by the trainee).', 'استُخدمت صيغة القصور الكلوي (بإجابة المتدرب).')
          : L('Standard form used: no severe renal failure (answered by the trainee).', 'استُخدمت الصيغة المعتادة: لا قصور كلوي شديد (بإجابة المتدرب).'),
      ],
      warnings,
      steps: [
        given('Measured level', inputs.level!, 2),
        given('Albumin', inputs.albumin!, 2),
        `Denominator = ${k} × ${show(alb, '', 2)} + 0.1 = ${show(denom, '', 3)}`,
        step(`Corrected level = ${show(c, '', 2)} ÷ ${show(denom, '', 3)}`, value, 'mg/L', 1),
      ],
    };
  },
  limitations: [
    L(
      'An estimate. A measured free (unbound) phenytoin level is more reliable whenever it is available.',
      'تقدير فقط. مستوى الفينيتوين الحر المقاس أكثر موثوقية متى توفر.',
    ),
    L(
      'Not valid when another drug displaces phenytoin from albumin (for example valproate): measure a free level.',
      'لا يصح عندما يزيح دواء آخر الفينيتوين عن الألبومين (مثل الفالبروات): قِس المستوى الحر.',
    ),
    L(
      'Revised coefficients (for example 0.25 or 0.275 instead of 0.2) and other renal cut-offs have been published; this calculator uses the original equations.',
      'نُشرت معاملات معدّلة (مثل 0.25 أو 0.275 بدلاً من 0.2) وحدود كلوية أخرى؛ وهذه الحاسبة تستخدم المعادلات الأصلية.',
    ),
  ],
};

/**
 * Causality assessment of a suspected adverse drug reaction as structured
 * questionnaires, scored deterministically (Section 10). Each assessment is
 * attached to an ADR register row; the trainee's own judgement on the row
 * stays as written, and any difference is shown, never overwritten.
 *
 * - Naranjo CA, Busto U, Sellers EM, et al. A method for estimating the
 *   probability of adverse drug reactions. Clin Pharmacol Ther
 *   1981;30(2):239–245. Ten questions answered yes / no / do not know; the
 *   total gives definite (≥ 9), probable (5–8), possible (1–4), doubtful (≤ 0).
 * - Uppsala Monitoring Centre. The use of the WHO-UMC system for standardised
 *   case causality assessment. The categories are defined by criteria; here
 *   each criterion is one structured answer and the category follows from
 *   them by fixed rules, shown with the criteria that decided it.
 */
import { L } from '../domain/label';

// ---------------------------------------------------------------- Naranjo

export type NaranjoAnswer = 'yes' | 'no' | 'unknown';

export interface NaranjoQuestion {
  id: string;
  label: L;
  points: Record<NaranjoAnswer, number>;
}

const q = (id: string, en: string, ar: string, yes: number, no: number): NaranjoQuestion => ({ id, label: L(en, ar), points: { yes, no, unknown: 0 } });

export const NARANJO_QUESTIONS: readonly NaranjoQuestion[] = [
  q('previous', 'Are there previous conclusive reports on this reaction?', 'هل توجد تقارير سابقة قاطعة عن هذا التفاعل؟', 1, 0),
  q('after', 'Did the adverse event appear after the suspected drug was administered?', 'هل ظهر الحدث الضار بعد إعطاء الدواء المشتبه به؟', 2, -1),
  q('dechallenge', 'Did the adverse reaction improve when the drug was discontinued or a specific antagonist was administered?', 'هل تحسن التفاعل الضار عند إيقاف الدواء أو إعطاء مضاد نوعي؟', 1, 0),
  q('rechallenge', 'Did the adverse reaction reappear when the drug was readministered?', 'هل عاد التفاعل الضار عند إعادة إعطاء الدواء؟', 2, -1),
  q('alternative', 'Are there alternative causes (other than the drug) that could on their own have caused the reaction?', 'هل توجد أسباب بديلة (غير الدواء) يمكن أن تسبب التفاعل وحدها؟', -1, 2),
  q('placebo', 'Did the reaction reappear when a placebo was given?', 'هل عاد التفاعل عند إعطاء دواء وهمي؟', -1, 1),
  q('toxic', 'Was the drug detected in the blood (or other fluids) in concentrations known to be toxic?', 'هل اكتُشف الدواء في الدم (أو سوائل أخرى) بتراكيز معروف أنها سامة؟', 1, 0),
  q('dose', 'Was the reaction more severe when the dose was increased, or less severe when the dose was decreased?', 'هل اشتد التفاعل عند زيادة الجرعة أو خفّ عند تخفيضها؟', 1, 0),
  q('similar', 'Did the patient have a similar reaction to the same or similar drugs in any previous exposure?', 'هل حدث للمريض تفاعل مشابه مع الدواء نفسه أو أدوية مشابهة في تعرض سابق؟', 1, 0),
  q('objective', 'Was the adverse event confirmed by any objective evidence?', 'هل تأكد الحدث الضار بأي دليل موضوعي؟', 1, 0),
];

export type NaranjoCategory = 'definite' | 'probable' | 'possible' | 'doubtful';

export const NARANJO_CATEGORY_LABEL: Record<NaranjoCategory, L> = {
  definite: L('Definite (9 or more)', 'مؤكد (9 فأكثر)'),
  probable: L('Probable (5–8)', 'محتمل (5–8)'),
  possible: L('Possible (1–4)', 'ممكن (1–4)'),
  doubtful: L('Doubtful (0 or less)', 'مشكوك فيه (0 أو أقل)'),
};

export type NaranjoResult =
  | { ok: true; score: number; category: NaranjoCategory; steps: string[] }
  | { ok: false; unanswered: string[] };

/** Every question must be answered ("do not know" is an answer); nothing is defaulted. */
export function scoreNaranjo(answers: Readonly<Record<string, string>>): NaranjoResult {
  const unanswered = NARANJO_QUESTIONS.filter((x) => !['yes', 'no', 'unknown'].includes(answers[x.id] ?? '')).map((x) => x.id);
  if (unanswered.length) return { ok: false, unanswered };
  let score = 0;
  const steps: string[] = [];
  NARANJO_QUESTIONS.forEach((x, i) => {
    const a = answers[x.id] as NaranjoAnswer;
    const p = x.points[a];
    score += p;
    steps.push(`${i + 1}. ${a === 'unknown' ? 'do not know' : a} → ${p > 0 ? `+${p}` : p}`);
  });
  const category: NaranjoCategory = score >= 9 ? 'definite' : score >= 5 ? 'probable' : score >= 1 ? 'possible' : 'doubtful';
  steps.push(`Total = ${score} → ${category}`);
  return { ok: true, score, category, steps };
}

// ---------------------------------------------------------------- WHO-UMC

export interface UmcQuestion {
  id: 'time' | 'alternative' | 'dechallenge' | 'rechallenge' | 'definitive' | 'information';
  label: L;
  options: readonly { value: string; label: L }[];
}

export const UMC_QUESTIONS: readonly UmcQuestion[] = [
  {
    id: 'information',
    label: L('Is the information enough to judge?', 'هل المعلومات كافية للحكم؟'),
    options: [
      { value: 'sufficient', label: L('Yes', 'نعم') },
      { value: 'pending', label: L('Not yet — more data is needed or under examination', 'ليس بعد — تلزم بيانات إضافية أو هي قيد الفحص') },
      { value: 'insufficient', label: L('No — insufficient or contradictory, and it cannot be supplemented or verified', 'لا — غير كافية أو متناقضة، ولا يمكن استكمالها أو التحقق منها') },
    ],
  },
  {
    id: 'time',
    label: L('Time relationship between drug intake and the event', 'العلاقة الزمنية بين تناول الدواء والحدث'),
    options: [
      { value: 'reasonable', label: L('Plausible / reasonable', 'معقولة') },
      { value: 'improbable', label: L('Makes a relationship improbable (but not impossible)', 'تجعل العلاقة غير مرجّحة (لكنها ليست مستحيلة)') },
    ],
  },
  {
    id: 'alternative',
    label: L('Could the disease or other drugs explain the event?', 'هل يمكن أن يفسر المرض أو أدوية أخرى الحدث؟'),
    options: [
      { value: 'no', label: L('No — cannot be explained by them / unlikely to be attributed to them', 'لا — لا يفسرانه / لا يُرجَّح نسبته إليهما') },
      { value: 'could', label: L('Could also be explained by them', 'قد يفسرانه أيضاً') },
      { value: 'plausible', label: L('They provide a plausible explanation', 'يقدمان تفسيراً معقولاً') },
    ],
  },
  {
    id: 'dechallenge',
    label: L('Response to withdrawal of the drug (dechallenge)', 'الاستجابة لإيقاف الدواء'),
    options: [
      { value: 'reasonable', label: L('Plausible / clinically reasonable', 'معقولة سريرياً') },
      { value: 'unclear', label: L('Lacking or unclear', 'غير متوفرة أو غير واضحة') },
    ],
  },
  {
    id: 'rechallenge',
    label: L('Rechallenge', 'إعادة التعرض للدواء'),
    options: [
      { value: 'positive', label: L('Positive (the event recurred)', 'إيجابية (عاد الحدث)') },
      { value: 'not_done', label: L('Not done, or not needed', 'لم تُجرَ أو لم تكن لازمة') },
      { value: 'negative', label: L('Negative (it did not recur)', 'سلبية (لم يعد الحدث)') },
    ],
  },
  {
    id: 'definitive',
    label: L(
      'Is the event definitive pharmacologically or phenomenologically (an objective, specific disorder or a recognised pharmacological phenomenon)?',
      'هل الحدث قاطع دوائياً أو ظاهرياً (اضطراب موضوعي محدد أو ظاهرة دوائية معروفة)؟',
    ),
    options: [
      { value: 'yes', label: L('Yes', 'نعم') },
      { value: 'no', label: L('No', 'لا') },
    ],
  },
];

export type UmcCategory = 'certain' | 'probable' | 'possible' | 'unlikely' | 'conditional' | 'unassessable';

export const UMC_CATEGORY_LABEL: Record<UmcCategory, L> = {
  certain: L('Certain', 'مؤكد'),
  probable: L('Probable / likely', 'مرجّح'),
  possible: L('Possible', 'ممكن'),
  unlikely: L('Unlikely', 'غير مرجّح'),
  conditional: L('Conditional / unclassified', 'مشروط / غير مصنّف'),
  unassessable: L('Unassessable / unclassifiable', 'غير قابل للتقييم / للتصنيف'),
};

export type UmcResult = { ok: true; category: UmcCategory; reason: L } | { ok: false; unanswered: string[] };

/**
 * The fixed decision rules. Information is judged first; then the
 * categories are tried from the strongest to the weakest, and the first whose
 * criteria are all met is the result.
 */
export function assessUmc(a: Readonly<Record<string, string>>): UmcResult {
  if (!a.information) return { ok: false, unanswered: ['information'] };
  if (a.information === 'insufficient')
    return { ok: true, category: 'unassessable', reason: L('The information is insufficient or contradictory and cannot be supplemented or verified.', 'المعلومات غير كافية أو متناقضة ولا يمكن استكمالها أو التحقق منها.') };
  if (a.information === 'pending')
    return { ok: true, category: 'conditional', reason: L('More data is needed for a proper assessment, or is under examination.', 'تلزم بيانات إضافية لتقييم سليم، أو هي قيد الفحص.') };
  const unanswered = UMC_QUESTIONS.filter((x) => x.id !== 'information' && !x.options.some((o) => o.value === a[x.id])).map((x) => x.id);
  if (unanswered.length) return { ok: false, unanswered };
  const { time, alternative, dechallenge, rechallenge, definitive } = a;
  if (time === 'improbable') {
    return alternative === 'plausible' || alternative === 'could'
      ? { ok: true, category: 'unlikely', reason: L('The time to drug intake makes a relationship improbable, and the disease or other drugs provide an explanation.', 'الزمن من تناول الدواء يجعل العلاقة غير مرجّحة، والمرض أو أدوية أخرى تقدم تفسيراً.') }
      : { ok: true, category: 'conditional', reason: L('The timing makes a relationship improbable but nothing else explains the event: more data is needed.', 'التوقيت يجعل العلاقة غير مرجّحة لكن لا شيء آخر يفسر الحدث: تلزم بيانات إضافية.') };
  }
  if (alternative === 'no' && dechallenge === 'reasonable' && definitive === 'yes' && rechallenge !== 'negative')
    return {
      ok: true,
      category: 'certain',
      reason: L(
        'Plausible timing; not explained by disease or other drugs; plausible response to withdrawal; the event is definitive; no negative rechallenge.',
        'توقيت معقول؛ لا يفسره المرض أو أدوية أخرى؛ استجابة معقولة للإيقاف؛ الحدث قاطع؛ ولا توجد إعادة تعرض سلبية.',
      ),
    };
  if (alternative === 'no' && dechallenge === 'reasonable' && rechallenge !== 'negative')
    return {
      ok: true,
      category: 'probable',
      reason: L(
        'Reasonable timing; unlikely to be attributed to disease or other drugs; clinically reasonable response to withdrawal.',
        'توقيت معقول؛ لا يُرجَّح نسبته إلى المرض أو أدوية أخرى؛ استجابة معقولة سريرياً للإيقاف.',
      ),
    };
  return {
    ok: true,
    category: 'possible',
    reason: L(
      'Reasonable timing, but the disease or other drugs could also explain it, or the response to withdrawal is lacking or unclear (or a rechallenge was negative).',
      'توقيت معقول، لكن قد يفسره المرض أو أدوية أخرى أيضاً، أو أن الاستجابة للإيقاف غير متوفرة أو غير واضحة (أو كانت إعادة التعرض سلبية).',
    ),
  };
}

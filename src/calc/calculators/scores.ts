/**
 * Clinical scores: CURB-65, qSOFA, CHA₂DS₂-VASc and HAS-BLED. Each produces a
 * score with the items that earned it; none produces a treatment decision.
 */
import { L } from '../../domain/label';
import { AGE, DIASTOLIC, RESP_RATE, SEX, SYSTOLIC, UREA, finding } from '../inputs';
import type { CalcInputs, CalculatorDef } from '../types';
import { show } from '../units';
import { isFemale, sameSample, val, valueText, yes } from './common';

type Item = { label: string; points: number; why: string };

function tally(items: Item[]): { value: number; steps: string[] } {
  const value = items.reduce((s, i) => s + i.points, 0);
  return {
    value,
    steps: [...items.map((i) => `${i.label}: ${i.why} → ${i.points}`), `Total = ${items.map((i) => i.points).join(' + ')} = ${value}`],
  };
}

const yn = (inputs: CalcInputs, key: string) => (yes(inputs, key) ? 'yes' : 'no');

// ---------------------------------------------------------------- CURB-65

const CONFUSION = finding('confusion', L('New confusion', 'تشوّش ذهني جديد'), L('New disorientation in person, place or time.', 'اضطراب جديد في التوجه للأشخاص أو المكان أو الزمان.'));

export const curb65: CalculatorDef = {
  id: 'curb65',
  name: 'CURB-65',
  nameAr: 'مقياس CURB-65',
  purpose: L('Severity of community-acquired pneumonia at presentation.', 'شدة الالتهاب الرئوي المكتسب من المجتمع عند الحضور.'),
  formulaVersion: '1',
  citation:
    'Lim WS, van der Eerden MM, Laing R, et al. Defining community acquired pneumonia severity on presentation to hospital: an international derivation and validation study. Thorax 2003;58(5):377–382.',
  formula:
    'One point each: confusion; urea > 7 mmol/L; respiratory rate ≥ 30/min; systolic BP < 90 mmHg or diastolic BP ≤ 60 mmHg; age ≥ 65 years',
  requiredInputs: [CONFUSION, UREA, RESP_RATE, SYSTOLIC, DIASTOLIC, AGE],
  optionalInputs: [],
  compute(inputs) {
    const urea = val(inputs, 'urea');
    const rr = val(inputs, 'rr');
    const sbp = val(inputs, 'sbp');
    const dbp = val(inputs, 'dbp');
    const age = val(inputs, 'age');
    const { value, steps } = tally([
      { label: 'Confusion', points: yes(inputs, 'confusion') ? 1 : 0, why: yn(inputs, 'confusion') },
      { label: 'Urea > 7 mmol/L', points: urea > 7 ? 1 : 0, why: valueText(inputs.urea!, 1) },
      { label: 'Respiratory rate ≥ 30', points: rr >= 30 ? 1 : 0, why: show(rr, 'breaths/min', 0) },
      { label: 'SBP < 90 or DBP ≤ 60', points: sbp < 90 || dbp <= 60 ? 1 : 0, why: `${show(sbp, '', 0)}/${show(dbp, 'mmHg', 0)}` },
      { label: 'Age ≥ 65', points: age >= 65 ? 1 : 0, why: show(age, 'years', 0) },
    ]);
    const group =
      value <= 1
        ? { value: 'low', label: L('Score 0–1: lowest-risk group of the original study', 'الدرجة 0–1: المجموعة الأقل خطراً في الدراسة الأصلية') }
        : value === 2
          ? { value: 'intermediate', label: L('Score 2: intermediate group of the original study', 'الدرجة 2: المجموعة المتوسطة في الدراسة الأصلية') }
          : { value: 'high', label: L('Score 3–5: highest-risk group of the original study', 'الدرجة 3–5: المجموعة الأعلى خطراً في الدراسة الأصلية') };
    const warnings: L[] = [];
    const sample = sameSample(inputs, ['rr', 'sbp']);
    if (sample) warnings.push(sample);
    return {
      value,
      unit: 'points',
      decimals: 0,
      category: group,
      assumptions: [L('Confusion answered by the trainee from the record.', 'أجاب المتدرب عن التشوش الذهني من السجل.')],
      warnings,
      steps,
    };
  },
  limitations: [
    L(
      'Derived for adults with community-acquired pneumonia, from findings at presentation; not for hospital-acquired pneumonia or severe immunosuppression.',
      'اشتُق للبالغين المصابين بالالتهاب الرئوي المكتسب من المجتمع ومن نتائج الحضور؛ ولا يصلح للالتهاب الرئوي المكتسب في المستشفى أو كبت المناعة الشديد.',
    ),
    L(
      'A BUN result is converted to urea (÷ 2.801). The US adaptation counts BUN > 19 mg/dL, which differs for BUN between 19 and 19.6 mg/dL.',
      'تُحوَّل نتيجة BUN إلى يوريا (÷ 2.801). والتكييف الأمريكي يحتسب BUN أعلى من 19 mg/dL، ويختلف ذلك حين يكون BUN بين 19 و19.6 mg/dL.',
    ),
    L('The score supports, and never replaces, clinical judgement of where to treat.', 'المقياس يدعم الحكم السريري بشأن مكان العلاج ولا يحل محله.'),
  ],
};

// ---------------------------------------------------------------- qSOFA

const MENTATION = finding('alteredMentation', L('Altered mentation (GCS below 15)', 'تغير الحالة الذهنية (GCS أقل من 15)'));

export const qsofa: CalculatorDef = {
  id: 'qsofa',
  name: 'qSOFA',
  nameAr: 'مقياس qSOFA',
  purpose: L(
    'Bedside prompt for adults with suspected infection who are at higher risk of a poor outcome.',
    'تنبيه سريري للبالغين المشتبه بإصابتهم بعدوى والأكثر عرضة لنتيجة سيئة.',
  ),
  formulaVersion: '1',
  citation:
    'Seymour CW, Liu VX, Iwashyna TJ, et al. Assessment of clinical criteria for sepsis: for the Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3). JAMA 2016;315(8):762–774. Singer M, Deutschman CS, Seymour CW, et al. JAMA 2016;315(8):801–810.',
  formula: 'One point each: respiratory rate ≥ 22/min; altered mentation (GCS < 15); systolic BP ≤ 100 mmHg',
  requiredInputs: [RESP_RATE, MENTATION, SYSTOLIC],
  optionalInputs: [],
  compute(inputs) {
    const rr = val(inputs, 'rr');
    const sbp = val(inputs, 'sbp');
    const { value, steps } = tally([
      { label: 'Respiratory rate ≥ 22', points: rr >= 22 ? 1 : 0, why: show(rr, 'breaths/min', 0) },
      { label: 'Altered mentation', points: yes(inputs, 'alteredMentation') ? 1 : 0, why: yn(inputs, 'alteredMentation') },
      { label: 'Systolic BP ≤ 100', points: sbp <= 100 ? 1 : 0, why: show(sbp, 'mmHg', 0) },
    ]);
    const warnings: L[] = [];
    const sample = sameSample(inputs, ['rr', 'sbp']);
    if (sample) warnings.push(sample);
    return {
      value,
      unit: 'points',
      decimals: 0,
      category:
        value >= 2
          ? { value: 'positive', label: L('2 or more: higher risk of a poor outcome', '2 فأكثر: خطر أعلى لنتيجة سيئة') }
          : { value: 'negative', label: L('Below 2', 'أقل من 2') },
      assumptions: [L('Mentation answered by the trainee from the record.', 'أجاب المتدرب عن الحالة الذهنية من السجل.')],
      warnings,
      steps,
    };
  },
  limitations: [
    L(
      'Not a diagnostic criterion for sepsis, and a score below 2 does not rule it out. The Surviving Sepsis Campaign 2021 advises against qSOFA alone as a screening tool (Evans L, et al. Crit Care Med 2021;49(11):e1063–e1143).',
      'ليس معياراً لتشخيص الإنتان، والدرجة الأقل من 2 لا تنفيه. وتنصح حملة النجاة من الإنتان 2021 بعدم الاعتماد على qSOFA وحده أداةً للفرز (Evans وآخرون، Crit Care Med 2021).',
    ),
    L('Adults outside the ICU; not validated in children.', 'للبالغين خارج العناية المركزة؛ غير مُعتمد للأطفال.'),
  ],
};

// ---------------------------------------------------------------- CHA₂DS₂-VASc

const CHF = finding('chf', L('Congestive heart failure or left ventricular dysfunction', 'قصور القلب الاحتقاني أو خلل وظيفة البطين الأيسر'));
const HTN = finding('htn', L('Hypertension', 'ارتفاع ضغط الدم'));
const DM = finding('diabetes', L('Diabetes mellitus', 'داء السكري'));
const STROKE = finding('strokeTia', L('Prior stroke, TIA or thromboembolism', 'سكتة دماغية أو نوبة إقفارية عابرة أو انصمام خثاري سابق'));
const VASC = finding(
  'vascular',
  L('Vascular disease (prior myocardial infarction, peripheral artery disease or aortic plaque)', 'مرض وعائي (احتشاء قلبي سابق، مرض الشرايين الطرفية، أو لويحة أبهرية)'),
);

export const cha2ds2vasc: CalculatorDef = {
  id: 'cha2ds2vasc',
  name: 'CHA₂DS₂-VASc',
  nameAr: 'مقياس CHA₂DS₂-VASc',
  purpose: L('Stroke risk in atrial fibrillation.', 'خطر السكتة الدماغية في الرجفان الأذيني.'),
  formulaVersion: '1',
  citation:
    'Lip GYH, Nieuwlaat R, Pisters R, Lane DA, Crijns HJGM. Refining clinical risk stratification for predicting stroke and thromboembolism in atrial fibrillation using a novel risk factor-based approach: the Euro Heart Survey on atrial fibrillation. Chest 2010;137(2):263–272.',
  formula:
    'C heart failure 1; H hypertension 1; A₂ age ≥ 75 2; D diabetes 1; S₂ stroke/TIA/thromboembolism 2; V vascular disease 1; A age 65–74 1; Sc female sex 1',
  requiredInputs: [CHF, HTN, AGE, DM, STROKE, VASC, SEX],
  optionalInputs: [],
  compute(inputs) {
    const age = val(inputs, 'age');
    const female = isFemale(inputs);
    const { value, steps } = tally([
      { label: 'C — heart failure', points: yes(inputs, 'chf') ? 1 : 0, why: yn(inputs, 'chf') },
      { label: 'H — hypertension', points: yes(inputs, 'htn') ? 1 : 0, why: yn(inputs, 'htn') },
      { label: 'A — age', points: age >= 75 ? 2 : age >= 65 ? 1 : 0, why: show(age, 'years', 0) },
      { label: 'D — diabetes', points: yes(inputs, 'diabetes') ? 1 : 0, why: yn(inputs, 'diabetes') },
      { label: 'S — stroke/TIA/thromboembolism', points: yes(inputs, 'strokeTia') ? 2 : 0, why: yn(inputs, 'strokeTia') },
      { label: 'V — vascular disease', points: yes(inputs, 'vascular') ? 1 : 0, why: yn(inputs, 'vascular') },
      { label: 'Sc — sex category', points: female ? 1 : 0, why: female ? 'female' : 'male' },
    ]);
    return {
      value,
      unit: 'points',
      decimals: 0,
      assumptions: [L('Risk factors answered by the trainee from the record; age and sex from the case record.', 'أجاب المتدرب عن عوامل الخطر من السجل؛ والعمر والجنس من سجل الحالة.')],
      warnings: [],
      steps,
    };
  },
  limitations: [
    L('For atrial fibrillation without moderate–severe mitral stenosis or a mechanical valve.', 'للرجفان الأذيني دون تضيق تاجي متوسط إلى شديد أو صمام ميكانيكي.'),
    L(
      'The 2024 ESC guideline uses CHA₂DS₂-VA, without the sex point (Van Gelder IC, et al. Eur Heart J 2024;45(36):3314–3414).',
      'يعتمد دليل الجمعية الأوروبية لأمراض القلب 2024 مقياس CHA₂DS₂-VA دون نقطة الجنس (Van Gelder وآخرون، Eur Heart J 2024).',
    ),
    L('Whether to anticoagulate is a clinical decision made with the guideline, not by the score.', 'قرار مضادات التخثر قرار سريري يُتخذ وفق الدليل، لا بالمقياس وحده.'),
  ],
};

// ---------------------------------------------------------------- HAS-BLED

const UNCONTROLLED_HTN = finding('uncontrolledHtn', L('Uncontrolled hypertension (systolic above 160 mmHg)', 'ارتفاع ضغط غير مضبوط (الانقباضي أعلى من 160 mmHg)'));
const RENAL = finding(
  'abnormalRenal',
  L('Abnormal renal function (dialysis, transplant, or creatinine ≥ 2.26 mg/dL / 200 µmol/L)', 'وظيفة كلوية غير طبيعية (غسيل، زراعة، أو كرياتينين ≥ 2.26 mg/dL أو 200 µmol/L)'),
);
const LIVER = finding(
  'abnormalLiver',
  L(
    'Abnormal liver function (cirrhosis, or bilirubin > 2 × upper limit with AST/ALT/ALP > 3 × upper limit)',
    'وظيفة كبدية غير طبيعية (تليف، أو بيليروبين > ضعفي الحد الأعلى مع AST/ALT/ALP > 3 أضعاف الحد الأعلى)',
  ),
);
const STROKE_HB = finding('stroke', L('Prior stroke', 'سكتة دماغية سابقة'));
const BLEEDING = finding('bleeding', L('Prior major bleeding or a predisposition to bleeding', 'نزف كبير سابق أو استعداد للنزف'));
const LABILE = finding('labileInr', L('Labile INR (unstable or high, or time in therapeutic range below 60%)', 'INR غير مستقر (متقلب أو مرتفع، أو وقت في المدى العلاجي أقل من 60%)'));
const DRUGS = finding('drugs', L('Drugs predisposing to bleeding (antiplatelet agents, NSAIDs)', 'أدوية تهيئ للنزف (مضادات الصفائح، مضادات الالتهاب غير الستيرويدية)'));
const ALCOHOL = finding('alcohol', L('Alcohol excess (8 or more drinks a week)', 'الإفراط في الكحول (8 مشروبات أسبوعياً أو أكثر)'));

export const hasBled: CalculatorDef = {
  id: 'has_bled',
  name: 'HAS-BLED',
  nameAr: 'مقياس HAS-BLED',
  purpose: L('One-year risk of major bleeding in atrial fibrillation on anticoagulation.', 'خطر النزف الكبير خلال سنة لدى مرضى الرجفان الأذيني على مضادات التخثر.'),
  formulaVersion: '1',
  citation:
    'Pisters R, Lane DA, Nieuwlaat R, de Vos CB, Crijns HJGM, Lip GYH. A novel user-friendly score (HAS-BLED) to assess 1-year risk of major bleeding in patients with atrial fibrillation: the Euro Heart Survey. Chest 2010;138(5):1093–1100.',
  formula:
    'One point each: uncontrolled hypertension; abnormal renal function; abnormal liver function; stroke; bleeding; labile INR; elderly (> 65 years); drugs; alcohol',
  requiredInputs: [UNCONTROLLED_HTN, RENAL, LIVER, STROKE_HB, BLEEDING, LABILE, AGE, DRUGS, ALCOHOL],
  optionalInputs: [],
  compute(inputs) {
    const age = val(inputs, 'age');
    const { value, steps } = tally([
      { label: 'H — uncontrolled hypertension', points: yes(inputs, 'uncontrolledHtn') ? 1 : 0, why: yn(inputs, 'uncontrolledHtn') },
      { label: 'A — abnormal renal function', points: yes(inputs, 'abnormalRenal') ? 1 : 0, why: yn(inputs, 'abnormalRenal') },
      { label: 'A — abnormal liver function', points: yes(inputs, 'abnormalLiver') ? 1 : 0, why: yn(inputs, 'abnormalLiver') },
      { label: 'S — stroke', points: yes(inputs, 'stroke') ? 1 : 0, why: yn(inputs, 'stroke') },
      { label: 'B — bleeding', points: yes(inputs, 'bleeding') ? 1 : 0, why: yn(inputs, 'bleeding') },
      { label: 'L — labile INR', points: yes(inputs, 'labileInr') ? 1 : 0, why: yn(inputs, 'labileInr') },
      { label: 'E — elderly (> 65)', points: age > 65 ? 1 : 0, why: show(age, 'years', 0) },
      { label: 'D — drugs', points: yes(inputs, 'drugs') ? 1 : 0, why: yn(inputs, 'drugs') },
      { label: 'D — alcohol', points: yes(inputs, 'alcohol') ? 1 : 0, why: yn(inputs, 'alcohol') },
    ]);
    return {
      value,
      unit: 'points',
      decimals: 0,
      category:
        value >= 3
          ? { value: 'high', label: L('3 or more: high risk in the original study', '3 فأكثر: خطر مرتفع في الدراسة الأصلية') }
          : { value: 'lower', label: L('Below 3', 'أقل من 3') },
      assumptions: [L('Items answered by the trainee from the record; age from the case record.', 'أجاب المتدرب عن البنود من السجل؛ والعمر من سجل الحالة.')],
      warnings: [],
      steps,
    };
  },
  limitations: [
    L(
      'A high score calls for attention to the modifiable risk factors and closer review; on its own it is not a reason to withhold anticoagulation.',
      'الدرجة المرتفعة تستدعي الانتباه لعوامل الخطر القابلة للتعديل والمتابعة الأدق؛ ولا تُعد وحدها سبباً لحجب مضادات التخثر.',
    ),
  ],
};

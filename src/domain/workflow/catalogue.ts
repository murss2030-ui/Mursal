/**
 * The Clinical Modules: the thirty tasks of a hospital clinical pharmacist,
 * as listed by the owner (change request, 15 October 2026), grouped into
 * eight modules that follow the Pharmacists' Patient Care Process
 * (Collect → Assess → Plan → Implement → Follow up) of Section 8.
 *
 * Task numbers and Arabic titles are the owner's own. Each task carries
 * teaching content (why and how), a checklist the trainee answers, the
 * registers it shares with other tasks, the data it depends on, and what the
 * later milestones add. The application never answers a task for the
 * trainee: every answer is the trainee's own entry. From M3 the model may
 * draft suggestions (owner decisions D2, D3; src/ai/analysis), but nothing
 * enters a worksheet until the trainee accepts or edits that one item, and
 * what only the trainee can record is never drafted (src/ai/analysis/limits.ts).
 */
import type { CalculatorId } from '../../calc/types';
import type { Milestone } from '../../config/release';
import { L } from '../label';
import type { RegisterId } from '../types';
import type { Choice } from './registers';

export type ModuleId = 'collect' | 'review' | 'dosing' | 'safety' | 'plan' | 'followup' | 'discharge' | 'document';

export interface CheckDef {
  id: string;
  label: L;
}

export interface TaskFieldDef {
  id: string;
  kind: 'text' | 'longtext' | 'choice' | 'multi';
  label: L;
  hint?: L;
  options?: readonly Choice[];
  /** Counted in the task's progress, like a checklist item. */
  tracked?: boolean;
}

export interface Section {
  checks: readonly CheckDef[];
  fields?: readonly TaskFieldDef[];
}

/** A section repeated for each active medication or each problem. */
export interface ScopedSection extends Section {
  /** A yes/no question deciding whether the section applies (e.g. "Is this an antimicrobial?"). */
  applies?: L;
}

export type ReadinessId =
  | 'demographics'
  | 'weight'
  | 'height'
  | 'cc'
  | 'hpi'
  | 'pmh'
  | 'allergy'
  | 'social'
  | 'vitals'
  | 'scr'
  | 'electrolytes'
  | 'cbc'
  | 'lft'
  | 'bilirubin'
  | 'albumin'
  | 'inr'
  | 'problems'
  | 'primary_dx'
  | 'meds'
  | 'home_meds'
  | 'cultures'
  | 'drug_levels'
  | 'sources'
  | 'dialysis';

export type PanelId =
  | 'sources'
  | 'inpatient_meds'
  | 'allergies'
  | 'no_indication'
  | 'cultures'
  | 'antimicrobial_days'
  | 'drug_levels'
  | 'lab_trends'
  | 'monitoring_due'
  | 'rounds_brief'
  | 'interventions'
  | 'care_plan';

export interface TaskDef {
  id: string;
  number: number;
  module: ModuleId;
  title: L;
  purpose: L;
  steps: readonly L[];
  case?: Section;
  perMedication?: ScopedSection;
  perProblem?: ScopedSection;
  registers?: readonly RegisterId[];
  needs?: readonly ReadinessId[];
  panels?: readonly PanelId[];
  /** M2: tested calculators shown in the worksheet, beside the trainee's own calculation checks. */
  calculators?: readonly CalculatorId[];
  later?: readonly { milestone: Milestone; what: L }[];
}

export interface ModuleDef {
  id: ModuleId;
  title: L;
  subtitle: L;
  tasks: readonly string[];
}

const ck = (id: string, en: string, ar: string): CheckDef => ({ id, label: L(en, ar) });
const ch = (value: string, en: string, ar: string): Choice => ({ value, label: L(en, ar) });

// ---------------------------------------------------------------- modules

export const MODULES: readonly ModuleDef[] = [
  { id: 'collect', title: L('Collect', 'جمع البيانات'), subtitle: L('The patient file, history and medication history', 'ملف المريض والتاريخ المرضي والدوائي'), tasks: ['t01', 't02', 't22'] },
  { id: 'review', title: L('Medication review', 'مراجعة العلاج'), subtitle: L('Orders, appropriateness and decisions', 'الأوامر الدوائية والملاءمة والقرارات'), tasks: ['t03', 't04', 't16', 't28'] },
  { id: 'dosing', title: L('Dosing', 'الجرعات'), subtitle: L('Organ function, calculations and drug levels', 'وظائف الأعضاء والحسابات ومستويات الأدوية'), tasks: ['t08', 't09', 't10'] },
  { id: 'safety', title: L('Safety', 'السلامة الدوائية'), subtitle: L('Interactions, adverse reactions and errors', 'التداخلات والتفاعلات الضارة والأخطاء'), tasks: ['t06', 't07', 't26', 't19'] },
  {
    id: 'plan',
    title: L('Problems & plan', 'المشكلات والخطة'),
    subtitle: L('DRPs, recommendations, stewardship, prophylaxis and cost', 'المشكلات الدوائية والتوصيات وترشيد المضادات والوقاية والتكلفة'),
    tasks: ['t05', 't13', 't14', 't27', 't24'],
  },
  { id: 'followup', title: L('Rounds & follow-up', 'الجولات والمتابعة'), subtitle: L('Rounds, monitoring and response to therapy', 'الجولات والمراقبة والاستجابة للعلاج'), tasks: ['t12', 't11', 't15', 't29'] },
  { id: 'discharge', title: L('Discharge & counselling', 'الخروج والتثقيف'), subtitle: L('Discharge review, the home plan and patient education', 'مراجعة الخروج والخطة المنزلية وتثقيف المريض'), tasks: ['t20', 't21', 't17'] },
  { id: 'document', title: L('Document & learn', 'التوثيق والتعلّم'), subtitle: L('Documentation, protocols, learning and the whole picture', 'التوثيق والبروتوكولات والتعلم والصورة الكاملة'), tasks: ['t18', 't23', 't25', 't30'] },
];

// ---------------------------------------------------------------- shared choices

const ADJUST: readonly Choice[] = [
  ch('needed', 'Adjustment needed', 'التعديل مطلوب'),
  ch('not_needed', 'No adjustment needed', 'لا يلزم تعديل'),
  ch('not_applicable', 'Not relevant for this drug', 'غير ذي صلة بهذا الدواء'),
  ch('unsure', 'Unsure — needs checking', 'غير متأكد — يحتاج تحققاً'),
];

const PROPHYLAXIS: readonly Choice[] = [
  ch('indicated_given', 'Indicated and prescribed', 'مستطَبة وموصوفة'),
  ch('indicated_missing', 'Indicated but not prescribed', 'مستطَبة وغير موصوفة'),
  ch('not_indicated', 'Not indicated', 'غير مستطَبة'),
  ch('given_not_indicated', 'Prescribed without an indication', 'موصوفة دون استطباب'),
  ch('contraindicated', 'Contraindicated', 'مضاد استطباب'),
  ch('not_assessed', 'Not assessed yet', 'لم تُقيَّم بعد'),
];

const COMPETENCIES: readonly Choice[] = [
  ch('direct_patient_care', 'Direct patient care', 'الرعاية المباشرة للمريض'),
  ch('pharmacotherapy_knowledge', 'Pharmacotherapy knowledge', 'المعرفة بالعلاج الدوائي'),
  ch('systems_based_care', 'Systems-based care', 'الرعاية القائمة على الأنظمة'),
  ch('communication', 'Communication', 'التواصل'),
  ch('professionalism', 'Professionalism', 'المهنية'),
  ch('continuing_development', 'Continuing development', 'التطوير المستمر'),
];

// ---------------------------------------------------------------- the thirty tasks

const TASK_LIST: readonly TaskDef[] = [
  // ============================================================ 1 · Collect
  {
    id: 't01',
    number: 1,
    module: 'collect',
    title: L('Patient Data Collection', 'جمع بيانات المريض وتاريخه المرضي والدوائي'),
    purpose: L(
      'Build a complete and verified picture of the patient before judging any therapy.',
      'بناء صورة كاملة وموثّقة عن المريض قبل الحكم على أي علاج.',
    ),
    steps: [
      L(
        'Start from the patient file you added (notes, laboratory printouts, medication chart) and transcribe each fact onto the timeline with its hospital day.',
        'ابدأ من ملف المريض الذي أضفته (الملاحظات، نتائج المختبر، جدول الأدوية) وانقل كل معلومة إلى الخط الزمني مع يومها.',
      ),
      L('Record weight with how it was obtained (measured, stated or estimated), and height.', 'سجّل الوزن مع طريقة الحصول عليه (مقاس أو مصرّح به أو تقديري)، والطول.'),
      L(
        'Take the history: chief complaint, HPI, past medical and surgical history, family and social history including khat and tobacco.',
        'خذ التاريخ: الشكوى الرئيسية، تاريخ المرض الحالي، التاريخ المرضي والجراحي، والتاريخ العائلي والاجتماعي بما فيه القات والتبغ.',
      ),
      L(
        'Document allergies and previous ADRs with the reaction — or record NKDA explicitly.',
        'وثّق الحساسية والتفاعلات الضارة السابقة مع نوع التفاعل — أو سجّل صراحةً عدم وجود حساسية معروفة (NKDA).',
      ),
      L(
        'Enter vital signs and laboratory results with units and reference ranges, plus cultures and imaging reports.',
        'أدخل العلامات الحيوية والنتائج المخبرية مع الوحدات والمدى المرجعي، والمزارع وتقارير التصوير.',
      ),
      L('Build the problem list (acute or chronic, status) and mark the primary diagnosis.', 'ابنِ قائمة المشكلات (حادة أو مزمنة، وحالتها) وحدّد التشخيص الرئيسي.'),
    ],
    needs: ['demographics', 'weight', 'height', 'cc', 'hpi', 'pmh', 'allergy', 'social', 'vitals', 'scr', 'electrolytes', 'cbc', 'lft', 'problems', 'primary_dx', 'meds', 'sources'],
    panels: ['sources'],
    case: {
      checks: [
        ck('verified', 'Every transcribed value checked against its source', 'تمت مطابقة كل قيمة منقولة مع مصدرها'),
        ck('unclear', 'Unclear or illegible items listed for clarification with the team', 'تم حصر البنود غير الواضحة أو غير المقروءة لتوضيحها مع الفريق'),
        ck('interview', 'Patient or family interviewed where possible', 'تمت مقابلة المريض أو أسرته متى أمكن'),
      ],
      fields: [{ id: 'gaps', kind: 'longtext', label: L('Information that could not be obtained, and why', 'معلومات تعذّر الحصول عليها ولماذا') }],
    },
    later: [
      {
        milestone: 'M3',
        what: L(
          'Photograph a page and let the extraction engine propose values — each one confirmed by you against the source before it can be used.',
          'تصوير صفحة ليقترح محرك الاستخراج القيم — وتؤكد كل قيمة بنفسك مقابل المصدر قبل استخدامها.',
        ),
      },
    ],
  },
  {
    id: 't02',
    number: 2,
    module: 'collect',
    title: L('Medication Reconciliation', 'مراجعة التاريخ الدوائي عند الدخول'),
    purpose: L('Build the best possible medication history and reconcile it with the admission orders.', 'بناء أفضل تاريخ دوائي ممكن ومطابقته مع أوامر الدخول.'),
    steps: [
      L(
        'Collect the pre-admission list from at least two sources: patient or family interview, medication containers, prescriptions or clinic letters, a previous discharge summary, the community pharmacy, the medical record.',
        'اجمع قائمة ما قبل الدخول من مصدرين على الأقل: مقابلة المريض أو أسرته، علب الأدوية، الوصفات أو رسائل العيادات، ملخص خروج سابق، الصيدلية المجتمعية، الملف الطبي.',
      ),
      L(
        'Ask specifically about over-the-counter medicines, herbal and traditional remedies, supplements, eye drops, inhalers and injections.',
        'اسأل تحديداً عن الأدوية دون وصفة، والأعشاب والعلاجات الشعبية، والمكملات، والقطرات، والبخاخات، والحقن.',
      ),
      L(
        'For each medication record the dose, route and frequency as actually taken, the indication and the last dose taken.',
        'سجّل لكل دواء الجرعة وطريقة الإعطاء والتكرار كما يتناوله فعلاً، ودواعي الاستعمال، وآخر جرعة أُخذت.',
      ),
      L('Compare with the admission orders: continued, changed, held, discontinued or not ordered.', 'قارن مع أوامر الدخول: استمر، عُدّل، أوقف مؤقتاً، أوقف نهائياً، أو لم يُطلب.'),
      L(
        'Classify every difference as intentional and documented, intentional but undocumented, or unintentional.',
        'صنّف كل اختلاف: مقصود وموثّق، أو مقصود غير موثّق، أو غير مقصود.',
      ),
      L('Resolve unintentional discrepancies with the prescriber and record the action taken.', 'عالج التباينات غير المقصودة مع الطبيب الواصف وسجّل الإجراء المتخذ.'),
    ],
    registers: ['home_med'],
    needs: ['allergy', 'meds', 'home_meds'],
    panels: ['inpatient_meds'],
    case: {
      checks: [
        ck('two_sources', 'At least two sources used for the history', 'استُخدم مصدران على الأقل للتاريخ الدوائي'),
        ck('otc_herbal', 'OTC, herbal and traditional products asked about', 'تم السؤال عن الأدوية دون وصفة والأعشاب والعلاجات الشعبية'),
        ck('allergies_confirmed', 'Allergies confirmed with the patient', 'تم تأكيد الحساسية مع المريض'),
        ck('all_compared', 'Every home medication compared with the admission orders', 'تمت مقارنة كل أدوية المنزل مع أوامر الدخول'),
        ck('new_orders', 'Every new inpatient order has an indication', 'لكل دواء جديد أثناء الإقامة سبب واضح'),
        ck('discrepancies_resolved', 'Unintentional discrepancies communicated to the prescriber', 'تم إبلاغ الطبيب بالتباينات غير المقصودة'),
      ],
    },
  },
  {
    id: 't22',
    number: 22,
    module: 'collect',
    title: L('Medication Adherence', 'متابعة التزام المريض بالعلاج'),
    purpose: L(
      'Find out how the patient really took their medicines before admission and what gets in the way.',
      'معرفة كيف كان المريض يتناول أدويته فعلاً قبل الدخول وما الذي يعيق التزامه.',
    ),
    steps: [
      L(
        'Ask open, non-judgemental questions: “Many people miss doses — how often does it happen to you?”',
        'اطرح أسئلة مفتوحة غير اتهامية: «كثير من الناس ينسون بعض الجرعات — كم مرة يحدث ذلك معك؟»',
      ),
      L('Check refill history, remaining tablets or containers where available.', 'تحقق من سجل صرف الأدوية أو الحبوب المتبقية أو العلب متى توفرت.'),
      L(
        'Identify barriers: cost and availability, side effects, complex regimens, beliefs, forgetfulness, khat-chewing hours, literacy.',
        'حدّد العوائق: التكلفة والتوفر، الأعراض الجانبية، تعقيد النظام العلاجي، المعتقدات، النسيان، أوقات تخزين القات، القدرة على القراءة.',
      ),
      L(
        'Agree on practical solutions: simplify the regimen, align doses with the daily routine, involve the family, use reminders.',
        'اتفق على حلول عملية: تبسيط النظام، وربط الجرعات بالروتين اليومي، وإشراك الأسرة، واستخدام المنبّهات.',
      ),
    ],
    registers: ['home_med'],
    needs: ['home_meds'],
    case: {
      checks: [
        ck('asked_each', 'Asked how each medication is actually taken', 'تم السؤال عن طريقة تناول كل دواء فعلياً'),
        ck('barriers_explored', 'Barriers explored without judgement', 'تم استكشاف العوائق دون إطلاق أحكام'),
        ck('plan_agreed', 'A plan agreed with the patient or family', 'تم الاتفاق على خطة مع المريض أو أسرته'),
      ],
      fields: [
        {
          id: 'overall',
          kind: 'choice',
          tracked: true,
          label: L('Overall adherence before admission', 'الالتزام العام قبل الدخول'),
          options: [ch('good', 'Good', 'جيد'), ch('partial', 'Partial', 'جزئي'), ch('poor', 'Poor', 'ضعيف'), ch('unknown', 'Unknown', 'غير معروف')],
        },
        {
          id: 'methods',
          kind: 'multi',
          label: L('How you assessed it', 'كيف قيّمته'),
          options: [
            ch('self_report', 'Patient report', 'إفادة المريض'),
            ch('caregiver', 'Caregiver report', 'إفادة مقدم الرعاية'),
            ch('pill_count', 'Pill count', 'عدّ الحبوب'),
            ch('refill', 'Refill history', 'سجل الصرف'),
            ch('containers', 'Containers', 'العلب'),
          ],
        },
        {
          id: 'barriers',
          kind: 'multi',
          label: L('Barriers found', 'العوائق التي وُجدت'),
          options: [
            ch('cost', 'Cost', 'التكلفة'),
            ch('availability', 'Availability', 'عدم التوفر'),
            ch('side_effects', 'Side effects', 'الأعراض الجانبية'),
            ch('complexity', 'Complex regimen', 'تعقيد النظام'),
            ch('beliefs', 'Beliefs or concerns', 'المعتقدات أو المخاوف'),
            ch('forgetfulness', 'Forgetfulness', 'النسيان'),
            ch('khat', 'Khat-chewing schedule', 'أوقات تخزين القات'),
            ch('literacy', 'Reading or health literacy', 'القراءة أو الوعي الصحي'),
            ch('none', 'None found', 'لم توجد عوائق'),
          ],
        },
        { id: 'plan', kind: 'longtext', label: L('Adherence plan', 'خطة دعم الالتزام') },
      ],
    },
  },

  // ============================================================ 2 · Medication review
  {
    id: 't03',
    number: 3,
    module: 'review',
    title: L('Prescription Review', 'مراجعة الوصفات والأدوية الموصوفة'),
    purpose: L(
      'Check every active order for completeness, clarity and appropriateness for this patient.',
      'التحقق من كل أمر دوائي فعّال من حيث الاكتمال والوضوح والملاءمة لهذا المريض.',
    ),
    steps: [
      L('Go through the orders one by one — do not skip as-needed or one-off orders.', 'راجع الأوامر واحداً تلو الآخر — لا تتجاوز الأوامر عند الحاجة أو الجرعات الفردية.'),
      L(
        'Check that each order is complete: drug, dose with unit, route, frequency, duration, indication.',
        'تأكد من اكتمال كل أمر: الدواء، الجرعة مع الوحدة، طريقة الإعطاء، التكرار، المدة، ودواعي الاستعمال.',
      ),
      L(
        'Check appropriateness against age, weight, organ function, allergies and the other drugs.',
        'تحقق من الملاءمة بالنسبة للعمر والوزن ووظائف الأعضاء والحساسية والأدوية الأخرى.',
      ),
      L('Mark anything wrong as a problem and turn it into a DRP card.', 'علّم أي خلل كمشكلة وحوّله إلى بطاقة مشكلة دوائية.'),
    ],
    needs: ['meds', 'allergy', 'weight', 'scr'],
    calculators: ['crcl_cg', 'egfr_ckdepi2021'],
    perMedication: {
      checks: [
        ck('indication', 'Indication documented', 'دواعي الاستعمال موثّقة'),
        ck('choice', 'Drug choice appropriate for the indication and the patient', 'اختيار الدواء مناسب للدواعي وللمريض'),
        ck('dose', 'Dose appropriate for age, weight and organ function', 'الجرعة مناسبة للعمر والوزن ووظائف الأعضاء'),
        ck('frequency', 'Frequency and timing appropriate', 'التكرار والتوقيت مناسبان'),
        ck('route', 'Route and dosage form appropriate (swallowing, NG tube, IV access)', 'طريقة الإعطاء والشكل الصيدلاني مناسبان (البلع، الأنبوب الأنفي المعدي، الوصول الوريدي)'),
        ck('duration', 'Duration or stop date defined', 'المدة أو موعد الإيقاف محددان'),
        ck('clear', 'Order complete and unambiguous (units in full, no error-prone abbreviations)', 'الأمر مكتمل وواضح (الوحدات مكتوبة كاملة، دون اختصارات معرّضة للخطأ)'),
        ck('duplication', 'No therapeutic duplication', 'لا توجد ازدواجية علاجية'),
        ck('allergy', 'Checked against allergies and previous ADRs', 'تمت مقارنته بالحساسية والتفاعلات الضارة السابقة'),
        ck('administration', 'Administration checked (dilution, compatibility, crushing, infusion time)', 'تمت مراجعة طريقة الإعطاء (التخفيف، التوافق، السحق، مدة التسريب)'),
      ],
    },
  },
  {
    id: 't04',
    number: 4,
    module: 'review',
    title: L('Drug Therapy Assessment', 'تقييم ملاءمة العلاج الدوائي للحالة المرضية'),
    purpose: L(
      'For each problem, judge whether the therapy is indicated, effective, safe and workable for this patient.',
      'الحكم لكل مشكلة على ما إذا كان العلاج مستطَباً وفعالاً وآمناً وعملياً لهذا المريض.',
    ),
    steps: [
      L('Take one problem at a time and list the drugs used for it.', 'خذ مشكلة واحدة في كل مرة واذكر الأدوية المستخدمة لها.'),
      L('Indication: does every drug have a reason, and does the problem have the therapy it needs?', 'الاستطباب: هل لكل دواء سبب، وهل تحصل المشكلة على العلاج الذي تحتاجه؟'),
      L('Effectiveness: is the goal of therapy defined, and is the patient moving towards it?', 'الفعالية: هل هدف العلاج محدد، وهل يتقدم المريض نحوه؟'),
      L('Safety: any adverse effect, contraindication, interaction or toxicity signal?', 'السلامة: هل توجد أعراض جانبية أو مضاد استطباب أو تداخل أو علامات سمية؟'),
      L('Adherence and practicality: can the patient get, afford and take it?', 'الالتزام والجانب العملي: هل يستطيع المريض الحصول عليه وتحمّل تكلفته وتناوله؟'),
      L(
        'This four-question frame (Cipolle, Strand and Morley) is a teaching aid. Drug-related problems are classified with PCNE V9.1 on the Problem Card — the two systems are not equivalent.',
        'هذا الإطار ذو الأسئلة الأربعة (Cipolle وStrand وMorley) أداة تعليمية. أما المشكلات الدوائية فتُصنَّف وفق PCNE V9.1 في بطاقة المشكلة — والنظامان غير متكافئين.',
      ),
    ],
    needs: ['problems', 'meds'],
    panels: ['no_indication'],
    perProblem: {
      checks: [
        ck('indication', 'Indication: the problem has the therapy it needs, and no drug lacks a reason', 'الاستطباب: المشكلة تحصل على العلاج الذي تحتاجه ولا يوجد دواء بلا سبب'),
        ck('effectiveness', 'Effectiveness: goal defined and progress towards it', 'الفعالية: الهدف محدد ويوجد تقدم نحوه'),
        ck('safety', 'Safety: no adverse effect, contraindication or toxicity', 'السلامة: لا أعراض جانبية ولا مضاد استطباب ولا سمية'),
        ck('adherence', 'Adherence and practicality: the patient can obtain and take it', 'الالتزام والجانب العملي: يستطيع المريض الحصول عليه وتناوله'),
      ],
      fields: [
        { id: 'goal', kind: 'text', label: L('Goal of therapy', 'هدف العلاج') },
        { id: 'assessment', kind: 'longtext', label: L('Your assessment', 'تقييمك') },
      ],
    },
  },
  {
    id: 't16',
    number: 16,
    module: 'review',
    title: L('Start, Stop or Adjust Assessment', 'تقييم الحاجة إلى بدء الدواء أو إيقافه أو تعديل جرعته'),
    purpose: L(
      'Decide, drug by drug, whether therapy should continue, be adjusted or be stopped — and whether something is missing.',
      'تقرير ما إذا كان كل دواء يجب أن يستمر أو يُعدَّل أو يوقف — وما إذا كان هناك علاج ناقص.',
    ),
    steps: [
      L('For each active drug, ask: is it still needed, at this dose, by this route, for this long?', 'اسأل لكل دواء فعّال: هل ما زال لازماً، بهذه الجرعة، وبهذه الطريقة، ولهذه المدة؟'),
      L(
        'Look for untreated indications: a problem without therapy, missing prophylaxis, missing secondary prevention.',
        'ابحث عن دواعٍ غير معالَجة: مشكلة بلا علاج، أو وقاية ناقصة، أو وقاية ثانوية ناقصة.',
      ),
      L(
        'Look for deprescribing opportunities: no current indication, harm outweighing benefit, duplication.',
        'ابحث عن فرص إيقاف الأدوية: لا داعي حالياً، أو الضرر يفوق الفائدة، أو ازدواجية.',
      ),
      L(
        'Write the reason for every decision and turn each proposed change into a DRP card with a recommendation.',
        'اكتب سبب كل قرار وحوّل كل تغيير مقترح إلى بطاقة مشكلة دوائية مع توصية.',
      ),
    ],
    needs: ['meds', 'problems'],
    case: {
      checks: [
        ck('untreated_checked', 'Checked for untreated indications', 'تم البحث عن دواعٍ غير معالَجة'),
        ck('deprescribing_checked', 'Checked for drugs that are no longer needed', 'تم البحث عن أدوية لم تعد لازمة'),
      ],
      fields: [
        { id: 'untreated', kind: 'longtext', label: L('Untreated indications found', 'دواعٍ غير معالَجة') },
        { id: 'deprescribe', kind: 'longtext', label: L('Deprescribing opportunities', 'فرص إيقاف أدوية غير لازمة') },
      ],
    },
    perMedication: {
      checks: [],
      fields: [
        {
          id: 'decision',
          kind: 'choice',
          tracked: true,
          label: L('Your assessment', 'تقييمك'),
          options: [
            ch('continue', 'Continue', 'يستمر'),
            ch('adjust', 'Adjust dose or regimen', 'تعديل الجرعة أو النظام'),
            ch('stop', 'Stop', 'إيقاف'),
            ch('switch', 'Switch drug or route', 'التحويل إلى دواء أو طريقة أخرى'),
            ch('review', 'Review later', 'مراجعة لاحقاً'),
          ],
        },
        { id: 'reason', kind: 'text', label: L('Reason', 'السبب') },
      ],
    },
  },
  {
    id: 't28',
    number: 28,
    module: 'review',
    title: L('High-Alert Medications', 'مراجعة الأدوية عالية الخطورة'),
    purpose: L(
      'Identify medicines with a heightened risk of serious harm when used in error, and make sure safeguards are in place.',
      'تحديد الأدوية التي يرتفع خطر ضررها الجسيم عند الخطأ في استخدامها، والتأكد من وجود الضمانات اللازمة.',
    ),
    steps: [
      L(
        "Use your hospital's high-alert list. PRECEPTOR ships no list: the published ISMP list is copyrighted.",
        'استخدم قائمة الأدوية عالية الخطورة في مستشفاك. لا يتضمن PRECEPTOR قائمة جاهزة لأن قائمة ISMP المنشورة محمية بحقوق النشر.',
      ),
      L(
        "Typical groups include anticoagulants, insulin, opioids, concentrated electrolytes, chemotherapy, sedatives and neuromuscular blockers — confirm against your hospital's list.",
        'تشمل المجموعات المعتادة مضادات التخثر والإنسولين والأفيونات والكهارل المركزة والعلاج الكيميائي والمهدئات ومرخيات العضلات العصبية — تحقق منها مقابل قائمة مستشفاك.',
      ),
      L(
        'For each high-alert drug check the safeguards: independent double-check, standard concentration, pump settings, monitoring, antidote.',
        'تحقق لكل دواء عالي الخطورة من الضمانات: التحقق المزدوج المستقل، التركيز القياسي، إعدادات المضخة، المراقبة، الترياق.',
      ),
    ],
    needs: ['meds'],
    perMedication: {
      applies: L("Is this a high-alert medication on your hospital's list?", 'هل هذا الدواء ضمن قائمة الأدوية عالية الخطورة في مستشفاك؟'),
      checks: [
        ck('double_check', 'Independent double-check before administration', 'تحقق مزدوج مستقل قبل الإعطاء'),
        ck('concentration', 'Standard concentration and clear labelling', 'تركيز قياسي وملصق واضح'),
        ck('pump', 'Infusion pump and rate verified (if infused)', 'التحقق من المضخة ومعدل التسريب (إن كان بالتسريب)'),
        ck('monitoring', 'Monitoring defined (e.g. glucose, INR or aPTT, sedation and breathing, potassium)', 'المراقبة محددة (مثل السكر، INR أو aPTT، التهدئة والتنفس، البوتاسيوم)'),
        ck('antidote', 'Antidote or reversal agent availability considered', 'تم التأكد من توفر الترياق أو العامل المعاكس'),
        ck('informed', 'Patient or caregiver told the warning signs', 'تم إعلام المريض أو مقدم الرعاية بعلامات الخطر'),
      ],
    },
  },

  // ============================================================ 3 · Dosing
  {
    id: 't08',
    number: 8,
    module: 'dosing',
    title: L('Renal & Hepatic Dose Adjustment', 'ضبط الجرعات وفق وظائف الكلى والكبد'),
    purpose: L('Match every renally or hepatically cleared drug to this patient’s organ function.', 'مواءمة كل دواء يُطرح كلوياً أو كبدياً مع وظائف أعضاء هذا المريض.'),
    steps: [
      L(
        'Confirm the inputs: age, sex, weight (and which weight), serum creatinine with its day, dialysis status.',
        'تأكد من المدخلات: العمر، الجنس، الوزن (وأي وزن)، الكرياتينين مع يومه، وحالة الغسيل الكلوي.',
      ),
      L(
        'Is renal function stable? An unstable creatinine (acute kidney injury) makes any estimate unreliable.',
        'هل وظيفة الكلى مستقرة؟ الكرياتينين غير المستقر (إصابة كلوية حادة) يجعل أي تقدير غير موثوق.',
      ),
      L(
        'Use CrCl (Cockcroft–Gault) for dosing where your reference does; eGFR is a staging tool — the two are not interchangeable.',
        'استخدم CrCl (Cockcroft–Gault) لتحديد الجرعات حين يعتمده مرجعك؛ أما eGFR فأداة لتصنيف المراحل — وهما غير قابلين للتبادل.',
      ),
      L(
        'For the liver, look at bilirubin, albumin, INR, ascites and encephalopathy; Child–Pugh has limits for dosing.',
        'للكبد، انظر إلى البيليروبين والألبومين وINR والاستسقاء والاعتلال الدماغي؛ ولتصنيف Child–Pugh حدود في تحديد الجرعات.',
      ),
      L('For each drug, check your reference for an adjustment and record the source.', 'راجع لكل دواء مرجعك بشأن التعديل وسجّل المصدر.'),
    ],
    needs: ['demographics', 'weight', 'scr', 'dialysis', 'bilirubin', 'albumin', 'inr', 'meds'],
    registers: ['calc_check'],
    calculators: ['crcl_cg', 'egfr_ckdepi2021', 'child_pugh'],
    case: {
      checks: [
        ck('inputs', 'Inputs confirmed, including which weight and the creatinine day', 'تم تأكيد المدخلات بما فيها نوع الوزن ويوم الكرياتينين'),
        ck('stability', 'Stability of renal function assessed', 'تم تقييم استقرار وظيفة الكلى'),
      ],
      fields: [{ id: 'values_used', kind: 'longtext', label: L('Values you used and why', 'القيم التي استخدمتها ولماذا') }],
    },
    perMedication: {
      checks: [],
      fields: [
        { id: 'renal', kind: 'choice', tracked: true, label: L('Renal adjustment', 'التعديل الكلوي'), options: ADJUST },
        { id: 'hepatic', kind: 'choice', tracked: true, label: L('Hepatic adjustment', 'التعديل الكبدي'), options: ADJUST },
        { id: 'source', kind: 'text', label: L('Source checked', 'المصدر الذي راجعته') },
        { id: 'action', kind: 'text', label: L('Proposed action', 'الإجراء المقترح') },
      ],
    },
  },
  {
    id: 't09',
    number: 9,
    module: 'dosing',
    title: L('Dose & Infusion Calculations', 'حساب الجرعات ومعدلات التسريب الوريدي'),
    purpose: L(
      'Verify weight-based doses, concentrations and infusion rates before they reach the patient.',
      'التحقق من الجرعات المحسوبة بالوزن والتراكيز ومعدلات التسريب قبل وصولها إلى المريض.',
    ),
    steps: [
      L('Write every input with its unit; never assume a unit.', 'اكتب كل مدخل مع وحدته؛ ولا تفترض وحدة أبداً.'),
      L('State which weight you used (actual, ideal or adjusted) and why.', 'اذكر أي وزن استخدمت (الفعلي أو المثالي أو المعدّل) ولماذا.'),
      L('Show the formula and the substitution, then compare the result with your reference.', 'اعرض المعادلة والتعويض، ثم قارن النتيجة بمرجعك.'),
      L('For infusions: dose → concentration → rate (mL/h); check the pump programming and compatibility.', 'للتسريب: الجرعة ← التركيز ← المعدل (مل/ساعة)؛ وتحقق من برمجة المضخة والتوافق.'),
      L('Have every high-risk calculation double-checked independently.', 'اطلب تحققاً مستقلاً مزدوجاً لكل حساب عالي الخطورة.'),
    ],
    needs: ['weight', 'height', 'demographics'],
    registers: ['calc_check'],
    calculators: ['ibw_adjbw', 'bsa_mosteller', 'bmi', 'infusion_rate_weight', 'infusion_rate_volume'],
    perMedication: {
      applies: L('Is this given by IV infusion or as a weight-based dose?', 'هل يُعطى هذا الدواء بالتسريب الوريدي أو بجرعة محسوبة بالوزن؟'),
      checks: [
        ck('weight_used', 'The weight used is documented and appropriate', 'الوزن المستخدم موثّق ومناسب'),
        ck('concentration', 'Concentration and diluent appropriate', 'التركيز والمُخفّف مناسبان'),
        ck('rate', 'Rate within the limits in your reference', 'المعدل ضمن الحدود في مرجعك'),
        ck('pump', 'Pump programming checked', 'تم التحقق من برمجة المضخة'),
        ck('compatibility', 'Compatible with co-infused drugs and the line', 'متوافق مع الأدوية المسرّبة معه ومع الخط الوريدي'),
      ],
    },
    later: [
    ],
  },
  {
    id: 't10',
    number: 10,
    module: 'dosing',
    title: L('Therapeutic Drug Monitoring (TDM)', 'متابعة مستويات الأدوية في الدم'),
    purpose: L(
      'Use drug levels — or, where levels cannot be measured, clinical monitoring — to keep narrow-therapeutic-index drugs effective and safe.',
      'استخدام مستويات الدواء — أو المراقبة السريرية حين يتعذر القياس — لإبقاء الأدوية ضيقة المدى العلاجي فعالة وآمنة.',
    ),
    steps: [
      L('Know why the level is taken: efficacy, toxicity or adherence.', 'اعرف سبب قياس المستوى: الفعالية أو السمية أو الالتزام.'),
      L(
        'Interpret a level only with its exact timing relative to the dose, and whether steady state was reached.',
        'لا تفسّر المستوى إلا مع توقيته الدقيق بالنسبة للجرعة، ومعرفة الوصول إلى الحالة المستقرة.',
      ),
      L(
        'Record the level on the timeline with its clock time (Add entry → Lab result) so it stays traceable.',
        'سجّل المستوى في الخط الزمني مع وقته (إضافة → نتيجة مخبرية) ليبقى قابلاً للتتبع.',
      ),
      L(
        'If no level can be measured, document the no-level path: which clinical signs and laboratory tests you will follow instead.',
        'إن تعذر قياس المستوى فوثّق المسار البديل: ما العلامات السريرية والفحوص المخبرية التي ستتابعها بدلاً منه.',
      ),
    ],
    needs: ['drug_levels', 'scr', 'weight'],
    registers: ['tdm'],
    panels: ['drug_levels'],
    calculators: ['vancomycin_auc', 'vancomycin_empiric', 'phenytoin_corrected'],
  },

  // ============================================================ 4 · Safety
  {
    id: 't06',
    number: 6,
    module: 'safety',
    title: L('Drug–Drug Interactions', 'اكتشاف التداخلات الدوائية'),
    purpose: L(
      'Find interactions between the patient’s drugs — and with diseases, food and khat — and decide what to do about each.',
      'اكتشاف التداخلات بين أدوية المريض — ومع الأمراض والغذاء والقات — وتقرير ما يجب فعله في كل منها.',
    ),
    steps: [
      L('Check every pair of active drugs, including home, OTC and herbal products.', 'افحص كل زوج من الأدوية الفعّالة، بما فيها أدوية المنزل والأدوية دون وصفة والأعشاب.'),
      L(
        'Check drug–disease interactions (renal or hepatic impairment, heart failure…) and drug–food and khat interactions.',
        'افحص تداخلات الدواء مع المرض (القصور الكلوي أو الكبدي، قصور القلب…) ومع الغذاء والقات.',
      ),
      L('Judge clinical significance for this patient — not every listed interaction matters.', 'قيّم الأهمية السريرية لهذا المريض — فليس كل تداخل مذكور مهماً.'),
      L('Choose a management: avoid the combination, adjust the dose, separate the timing, or monitor.', 'اختر طريقة التعامل: تجنب الجمع، أو تعديل الجرعة، أو الفصل الزمني، أو المراقبة.'),
      L('Record where you checked each interaction.', 'سجّل أين تحققت من كل تداخل.'),
    ],
    needs: ['meds', 'home_meds', 'problems'],
    calculators: ['qtc_bazett'],
    registers: ['interaction'],
    case: {
      checks: [
        ck('pairs', 'All active drug pairs reviewed', 'تمت مراجعة جميع أزواج الأدوية الفعّالة'),
        ck('home_otc', 'Home, OTC and herbal products included', 'تم تضمين أدوية المنزل والأدوية دون وصفة والأعشاب'),
        ck('disease', 'Drug–disease interactions considered', 'تم النظر في تداخلات الدواء مع المرض'),
        ck('food_khat', 'Drug–food and khat interactions considered', 'تم النظر في تداخلات الدواء مع الغذاء والقات'),
      ],
    },
    later: [
      {
        milestone: 'M2',
        what: L(
          'The ONC high-priority list, which raises an interaction to critical, is not installed yet: its full text could not be obtained. DDInter interactions are checked automatically; a pair the DDInter files do not cover is listed as not checked.',
          'قائمة ONC عالية الأولوية، التي ترفع التداخل إلى مستوى حرج، غير مثبتة بعد: تعذّر الحصول على نصها الكامل. تُفحص تداخلات DDInter تلقائياً، ويُذكر الزوج الذي لا تغطيه ملفات DDInter على أنه لم يُفحص.',
        ),
      },
    ],
  },
  {
    id: 't07',
    number: 7,
    module: 'safety',
    title: L('Adverse Drug Reactions (ADRs)', 'اكتشاف الآثار الجانبية للأدوية'),
    purpose: L(
      'Recognise suspected adverse drug reactions early, assess them and manage them.',
      'التعرف المبكر على التفاعلات الدوائية الضارة المشتبه بها وتقييمها وإدارتها.',
    ),
    steps: [
      L('For any new symptom, sign or laboratory change, ask: could a drug have caused it?', 'اسأل عند أي عرض أو علامة أو تغير مخبري جديد: هل يمكن أن يكون الدواء سببه؟'),
      L('Check the timing: did it start after the drug was started or the dose increased?', 'تحقق من التوقيت: هل بدأ بعد بدء الدواء أو زيادة الجرعة؟'),
      L('Look for other explanations: the disease itself, other drugs, procedures.', 'ابحث عن تفسيرات أخرى: المرض نفسه، أدوية أخرى، إجراءات.'),
      L('Note what happened when the drug was stopped or reduced (dechallenge).', 'سجّل ما حدث عند إيقاف الدواء أو تخفيض جرعته (Dechallenge).'),
      L(
        "Manage the reaction and, if confirmed, add it to the patient's allergy and ADR history.",
        'عالج التفاعل، وأضفه عند تأكيده إلى سجل الحساسية والتفاعلات الضارة لدى المريض.',
      ),
    ],
    needs: ['allergy', 'meds'],
    registers: ['adr'],
    panels: ['allergies'],
    case: {
      checks: [
        ck('new_findings', 'New symptoms and laboratory changes reviewed for a drug cause', 'تمت مراجعة الأعراض والتغيرات المخبرية الجديدة بحثاً عن سبب دوائي'),
        ck('timing', 'Timing relative to drug start assessed', 'تم تقييم التوقيت بالنسبة لبدء الدواء'),
        ck('alternatives', 'Other causes considered', 'تم النظر في أسباب أخرى'),
        ck('history_updated', 'Allergy and ADR history updated if confirmed', 'تم تحديث سجل الحساسية والتفاعلات الضارة عند التأكيد'),
      ],
    },
  },
  {
    id: 't26',
    number: 26,
    module: 'safety',
    title: L('Medication Safety', 'تعزيز سلامة الدواء ومنع الأخطاء الدوائية'),
    purpose: L(
      'Prevent medication errors at every step: prescribing, transcribing, dispensing, administering and monitoring.',
      'منع الأخطاء الدوائية في كل خطوة: الوصف والنقل والصرف والإعطاء والمراقبة.',
    ),
    steps: [
      L('Walk the medication process for this patient and look for weak points.', 'تتبّع مسار الدواء لهذا المريض وابحث عن نقاط الضعف.'),
      L(
        'Look-alike and sound-alike names, error-prone abbreviations and verbal orders are common causes.',
        'الأسماء المتشابهة شكلاً أو نطقاً والاختصارات المعرّضة للخطأ والأوامر الشفهية أسباب شائعة.',
      ),
      L('Transitions — admission, transfer, discharge — are where errors cluster.', 'مراحل الانتقال — الدخول والنقل والخروج — هي حيث تتجمع الأخطاء.'),
      L('Record every error or near miss you find, and what would prevent it.', 'سجّل كل خطأ أو خطأ وشيك تجده، وما الذي يمنع تكراره.'),
    ],
    needs: ['allergy', 'meds'],
    registers: ['med_error'],
    case: {
      checks: [
        ck('allergy_visible', 'Allergy status visible on the medication chart', 'حالة الحساسية ظاهرة في جدول الأدوية'),
        ck('lasa', 'Look-alike and sound-alike names checked', 'تم التحقق من الأسماء المتشابهة شكلاً أو نطقاً'),
        ck('abbreviations', 'No error-prone abbreviations or trailing zeros', 'لا توجد اختصارات معرّضة للخطأ أو أصفار زائدة'),
        ck('iv_prep', 'IV preparation and administration checked', 'تمت مراجعة تحضير وإعطاء الأدوية الوريدية'),
        ck('high_alert', 'High-alert safeguards in place (Task 28)', 'ضمانات الأدوية عالية الخطورة مطبقة (المهمة 28)'),
        ck('timing', 'Administration times fit meals, khat hours and other drugs', 'أوقات الإعطاء تتناسب مع الوجبات وأوقات القات والأدوية الأخرى'),
        ck('transitions', 'Transfer and discharge orders checked', 'تمت مراجعة أوامر النقل والخروج'),
      ],
    },
  },
  {
    id: 't19',
    number: 19,
    module: 'safety',
    title: L('Pharmacovigilance & Medication Errors', 'الإبلاغ عن الآثار الجانبية والأخطاء الدوائية'),
    purpose: L(
      'Report suspected ADRs and medication errors through the official channels so the system can learn.',
      'الإبلاغ عن التفاعلات الضارة المشتبه بها والأخطاء الدوائية عبر القنوات الرسمية ليتعلم النظام منها.',
    ),
    steps: [
      L('Report even when you are not certain — suspicion is enough for pharmacovigilance.', 'أبلغ حتى عند عدم اليقين — فالاشتباه كافٍ في اليقظة الدوائية.'),
      L(
        "Use the hospital's reporting form or the national pharmacovigilance centre's form.",
        'استخدم نموذج الإبلاغ في المستشفى أو نموذج المركز الوطني لليقظة الدوائية.',
      ),
      L('Medication-error reports focus on the system, not on blaming a person.', 'تركّز تقارير الأخطاء الدوائية على النظام لا على لوم الأشخاص.'),
      L('PRECEPTOR never sends a report: submit it yourself, then record it here.', 'لا يرسل PRECEPTOR أي بلاغ: قدّمه بنفسك ثم سجّل ذلك هنا.'),
    ],
    registers: ['adr', 'med_error'],
    case: {
      checks: [
        ck('adrs_reported', 'Every suspected ADR has a reporting decision', 'لكل تفاعل ضار مشتبه به قرار إبلاغ'),
        ck('errors_reported', 'Every error or near miss has a reporting decision', 'لكل خطأ أو خطأ وشيك قرار إبلاغ'),
        ck('lessons', 'Lessons shared with the team', 'تمت مشاركة الدروس المستفادة مع الفريق'),
      ],
    },
  },

  // ============================================================ 5 · Problems & plan
  {
    id: 't05',
    number: 5,
    module: 'plan',
    title: L('Drug-Related Problems (DRPs)', 'تحديد المشكلات المتعلقة بالأدوية'),
    purpose: L(
      'Turn your findings into a prioritised list of drug-related problems, each backed by evidence and with a plan.',
      'تحويل ملاحظاتك إلى قائمة مرتبة بالأولوية من المشكلات الدوائية، لكل منها دليل وخطة.',
    ),
    steps: [
      L('One problem per card, stated in one sentence.', 'مشكلة واحدة لكل بطاقة، مصاغة في جملة واحدة.'),
      L("Support it with this patient's data, each value with its day.", 'ادعمها ببيانات هذا المريض، كل قيمة مع يومها.'),
      L('Name what is missing rather than guessing.', 'اذكر ما هو ناقص بدلاً من التخمين.'),
      L('Prioritise — critical, important or informational — and say why.', 'رتّب الأولوية — حرجة أو مهمة أو للعلم — واذكر السبب.'),
      L('Propose a specific, feasible recommendation and how you will monitor it.', 'اقترح توصية محددة وقابلة للتطبيق وكيف ستراقبها.'),
    ],
    registers: ['drp'],
    case: {
      checks: [
        ck('all_findings', 'Problems found in the other tasks are on this list', 'المشكلات المكتشفة في المهام الأخرى مدرجة في هذه القائمة'),
        ck('prioritised', 'Every problem has a priority and a reason', 'لكل مشكلة أولوية وسبب'),
      ],
    },
  },
  {
    id: 't13',
    number: 13,
    module: 'plan',
    title: L('Pharmacotherapy Recommendations', 'تقديم التوصيات الدوائية للفريق الطبي'),
    purpose: L(
      'Communicate each recommendation clearly to the right person and record what the team decided.',
      'إبلاغ كل توصية بوضوح إلى الشخص المناسب وتسجيل قرار الفريق.',
    ),
    steps: [
      L('Prepare each recommendation with SBAR: Situation, Background, Assessment, Recommendation.', 'جهّز كل توصية بأسلوب SBAR: الموقف، الخلفية، التقييم، التوصية.'),
      L('Be specific: what to change, why, and how it will be monitored.', 'كن محدداً: ما الذي يُغيَّر، ولماذا، وكيف ستتم مراقبته.'),
      L('Discuss with your preceptor before communicating anything outside the teaching setting.', 'ناقش مع مشرفك قبل إبلاغ أي شيء خارج الإطار التعليمي.'),
      L(
        'Record who you spoke to, when, and their response; a declined recommendation keeps its reason.',
        'سجّل مع من تحدثت ومتى وما كان الرد؛ والتوصية المرفوضة يُحفظ سبب رفضها.',
      ),
    ],
    registers: ['drp'],
    case: {
      checks: [
        ck('sbar', 'Each recommendation prepared in SBAR form', 'كل توصية مُعدّة بأسلوب SBAR'),
        ck('preceptor', 'Discussed with my preceptor first', 'نوقشت مع مشرفي أولاً'),
        ck('responses', 'Team response recorded for every communicated recommendation', 'رد الفريق مسجّل لكل توصية مُبلَّغة'),
      ],
    },
  },
  {
    id: 't14',
    number: 14,
    module: 'plan',
    title: L('Antimicrobial Stewardship', 'تحسين استخدام المضادات الحيوية'),
    purpose: L(
      'Make sure every antimicrobial has the right indication, drug, dose, route and duration — and is narrowed or stopped as soon as possible.',
      'التأكد من أن لكل مضاد ميكروبي الاستطباب والدواء والجرعة والطريقة والمدة الصحيحة — وأنه يُضيَّق أو يوقف في أقرب وقت ممكن.',
    ),
    steps: [
      L('Confirm the infection and its site; send cultures before the first dose when possible.', 'تأكد من وجود العدوى وموقعها؛ وأرسل المزارع قبل الجرعة الأولى متى أمكن.'),
      L('Check the empiric choice against the likely organisms, local resistance and allergies.', 'قارن الاختيار التجريبي بالجراثيم المحتملة والمقاومة المحلية والحساسية.'),
      L('Optimise the dose for the site, weight and organ function.', 'حسّن الجرعة بحسب موقع العدوى والوزن ووظائف الأعضاء.'),
      L('At 48–72 hours, review: continue, narrow (de-escalate), switch IV to oral, or stop.', 'راجع عند 48–72 ساعة: الاستمرار أو التضييق أو التحويل من الوريد إلى الفم أو الإيقاف.'),
      L('Document a planned duration or stop date.', 'وثّق مدة مخططة أو موعد إيقاف.'),
    ],
    needs: ['cultures', 'allergy', 'scr', 'weight'],
    calculators: ['curb65', 'qsofa', 'crcl_cg'],
    panels: ['cultures', 'antimicrobial_days'],
    perMedication: {
      applies: L('Is this an antimicrobial?', 'هل هذا الدواء مضاد ميكروبي؟'),
      checks: [
        ck('indication', 'Infection and site documented', 'العدوى وموقعها موثّقان'),
        ck('cultures', 'Cultures sent before the first dose', 'أُرسلت المزارع قبل الجرعة الأولى'),
        ck('empiric', 'Spectrum fits the likely organisms, local resistance and allergies', 'الطيف يناسب الجراثيم المحتملة والمقاومة المحلية والحساسية'),
        ck('dose', 'Dose optimised for site, weight and organ function', 'الجرعة مُحسّنة للموقع والوزن ووظائف الأعضاء'),
        ck('timeout', '48–72 hour review documented', 'مراجعة 48–72 ساعة موثّقة'),
        ck('deescalation', 'De-escalation considered once results are available', 'تم النظر في التضييق بعد ظهور النتائج'),
        ck('iv_po', 'IV-to-oral switch considered', 'تم النظر في التحويل من الوريد إلى الفم'),
        ck('duration', 'Planned duration or stop date documented', 'المدة المخططة أو موعد الإيقاف موثّق'),
      ],
    },
  },
  {
    id: 't27',
    number: 27,
    module: 'plan',
    title: L('Pharmacological Prophylaxis', 'تقييم الحاجة إلى الوقاية الدوائية'),
    purpose: L(
      'Check whether the patient needs preventive therapy — and whether what is prescribed is still indicated.',
      'التحقق مما إذا كان المريض يحتاج علاجاً وقائياً — وما إذا كان الموصوف حالياً ما زال مستطَباً.',
    ),
    steps: [
      L(
        "VTE: assess thrombosis and bleeding risk with your hospital's tool, then choose pharmacological or mechanical prophylaxis.",
        'الانصمام الخثاري الوريدي: قيّم خطر التخثر وخطر النزف بأداة مستشفاك، ثم اختر الوقاية الدوائية أو الميكانيكية.',
      ),
      L(
        'Stress ulcer: prophylaxis only with a recognised risk factor — and stop it when the risk resolves.',
        'قرحة الشدة: الوقاية فقط عند وجود عامل خطر معترف به — وأوقفها عند زوال الخطر.',
      ),
      L(
        'Other prophylaxis: surgical antibiotic timing and duration, and any other preventive therapy.',
        'وقاية أخرى: توقيت ومدة المضاد الحيوي الوقائي في الجراحة، وأي علاج وقائي آخر.',
      ),
      L(
        'VTE risk tools (for example Padua or Caprini) are not among the tested calculators: record the tool and the result you used. CHA₂DS₂-VASc and HAS-BLED (atrial fibrillation) are below. Prophylaxis without an indication is a DRP too.',
        'أدوات تقييم خطر الانصمام الخثاري (مثل Padua أو Caprini) ليست ضمن الحاسبات المختبرة: سجّل الأداة والنتيجة التي استخدمتها. ومقياسا CHA₂DS₂-VASc وHAS-BLED (للرجفان الأذيني) متاحان أدناه. والوقاية دون استطباب هي أيضاً مشكلة دوائية.',
      ),
    ],
    needs: ['meds', 'problems', 'scr'],
    calculators: ['cha2ds2vasc', 'has_bled'],
    case: {
      checks: [],
      fields: [
        { id: 'vte', kind: 'choice', tracked: true, label: L('VTE prophylaxis', 'الوقاية من الانصمام الخثاري الوريدي'), options: PROPHYLAXIS },
        { id: 'vte_note', kind: 'text', label: L('VTE: risk tool, result and bleeding risk', 'الانصمام: أداة تقييم الخطر ونتيجتها وخطر النزف') },
        { id: 'sup', kind: 'choice', tracked: true, label: L('Stress-ulcer prophylaxis', 'الوقاية من قرحة الشدة'), options: PROPHYLAXIS },
        { id: 'sup_note', kind: 'text', label: L('Stress ulcer: risk factor', 'قرحة الشدة: عامل الخطر') },
        { id: 'other', kind: 'choice', tracked: true, label: L('Other prophylaxis', 'وقاية أخرى'), options: PROPHYLAXIS },
        { id: 'other_note', kind: 'text', label: L('Other: which, and why', 'غير ذلك: ما هي ولماذا') },
      ],
    },
  },
  {
    id: 't24',
    number: 24,
    module: 'plan',
    title: L('Medication Use & Cost Optimization', 'المساهمة في ترشيد استهلاك الأدوية وتكاليف العلاج'),
    purpose: L(
      'Use medicines wisely: nothing unnecessary, the most cost-effective appropriate option, and the simplest effective route.',
      'استخدام الأدوية بحكمة: لا شيء غير ضروري، والخيار المناسب الأعلى فعالية مقابل التكلفة، وأبسط طريقة إعطاء فعالة.',
    ),
    steps: [
      L('Remove drugs without an indication, and duplicates.', 'أزل الأدوية بلا استطباب والأدوية المكررة.'),
      L('Switch from IV to oral when the patient is stable and can take oral medicines.', 'حوّل من الوريد إلى الفم حين يكون المريض مستقراً ويستطيع تناول الأدوية بالفم.'),
      L(
        'Prefer drugs available in the hospital and affordable for the patient; suggest an alternative when an agent is not available.',
        'فضّل الأدوية المتوفرة في المستشفى والمناسبة لقدرة المريض المادية؛ واقترح بديلاً حين لا يتوفر الدواء.',
      ),
      L('Avoid durations longer than needed.', 'تجنب المدد الأطول من اللازم.'),
    ],
    needs: ['meds'],
    case: {
      checks: [
        ck('unnecessary', 'No unnecessary or duplicate drugs', 'لا توجد أدوية غير ضرورية أو مكررة'),
        ck('iv_po', 'IV-to-oral opportunities reviewed', 'تمت مراجعة فرص التحويل من الوريد إلى الفم'),
        ck('availability', 'Prescribed drugs available in the hospital (alternatives proposed if not)', 'الأدوية الموصوفة متوفرة في المستشفى (واقتُرحت بدائل إن لم تتوفر)'),
        ck('affordability', 'Cost to the patient considered', 'تمت مراعاة التكلفة على المريض'),
        ck('duration', 'Durations not longer than needed', 'المدد ليست أطول من اللازم'),
      ],
      fields: [{ id: 'impact', kind: 'longtext', label: L('Optimisation proposed and its expected impact', 'التحسين المقترح وأثره المتوقع') }],
    },
  },

  // ============================================================ 6 · Rounds & follow-up
  {
    id: 't12',
    number: 12,
    module: 'followup',
    title: L('Medical Rounds', 'المشاركة في الجولات الطبية'),
    purpose: L(
      'Prepare for rounds, contribute the pharmacotherapy view, and capture what was decided.',
      'الاستعداد للجولات، والمساهمة بالرأي الدوائي، وتسجيل ما تقرر.',
    ),
    steps: [
      L(
        'Before rounds, read the brief below: problems, active drugs, latest key laboratory values, open problems and monitoring due.',
        'قبل الجولة، اقرأ الملخص أدناه: المشكلات، الأدوية الفعالة، أحدث القيم المخبرية المهمة، المشكلات المفتوحة والمراقبة المستحقة.',
      ),
      L('Prepare one or two focused points and bring the data that supports them.', 'جهّز نقطة أو نقطتين مركّزتين واحمل البيانات الداعمة لها.'),
      L('Speak at the right moment, briefly, with a clear recommendation.', 'تحدث في الوقت المناسب، باختصار، وبتوصية واضحة.'),
      L('After rounds, log the points raised, the decisions and what to follow up.', 'بعد الجولة، سجّل النقاط المطروحة والقرارات وما يجب متابعته.'),
    ],
    registers: ['rounds'],
    panels: ['rounds_brief'],
    case: {
      checks: [
        ck('prepared', 'Prepared before rounds', 'تم التحضير قبل الجولة'),
        ck('contributed', 'Attended and contributed', 'تم الحضور والمساهمة'),
        ck('logged', 'Decisions logged and follow-up planned', 'تم تسجيل القرارات وتخطيط المتابعة'),
      ],
    },
  },
  {
    id: 't11',
    number: 11,
    module: 'followup',
    title: L('Laboratory & Clinical Monitoring', 'متابعة التحاليل والمؤشرات السريرية'),
    purpose: L(
      'Follow the laboratory values and clinical signs that show whether therapy is working and safe.',
      'متابعة القيم المخبرية والعلامات السريرية التي تبين ما إذا كان العلاج فعالاً وآمناً.',
    ),
    steps: [
      L('For each active drug and problem, decide which parameters matter and how often to check them.', 'حدّد لكل دواء ومشكلة فعّالة المؤشرات المهمة وعدد مرات فحصها.'),
      L('Read trends, not single values: compare with the previous result and the day it was drawn.', 'اقرأ الاتجاهات لا القيم المنفردة: قارن بالنتيجة السابقة ويوم سحبها.'),
      L('Set a next-check day for every parameter so nothing is forgotten.', 'حدّد يوم الفحص القادم لكل مؤشر حتى لا يُنسى شيء.'),
      L('Interpret every abnormal value yourself and record its clinical significance.', 'فسّر بنفسك كل قيمة غير طبيعية وسجّل أهميتها السريرية.'),
    ],
    needs: ['scr', 'electrolytes', 'cbc', 'vitals'],
    calculators: ['anion_gap', 'corrected_calcium', 'anc'],
    registers: ['monitoring'],
    panels: ['monitoring_due', 'lab_trends'],
    case: {
      checks: [
        ck('plan_defined', 'A monitoring plan exists for each high-risk drug', 'توجد خطة مراقبة لكل دواء عالي الخطورة'),
        ck('trends', 'Trends reviewed for the key laboratory values', 'تمت مراجعة اتجاهات القيم المخبرية المهمة'),
        ck('abnormal', 'Every abnormal result interpreted', 'تم تفسير كل نتيجة غير طبيعية'),
      ],
    },
  },
  {
    id: 't15',
    number: 15,
    module: 'followup',
    title: L('Efficacy & Safety Monitoring', 'متابعة فعالية العلاج وسلامته'),
    purpose: L(
      'For every therapy, define what success looks like and what harm to watch for — then check both.',
      'تحديد معنى النجاح والضرر الذي يجب مراقبته لكل علاج — ثم التحقق من الاثنين.',
    ),
    steps: [
      L(
        'Efficacy: choose a measurable marker and a target (temperature, blood pressure, glucose, pain score…).',
        'الفعالية: اختر مؤشراً قابلاً للقياس وهدفاً (الحرارة، ضغط الدم، السكر، شدة الألم…).',
      ),
      L('Safety: name the main adverse effect of each drug and how you will detect it.', 'السلامة: سمِّ أهم عرض جانبي لكل دواء وكيف ستكتشفه.'),
      L('Decide when the drug should have worked — “too early to judge” is a valid answer.', 'حدّد متى يُفترض أن يظهر أثر الدواء — و«مبكر للحكم» إجابة صحيحة.'),
    ],
    needs: ['meds', 'vitals'],
    registers: ['monitoring'],
    perMedication: {
      checks: [],
      fields: [
        { id: 'efficacy', kind: 'text', label: L('Efficacy marker and target', 'مؤشر الفعالية والهدف') },
        {
          id: 'efficacyStatus',
          kind: 'choice',
          tracked: true,
          label: L('Efficacy so far', 'الفعالية حتى الآن'),
          options: [
            ch('effective', 'Effective', 'فعّال'),
            ch('partial', 'Partly effective', 'فعّال جزئياً'),
            ch('not_effective', 'Not effective', 'غير فعّال'),
            ch('too_early', 'Too early to judge', 'مبكر للحكم'),
          ],
        },
        { id: 'safety', kind: 'text', label: L('Safety marker', 'مؤشر السلامة') },
        {
          id: 'safetyStatus',
          kind: 'choice',
          tracked: true,
          label: L('Safety so far', 'السلامة حتى الآن'),
          options: [
            ch('no_concern', 'No concern', 'لا توجد مشكلة'),
            ch('concern', 'Concern — record an ADR or a DRP', 'مشكلة — سجّل تفاعلاً ضاراً أو مشكلة دوائية'),
            ch('too_early', 'Too early to judge', 'مبكر للحكم'),
          ],
        },
      ],
    },
  },
  {
    id: 't29',
    number: 29,
    module: 'followup',
    title: L('Response Evaluation & Plan Adjustment', 'تقييم الاستجابة العلاجية وتعديل الخطة الدوائية بالتعاون مع الفريق الطبي'),
    purpose: L(
      'Close the loop: measure the result of each intervention and adjust the plan together with the medical team.',
      'إغلاق الحلقة: قياس نتيجة كل تدخل وتعديل الخطة بالتعاون مع الفريق الطبي.',
    ),
    steps: [
      L('For each implemented recommendation, measure the outcome you planned to monitor.', 'قِس لكل توصية منفّذة النتيجة التي خططت لمراقبتها.'),
      L('“Not yet measured” is a valid answer — never record an outcome you have not measured.', '«لم تُقَس بعد» إجابة صحيحة — ولا تسجّل أبداً نتيجة لم تقسها.'),
      L('If the goal is not met, reassess: dose, adherence, diagnosis, drug choice.', 'إن لم يتحقق الهدف فأعد التقييم: الجرعة، الالتزام، التشخيص، اختيار الدواء.'),
      L('Agree on changes with the team and record them as new recommendations.', 'اتفق على التغييرات مع الفريق وسجّلها كتوصيات جديدة.'),
    ],
    registers: ['drp'],
    case: {
      checks: [
        ck('measured', "Outcome recorded (or 'not yet measured') for every implemented recommendation", 'النتيجة مسجلة (أو «لم تُقَس بعد») لكل توصية منفّذة'),
        ck('reassessed', 'Unmet goals reassessed', 'تمت إعادة تقييم الأهداف غير المتحققة'),
      ],
      fields: [{ id: 'changes', kind: 'longtext', label: L('Plan changes agreed with the team', 'تغييرات الخطة المتفق عليها مع الفريق') }],
    },
  },

  // ============================================================ 7 · Discharge & counselling
  {
    id: 't20',
    number: 20,
    module: 'discharge',
    title: L('Discharge Medication Review', 'مراجعة الأدوية عند خروج المريض'),
    purpose: L(
      'Reconcile the discharge prescription against the pre-admission list and the inpatient therapy.',
      'مطابقة وصفة الخروج مع قائمة ما قبل الدخول والعلاج أثناء الإقامة.',
    ),
    steps: [
      L('Account for every pre-admission medication: continue, change or stop — with a reason.', 'حدّد مصير كل دواء من أدوية ما قبل الدخول: استمرار أو تعديل أو إيقاف — مع السبب.'),
      L(
        'Decide for every inpatient drug: stop it (e.g. IV antibiotics, prophylaxis) or continue it at home.',
        'قرّر لكل دواء أثناء الإقامة: إيقافه (مثل المضادات الوريدية والوقاية) أو استمراره في المنزل.',
      ),
      L('Check doses against organ function at discharge and set durations for short courses.', 'تحقق من الجرعات مقابل وظائف الأعضاء عند الخروج وحدّد مدد العلاجات القصيرة.'),
      L('Make sure every discharge medicine is available and affordable.', 'تأكد من توفر كل دواء خروج وأن تكلفته مناسبة.'),
    ],
    needs: ['home_meds', 'meds'],
    registers: ['home_med'],
    panels: ['inpatient_meds'],
    case: {
      checks: [
        ck('home_accounted', 'Every pre-admission medication accounted for', 'تم تحديد مصير كل دواء من أدوية ما قبل الدخول'),
        ck('inpatient_decided', 'Every inpatient drug stopped or continued deliberately', 'تم إيقاف أو استمرار كل دواء أثناء الإقامة عن قصد'),
        ck('doses_checked', 'Doses checked against organ function at discharge', 'تم التحقق من الجرعات مقابل وظائف الأعضاء عند الخروج'),
        ck('durations', 'Durations set for short courses', 'تم تحديد المدد للعلاجات القصيرة'),
        ck('availability', 'Availability and cost checked', 'تم التحقق من التوفر والتكلفة'),
      ],
    },
  },
  {
    id: 't21',
    number: 21,
    module: 'discharge',
    title: L('Discharge Medication Plan', 'إعداد الخطة الدوائية عند الخروج'),
    purpose: L(
      'Prepare a clear and safe medication plan for home, ready to review with your preceptor.',
      'إعداد خطة دوائية واضحة وآمنة للمنزل، جاهزة للمراجعة مع مشرفك.',
    ),
    steps: [
      L('List every medicine to take at home with dose, timing, purpose and duration.', 'اذكر كل دواء سيُؤخذ في المنزل مع الجرعة والتوقيت والغرض والمدة.'),
      L('Mark what is new, changed or unchanged compared with before admission, and why.', 'حدّد ما هو جديد أو معدّل أو دون تغيير مقارنة بما قبل الدخول، ولماذا.'),
      L('Add follow-up tests and appointments.', 'أضف فحوص ومواعيد المتابعة.'),
      L(
        'The plan stays in PRECEPTOR for supervision; it is not handed to the patient from the app.',
        'تبقى الخطة في PRECEPTOR للإشراف؛ ولا تُسلَّم للمريض من التطبيق.',
      ),
    ],
    registers: ['discharge_med'],
    case: {
      checks: [
        ck('complete', 'Every discharge medicine has dose, timing, purpose and duration', 'لكل دواء خروج جرعة وتوقيت وغرض ومدة'),
        ck('changes_explained', 'Every change explained', 'كل تغيير مشروح'),
        ck('follow_up', 'Follow-up tests and appointments planned', 'تم التخطيط لفحوص ومواعيد المتابعة'),
        ck('reviewed', 'Plan reviewed with my preceptor', 'تمت مراجعة الخطة مع مشرفي'),
      ],
    },
  },
  {
    id: 't17',
    number: 17,
    module: 'discharge',
    title: L('Patient Counseling', 'تثقيف المرضى حول أدويتهم'),
    purpose: L('Help the patient and family understand and use their medicines safely.', 'مساعدة المريض وأسرته على فهم أدويتهم واستخدامها بأمان.'),
    steps: [
      L('Start by asking what the patient already knows; use plain words in their language.', 'ابدأ بسؤال المريض عما يعرفه؛ واستخدم كلمات بسيطة بلغته.'),
      L(
        'Cover the purpose, how and when to take it, duration, missed doses, side effects and warning signs.',
        'غطِّ الغرض وطريقة الاستعمال وتوقيته والمدة والجرعات الفائتة والأعراض الجانبية وعلامات الخطر.',
      ),
      L('Discuss timing with meals and khat, and interactions with food, herbs and khat.', 'ناقش التوقيت مع الوجبات والقات، والتداخلات مع الغذاء والأعشاب والقات.'),
      L('Demonstrate devices (inhalers, insulin pens) and watch the patient use them.', 'اعرض طريقة استخدام الأجهزة (البخاخات، أقلام الإنسولين) وراقب المريض أثناء استخدامها.'),
      L('Close with teach-back: ask the patient to explain it back in their own words.', 'اختم بإعادة الشرح: اطلب من المريض أن يشرح بكلماته.'),
    ],
    registers: ['counseling'],
    case: {
      checks: [
        ck('needs_assessed', 'Learning needs and preferred language assessed', 'تم تقييم احتياجات التعلم واللغة المفضلة'),
        ck('caregiver', 'Caregiver involved where needed', 'تم إشراك مقدم الرعاية عند الحاجة'),
        ck('teach_back', 'Teach-back used', 'تم استخدام إعادة الشرح'),
      ],
    },
    later: [
      {
        milestone: 'M5',
        what: L(
          'MedlinePlus patient information (English) retrieved by drug, as a source for you to adapt.',
          'معلومات MedlinePlus للمرضى (بالإنجليزية) حسب الدواء، كمصدر تكيّفه أنت.',
        ),
      },
    ],
  },

  // ============================================================ 8 · Document & learn
  {
    id: 't18',
    number: 18,
    module: 'document',
    title: L('Pharmaceutical Care Documentation', 'توثيق التدخلات الصيدلانية'),
    purpose: L(
      'Keep a complete and honest record of every intervention, its acceptance and its outcome.',
      'الاحتفاظ بسجل كامل وأمين لكل تدخل وقبوله ونتيجته.',
    ),
    steps: [
      L(
        'For every intervention: the problem, your recommendation, who you told, their response and the outcome.',
        'لكل تدخل: المشكلة، توصيتك، من أبلغت، رده، والنتيجة.',
      ),
      L('Proposed and implemented are different: never record a proposal as done.', 'المقترح والمنفّذ أمران مختلفان: لا تسجّل مقترحاً على أنه نُفّذ.'),
      L('Complete the department form; its missing-items list shows what is still needed.', 'أكمل نموذج القسم؛ وقائمة البنود الناقصة فيه تبيّن ما زال مطلوباً.'),
    ],
    panels: ['interventions'],
    case: {
      checks: [
        ck('responses', 'Every intervention has a recorded response', 'لكل تدخل رد مسجّل'),
        ck('outcomes', "Outcomes recorded or marked 'not yet measured'", 'النتائج مسجلة أو موسومة بأنها لم تُقَس بعد'),
        ck('form', 'Department form reviewed for missing items', 'تمت مراجعة نموذج القسم بحثاً عن البنود الناقصة'),
        ck('preceptor', 'Documentation reviewed with my preceptor', 'تمت مراجعة التوثيق مع مشرفي'),
      ],
    },
  },
  {
    id: 't23',
    number: 23,
    module: 'document',
    title: L('Clinical Protocols & Guidelines', 'المشاركة في وضع البروتوكولات والإرشادات العلاجية'),
    purpose: L(
      'Know which protocol or guideline governs each decision in this case, and note where practice and protocol differ.',
      'معرفة البروتوكول أو الدليل الذي يحكم كل قرار في هذه الحالة، وملاحظة مواضع الاختلاف بين الممارسة والبروتوكول.',
    ),
    steps: [
      L('For each main problem, identify the hospital protocol or guideline that applies.', 'حدّد لكل مشكلة رئيسية البروتوكول أو الدليل المعتمد في المستشفى.'),
      L(
        'Record the references you actually read, with their year — anything older than five years deserves a check for an update.',
        'سجّل المراجع التي قرأتها فعلاً مع سنتها — وما كان أقدم من خمس سنوات يستحق التحقق من وجود تحديث.',
      ),
      L(
        'Note the gaps: where the protocol is missing, outdated or not followed — these feed protocol development.',
        'دوّن الثغرات: حيث يكون البروتوكول غائباً أو قديماً أو غير مطبّق — فهذه تغذي تطوير البروتوكولات.',
      ),
    ],
    registers: ['reference'],
    case: {
      checks: [
        ck('identified', 'Applicable protocol or guideline identified for each main problem', 'تم تحديد البروتوكول أو الدليل المناسب لكل مشكلة رئيسية'),
        ck('current', 'Versions checked for currency', 'تم التحقق من حداثة الإصدارات'),
      ],
      fields: [{ id: 'gaps', kind: 'longtext', label: L('Protocol gaps or improvement ideas', 'ثغرات البروتوكول أو أفكار للتحسين') }],
    },
    later: [
      {
        milestone: 'M5',
        what: L(
          'Upload your guideline PDFs into a local library; passages are retrieved with citations and each guideline shows its age.',
          'رفع ملفات الأدلة الإرشادية إلى مكتبة محلية؛ واسترجاع المقاطع مع الاستشهاد وعرض عمر كل دليل.',
        ),
      },
    ],
  },
  {
    id: 't25',
    number: 25,
    module: 'document',
    title: L('Education, Training & Research', 'المشاركة في التعليم والتدريب والبحث العلمي'),
    purpose: L('Turn this case into learning — for you, for your peers and for future research.', 'تحويل هذه الحالة إلى تعلّم — لك ولزملائك وللبحث مستقبلاً.'),
    steps: [
      L('Write the key learning points while the case is fresh.', 'اكتب نقاط التعلم الأساسية والحالة ما زالت حاضرة في ذهنك.'),
      L('Note what you would do differently next time.', 'دوّن ما ستفعله بشكل مختلف في المرة القادمة.'),
      L('List the questions to take to your preceptor.', 'اكتب الأسئلة التي ستعرضها على مشرفك.'),
      L('Capture the research or audit ideas this case raises.', 'سجّل أفكار البحث أو التدقيق التي تثيرها هذه الحالة.'),
    ],
    case: {
      checks: [
        ck('reflection', 'Reflection written', 'تمت كتابة التأمل'),
        ck('discussed', 'Learning discussed with my preceptor', 'تمت مناقشة التعلم مع مشرفي'),
      ],
      fields: [
        { id: 'learning', kind: 'longtext', label: L('Key learning points', 'نقاط التعلم الأساسية') },
        { id: 'differently', kind: 'longtext', label: L('What I would do differently', 'ما سأفعله بشكل مختلف') },
        { id: 'questions', kind: 'longtext', label: L('Questions for my preceptor', 'أسئلة لمشرفي') },
        { id: 'research', kind: 'longtext', label: L('Research or audit idea', 'فكرة بحث أو تدقيق') },
        { id: 'teaching', kind: 'longtext', label: L('Teaching I delivered, and to whom', 'التعليم الذي قدّمته ولمن') },
        { id: 'competencies', kind: 'multi', label: L('Competency areas practised', 'مجالات الكفاءة التي مارستها'), options: COMPETENCIES },
      ],
    },
    later: [
      {
        milestone: 'M8',
        what: L(
          'Teach Me, Assessment Mode, Argue With Me, competency tagging and the portfolio.',
          'وضع «علّمني» و«وضع التقييم» و«جادلني»، ووسم الكفاءات، وملف الإنجاز.',
        ),
      },
    ],
  },
  {
    id: 't30',
    number: 30,
    module: 'document',
    title: L('Comprehensive Pharmaceutical Care', 'تقديم الرعاية الصيدلانية المتكاملة للمريض'),
    purpose: L(
      'Bring everything together into one coherent care plan for this patient, ready to discuss with your preceptor.',
      'جمع كل ما سبق في خطة رعاية واحدة متكاملة لهذا المريض، جاهزة للنقاش مع مشرفك.',
    ),
    steps: [
      L('Read the summary below: what is complete, what is open, what is missing.', 'اقرأ الملخص أدناه: ما اكتمل، وما هو مفتوح، وما هو ناقص.'),
      L(
        'Check that every active problem has an assessed therapy and every DRP has a plan and a status.',
        'تأكد من أن لكل مشكلة فعّالة علاجاً مُقيَّماً، ولكل مشكلة دوائية خطة وحالة.',
      ),
      L('Write a short pharmaceutical care summary in your own words.', 'اكتب ملخصاً قصيراً للرعاية الصيدلانية بكلماتك.'),
    ],
    panels: ['care_plan'],
    case: {
      checks: [
        ck('problems_assessed', 'Every active problem has an assessed therapy', 'لكل مشكلة فعّالة علاج مُقيَّم'),
        ck('drps_planned', 'Every DRP has a plan and a status', 'لكل مشكلة دوائية خطة وحالة'),
        ck('monitoring', 'Monitoring plan defined', 'خطة المراقبة محددة'),
        ck('discharge', 'Discharge plan prepared, or not yet applicable', 'خطة الخروج مُعدّة أو لم يحن وقتها'),
        ck('preceptor', 'Case discussed with my preceptor', 'نوقشت الحالة مع مشرفي'),
      ],
      fields: [{ id: 'summary', kind: 'longtext', label: L('Pharmaceutical care summary', 'ملخص الرعاية الصيدلانية') }],
    },
  },
];

export const TASKS: ReadonlyMap<string, TaskDef> = new Map(TASK_LIST.map((t) => [t.id, t]));

/** Tasks in the order of the modules (the order the trainee works through them). */
export const TASK_ORDER: readonly TaskDef[] = MODULES.flatMap((m) => m.tasks.map((id) => TASKS.get(id)!));

export const MODULE_BY_ID: ReadonlyMap<ModuleId, ModuleDef> = new Map(MODULES.map((m) => [m.id, m]));

export function taskByNumber(n: number): TaskDef | undefined {
  return TASK_LIST.find((t) => t.number === n);
}

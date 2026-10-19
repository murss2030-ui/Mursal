/**
 * Registers: the lists the clinical modules share, so that each fact is
 * entered once (Section 20, "Enter data once"). A home medication recorded in
 * admission reconciliation reappears in adherence and discharge review; a
 * drug-related problem identified once is followed through recommendation,
 * implementation and outcome.
 *
 * Every row is a versioned record: an edit creates a new version, the old one
 * stays readable, and "entered in error" is a retraction with a reason.
 *
 * Nothing here is computed or suggested by the application. Every value is
 * the trainee's own entry (provenance: user_entered).
 */
import { isValidHospitalDay, isValidTimeOfDay } from '../dates';
import { DRP_CHECKBOXES } from '../form/spec';
import { L } from '../label';
import type { RegisterId } from '../types';

export type FieldKind =
  | 'text'
  | 'longtext'
  | 'choice'
  | 'multi'
  | 'day'
  | 'time'
  /** Must be ticked to save (a statement the trainee confirms). */
  | 'confirm'
  /** The id of one of the case's medication courses. */
  | 'medRef'
  /** The id of one of the case's problems. */
  | 'problemRef'
  /** The id of a timeline entry (e.g. a drug-level result). */
  | 'entryRef';

export interface Choice {
  value: string;
  label: L;
}

export interface Condition {
  field: string;
  in: readonly string[];
}

export interface FieldDef {
  id: string;
  kind: FieldKind;
  label: L;
  hint?: L;
  required?: boolean;
  /** Required only when another field has one of the listed values. */
  requiredIf?: Condition;
  /** Shown only when another field has one of the listed values. Hidden values are dropped on save. */
  showIf?: Condition;
  options?: readonly Choice[];
}

export interface RegisterDef {
  id: RegisterId;
  title: L;
  /** One row, e.g. "medication", used in "Add medication". */
  noun: L;
  /** Field shown as the row's heading. */
  titleField: string;
  /** Fields shown under the heading, in order. */
  subtitleFields: readonly string[];
  /** Choice fields shown as chips on the row. */
  chipFields: readonly string[];
  fields: readonly FieldDef[];
}

const c = (value: string, en: string, ar: string): Choice => ({ value, label: L(en, ar) });
const YES_NO: readonly Choice[] = [c('yes', 'Yes', 'نعم'), c('no', 'No', 'لا')];

// ---------------------------------------------------------------- home medications (BPMH and reconciliation)

const HOME_MED: RegisterDef = {
  id: 'home_med',
  title: L('Pre-admission medications (BPMH)', 'أدوية ما قبل الدخول (أفضل تاريخ دوائي ممكن BPMH)'),
  noun: L('medication', 'دواء'),
  titleField: 'drug',
  subtitleFields: ['regimen', 'indication'],
  chipFields: ['admissionStatus', 'discrepancy', 'dischargeDecision'],
  fields: [
    { id: 'drug', kind: 'text', required: true, label: L('Medication (generic name)', 'الدواء (الاسم العلمي)') },
    { id: 'brand', kind: 'text', label: L('Brand name as the patient knows it', 'الاسم التجاري كما يعرفه المريض') },
    {
      id: 'regimen',
      kind: 'text',
      required: true,
      label: L('Dose, route and frequency as actually taken', 'الجرعة وطريقة الإعطاء والتكرار كما يتناوله فعلاً'),
      hint: L(
        'Write "unknown" if it is not known. Write units in full (units, mcg) and avoid trailing zeros.',
        'اكتب "unknown" إن لم يكن معروفاً. اكتب الوحدات كاملة (units, mcg) وتجنب الأصفار بعد الفاصلة.',
      ),
    },
    { id: 'indication', kind: 'text', label: L('Indication', 'دواعي الاستعمال') },
    { id: 'lastDose', kind: 'text', label: L('Last dose taken (day and time)', 'آخر جرعة أُخذت (اليوم والوقت)') },
    {
      id: 'sources',
      kind: 'multi',
      required: true,
      label: L('Sources used for this medication', 'المصادر التي استُخدمت لهذا الدواء'),
      hint: L('A best possible medication history uses at least two sources.', 'أفضل تاريخ دوائي ممكن يعتمد على مصدرين على الأقل.'),
      options: [
        c('patient', 'Patient interview', 'مقابلة المريض'),
        c('family', 'Family or caregiver', 'الأسرة أو مقدم الرعاية'),
        c('containers', 'Medication containers', 'علب الأدوية'),
        c('prescription', 'Prescription or clinic letter', 'وصفة أو رسالة عيادة'),
        c('previous_discharge', 'Previous discharge summary', 'ملخص خروج سابق'),
        c('pharmacy', 'Community pharmacy', 'الصيدلية المجتمعية'),
        c('record', 'Medical record', 'الملف الطبي'),
        c('other', 'Other', 'أخرى'),
      ],
    },
    {
      id: 'admissionStatus',
      kind: 'choice',
      label: L('On admission it was…', 'عند الدخول…'),
      options: [
        c('continued', 'Continued unchanged', 'استمر دون تغيير'),
        c('changed', 'Continued with a change', 'استمر مع تعديل'),
        c('held', 'Held', 'أوقف مؤقتاً'),
        c('stopped', 'Discontinued', 'أوقف نهائياً'),
        c('not_ordered', 'Not ordered', 'لم يُطلب'),
        c('not_reviewed', 'Not compared yet', 'لم تتم المقارنة بعد'),
      ],
    },
    { id: 'linkedMedId', kind: 'medRef', label: L('Matching inpatient order', 'الطلب المقابل أثناء الإقامة') },
    {
      id: 'discrepancy',
      kind: 'choice',
      label: L('Discrepancy', 'التباين'),
      options: [
        c('none', 'No discrepancy', 'لا يوجد تباين'),
        c('intentional_documented', 'Intentional — documented', 'مقصود — موثّق'),
        c('intentional_undocumented', 'Intentional — not documented', 'مقصود — غير موثّق'),
        c('unintentional', 'Unintentional', 'غير مقصود'),
      ],
    },
    {
      id: 'discrepancyType',
      kind: 'choice',
      label: L('Type of unintentional discrepancy', 'نوع التباين غير المقصود'),
      showIf: { field: 'discrepancy', in: ['unintentional'] },
      requiredIf: { field: 'discrepancy', in: ['unintentional'] },
      options: [
        c('omission', 'Omission', 'إغفال'),
        c('dose', 'Different dose', 'جرعة مختلفة'),
        c('frequency', 'Different frequency', 'تكرار مختلف'),
        c('route', 'Different route', 'طريقة إعطاء مختلفة'),
        c('formulation', 'Different formulation', 'شكل صيدلاني مختلف'),
        c('duplication', 'Duplication', 'ازدواجية'),
        c('wrong_drug', 'Wrong drug', 'دواء خاطئ'),
        c('other', 'Other', 'أخرى'),
      ],
    },
    {
      id: 'resolution',
      kind: 'choice',
      label: L('Resolution', 'المعالجة'),
      showIf: { field: 'discrepancy', in: ['intentional_undocumented', 'unintentional'] },
      options: [
        c('resolved', 'Resolved with the prescriber', 'حُلّ مع الطبيب'),
        c('pending', 'Pending', 'قيد المتابعة'),
        c('not_resolved', 'Not resolved', 'لم يُحل'),
      ],
    },
    { id: 'action', kind: 'text', label: L('Action / reason (department form, Section 4)', 'الإجراء / السبب (القسم 4 من النموذج)') },
    {
      id: 'adherence',
      kind: 'choice',
      label: L('Adherence before admission', 'الالتزام قبل الدخول'),
      options: [
        c('adherent', 'Takes it as prescribed', 'يتناوله كما وُصف'),
        c('partial', 'Partly adherent', 'ملتزم جزئياً'),
        c('non_adherent', 'Not adherent', 'غير ملتزم'),
        c('unknown', 'Unknown', 'غير معروف'),
      ],
    },
    {
      id: 'dischargeDecision',
      kind: 'choice',
      label: L('At discharge', 'عند الخروج'),
      options: [
        c('continue', 'Continue unchanged', 'يستمر دون تغيير'),
        c('change', 'Continue with a change', 'يستمر مع تعديل'),
        c('stop', 'Stop', 'يوقف'),
        c('not_decided', 'Not decided yet', 'لم يُحدد بعد'),
      ],
    },
    { id: 'dischargeNote', kind: 'text', label: L('Discharge regimen or reason', 'نظام الخروج أو السبب') },
  ],
};

// ---------------------------------------------------------------- drug-related problems (manual Problem Card)

const DRP_CATEGORY_IDS = [
  'unnecessary',
  'additional_therapy',
  'ineffective',
  'dose_low',
  'dose_high',
  'adr',
  'interaction',
  'nonadherence',
  'monitoring',
  'other',
] as const;
export type DrpCategory = (typeof DRP_CATEGORY_IDS)[number];
/** The department form's Section 8 boxes, in the form's order. The category IS the box: no mapping is involved. */
export const DRP_CATEGORIES: readonly Choice[] = DRP_CATEGORY_IDS.map((id, i) => ({ value: id, label: DRP_CHECKBOXES[i]! }));

const MEASURED = ['yes', 'partly', 'no'] as const;

const DRP: RegisterDef = {
  id: 'drp',
  title: L('Drug-related problems and interventions', 'المشكلات المتعلقة بالعلاج الدوائي والتدخلات'),
  noun: L('drug-related problem', 'مشكلة دوائية'),
  titleField: 'problem',
  subtitleFields: ['drugs', 'recommendation'],
  chipFields: ['priority', 'category', 'response'],
  fields: [
    { id: 'problem', kind: 'text', required: true, label: L('Clinical problem, in one sentence', 'المشكلة السريرية في جملة واحدة') },
    { id: 'drugs', kind: 'text', label: L('Medication(s) involved', 'الدواء أو الأدوية المعنية') },
    { id: 'linkedProblemId', kind: 'problemRef', label: L('Related diagnosis', 'التشخيص المرتبط') },
    {
      id: 'category',
      kind: 'choice',
      required: true,
      label: L('Category (department form, Section 8)', 'الفئة (القسم 8 من النموذج)'),
      hint: L(
        'The PCNE V9.1 problem and cause codes are added in M4.',
        'تُضاف رموز المشكلة والسبب وفق تصنيف PCNE V9.1 في المرحلة M4.',
      ),
      options: DRP_CATEGORIES,
    },
    {
      id: 'evidence',
      kind: 'longtext',
      required: true,
      label: L('Supporting data from this patient', 'البيانات الداعمة من حالة هذا المريض'),
      hint: L('Each value with its hospital day, e.g. "SCr 2.1 mg/dL on Day 3".', 'كل قيمة مع يومها، مثل "SCr 2.1 mg/dL في اليوم 3".'),
    },
    {
      id: 'missing',
      kind: 'longtext',
      label: L('Information still missing', 'المعلومات التي ما زالت ناقصة'),
      hint: L('Name it — never leave it blank to look complete.', 'سمّها بوضوح — لا تتركها فارغة لتبدو الحالة مكتملة.'),
    },
    { id: 'assessment', kind: 'longtext', label: L('Assessment and alternative explanations', 'التقييم والتفسيرات البديلة') },
    {
      id: 'priority',
      kind: 'choice',
      required: true,
      label: L('Priority', 'الأولوية'),
      options: [c('critical', 'Critical', 'حرجة'), c('important', 'Important', 'مهمة'), c('informational', 'Informational', 'للعلم')],
    },
    { id: 'priorityReason', kind: 'text', label: L('Why this priority', 'سبب هذه الأولوية') },
    {
      id: 'recommendation',
      kind: 'longtext',
      label: L('Recommendation and rationale', 'التوصية ومبرراتها'),
      hint: L(
        'If it includes a dose, state where the dose comes from (a calculation or a reference you read).',
        'إن تضمنت جرعة فاذكر مصدرها (حساب أو مرجع قرأته).',
      ),
    },
    { id: 'monitoring', kind: 'longtext', label: L('Monitoring: parameter, target, when', 'المراقبة: المؤشر والهدف والتوقيت') },
    { id: 'references', kind: 'text', label: L('References you read yourself', 'مراجع قرأتها بنفسك') },
    {
      id: 'recStatus',
      kind: 'choice',
      label: L('Recommendation status', 'حالة التوصية'),
      hint: L(
        'Only final recommendations appear in Section 9 of the department form.',
        'التوصيات النهائية فقط تظهر في القسم 9 من النموذج.',
      ),
      options: [c('draft', 'Draft — still working on it', 'مسودة — ما زلت أعمل عليها'), c('final', 'Final — ready to discuss', 'نهائية — جاهزة للنقاش')],
    },
    {
      id: 'response',
      kind: 'choice',
      label: L('Team response', 'رد الفريق الطبي'),
      hint: L(
        'PRECEPTOR never sends anything to the team. Communicate in person or in the chart, then record it here.',
        'لا يرسل PRECEPTOR أي شيء إلى الفريق. أبلغ التوصية شخصياً أو في الملف ثم سجّلها هنا.',
      ),
      options: [
        c('not_communicated', 'Not communicated yet', 'لم تُبلَّغ بعد'),
        c('awaiting', 'Communicated — awaiting a response', 'أُبلغت — بانتظار الرد'),
        c('accepted', 'Accepted', 'قُبلت'),
        c('modified', 'Accepted with modification', 'قُبلت مع تعديل'),
        c('declined', 'Declined', 'رُفضت'),
      ],
    },
    {
      id: 'communicatedTo',
      kind: 'choice',
      label: L('Communicated to', 'أُبلغت إلى'),
      showIf: { field: 'response', in: ['awaiting', 'accepted', 'modified', 'declined'] },
      options: [
        c('physician', 'Treating physician', 'الطبيب المعالج'),
        c('resident', 'Resident', 'الطبيب المقيم'),
        c('consultant', 'Consultant', 'الاستشاري'),
        c('nurse', 'Nurse', 'الممرض'),
        c('preceptor', 'Preceptor', 'المشرف'),
        c('other', 'Other', 'أخرى'),
      ],
    },
    {
      id: 'communicatedDay',
      kind: 'day',
      label: L('Communicated on (hospital day)', 'تاريخ الإبلاغ (اليوم)'),
      showIf: { field: 'response', in: ['awaiting', 'accepted', 'modified', 'declined'] },
    },
    {
      id: 'declineReason',
      kind: 'text',
      label: L('Reason given for declining', 'سبب الرفض'),
      showIf: { field: 'response', in: ['declined'] },
      requiredIf: { field: 'response', in: ['declined'] },
    },
    {
      id: 'implemented',
      kind: 'choice',
      label: L('Implementation', 'التنفيذ'),
      hint: L('Implemented means it was actually carried out — record who and when.', 'التنفيذ يعني أنه طُبّق فعلاً — سجّل من نفّذه ومتى.'),
      options: [c('no', 'Not implemented', 'لم يُنفّذ'), c('yes', 'Implemented', 'نُفّذ')],
    },
    {
      id: 'implementedBy',
      kind: 'text',
      label: L('Implemented by (role)', 'نفّذه (الصفة)'),
      showIf: { field: 'implemented', in: ['yes'] },
      requiredIf: { field: 'implemented', in: ['yes'] },
    },
    {
      id: 'implementedDay',
      kind: 'day',
      label: L('Implemented on (hospital day)', 'تاريخ التنفيذ (اليوم)'),
      showIf: { field: 'implemented', in: ['yes'] },
      requiredIf: { field: 'implemented', in: ['yes'] },
    },
    {
      id: 'goalMet',
      kind: 'choice',
      label: L('Follow-up outcome', 'نتيجة المتابعة'),
      options: [
        c('not_measured', 'Not measured yet', 'لم تُقَس بعد'),
        c('yes', 'Goal met', 'تحقق الهدف'),
        c('partly', 'Goal partly met', 'تحقق الهدف جزئياً'),
        c('no', 'Goal not met', 'لم يتحقق الهدف'),
      ],
    },
    {
      id: 'outcome',
      kind: 'longtext',
      label: L('What was measured', 'ما الذي تم قياسه'),
      showIf: { field: 'goalMet', in: MEASURED },
      requiredIf: { field: 'goalMet', in: MEASURED },
    },
    {
      id: 'outcomeDay',
      kind: 'day',
      label: L('Measured on (hospital day)', 'تاريخ القياس (اليوم)'),
      showIf: { field: 'goalMet', in: MEASURED },
      requiredIf: { field: 'goalMet', in: MEASURED },
    },
    {
      id: 'teaching',
      kind: 'longtext',
      label: L('Teaching point: what question does this problem teach you to ask?', 'النقطة التعليمية: ما السؤال الذي تعلّمك هذه المشكلة أن تطرحه؟'),
    },
    { id: 'preceptorReviewed', kind: 'choice', label: L('Discussed with my preceptor', 'نوقشت مع المشرف'), options: YES_NO },
  ],
};

// ---------------------------------------------------------------- interactions (trainee-checked)

const INTERACTION: RegisterDef = {
  id: 'interaction',
  title: L('Interactions you checked', 'التداخلات التي تحققت منها'),
  noun: L('interaction', 'تداخل'),
  titleField: 'drugA',
  subtitleFields: ['drugB', 'management'],
  chipFields: ['severity', 'kind', 'relevance'],
  fields: [
    {
      id: 'kind',
      kind: 'choice',
      required: true,
      label: L('Type', 'النوع'),
      options: [
        c('drug_drug', 'Drug–drug', 'دواء–دواء'),
        c('drug_disease', 'Drug–disease', 'دواء–مرض'),
        c('drug_food', 'Drug–food or khat', 'دواء–غذاء أو قات'),
        c('drug_lab', 'Drug–laboratory test', 'دواء–فحص مخبري'),
      ],
    },
    { id: 'drugA', kind: 'text', required: true, label: L('Drug A', 'الدواء أ') },
    { id: 'drugB', kind: 'text', required: true, label: L('Drug B, disease, food or test', 'الدواء ب أو المرض أو الغذاء أو الفحص') },
    {
      id: 'severity',
      kind: 'choice',
      required: true,
      label: L('Severity (as stated by your source)', 'الشدة (كما يذكرها مصدرك)'),
      options: [
        c('contraindicated', 'Contraindicated', 'مضاد استطباب'),
        c('major', 'Major', 'شديد'),
        c('moderate', 'Moderate', 'متوسط'),
        c('minor', 'Minor', 'طفيف'),
        c('unknown', 'Not established', 'غير محدد'),
      ],
    },
    // Owner decision of 19 October 2026: PRECEPTOR gives the level only; the trainee looks up and writes the mechanism and the management.
    {
      id: 'mechanism',
      kind: 'text',
      required: true,
      label: L('Mechanism', 'الآلية'),
      hint: L(
        'Write it yourself, from the hospital’s approved reference: PRECEPTOR gives the interaction level only.',
        'اكتبها بنفسك من المرجع المعتمد في المستشفى: يعطي PRECEPTOR مستوى التداخل فقط.',
      ),
    },
    { id: 'effect', kind: 'text', label: L('Clinical effect', 'الأثر السريري') },
    {
      id: 'management',
      kind: 'longtext',
      required: true,
      label: L('Management plan', 'خطة التعامل'),
      hint: L(
        'Write it yourself, from the hospital’s approved reference and the patient’s situation.',
        'اكتبها بنفسك من المرجع المعتمد في المستشفى ومن وضع المريض.',
      ),
    },
    {
      id: 'source',
      kind: 'text',
      required: true,
      label: L('Where you checked it', 'أين تحققت منه'),
      hint: L(
        'Name the source you consulted yourself. PRECEPTOR’s own offline check is shown separately on the safety card, never in this row.',
        'اذكر المصدر الذي رجعت إليه بنفسك. يُعرض فحص PRECEPTOR المحلي منفصلاً في بطاقة السلامة، ولا يظهر أبداً في هذا السطر.',
      ),
    },
    {
      id: 'relevance',
      kind: 'choice',
      label: L('Relevance for this patient', 'الأهمية لهذا المريض'),
      options: [
        c('relevant', 'Clinically relevant — act', 'مهم سريرياً — يتطلب إجراء'),
        c('monitor', 'Monitor only', 'مراقبة فقط'),
        c('not_relevant', 'Not relevant here', 'غير مهم في هذه الحالة'),
      ],
    },
  ],
};

// ---------------------------------------------------------------- suspected adverse drug reactions

const ADR: RegisterDef = {
  id: 'adr',
  title: L('Suspected adverse drug reactions', 'التفاعلات الدوائية الضارة المشتبه بها'),
  noun: L('suspected ADR', 'تفاعل ضار مشتبه به'),
  titleField: 'drug',
  subtitleFields: ['reaction'],
  chipFields: ['severity', 'causality', 'reported'],
  fields: [
    { id: 'drug', kind: 'text', required: true, label: L('Suspected drug', 'الدواء المشتبه به') },
    { id: 'reaction', kind: 'longtext', required: true, label: L('Reaction: signs, symptoms, laboratory changes', 'التفاعل: العلامات والأعراض والتغيرات المخبرية') },
    { id: 'onsetDay', kind: 'day', label: L('Onset (hospital day)', 'بداية الظهور (اليوم)') },
    {
      id: 'severity',
      kind: 'choice',
      required: true,
      label: L('Severity', 'الشدة'),
      options: [
        c('mild', 'Mild', 'خفيف'),
        c('moderate', 'Moderate', 'متوسط'),
        c('severe', 'Severe', 'شديد'),
        c('life_threatening', 'Life-threatening', 'مهدد للحياة'),
      ],
    },
    {
      id: 'serious',
      kind: 'choice',
      label: L('Serious (hospitalisation, disability, life-threatening or death)', 'خطير (دخول المستشفى أو إعاقة أو تهديد للحياة أو وفاة)'),
      options: YES_NO,
    },
    {
      id: 'action',
      kind: 'choice',
      label: L('Action taken', 'الإجراء المتخذ'),
      options: [
        c('withdrawn', 'Drug withdrawn', 'أوقف الدواء'),
        c('dose_reduced', 'Dose reduced', 'خُفضت الجرعة'),
        c('unchanged', 'Continued unchanged', 'استمر دون تغيير'),
        c('treated', 'Reaction treated', 'عولج التفاعل'),
        c('unknown', 'Unknown', 'غير معروف'),
      ],
    },
    {
      id: 'dechallenge',
      kind: 'choice',
      label: L('After stopping or reducing', 'بعد الإيقاف أو تخفيض الجرعة'),
      options: [
        c('improved', 'Improved', 'تحسن'),
        c('not_improved', 'Did not improve', 'لم يتحسن'),
        c('not_done', 'Not stopped or reduced', 'لم يوقف أو يُخفَّض'),
        c('unknown', 'Unknown', 'غير معروف'),
      ],
    },
    {
      id: 'outcome',
      kind: 'choice',
      label: L('Outcome', 'المآل'),
      options: [
        c('recovered', 'Recovered', 'تعافى'),
        c('recovering', 'Recovering', 'في طور التعافي'),
        c('not_recovered', 'Not recovered', 'لم يتعافَ'),
        c('fatal', 'Fatal', 'وفاة'),
        c('unknown', 'Unknown', 'غير معروف'),
      ],
    },
    {
      id: 'causality',
      kind: 'choice',
      label: L('Causality — your WHO-UMC category', 'السببية — تصنيفك وفق WHO-UMC'),
      hint: L(
        'Your own judgement. Once the row is saved, the Naranjo and WHO-UMC questionnaires open from it; their results never change this answer.',
        'تقديرك الشخصي. بعد حفظ السطر تُفتح منه استبيانات Naranjo وWHO-UMC؛ ونتائجها لا تغيّر هذه الإجابة أبداً.',
      ),
      options: [
        c('certain', 'Certain', 'مؤكد'),
        c('probable', 'Probable / likely', 'مرجّح'),
        c('possible', 'Possible', 'ممكن'),
        c('unlikely', 'Unlikely', 'غير مرجّح'),
        c('conditional', 'Conditional / unclassified', 'مشروط / غير مصنّف'),
        c('unassessable', 'Unassessable / unclassifiable', 'غير قابل للتقييم'),
      ],
    },
    {
      id: 'preventable',
      kind: 'choice',
      label: L('Preventability', 'إمكانية الوقاية'),
      options: [
        c('preventable', 'Preventable', 'يمكن الوقاية منه'),
        c('possibly', 'Possibly preventable', 'ربما يمكن الوقاية منه'),
        c('not_preventable', 'Not preventable', 'لا يمكن الوقاية منه'),
        c('unknown', 'Unknown', 'غير معروف'),
      ],
    },
    {
      id: 'reported',
      kind: 'choice',
      label: L('Reported', 'الإبلاغ'),
      hint: L('PRECEPTOR never sends reports. Use the official form, then record it here.', 'لا يرسل PRECEPTOR أي بلاغ. استخدم النموذج الرسمي ثم سجّل ذلك هنا.'),
      options: [
        c('not_reported', 'Not reported yet', 'لم يُبلَّغ بعد'),
        c('hospital', 'To the hospital pharmacovigilance unit', 'إلى وحدة اليقظة الدوائية في المستشفى'),
        c('national', 'To the national pharmacovigilance centre', 'إلى المركز الوطني لليقظة الدوائية'),
        c('not_required', 'Not required', 'لا يلزم'),
      ],
    },
    {
      id: 'reportDay',
      kind: 'day',
      label: L('Reported on (hospital day)', 'تاريخ الإبلاغ (اليوم)'),
      showIf: { field: 'reported', in: ['hospital', 'national'] },
    },
  ],
};

// ---------------------------------------------------------------- medication errors and near misses

const MED_ERROR: RegisterDef = {
  id: 'med_error',
  title: L('Medication errors and near misses', 'الأخطاء الدوائية والأخطاء الوشيكة'),
  noun: L('error or near miss', 'خطأ أو خطأ وشيك'),
  titleField: 'description',
  subtitleFields: ['prevention'],
  chipFields: ['stage', 'reached', 'reported'],
  fields: [
    { id: 'description', kind: 'longtext', required: true, label: L('What happened', 'ما الذي حدث') },
    { id: 'day', kind: 'day', label: L('Hospital day', 'اليوم') },
    {
      id: 'stage',
      kind: 'choice',
      required: true,
      label: L('Stage of the medication process', 'مرحلة استخدام الدواء'),
      options: [
        c('prescribing', 'Prescribing', 'الوصف'),
        c('transcribing', 'Transcribing', 'النقل والتدوين'),
        c('dispensing', 'Dispensing', 'الصرف'),
        c('administration', 'Administration', 'الإعطاء'),
        c('monitoring', 'Monitoring', 'المراقبة'),
      ],
    },
    {
      id: 'type',
      kind: 'choice',
      label: L('Type', 'النوع'),
      options: [
        c('wrong_drug', 'Wrong drug', 'دواء خاطئ'),
        c('wrong_dose', 'Wrong dose', 'جرعة خاطئة'),
        c('wrong_frequency', 'Wrong frequency', 'تكرار خاطئ'),
        c('wrong_route', 'Wrong route', 'طريقة إعطاء خاطئة'),
        c('wrong_time', 'Wrong time', 'توقيت خاطئ'),
        c('omission', 'Omission', 'إغفال جرعة'),
        c('wrong_patient', 'Wrong patient', 'مريض خاطئ'),
        c('duplication', 'Duplication', 'ازدواجية'),
        c('allergy', 'Known allergy not respected', 'تجاهل حساسية معروفة'),
        c('interaction', 'Interaction not managed', 'تداخل لم يُعالَج'),
        c('other', 'Other', 'أخرى'),
      ],
    },
    {
      id: 'reached',
      kind: 'choice',
      required: true,
      label: L('Did it reach the patient, and with what result?', 'هل وصل الخطأ إلى المريض وما النتيجة؟'),
      options: [
        c('potential', 'Potential error — circumstances only', 'خطأ محتمل — ظروف فقط'),
        c('not_reached', 'Error that did not reach the patient', 'خطأ لم يصل إلى المريض'),
        c('reached_no_harm', 'Reached the patient — no harm', 'وصل إلى المريض — دون ضرر'),
        c('reached_monitoring', 'Reached — needed monitoring or intervention to prevent harm', 'وصل — احتاج مراقبة أو تدخلاً لمنع الضرر'),
        c('harm_temporary', 'Temporary harm', 'ضرر مؤقت'),
        c('harm_permanent', 'Permanent harm', 'ضرر دائم'),
        c('life_threatening', 'Life-threatening', 'مهدد للحياة'),
        c('death', 'Death', 'وفاة'),
      ],
    },
    { id: 'prevention', kind: 'longtext', label: L('Prevention: what would stop it happening again', 'الوقاية: ما الذي يمنع تكراره') },
    {
      id: 'reported',
      kind: 'choice',
      label: L('Reported', 'الإبلاغ'),
      options: [
        c('not_reported', 'Not reported yet', 'لم يُبلَّغ بعد'),
        c('hospital', "Through the hospital's incident system", 'عبر نظام الإبلاغ عن الحوادث في المستشفى'),
        c('not_required', 'Not required', 'لا يلزم'),
      ],
    },
  ],
};

// ---------------------------------------------------------------- therapeutic drug monitoring

const TDM: RegisterDef = {
  id: 'tdm',
  title: L('Drug levels and their interpretation', 'مستويات الأدوية وتفسيرها'),
  noun: L('level review', 'مراجعة مستوى'),
  titleField: 'drug',
  subtitleFields: ['levelText', 'interpretation', 'noLevelPlan'],
  chipFields: ['levelAvailable', 'steadyState'],
  fields: [
    { id: 'drug', kind: 'text', required: true, label: L('Drug', 'الدواء') },
    {
      id: 'levelAvailable',
      kind: 'choice',
      required: true,
      label: L('Is a measured level available?', 'هل يتوفر مستوى مقاس؟'),
      options: [c('yes', 'Yes', 'نعم'), c('no', 'No — levels cannot be measured here', 'لا — لا يمكن قياس المستوى هنا')],
    },
    {
      id: 'levelEntryId',
      kind: 'entryRef',
      label: L('Level recorded on the timeline', 'المستوى المسجل في الخط الزمني'),
      showIf: { field: 'levelAvailable', in: ['yes'] },
    },
    {
      id: 'levelText',
      kind: 'text',
      label: L('Level (value and unit), if not on the timeline', 'المستوى (القيمة والوحدة) إن لم يكن في الخط الزمني'),
      showIf: { field: 'levelAvailable', in: ['yes'] },
    },
    {
      id: 'timing',
      kind: 'text',
      label: L('Timing relative to the dose', 'توقيت السحب بالنسبة للجرعة'),
      hint: L('For example: trough, 30 minutes before the 4th dose.', 'مثال: قاع، قبل الجرعة الرابعة بـ 30 دقيقة.'),
      showIf: { field: 'levelAvailable', in: ['yes'] },
      requiredIf: { field: 'levelAvailable', in: ['yes'] },
    },
    {
      id: 'steadyState',
      kind: 'choice',
      label: L('At steady state?', 'هل وصل إلى الحالة المستقرة؟'),
      showIf: { field: 'levelAvailable', in: ['yes'] },
      options: [c('yes', 'Yes', 'نعم'), c('no', 'No', 'لا'), c('unsure', 'Unsure', 'غير متأكد')],
    },
    {
      id: 'target',
      kind: 'text',
      label: L('Target range and its source', 'المدى المستهدف ومصدره'),
      showIf: { field: 'levelAvailable', in: ['yes'] },
      requiredIf: { field: 'levelAvailable', in: ['yes'] },
    },
    {
      id: 'interpretation',
      kind: 'longtext',
      label: L('Interpretation', 'التفسير'),
      showIf: { field: 'levelAvailable', in: ['yes'] },
      requiredIf: { field: 'levelAvailable', in: ['yes'] },
    },
    {
      id: 'noLevelPlan',
      kind: 'longtext',
      label: L('No-level path: the clinical monitoring used instead', 'المسار دون مستوى: المراقبة السريرية المستخدمة بدلاً منه'),
      hint: L(
        'For example renal function, clinical response and signs of toxicity, with how often you will check them.',
        'مثل وظائف الكلى والاستجابة السريرية وعلامات السمية، مع عدد مرات التحقق منها.',
      ),
      showIf: { field: 'levelAvailable', in: ['no'] },
      requiredIf: { field: 'levelAvailable', in: ['no'] },
    },
    { id: 'plan', kind: 'longtext', label: L('Plan', 'الخطة') },
  ],
};

// ---------------------------------------------------------------- monitoring plan

const MONITORING: RegisterDef = {
  id: 'monitoring',
  title: L('Monitoring plan', 'خطة المراقبة'),
  noun: L('parameter', 'مؤشر'),
  titleField: 'parameter',
  subtitleFields: ['forWhat', 'target', 'frequency'],
  chipFields: ['purpose', 'status'],
  fields: [
    { id: 'parameter', kind: 'text', required: true, label: L('Parameter', 'المؤشر') },
    {
      id: 'purpose',
      kind: 'choice',
      required: true,
      label: L('Monitors', 'يراقب'),
      options: [c('efficacy', 'Efficacy', 'الفعالية'), c('safety', 'Safety', 'السلامة'), c('both', 'Efficacy and safety', 'الفعالية والسلامة')],
    },
    { id: 'forWhat', kind: 'text', label: L('For which drug or problem', 'لأي دواء أو مشكلة') },
    { id: 'target', kind: 'text', required: true, label: L('Target', 'الهدف') },
    { id: 'frequency', kind: 'text', required: true, label: L('Frequency', 'التكرار') },
    { id: 'nextDay', kind: 'day', label: L('Next check (hospital day)', 'الفحص القادم (اليوم)') },
    { id: 'lastResult', kind: 'text', label: L('Latest result and trend', 'آخر نتيجة والاتجاه') },
    {
      id: 'status',
      kind: 'choice',
      required: true,
      label: L('Status', 'الحالة'),
      options: [c('active', 'Active', 'نشط'), c('completed', 'Completed', 'مكتمل'), c('stopped', 'Stopped', 'متوقف')],
    },
  ],
};

// ---------------------------------------------------------------- rounds

const ROUNDS: RegisterDef = {
  id: 'rounds',
  title: L('Rounds log', 'سجل الجولات'),
  noun: L('round', 'جولة'),
  titleField: 'points',
  subtitleFields: ['decisions', 'followUp'],
  chipFields: ['roundType'],
  fields: [
    { id: 'day', kind: 'day', required: true, label: L('Hospital day', 'اليوم') },
    {
      id: 'roundType',
      kind: 'choice',
      required: true,
      label: L('Type', 'النوع'),
      options: [
        c('ward', 'Ward round', 'جولة القسم'),
        c('consultant', 'Consultant round', 'جولة الاستشاري'),
        c('mdt', 'Multidisciplinary meeting', 'اجتماع الفريق متعدد التخصصات'),
        c('icu', 'ICU round', 'جولة العناية المركزة'),
        c('handover', 'Handover', 'تسليم واستلام'),
        c('other', 'Other', 'أخرى'),
      ],
    },
    { id: 'points', kind: 'longtext', required: true, label: L('Pharmacotherapy points I raised', 'النقاط الدوائية التي طرحتها') },
    { id: 'decisions', kind: 'longtext', label: L('Team decisions', 'قرارات الفريق') },
    { id: 'followUp', kind: 'longtext', label: L('To follow up', 'للمتابعة') },
  ],
};

// ---------------------------------------------------------------- counselling sessions

const COUNSELING: RegisterDef = {
  id: 'counseling',
  title: L('Counselling sessions', 'جلسات التثقيف'),
  noun: L('session', 'جلسة'),
  titleField: 'meds',
  subtitleFields: ['notes'],
  chipFields: ['who', 'teachBack'],
  fields: [
    { id: 'day', kind: 'day', label: L('Hospital day', 'اليوم') },
    {
      id: 'who',
      kind: 'choice',
      required: true,
      label: L('Counselled', 'تم تثقيف'),
      options: [c('patient', 'Patient', 'المريض'), c('caregiver', 'Caregiver', 'مقدم الرعاية'), c('both', 'Patient and caregiver', 'المريض ومقدم الرعاية')],
    },
    { id: 'meds', kind: 'text', required: true, label: L('Medications covered', 'الأدوية التي شملها التثقيف') },
    {
      id: 'topics',
      kind: 'multi',
      required: true,
      label: L('Topics covered', 'المواضيع التي غُطّيت'),
      options: [
        c('indication', 'What it is for', 'الغرض منه'),
        c('how', 'How to take it', 'طريقة الاستعمال'),
        c('timing', 'Timing with meals and khat', 'التوقيت مع الوجبات والقات'),
        c('duration', 'How long to take it', 'مدة الاستعمال'),
        c('missed', 'Missed doses', 'الجرعات الفائتة'),
        c('side_effects', 'Common side effects', 'الأعراض الجانبية الشائعة'),
        c('warning', 'Warning signs to report', 'علامات الخطر التي يجب الإبلاغ عنها'),
        c('interactions', 'Interactions, food and khat', 'التداخلات والغذاء والقات'),
        c('storage', 'Storage', 'التخزين'),
        c('device', 'Device or inhaler technique', 'طريقة استخدام الجهاز أو البخاخ'),
        c('follow_up', 'Follow-up and tests', 'المتابعة والفحوص'),
      ],
    },
    {
      id: 'language',
      kind: 'choice',
      label: L('Language used', 'اللغة المستخدمة'),
      options: [c('ar', 'Arabic', 'العربية'), c('en', 'English', 'الإنجليزية'), c('other', 'Other', 'أخرى')],
    },
    {
      id: 'teachBack',
      kind: 'choice',
      required: true,
      label: L('Teach-back', 'إعادة الشرح من المريض (Teach-back)'),
      options: [
        c('understood', 'Explained it back correctly', 'أعاد الشرح بشكل صحيح'),
        c('partly', 'Partly', 'جزئياً'),
        c('not_done', 'Not done', 'لم يتم'),
      ],
    },
    { id: 'notes', kind: 'longtext', label: L('Notes and materials given', 'ملاحظات والمواد المعطاة') },
  ],
};

// ---------------------------------------------------------------- discharge medication plan

const DISCHARGE_MED: RegisterDef = {
  id: 'discharge_med',
  title: L('Discharge medication plan', 'الخطة الدوائية عند الخروج'),
  noun: L('discharge medication', 'دواء خروج'),
  titleField: 'drug',
  subtitleFields: ['regimen', 'purpose', 'duration'],
  chipFields: ['change', 'available'],
  fields: [
    { id: 'drug', kind: 'text', required: true, label: L('Medication', 'الدواء') },
    { id: 'regimen', kind: 'text', required: true, label: L('Dose, route and frequency', 'الجرعة وطريقة الإعطاء والتكرار') },
    { id: 'purpose', kind: 'text', label: L('Purpose, in plain words', 'الغرض بكلمات بسيطة') },
    { id: 'duration', kind: 'text', label: L('Duration or stop date', 'المدة أو موعد الإيقاف') },
    {
      id: 'change',
      kind: 'choice',
      required: true,
      label: L('Compared with before admission', 'مقارنة بما قبل الدخول'),
      options: [c('new', 'New', 'جديد'), c('changed', 'Changed', 'معدّل'), c('unchanged', 'Unchanged', 'دون تغيير')],
    },
    {
      id: 'reason',
      kind: 'text',
      label: L('Reason for the change', 'سبب التغيير'),
      showIf: { field: 'change', in: ['new', 'changed'] },
      requiredIf: { field: 'change', in: ['new', 'changed'] },
    },
    { id: 'instructions', kind: 'text', label: L('Special instructions (meals, khat, monitoring)', 'تعليمات خاصة (الوجبات، القات، المراقبة)') },
    {
      id: 'available',
      kind: 'choice',
      label: L('Availability and cost for the patient', 'التوفر والتكلفة بالنسبة للمريض'),
      options: [
        c('yes', 'Available and affordable', 'متوفر وبتكلفة مناسبة'),
        c('concern', 'Availability or cost concern', 'مشكلة في التوفر أو التكلفة'),
        c('unknown', 'Not checked', 'لم يُتحقق منه'),
      ],
    },
    { id: 'followUp', kind: 'text', label: L('Follow-up tests or appointment', 'فحوص أو موعد المتابعة') },
  ],
};

// ---------------------------------------------------------------- references (ExternalReference, Section 4)

const REFERENCE: RegisterDef = {
  id: 'reference',
  title: L('References and protocols you used', 'المراجع والبروتوكولات التي استخدمتها'),
  noun: L('reference', 'مرجع'),
  titleField: 'title',
  subtitleFields: ['publisher', 'year', 'usedFor'],
  chipFields: ['type'],
  fields: [
    {
      id: 'title',
      kind: 'text',
      required: true,
      label: L('Title or topic', 'العنوان أو الموضوع'),
      hint: L('List only what you read yourself. PRECEPTOR never consults, suggests or cites a source.', 'اذكر فقط ما قرأته بنفسك. لا يرجع PRECEPTOR إلى أي مصدر ولا يقترحه ولا يستشهد به.'),
    },
    { id: 'publisher', kind: 'text', label: L('Organisation or publisher', 'الجهة أو الناشر') },
    { id: 'year', kind: 'text', label: L('Year or version', 'السنة أو الإصدار') },
    {
      id: 'type',
      kind: 'choice',
      required: true,
      label: L('Type', 'النوع'),
      options: [
        c('guideline', 'Guideline', 'دليل إرشادي'),
        c('protocol', 'Hospital protocol', 'بروتوكول المستشفى'),
        c('textbook', 'Textbook', 'كتاب مرجعي'),
        c('article', 'Journal article', 'مقال علمي'),
        c('label', 'Product label', 'نشرة الدواء'),
        c('database', 'Drug information resource', 'مصدر معلومات دوائية'),
        c('other', 'Other', 'أخرى'),
      ],
    },
    {
      id: 'link',
      kind: 'text',
      label: L('Link', 'الرابط'),
      hint: L('Kept as text for your own record. PRECEPTOR never opens or fetches it.', 'يُحفظ كنص لسجلك الخاص. لا يفتحه PRECEPTOR ولا يجلبه أبداً.'),
    },
    { id: 'usedFor', kind: 'text', label: L('Used for', 'استُخدم في') },
    { id: 'verified', kind: 'confirm', required: true, label: L('I read this source myself', 'قرأت هذا المصدر بنفسي') },
  ],
};

// ---------------------------------------------------------------- calculations the trainee checked by hand

const CALC_CHECK: RegisterDef = {
  id: 'calc_check',
  title: L('Calculations you checked', 'الحسابات التي تحققت منها'),
  noun: L('calculation', 'حساب'),
  titleField: 'what',
  subtitleFields: ['result', 'method'],
  chipFields: ['doubleChecked'],
  fields: [
    { id: 'what', kind: 'text', required: true, label: L('What was calculated', 'ما الذي حُسب') },
    { id: 'inputs', kind: 'longtext', required: true, label: L('Inputs, each with its unit', 'المدخلات، كل منها مع وحدته') },
    { id: 'method', kind: 'text', required: true, label: L('Formula or method, and its source', 'المعادلة أو الطريقة ومصدرها') },
    { id: 'result', kind: 'text', required: true, label: L('Result, with its unit', 'النتيجة مع وحدتها') },
    {
      id: 'doubleChecked',
      kind: 'choice',
      label: L('Independent double-check', 'تحقق مستقل مزدوج'),
      options: [c('yes', 'Double-checked independently', 'تم التحقق المستقل'), c('no', 'Not yet', 'ليس بعد')],
    },
    { id: 'comment', kind: 'longtext', label: L('Comment', 'تعليق') },
  ],
};

export const REGISTERS: Readonly<Record<RegisterId, RegisterDef>> = {
  home_med: HOME_MED,
  drp: DRP,
  interaction: INTERACTION,
  adr: ADR,
  med_error: MED_ERROR,
  tdm: TDM,
  monitoring: MONITORING,
  rounds: ROUNDS,
  counseling: COUNSELING,
  discharge_med: DISCHARGE_MED,
  reference: REFERENCE,
  calc_check: CALC_CHECK,
};

// ---------------------------------------------------------------- validation

export type ItemFieldError = 'required' | 'invalidChoice' | 'hospitalDay' | 'time' | 'tooLong' | 'unknownField' | 'confirm';
export type ItemErrors = Record<string, ItemFieldError>;

export const MAX_TEXT = 300;
export const MAX_LONGTEXT = 4000;

function matches(cond: Condition | undefined, values: Record<string, string>): boolean {
  if (!cond) return true;
  return cond.in.includes(values[cond.field] ?? '');
}

/** Whether a field is currently shown, given the other values. */
export function isFieldVisible(def: FieldDef, values: Record<string, string>): boolean {
  return matches(def.showIf, values);
}

/**
 * Trims values, drops empty and hidden ones, and checks the result against the
 * register's schema. References to medications, problems and entries are
 * checked against the case by the store, not here.
 */
export function normalizeItemFields(
  register: RegisterId,
  input: Record<string, string>,
): { ok: true; fields: Record<string, string> } | { ok: false; errors: ItemErrors } {
  const def = REGISTERS[register];
  const known = new Map(def.fields.map((f) => [f.id, f]));
  const errors: ItemErrors = {};
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!known.has(k)) {
      errors[k] = 'unknownField';
      continue;
    }
    const t = (v ?? '').trim();
    if (t) raw[k] = t;
  }
  const out: Record<string, string> = {};
  for (const f of def.fields) {
    const v = raw[f.id];
    const visible = isFieldVisible(f, raw);
    const required = f.required || (f.requiredIf ? matches(f.requiredIf, raw) : false);
    if (!visible) continue; // hidden values are dropped
    if (v === undefined) {
      if (required) errors[f.id] = f.kind === 'confirm' ? 'confirm' : 'required';
      continue;
    }
    switch (f.kind) {
      case 'text':
        if (v.length > MAX_TEXT) errors[f.id] = 'tooLong';
        break;
      case 'longtext':
        if (v.length > MAX_LONGTEXT) errors[f.id] = 'tooLong';
        break;
      case 'choice':
        if (!f.options?.some((o) => o.value === v)) errors[f.id] = 'invalidChoice';
        break;
      case 'multi': {
        const parts = v.split('|').filter(Boolean);
        if (parts.length === 0 && required) errors[f.id] = 'required';
        if (parts.some((p) => !f.options?.some((o) => o.value === p))) errors[f.id] = 'invalidChoice';
        if (new Set(parts).size !== parts.length) errors[f.id] = 'invalidChoice';
        break;
      }
      case 'day': {
        const n = Number(v);
        if (!/^-?\d+$/.test(v) || !isValidHospitalDay(n)) errors[f.id] = 'hospitalDay';
        break;
      }
      case 'time':
        if (!isValidTimeOfDay(v)) errors[f.id] = 'time';
        break;
      case 'confirm':
        if (v !== 'yes') errors[f.id] = 'confirm';
        break;
      case 'medRef':
      case 'problemRef':
      case 'entryRef':
        if (v.length > 100) errors[f.id] = 'tooLong';
        break;
    }
    out[f.id] = v;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, fields: out };
}

/** The label of a choice value, or the value itself when it is not a choice. */
export function choiceLabel(register: RegisterId, fieldId: string, value: string): L | undefined {
  const f = REGISTERS[register].fields.find((x) => x.id === fieldId);
  return f?.options?.find((o) => o.value === value)?.label;
}

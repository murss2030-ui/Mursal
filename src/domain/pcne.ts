/**
 * The PCNE Classification V 9.1 (Pharmaceutical Care Network Europe), the
 * stored classification of a drug-related problem (Section 14): problem
 * domains P1–P3 and cause domains C1–C9, with the planned interventions,
 * the acceptance of interventions and the status of the problem.
 *
 * Codes and English wording are copied from the official English document
 * ("PCNE Classification for Drug-Related Problems V9.1", PDF of 7 January
 * 2026, pcne.org). The Arabic lines are PRECEPTOR's explanations shown beside
 * the official English wording (Section 20); they are not a PCNE translation.
 *
 * PCNE's terms: the classification may be used exclusively for
 * pharmaceutical care research and practice, provided that the PCNE
 * Association is informed of its use and of the results of any validations;
 * commercial use needs the PCNE Board's explicit permission.
 */
import { L } from './label';

export const PCNE_CITATION = 'The PCNE Classification V 9.1. Pharmaceutical Care Network Europe Association, © 2003–2020 (English edition, 2026). pcne.org';

export const PCNE_TERMS =
  'This classification may be used exclusively for Pharmaceutical Care Research and Practice, provided that the PCNE Association is informed of its use and of the results of any validations. Any use by commercial entities, or any use with a commercial purpose, is prohibited unless the user has obtained explicit permission from the PCNE Board. These conditions reflect PCNE’s long-standing policy and apply to both the current version and earlier versions of the classification. The exclusive place of jurisdiction for any dispute arising from the use of this classification is the District Court of The Hague, the Netherlands.';

export type PcneSection = 'problem' | 'cause' | 'intervention' | 'acceptance' | 'status';

export interface PcneDomain {
  /** P1, C3, I2, A1, O3 … */
  code: string;
  section: PcneSection;
  label: L;
  /** The domain's description in the document, where it gives one. */
  description?: L;
}

export interface PcneCode {
  /** P1.2, C7.10, I3.5 … */
  code: string;
  domain: string;
  /** The official English wording, with PRECEPTOR's Arabic explanation. */
  label: L;
}

const d = (code: string, section: PcneSection, en: string, ar: string, desc?: [string, string]): PcneDomain => ({
  code,
  section,
  label: L(en, ar),
  ...(desc ? { description: L(desc[0], desc[1]) } : {}),
});
const c = (code: string, en: string, ar: string): PcneCode => ({ code, domain: code.split('.')[0]!, label: L(en, ar) });

export const PCNE_DOMAINS: readonly PcneDomain[] = [
  d('P1', 'problem', 'Treatment effectiveness', 'فعالية العلاج', [
    'There is a (potential) problem with the (lack of) effect of the pharmacotherapy',
    'هناك مشكلة (فعلية أو محتملة) في أثر العلاج الدوائي أو في غيابه',
  ]),
  d('P2', 'problem', 'Treatment safety', 'سلامة العلاج', [
    'Patient suffers, or could suffer, from an adverse drug event',
    'يعاني المريض، أو قد يعاني، من حدث دوائي ضار',
  ]),
  d('P3', 'problem', 'Other', 'أخرى'),
  d('C1', 'cause', 'Drug selection', 'اختيار الدواء', ['The cause of the DRP can be related to the selection of the drug', 'قد يتعلق سبب المشكلة باختيار الدواء']),
  d('C2', 'cause', 'Drug form', 'الشكل الصيدلاني', ['The cause of the DRP is related to the selection of the drug form', 'يتعلق سبب المشكلة باختيار الشكل الصيدلاني']),
  d('C3', 'cause', 'Dose selection', 'اختيار الجرعة', ['The cause of the DRP can be related to the selection of the dosage schedule', 'قد يتعلق سبب المشكلة باختيار نظام الجرعات']),
  d('C4', 'cause', 'Treatment duration', 'مدة العلاج', ['The cause of the DRP is related to the duration of treatment', 'يتعلق سبب المشكلة بمدة العلاج']),
  d('C5', 'cause', 'Dispensing', 'الصرف', [
    'The cause of the DRP can be related to the logistics of the prescribing and dispensing process',
    'قد يتعلق سبب المشكلة بإجراءات الوصف والصرف',
  ]),
  d('C6', 'cause', 'Drug use process', 'عملية إعطاء الدواء', [
    'The cause of the DRP is related to the way the patient gets the drug administered by a health professional or carer, in spite of proper instructions (on the label)',
    'يتعلق سبب المشكلة بطريقة إعطاء الدواء للمريض من قبل مهني صحي أو مقدم رعاية، رغم صحة التعليمات (على الملصق)',
  ]),
  d('C7', 'cause', 'Patient related', 'متعلق بالمريض', [
    'The cause of the DRP can be related to the patient and his behaviour (intentional or non-intentional)',
    'قد يتعلق سبب المشكلة بالمريض وسلوكه (عن قصد أو دون قصد)',
  ]),
  d('C8', 'cause', 'Patient transfer related', 'متعلق بانتقال المريض', [
    'The cause of the DRP can be related to the transfer of patients between primary, secondary and tertiary care, or transfer within one care institution.',
    'قد يتعلق سبب المشكلة بانتقال المريض بين مستويات الرعاية الأولية والثانوية والثالثية، أو داخل المؤسسة الصحية الواحدة.',
  ]),
  d('C9', 'cause', 'Other', 'أخرى'),
  d('I0', 'intervention', 'No intervention', 'لا تدخل'),
  d('I1', 'intervention', 'At prescriber level', 'على مستوى الواصف'),
  d('I2', 'intervention', 'At patient level', 'على مستوى المريض'),
  d('I3', 'intervention', 'At drug level', 'على مستوى الدواء'),
  d('I4', 'intervention', 'Other', 'أخرى'),
  d('A1', 'acceptance', 'Intervention accepted', 'قُبل التدخل'),
  d('A2', 'acceptance', 'Intervention not accepted', 'لم يُقبل التدخل'),
  d('A3', 'acceptance', 'Other', 'أخرى'),
  d('O0', 'status', 'Problem status unknown', 'حالة المشكلة غير معروفة'),
  d('O1', 'status', 'Problem solved', 'حُلّت المشكلة'),
  d('O2', 'status', 'Problem partially solved', 'حُلّت المشكلة جزئياً'),
  d('O3', 'status', 'Problem not solved', 'لم تُحل المشكلة'),
];

export const PCNE_PROBLEMS: readonly PcneCode[] = [
  c('P1.1', 'No effect of drug treatment despite correct use', 'لا أثر للعلاج الدوائي رغم الاستخدام الصحيح'),
  c('P1.2', 'Effect of drug treatment not optimal', 'أثر العلاج الدوائي غير مثالي'),
  c('P1.3', 'Untreated symptoms or indication', 'أعراض أو استطباب دون علاج'),
  c('P2.1', 'Adverse drug event (possibly) occurring', 'حدث دوائي ضار (يحدث أو يُحتمل حدوثه)'),
  c('P3.1', 'Unnecessary drug-treatment', 'علاج دوائي غير ضروري'),
  c('P3.2', 'Unclear problem/complaint. Further clarification necessary (please use as escape only)', 'مشكلة أو شكوى غير واضحة تحتاج إلى توضيح إضافي (للاستخدام كخيار أخير فقط)'),
];

export const PCNE_CAUSES: readonly PcneCode[] = [
  c('C1.1', 'Inappropriate drug according to guidelines/formulary', 'دواء غير مناسب وفق الإرشادات أو الدليل الدوائي'),
  c('C1.2', 'No indication for drug', 'لا استطباب للدواء'),
  c('C1.3', 'Inappropriate combination of drugs, or drugs and herbal medications, or drugs and dietary supplements', 'جمع غير مناسب بين أدوية، أو بين أدوية وأدوية عشبية، أو بين أدوية ومكملات غذائية'),
  c('C1.4', 'Inappropriate duplication of therapeutic group or active ingredient', 'ازدواجية غير مناسبة في المجموعة العلاجية أو المادة الفعالة'),
  c('C1.5', 'No or incomplete drug treatment in spite of existing indication', 'غياب العلاج الدوائي أو نقصه رغم وجود الاستطباب'),
  c('C1.6', 'Too many different drugs/active ingredients prescribed for indication', 'وصف عدد كبير جداً من الأدوية أو المواد الفعالة للاستطباب الواحد'),
  c('C2.1', 'Inappropriate drug form/formulation (for this patient)', 'شكل صيدلاني أو تركيبة غير مناسبة (لهذا المريض)'),
  c('C3.1', 'Drug dose too low', 'جرعة الدواء منخفضة جداً'),
  c('C3.2', 'Drug dose of a single active ingredient too high', 'جرعة مادة فعالة واحدة مرتفعة جداً'),
  c('C3.3', 'Dosage regimen not frequent enough', 'نظام الجرعات غير متكرر بما يكفي'),
  c('C3.4', 'Dosage regimen too frequent', 'نظام الجرعات متكرر أكثر من اللازم'),
  c('C3.5', 'Dose timing instructions wrong, unclear or missing', 'تعليمات توقيت الجرعة خاطئة أو غير واضحة أو غائبة'),
  c('C4.1', 'Duration of treatment too short', 'مدة العلاج قصيرة جداً'),
  c('C4.2', 'Duration of treatment too long', 'مدة العلاج طويلة جداً'),
  c('C5.1', 'Prescribed drug not available', 'الدواء الموصوف غير متوفر'),
  c('C5.2', 'Necessary information not provided or incorrect advice provided', 'لم تُقدَّم المعلومات اللازمة أو قُدِّمت نصيحة خاطئة'),
  c('C5.3', 'Wrong drug, strength or dosage advised (OTC)', 'نُصح بدواء أو تركيز أو جرعة خاطئة (أدوية دون وصفة)'),
  c('C5.4', 'Wrong drug or strength dispensed', 'صُرف دواء أو تركيز خاطئ'),
  c('C6.1', 'Inappropriate timing of administration or dosing intervals by a health professional', 'توقيت إعطاء أو فواصل جرعات غير مناسبة من قبل مهني صحي'),
  c('C6.2', 'Drug under-administered by a health professional', 'إعطاء الدواء بأقل من المطلوب من قبل مهني صحي'),
  c('C6.3', 'Drug over-administered by a health professional', 'إعطاء الدواء بأكثر من المطلوب من قبل مهني صحي'),
  c('C6.4', 'Drug not administered at all by a health professional', 'لم يُعطَ الدواء إطلاقاً من قبل مهني صحي'),
  c('C6.5', 'Wrong drug administered by a health professional', 'أُعطي دواء خاطئ من قبل مهني صحي'),
  c('C6.6', 'Drug administered via wrong route by a health professional', 'أُعطي الدواء بطريق خاطئ من قبل مهني صحي'),
  c('C7.1', 'Patient intentionally uses/takes less drug than prescribed or does not take the drug at all for whatever reason', 'يستخدم المريض عن قصد كمية أقل من الموصوف أو لا يتناول الدواء إطلاقاً لأي سبب'),
  c('C7.2', 'Patient uses/takes more drug than prescribed', 'يستخدم المريض كمية أكبر من الموصوف'),
  c('C7.3', 'Patient abuses drug (unregulated overuse)', 'يسيء المريض استخدام الدواء (إفراط غير منضبط)'),
  c('C7.4', 'Patient decides to use unnecessary drug', 'يقرر المريض استخدام دواء غير ضروري'),
  c('C7.5', 'Patient takes food that interacts', 'يتناول المريض طعاماً يتداخل مع الدواء'),
  c('C7.6', 'Patient stores drug inappropriately', 'يخزّن المريض الدواء بطريقة غير مناسبة'),
  c('C7.7', 'Inappropriate timing or dosing intervals', 'توقيت أو فواصل جرعات غير مناسبة'),
  c('C7.8', 'Patient unintentionally administers/uses the drug in a wrong way', 'يستخدم المريض الدواء بطريقة خاطئة دون قصد'),
  c('C7.9', 'Patient physically unable to use drug/form as directed', 'المريض غير قادر جسدياً على استخدام الدواء أو الشكل الصيدلاني كما هو موجّه'),
  c('C7.10', 'Patient unable to understand instructions properly', 'المريض غير قادر على فهم التعليمات بشكل صحيح'),
  c('C8.1', 'Medication reconciliation problem', 'مشكلة في مطابقة الأدوية'),
  c('C9.1', 'No or inappropriate outcome monitoring (incl. TDM)', 'غياب مراقبة النتائج أو عدم ملاءمتها (بما فيها مراقبة مستوى الدواء)'),
  c('C9.2', 'Other cause; specify', 'سبب آخر؛ حدّده'),
  c('C9.3', 'No obvious cause', 'لا سبب واضح'),
];

export const PCNE_INTERVENTIONS: readonly PcneCode[] = [
  c('I0.1', 'No Intervention', 'لا تدخل'),
  c('I1.1', 'Prescriber informed only', 'إبلاغ الواصف فقط'),
  c('I1.2', 'Prescriber asked for information', 'طُلبت معلومات من الواصف'),
  c('I1.3', 'Intervention proposed to prescriber', 'اقتُرح التدخل على الواصف'),
  c('I1.4', 'Intervention discussed with prescriber', 'نوقش التدخل مع الواصف'),
  c('I2.1', 'Patient (drug) counselling', 'إرشاد المريض (دوائياً)'),
  c('I2.2', 'Written information provided (only)', 'قُدّمت معلومات مكتوبة (فقط)'),
  c('I2.3', 'Patient referred to prescriber', 'أُحيل المريض إلى الواصف'),
  c('I2.4', 'Spoken to family member/caregiver', 'جرى التحدث مع أحد أفراد العائلة أو مقدم الرعاية'),
  c('I3.1', 'Drug changed to …', 'تغيير الدواء إلى …'),
  c('I3.2', 'Dosage changed to …', 'تغيير الجرعة إلى …'),
  c('I3.3', 'Formulation changed to …', 'تغيير الشكل الصيدلاني إلى …'),
  c('I3.4', 'Instructions for use changed to …', 'تغيير تعليمات الاستخدام إلى …'),
  c('I3.5', 'Drug paused or stopped', 'إيقاف الدواء مؤقتاً أو نهائياً'),
  c('I3.6', 'Drug started', 'بدء الدواء'),
  c('I4.1', 'Other intervention (specify)', 'تدخل آخر (حدّده)'),
  c('I4.2', 'Side effect reported to authorities', 'الإبلاغ عن الأثر الجانبي للجهات المختصة'),
];

export const PCNE_ACCEPTANCE: readonly PcneCode[] = [
  c('A1.1', 'Intervention accepted and fully implemented', 'قُبل التدخل ونُفّذ بالكامل'),
  c('A1.2', 'Intervention accepted, partially implemented', 'قُبل التدخل ونُفّذ جزئياً'),
  c('A1.3', 'Intervention accepted but not implemented', 'قُبل التدخل لكنه لم يُنفّذ'),
  c('A1.4', 'Intervention accepted, implementation unknown', 'قُبل التدخل وتنفيذه غير معروف'),
  c('A2.1', 'Intervention not accepted: not feasible', 'لم يُقبل التدخل: غير ممكن التنفيذ'),
  c('A2.2', 'Intervention not accepted: no agreement', 'لم يُقبل التدخل: لا اتفاق'),
  c('A2.3', 'Intervention not accepted: other reason (specify)', 'لم يُقبل التدخل: سبب آخر (حدّده)'),
  c('A2.4', 'Intervention not accepted: unknown reason', 'لم يُقبل التدخل: سبب غير معروف'),
  c('A3.1', 'Intervention proposed, acceptance unknown', 'اقتُرح التدخل والقبول غير معروف'),
  c('A3.2', 'Intervention not proposed', 'لم يُقترح التدخل'),
];

export const PCNE_STATUS: readonly PcneCode[] = [
  c('O0.1', 'Problem status unknown', 'حالة المشكلة غير معروفة'),
  c('O1.1', 'Problem totally solved', 'حُلّت المشكلة كلياً'),
  c('O2.1', 'Problem partially solved', 'حُلّت المشكلة جزئياً'),
  c('O3.1', 'Problem not solved, lack of cooperation of patient', 'لم تُحل المشكلة لعدم تعاون المريض'),
  c('O3.2', 'Problem not solved, lack of cooperation of prescriber', 'لم تُحل المشكلة لعدم تعاون الواصف'),
  c('O3.3', 'Problem not solved, intervention not effective', 'لم تُحل المشكلة لأن التدخل لم يكن فعالاً'),
  c('O3.4', 'No need or possibility to solve problem', 'لا حاجة أو لا إمكانية لحل المشكلة'),
];

/** Whether the problem is potential or already manifest (the document's two boxes under the problems). */
export type PcneProblemType = 'potential' | 'manifest';

export const PCNE_CODE: ReadonlyMap<string, PcneCode> = new Map(
  [...PCNE_PROBLEMS, ...PCNE_CAUSES, ...PCNE_INTERVENTIONS, ...PCNE_ACCEPTANCE, ...PCNE_STATUS].map((x) => [x.code, x]),
);
export const PCNE_DOMAIN: ReadonlyMap<string, PcneDomain> = new Map(PCNE_DOMAINS.map((x) => [x.code, x]));

export const isProblemCode = (code: string): boolean => PCNE_PROBLEMS.some((p) => p.code === code);
export const isCauseCode = (code: string): boolean => PCNE_CAUSES.some((x) => x.code === code);

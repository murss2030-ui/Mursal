/**
 * The department's Clinical Pharmacy Assessment and Medication Review Form
 * (Decision 9, Section 15): eleven numbered sections whose numbering and field
 * names are preserved exactly. English is the official label; the Arabic label
 * is shown beside it.
 *
 * Source of these labels: the specification's description of the paper form
 * (Section 15). They must be checked against the paper form itself before the
 * M6 export is built.
 */
import type { Milestone } from '../../config/release';

export interface FormLabel {
  en: string;
  ar: string;
}

const L = (en: string, ar: string): FormLabel => ({ en, ar });

export const FORM_TITLE = L(
  'Clinical Pharmacy Assessment and Medication Review Form',
  'نموذج تقييم الصيدلة السريرية ومراجعة الأدوية',
);

export const SECTION_TITLES: Readonly<Record<number, FormLabel>> = {
  1: L('Patient identification and administrative data', 'تعريف المريض والبيانات الإدارية'),
  2: L('Clinical assessment', 'التقييم السريري'),
  3: L('Diagnosis and clinical status', 'التشخيص والحالة السريرية'),
  4: L('Medication reconciliation', 'مطابقة الأدوية'),
  5: L('Laboratory and clinical monitoring', 'المراقبة المخبرية والسريرية'),
  6: L('Medication therapy review', 'مراجعة العلاج الدوائي'),
  7: L('Drug interaction assessment', 'تقييم التداخلات الدوائية'),
  8: L('Drug-related problems', 'المشكلات المتعلقة بالعلاج الدوائي'),
  9: L('Pharmacist intervention and recommendation', 'تدخل الصيدلي وتوصياته'),
  10: L('Follow-up plan', 'خطة المتابعة'),
  11: L('Documentation', 'التوثيق'),
};

export const FIELD_LABELS = {
  // Section 1
  's1.patientName': L('Patient name', 'اسم المريض'),
  's1.mrn': L('MRN/ID', 'رقم الملف الطبي / الهوية'),
  's1.age': L('Age', 'العمر'),
  's1.gender': L('Gender', 'الجنس'),
  's1.wardRoom': L('Ward/room', 'القسم / الغرفة'),
  's1.consultant': L('Consultant', 'الطبيب الاستشاري'),
  's1.admissionDate': L('Admission date', 'تاريخ الدخول'),
  's1.dischargeDate': L('Discharge date', 'تاريخ الخروج'),
  's1.height': L('Height', 'الطول'),
  's1.weight': L('Weight', 'الوزن'),
  's1.bmi': L('BMI', 'مؤشر كتلة الجسم'),
  's1.crclEgfr': L('CrCl/eGFR', 'تصفية الكرياتينين / معدل الترشيح الكبيبي المقدَّر'),
  // Section 2
  's2.chiefComplaint': L('Chief complaint', 'الشكوى الرئيسية'),
  's2.hpi': L('History of present illness', 'تاريخ المرض الحالي'),
  's2.pmhPsh': L('Past medical and surgical history', 'التاريخ المرضي والجراحي السابق'),
  's2.allergies': L('Allergies and previous ADRs', 'الحساسية والتفاعلات الدوائية الضارة السابقة'),
  's2.familySocial': L('Family and social history / lifestyle', 'التاريخ العائلي والاجتماعي / نمط الحياة'),
  // Section 3
  's3.problem': L('Problem', 'المشكلة'),
  's3.acuity': L('Acute/chronic', 'حادة / مزمنة'),
  's3.stage': L('Stage', 'المرحلة'),
  's3.type': L('Type', 'النوع'),
  's3.status': L('Status', 'الحالة'),
  's3.duration': L('Duration', 'المدة'),
  's3.diagnosis': L('Diagnosis', 'التشخيص'),
  // Section 4
  's4.medication': L('Medication', 'الدواء'),
  's4.before': L('Medication before admission', 'الأدوية قبل الدخول'),
  's4.during': L('Medication during admission', 'الأدوية أثناء الإقامة'),
  's4.discharge': L('Medication at discharge', 'الأدوية عند الخروج'),
  's4.action': L('Action/reason', 'الإجراء / السبب'),
  // Section 5
  's5.parameter': L('Parameter', 'المؤشر'),
  's5.date': L('Date', 'التاريخ'),
  's5.result': L('Result', 'النتيجة'),
  's5.refRange': L('Reference range', 'المدى المرجعي'),
  's5.interpretation': L('Interpretation / clinical significance', 'التفسير / الأهمية السريرية'),
  // Section 6
  's6.medication': L('Medication', 'الدواء'),
  's6.indication': L('Indication', 'دواعي الاستعمال'),
  's6.regimen': L('Dose/route/frequency', 'الجرعة / طريقة الإعطاء / التكرار'),
  's6.effectiveness': L('Effectiveness', 'الفعالية'),
  's6.safety': L('Safety', 'السلامة'),
  's6.monitoring': L('Monitoring', 'المراقبة'),
  's6.target': L('Target goal', 'الهدف العلاجي'),
  // Section 7
  's7.drugA': L('Drug A', 'الدواء أ'),
  's7.drugB': L('Drug B', 'الدواء ب'),
  's7.severity': L('Severity', 'الشدة'),
  's7.mechanism': L('Mechanism', 'الآلية'),
  's7.management': L('Management plan', 'خطة التعامل'),
  // Section 8
  's8.explanation': L('Explanation', 'التوضيح'),
  // Section 9
  's9.text': L('Pharmacist intervention and recommendation', 'تدخل الصيدلي وتوصياته'),
  // Section 10
  's10.parameters': L('Monitoring parameters', 'مؤشرات المراقبة'),
  's10.frequency': L('Frequency', 'التكرار'),
  's10.target': L('Target', 'الهدف'),
  's10.nextReview': L('Next review date', 'موعد المراجعة القادمة'),
  // Section 11
  's11.name': L('Clinical pharmacist / student name', 'اسم الصيدلي السريري / الطالب'),
  's11.date': L('Date', 'التاريخ'),
  's11.signature': L('Supervisor signature', 'توقيع المشرف'),
  's11.references': L('References', 'المراجع'),
} as const satisfies Record<string, FormLabel>;
export type FieldKey = keyof typeof FIELD_LABELS;

/** Section 8 checkbox list, in the form's order. */
export const DRP_CHECKBOXES: readonly FormLabel[] = [
  L('Unnecessary medication', 'دواء غير ضروري'),
  L('Need for additional therapy', 'الحاجة إلى علاج إضافي'),
  L('Ineffective therapy', 'علاج غير فعّال'),
  L('Dose too low', 'جرعة منخفضة جداً'),
  L('Dose too high', 'جرعة مرتفعة جداً'),
  L('Adverse drug reaction', 'تفاعل دوائي ضار'),
  L('Drug interaction', 'تداخل دوائي'),
  L('Non-adherence', 'عدم الالتزام بالعلاج'),
  L('Monitoring problem', 'مشكلة في المراقبة'),
  L('Other', 'أخرى'),
];

/**
 * Fields that hold identifiers. Ward copy and Teaching copy differ only in
 * these (Section 15). Name and MRN are replaced by the case id; room/bed and
 * consultant (physician) name are withheld, and calendar dates are shown as
 * hospital days, following the Safe Harbor design standard of Section 18.
 * Age differs only for patients older than 89, who are shown as "90 or older".
 */
export const IDENTIFIER_FIELDS: ReadonlySet<string> = new Set([
  's1.patientName',
  's1.mrn',
  's1.age',
  's1.wardRoom',
  's1.consultant',
  's1.admissionDate',
  's1.dischargeDate',
  's5.date',
]);

/**
 * Where each not-yet-built part of the form comes from. Sections 4 and 7–10
 * and the references are filled from the Clinical Modules (M1 revision);
 * their engines (interaction checking M2, PCNE M4, retrieval M5) add to them
 * later. Since M2, BMI and CrCl/eGFR come from calculation results.
 */
export const FORM_DEPENDENCIES: Readonly<Record<string, Milestone>> = {
  's11.date': 'M6',
};

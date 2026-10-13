/**
 * Clinical vocabulary (Decision 10): the term always stays in English; in the
 * Arabic interface an Arabic explanation is shown beside it, e.g.
 * "Drug-Related Problem (DRP) — المشكلة المتعلقة بالعلاج الدوائي".
 */
export const TERMS = {
  // record types
  teaching_case: { en: 'Teaching Case', ar: 'حالة تعليمية' },
  clinical_case: { en: 'Clinical Case', ar: 'حالة سريرية' },
  teaching_copy: { en: 'Teaching copy', ar: 'نسخة تعليمية بلا معرّفات' },
  ward_copy: { en: 'Ward copy', ar: 'نسخة القسم بالمعرّفات' },
  hospital_day: { en: 'Hospital day', ar: 'اليوم منذ الدخول' },
  timeline: { en: 'Timeline', ar: 'الخط الزمني للحالة' },
  provenance: { en: 'Provenance', ar: 'مصدر المعلومة وحالة التحقق' },
  drp: { en: 'Drug-Related Problem (DRP)', ar: 'المشكلة المتعلقة بالعلاج الدوائي' },
  pcne: { en: 'PCNE classification', ar: 'تصنيف المشكلات الدوائية PCNE' },
  mrn: { en: 'MRN', ar: 'رقم الملف الطبي' },
  nkda: { en: 'NKDA', ar: 'لا توجد حساسية دوائية معروفة' },
  adr: { en: 'ADR', ar: 'تفاعل دوائي ضار' },
  crcl: { en: 'CrCl', ar: 'تصفية الكرياتينين' },
  egfr: { en: 'eGFR', ar: 'معدل الترشيح الكبيبي المقدَّر' },
  bmi: { en: 'BMI', ar: 'مؤشر كتلة الجسم' },
  supersession: { en: 'Correction by supersession', ar: 'التصحيح بإضافة سجل جديد يحل محل القديم' },
  audit_log: { en: 'Audit log', ar: 'سجل التدقيق' },
  // entry types
  'entry.lab': { en: 'Lab result', ar: 'نتيجة مخبرية' },
  'entry.vital': { en: 'Vital sign', ar: 'علامة حيوية' },
  'entry.weight': { en: 'Weight', ar: 'الوزن' },
  'entry.med_start': { en: 'Medication start', ar: 'بدء دواء' },
  'entry.med_change': { en: 'Medication change', ar: 'تعديل دواء' },
  'entry.med_stop': { en: 'Medication stop', ar: 'إيقاف دواء' },
  'entry.culture': { en: 'Culture', ar: 'زرع ميكروبي' },
  'entry.imaging': { en: 'Imaging report', ar: 'تقرير تصوير (نص التقرير فقط)' },
  'entry.procedure': { en: 'Procedure', ar: 'إجراء' },
  'entry.note': { en: 'Clinical note', ar: 'ملاحظة سريرية' },
  'entry.event': { en: 'Event', ar: 'حدث' },
  'entry.intervention': { en: 'Intervention', ar: 'تدخل' },
  'entry.outcome': { en: 'Outcome', ar: 'نتيجة علاجية' },
  // note categories
  'note.chief_complaint': { en: 'Chief complaint', ar: 'الشكوى الرئيسية' },
  'note.hpi': { en: 'History of present illness (HPI)', ar: 'تاريخ المرض الحالي' },
  'note.pmh': { en: 'Past medical history (PMH)', ar: 'التاريخ المرضي السابق' },
  'note.psh': { en: 'Past surgical history (PSH)', ar: 'التاريخ الجراحي السابق' },
  'note.allergy_adr': { en: 'Allergy / previous ADR', ar: 'حساسية / تفاعل دوائي ضار سابق' },
  'note.family_history': { en: 'Family history', ar: 'التاريخ العائلي' },
  'note.social_history': { en: 'Social history / lifestyle', ar: 'التاريخ الاجتماعي / نمط الحياة' },
  'note.problem': { en: 'Problem / diagnosis', ar: 'مشكلة / تشخيص' },
  'note.progress': { en: 'Progress note', ar: 'ملاحظة متابعة' },
  'note.other': { en: 'Other note', ar: 'ملاحظة أخرى' },
  khat: { en: 'Khat use', ar: 'تعاطي القات' },
  tobacco: { en: 'Tobacco', ar: 'التبغ' },
  alcohol: { en: 'Alcohol', ar: 'الكحول' },
  // departments
  'dept.internal_medicine': { en: 'Internal medicine', ar: 'الباطنة' },
  'dept.icu': { en: 'ICU', ar: 'العناية المركزة' },
  'dept.cardiology': { en: 'Cardiology', ar: 'أمراض القلب' },
  'dept.nephrology': { en: 'Nephrology', ar: 'أمراض الكلى' },
  'dept.oncology_haematology': { en: 'Oncology and haematology', ar: 'الأورام وأمراض الدم' },
  'dept.infectious_disease': { en: 'Infectious disease', ar: 'الأمراض المعدية' },
  'dept.paediatrics': { en: 'Paediatrics', ar: 'طب الأطفال' },
  'dept.emergency': { en: 'Emergency', ar: 'الطوارئ' },
  'dept.other': { en: 'Other department', ar: 'قسم آخر' },
  // competency areas (adapted from ASHP/ACCP; not ASHP-accredited)
  'comp.direct_patient_care': { en: 'Direct patient care', ar: 'الرعاية المباشرة للمريض' },
  'comp.pharmacotherapy_knowledge': { en: 'Pharmacotherapy knowledge', ar: 'المعرفة بالعلاج الدوائي' },
  'comp.systems_based_care': { en: 'Systems-based care', ar: 'الرعاية القائمة على الأنظمة' },
  'comp.communication': { en: 'Communication', ar: 'التواصل' },
  'comp.professionalism': { en: 'Professionalism', ar: 'المهنية' },
  'comp.continuing_development': { en: 'Continuing development', ar: 'التطوير المستمر' },
} as const satisfies Record<string, { en: string; ar: string }>;

export type TermId = keyof typeof TERMS;

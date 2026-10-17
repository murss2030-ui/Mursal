/** Child–Pugh score, with its limitations for dose adjustment stated (Section 9). */
import { L } from '../../domain/label';
import { ALBUMIN, BILIRUBIN, INR } from '../inputs';
import type { CalculatorDef, InputSpec } from '../types';
import { show } from '../units';
import { given, sameSample, val } from './common';

const ASCITES: InputSpec = {
  key: 'ascites',
  label: L('Ascites', 'الاستسقاء'),
  kind: 'choice',
  source: { kind: 'answer' },
  options: [
    { value: 'none', label: L('None', 'لا يوجد'), points: 1 },
    { value: 'slight', label: L('Slight (or controlled with diuretics)', 'خفيف (أو مضبوط بالمدرات)'), points: 2 },
    { value: 'moderate', label: L('Moderate to severe (or refractory)', 'متوسط إلى شديد (أو مقاوم للعلاج)'), points: 3 },
  ],
};

const ENCEPHALOPATHY: InputSpec = {
  key: 'encephalopathy',
  label: L('Hepatic encephalopathy', 'الاعتلال الدماغي الكبدي'),
  kind: 'choice',
  source: { kind: 'answer' },
  options: [
    { value: 'none', label: L('None', 'لا يوجد'), points: 1 },
    { value: 'grade12', label: L('Grade 1–2 (or controlled with treatment)', 'الدرجة 1–2 (أو مضبوط بالعلاج)'), points: 2 },
    { value: 'grade34', label: L('Grade 3–4 (or refractory)', 'الدرجة 3–4 (أو مقاوم للعلاج)'), points: 3 },
  ],
};

export function bilirubinPoints(mgdl: number): number {
  return mgdl < 2 ? 1 : mgdl <= 3 ? 2 : 3;
}
export function albuminPoints(gdl: number): number {
  return gdl > 3.5 ? 1 : gdl >= 2.8 ? 2 : 3;
}
export function inrPoints(inr: number): number {
  return inr < 1.7 ? 1 : inr <= 2.3 ? 2 : 3;
}

export const childPugh: CalculatorDef = {
  id: 'child_pugh',
  name: 'Child–Pugh score',
  nameAr: 'مقياس Child–Pugh',
  purpose: L('Severity of chronic liver disease (class A, B or C).', 'شدة مرض الكبد المزمن (الفئة A أو B أو C).'),
  formulaVersion: '1',
  citation:
    'Pugh RNH, Murray-Lyon IM, Dawson JL, Pietroni MC, Williams R. Transection of the oesophagus for bleeding oesophageal varices. Br J Surg 1973;60(8):646–649. INR thresholds replace the original prothrombin-time prolongation, as in common current use.',
  formula:
    'Points 1/2/3 — bilirubin < 2, 2–3, > 3 mg/dL; albumin > 3.5, 2.8–3.5, < 2.8 g/dL; INR < 1.7, 1.7–2.3, > 2.3; ascites none, slight, moderate–severe; encephalopathy none, grade 1–2, grade 3–4. Class A 5–6, B 7–9, C 10–15.',
  requiredInputs: [BILIRUBIN, ALBUMIN, INR, ASCITES, ENCEPHALOPATHY],
  optionalInputs: [],
  compute(inputs) {
    const bili = val(inputs, 'bilirubin');
    const alb = val(inputs, 'albumin');
    const inr = val(inputs, 'inr');
    const pb = bilirubinPoints(bili);
    const pa = albuminPoints(alb);
    const pi = inrPoints(inr);
    const pasc = val(inputs, 'ascites');
    const penc = val(inputs, 'encephalopathy');
    const value = pb + pa + pi + pasc + penc;
    const cls = value <= 6 ? 'A' : value <= 9 ? 'B' : 'C';
    const warnings: L[] = [
      L(
        'Not a dosing tool by itself: use a Child–Pugh class for dose adjustment only where the drug’s labelling or reference gives one.',
        'ليس أداة جرعات بذاته: استخدم فئة Child–Pugh لتعديل الجرعة فقط حين يحددها ملصق الدواء أو مرجعه.',
      ),
    ];
    const sample = sameSample(inputs, ['bilirubin', 'albumin', 'inr']);
    if (sample) warnings.push(sample);
    const ascLabel = inputs.ascites!.choice;
    const encLabel = inputs.encephalopathy!.choice;
    return {
      value,
      unit: 'points',
      decimals: 0,
      category: { value: cls, label: L(`Class ${cls}`, `الفئة ${cls}`) },
      assumptions: [
        L('Ascites and encephalopathy graded by the trainee from the record.', 'قدّر المتدرب درجة الاستسقاء والاعتلال الدماغي من السجل.'),
      ],
      warnings,
      steps: [
        `${given('Bilirubin', inputs.bilirubin!, 2)} → ${pb} point${pb > 1 ? 's' : ''}`,
        `${given('Albumin', inputs.albumin!, 2)} → ${pa} point${pa > 1 ? 's' : ''}`,
        `INR = ${show(inr, '', 2)} → ${pi} point${pi > 1 ? 's' : ''}`,
        `Ascites: ${ascLabel} → ${pasc} point${pasc > 1 ? 's' : ''}`,
        `Encephalopathy: ${encLabel} → ${penc} point${penc > 1 ? 's' : ''}`,
        `Total = ${pb} + ${pa} + ${pi} + ${pasc} + ${penc} = ${value} points → class ${cls}`,
      ],
    };
  },
  limitations: [
    L(
      'Developed to predict surgical risk in cirrhosis, not drug clearance; it does not measure the liver’s capacity to metabolise a given drug.',
      'وُضع للتنبؤ بخطر الجراحة في التليف الكبدي لا بتصفية الأدوية؛ ولا يقيس قدرة الكبد على استقلاب دواء بعينه.',
    ),
    L(
      'Ascites and encephalopathy are judged subjectively; albumin and INR are affected by infusions, nutrition and anticoagulants.',
      'يُقدَّر الاستسقاء والاعتلال الدماغي تقديراً ذاتياً؛ ويتأثر الألبومين وINR بالمحاليل والتغذية ومضادات التخثر.',
    ),
    L(
      'In cholestatic liver disease (for example primary biliary cholangitis) different bilirubin thresholds are used; this calculator uses the standard ones.',
      'في أمراض الكبد الركودية (مثل التهاب الأقنية الصفراوية الأولي) تُستخدم حدود مختلفة للبيليروبين؛ وهذه الحاسبة تستخدم الحدود المعتادة.',
    ),
  ],
};

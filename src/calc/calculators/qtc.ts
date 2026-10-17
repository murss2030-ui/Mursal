/**
 * QTc by Bazett and by Fridericia — always computed and shown together,
 * never alone (Section 9). QT and heart rate are transcribed from the ECG
 * report; PRECEPTOR never reads or interprets an ECG.
 */
import { L } from '../../domain/label';
import { step } from '../engine';
import type { CalcInputs, CalcOutput, CalculatorDef, InputSpec } from '../types';
import { show } from '../units';
import { val } from './common';

const QT: InputSpec = {
  key: 'qt',
  label: L('QT interval, from the ECG report', 'فترة QT من تقرير تخطيط القلب'),
  kind: 'qt',
  source: { kind: 'answer' },
  limits: [1, 2000],
  plausible: [200, 700],
  hint: L('Copy the value printed or written on the ECG report.', 'انقل القيمة المطبوعة أو المكتوبة في تقرير التخطيط.'),
};

const ECG_HR: InputSpec = {
  key: 'hr',
  label: L('Heart rate, from the same ECG report', 'معدل النبض من تقرير التخطيط نفسه'),
  kind: 'heart_rate',
  source: { kind: 'answer' },
  limits: [1, 400],
  plausible: [30, 220],
  hint: L('Use the rate on the ECG, not a bedside reading from another time.', 'استخدم المعدل المذكور في التخطيط، لا قراءة سريرية من وقت آخر.'),
};

const ECG_WHEN: InputSpec = {
  key: 'ecgAt',
  label: L('When the ECG was recorded (day and clock time)', 'وقت تسجيل التخطيط (اليوم والساعة)'),
  kind: 'time',
  source: { kind: 'answer' },
};

const CITATION_BAZETT = 'Bazett HC. An analysis of the time-relations of electrocardiograms. Heart 1920;7:353–370.';
const CITATION_FRIDERICIA =
  'Fridericia LS. Die Systolendauer im Elektrokardiogramm bei normalen Menschen und bei Herzkranken. Acta Med Scand 1920;53:469–486.';
const WHICH_REF =
  'Choice between them: Vandenberk B, Vandael E, Robyns T, et al. Which QT correction formulae to use for QT monitoring? J Am Heart Assoc 2016;5(6):e003264.';

function which(hr: number): L {
  if (hr < 60 || hr > 100) {
    return L(
      `Heart rate ${show(hr, 'beats/min', 0)} is outside 60–100: Bazett’s formula under-corrects slow and over-corrects fast heart rates. Trust the Fridericia value here.`,
      `معدل النبض ${show(hr, 'beats/min', 0)} خارج 60–100: معادلة Bazett تقلل التصحيح في النبض البطيء وتبالغ فيه في النبض السريع. اعتمد قيمة Fridericia هنا.`,
    );
  }
  return L(
    `Heart rate ${show(hr, 'beats/min', 0)} is within 60–100, where the two formulas differ least. Fridericia’s is still the more accurate across heart rates.`,
    `معدل النبض ${show(hr, 'beats/min', 0)} ضمن 60–100 حيث يقل الفرق بين المعادلتين. وتبقى معادلة Fridericia الأدق عبر معدلات النبض.`,
  );
}

function qtc(inputs: CalcInputs, root: 'square' | 'cube'): CalcOutput {
  const qt = val(inputs, 'qt');
  const hr = val(inputs, 'hr');
  const rr = 60 / hr;
  const value = root === 'square' ? qt / Math.sqrt(rr) : qt / Math.cbrt(rr);
  const name = root === 'square' ? 'QTc (Bazett)' : 'QTc (Fridericia)';
  const op = root === 'square' ? '√' : '∛';
  return {
    value,
    unit: 'ms',
    decimals: 0,
    assumptions: [
      L('QT and heart rate transcribed from the ECG report by the trainee; the ECG itself was not read.', 'نقل المتدرب QT ومعدل النبض من تقرير التخطيط؛ ولم يُقرأ التخطيط نفسه.'),
    ],
    warnings: [which(hr)],
    steps: [
      `QT = ${show(qt, 'ms', 0)}; heart rate = ${show(hr, 'beats/min', 0)}`,
      `RR interval = 60 ÷ ${show(hr, '', 0)} = ${show(rr, 's', 3)}`,
      step(`${name} = ${show(qt, '', 0)} ÷ ${op}${show(rr, '', 3)}`, value, 'ms', 0),
    ],
  };
}

const limitations = [
  L(
    'Assumes a regular rhythm; with atrial fibrillation or a wide QRS (bundle branch block, pacing) these corrections are unreliable — ask your preceptor.',
    'تفترض انتظام النظم؛ ومع الرجفان الأذيني أو اتساع QRS (حصار الحزمة، الناظمة) لا يُعتمد على هذا التصحيح — استشر مشرفك.',
  ),
  L('Not an ECG interpretation: the values come from the written report.', 'ليست تفسيراً للتخطيط: القيم مأخوذة من التقرير المكتوب.'),
];

export const qtcBazett: CalculatorDef = {
  id: 'qtc_bazett',
  name: 'QTc (Bazett)',
  nameAr: 'فترة QT المصححة (Bazett)',
  purpose: L('Heart-rate-corrected QT interval; shown together with Fridericia.', 'فترة QT مصححة لمعدل النبض؛ تُعرض مع Fridericia.'),
  formulaVersion: '1',
  citation: `${CITATION_BAZETT} ${WHICH_REF}`,
  formula: 'QTc = QT ÷ √RR, with RR = 60 ÷ heart rate (s)',
  requiredInputs: [QT, ECG_HR, ECG_WHEN],
  optionalInputs: [],
  compute: (inputs) => qtc(inputs, 'square'),
  limitations,
  pairedWith: 'qtc_fridericia',
};

export const qtcFridericia: CalculatorDef = {
  id: 'qtc_fridericia',
  name: 'QTc (Fridericia)',
  nameAr: 'فترة QT المصححة (Fridericia)',
  purpose: L('Heart-rate-corrected QT interval; preferred at extremes of heart rate.', 'فترة QT مصححة لمعدل النبض؛ المفضلة عند تطرف معدل النبض.'),
  formulaVersion: '1',
  citation: `${CITATION_FRIDERICIA} ${WHICH_REF}`,
  formula: 'QTc = QT ÷ ∛RR, with RR = 60 ÷ heart rate (s)',
  requiredInputs: [QT, ECG_HR, ECG_WHEN],
  optionalInputs: [],
  compute: (inputs) => qtc(inputs, 'cube'),
  limitations,
  pairedWith: 'qtc_bazett',
};

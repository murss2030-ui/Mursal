/**
 * Input specifications shared by the calculators.
 *
 * `plausible` ranges are the engine's physiologic plausibility limits, in
 * the canonical unit: a value outside one is not refused, but it is only
 * used after the trainee confirms it, with the value and unit shown
 * (Section 9, hard rules). `limits` are definitional (a weight cannot be
 * zero, a percentage cannot exceed 100): a value outside them is rejected.
 * These ranges are deliberately wide — they catch unit slips and typing
 * errors, they are not reference ranges — and they are listed for review in
 * docs/m2/CALCULATOR-FIXTURES.md.
 */
import { L } from '../domain/label';
import type { ChoiceOption, InputSpec } from './types';

export const AGE: InputSpec = {
  key: 'age',
  label: L('Age', 'العمر'),
  kind: 'age',
  source: { kind: 'case', field: 'ageYears' },
  limits: [0, 130],
  plausible: [0, 120],
};

export const SEX: InputSpec = {
  key: 'sex',
  label: L('Sex', 'الجنس'),
  kind: 'sex',
  source: { kind: 'case', field: 'sex' },
};

export const HEIGHT: InputSpec = {
  key: 'height',
  label: L('Height', 'الطول'),
  kind: 'height',
  source: { kind: 'case', field: 'heightCm' },
  limits: [1, 300],
  plausible: [45, 230],
};

export const WEIGHT: InputSpec = {
  key: 'weight',
  label: L('Weight (total body weight)', 'الوزن (وزن الجسم الكلي)'),
  kind: 'weight',
  source: { kind: 'weight' },
  limits: [0.2, 700],
  plausible: [2, 300],
};

export const SCR: InputSpec = {
  key: 'scr',
  label: L('Serum creatinine', 'الكرياتينين في الدم'),
  kind: 'creatinine',
  source: { kind: 'lab', analytes: ['scr'] },
  limits: [0.01, 50],
  plausible: [0.2, 20],
};

export const ALBUMIN: InputSpec = {
  key: 'albumin',
  label: L('Albumin', 'الألبومين'),
  kind: 'albumin',
  source: { kind: 'lab', analytes: ['albumin'] },
  limits: [0.01, 10],
  plausible: [1, 6],
};

export const CALCIUM: InputSpec = {
  key: 'calcium',
  label: L('Calcium (total)', 'الكالسيوم (الكلي)'),
  kind: 'calcium',
  source: { kind: 'lab', analytes: ['ca_total'] },
  limits: [0.01, 30],
  plausible: [4, 16],
};

export const SODIUM: InputSpec = {
  key: 'na',
  label: L('Sodium', 'الصوديوم'),
  kind: 'electrolyte',
  source: { kind: 'lab', analytes: ['na'] },
  limits: [1, 250],
  plausible: [100, 180],
};

export const CHLORIDE: InputSpec = {
  key: 'cl',
  label: L('Chloride', 'الكلوريد'),
  kind: 'electrolyte',
  source: { kind: 'lab', analytes: ['cl'] },
  limits: [1, 250],
  plausible: [60, 150],
};

export const BICARBONATE: InputSpec = {
  key: 'hco3',
  label: L('Bicarbonate', 'البيكربونات'),
  kind: 'electrolyte',
  source: { kind: 'lab', analytes: ['hco3'] },
  limits: [0.1, 100],
  plausible: [3, 50],
};

export const UREA: InputSpec = {
  key: 'urea',
  label: L('Urea (or BUN)', 'اليوريا (أو نيتروجين اليوريا BUN)'),
  kind: 'urea',
  source: { kind: 'lab', analytes: ['urea', 'bun'] },
  limits: [0.01, 300],
  plausible: [0.5, 80],
};

export const BILIRUBIN: InputSpec = {
  key: 'bilirubin',
  label: L('Bilirubin (total)', 'البيليروبين (الكلي)'),
  kind: 'bilirubin',
  source: { kind: 'lab', analytes: ['tbil'] },
  limits: [0, 100],
  plausible: [0.1, 40],
};

export const INR: InputSpec = {
  key: 'inr',
  label: L('INR', 'INR'),
  kind: 'inr',
  source: { kind: 'lab', analytes: ['inr'] },
  limits: [0.1, 30],
  plausible: [0.8, 10],
};

export const WBC: InputSpec = {
  key: 'wbc',
  label: L('White blood cells (WBC)', 'الكريات البيض'),
  kind: 'cell_count',
  source: { kind: 'lab', analytes: ['wbc'] },
  limits: [0, 1000],
  plausible: [0.1, 200],
};

export const NEUT_PCT: InputSpec = {
  key: 'neutPct',
  label: L('Neutrophils (%)', 'العدلات (%)'),
  kind: 'percent',
  source: { kind: 'lab', analytes: ['neut_pct'] },
  limits: [0, 100],
};

export const BANDS_PCT: InputSpec = {
  key: 'bandsPct',
  label: L('Band neutrophils (%)', 'العدلات الشريطية (%)'),
  kind: 'percent',
  source: { kind: 'lab', analytes: ['bands_pct'] },
  limits: [0, 100],
};

export const HEART_RATE: InputSpec = {
  key: 'hr',
  label: L('Heart rate', 'معدل نبض القلب'),
  kind: 'heart_rate',
  source: { kind: 'vital', vital: 'heart_rate' },
  limits: [1, 400],
  plausible: [30, 220],
};

export const SYSTOLIC: InputSpec = {
  key: 'sbp',
  label: L('Systolic blood pressure', 'ضغط الدم الانقباضي'),
  kind: 'pressure',
  source: { kind: 'vital', vital: 'blood_pressure', part: 'systolic' },
  limits: [1, 400],
  plausible: [50, 260],
};

export const DIASTOLIC: InputSpec = {
  key: 'dbp',
  label: L('Diastolic blood pressure', 'ضغط الدم الانبساطي'),
  kind: 'pressure',
  source: { kind: 'vital', vital: 'blood_pressure', part: 'diastolic' },
  limits: [1, 300],
  plausible: [20, 160],
};

export const RESP_RATE: InputSpec = {
  key: 'rr',
  label: L('Respiratory rate', 'معدل التنفس'),
  kind: 'resp_rate',
  source: { kind: 'vital', vital: 'respiratory_rate' },
  limits: [0, 120],
  plausible: [4, 60],
};

const YES = L('Yes', 'نعم');
const NO = L('No', 'لا');

/** A yes/no finding the trainee answers from the chart. */
export function finding(key: string, label: L, hint?: L): InputSpec {
  return { key, label, kind: 'boolean', source: { kind: 'answer' }, ...(hint ? { hint } : {}) };
}

export const yesNo: readonly ChoiceOption[] = [
  { value: 'yes', label: YES, points: 1 },
  { value: 'no', label: NO, points: 0 },
];

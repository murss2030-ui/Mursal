/**
 * Pick-lists for manual entry. Clinical vocabulary stays in English (Decision 10).
 *
 * Units are explicit per analyte; a value whose unit is unknown is rejected,
 * never assumed (Section 9, hard rules). Abbreviations avoid the ISMP list of
 * error-prone abbreviations: "subcut" (not SC/SQ), "units" (not U/IU), "mcg"
 * (not µg), and frequencies written out (no OD/QD/QOD).
 *
 * This file holds no reference ranges and no plausibility limits: those
 * belong to the calculator engine's input specifications (M2).
 */

export interface AnalyteDef {
  id: string;
  name: string;
  units: readonly string[];
  /** Definitional: the quantity cannot be negative. */
  nonNegative: boolean;
  group: 'renal' | 'electrolytes' | 'metabolic' | 'liver' | 'coagulation' | 'haematology' | 'infection' | 'cardiac' | 'drug_level' | 'other';
}

const a = (
  id: string,
  name: string,
  units: readonly string[],
  group: AnalyteDef['group'],
  nonNegative = true,
): AnalyteDef => ({ id, name, units, group, nonNegative });

export const ANALYTES: readonly AnalyteDef[] = [
  a('scr', 'Serum creatinine', ['mg/dL', 'µmol/L'], 'renal'),
  a('bun', 'Blood urea nitrogen (BUN)', ['mg/dL'], 'renal'),
  a('urea', 'Urea', ['mmol/L', 'mg/dL'], 'renal'),
  a('na', 'Sodium', ['mmol/L', 'mEq/L'], 'electrolytes'),
  a('k', 'Potassium', ['mmol/L', 'mEq/L'], 'electrolytes'),
  a('cl', 'Chloride', ['mmol/L', 'mEq/L'], 'electrolytes'),
  a('hco3', 'Bicarbonate', ['mmol/L', 'mEq/L'], 'electrolytes'),
  a('ca_total', 'Calcium (total)', ['mg/dL', 'mmol/L'], 'electrolytes'),
  a('ca_ionized', 'Calcium (ionized)', ['mmol/L', 'mg/dL'], 'electrolytes'),
  a('mg', 'Magnesium', ['mg/dL', 'mmol/L', 'mEq/L'], 'electrolytes'),
  a('phos', 'Phosphate', ['mg/dL', 'mmol/L'], 'electrolytes'),
  a('albumin', 'Albumin', ['g/dL', 'g/L'], 'metabolic'),
  a('glucose', 'Glucose', ['mg/dL', 'mmol/L'], 'metabolic'),
  a('hba1c', 'HbA1c', ['%', 'mmol/mol'], 'metabolic'),
  a('uric', 'Uric acid', ['mg/dL', 'µmol/L'], 'metabolic'),
  a('tbil', 'Bilirubin (total)', ['mg/dL', 'µmol/L'], 'liver'),
  a('dbil', 'Bilirubin (direct)', ['mg/dL', 'µmol/L'], 'liver'),
  a('alt', 'ALT', ['U/L'], 'liver'),
  a('ast', 'AST', ['U/L'], 'liver'),
  a('alp', 'ALP', ['U/L'], 'liver'),
  a('ggt', 'GGT', ['U/L'], 'liver'),
  a('inr', 'INR', ['unitless'], 'coagulation'),
  a('pt', 'Prothrombin time (PT)', ['s'], 'coagulation'),
  a('aptt', 'aPTT', ['s'], 'coagulation'),
  a('hb', 'Haemoglobin', ['g/dL', 'g/L'], 'haematology'),
  a('wbc', 'White blood cells (WBC)', ['×10⁹/L', '×10³/µL'], 'haematology'),
  a('neut_abs', 'Neutrophils (absolute)', ['×10⁹/L', '×10³/µL'], 'haematology'),
  a('neut_pct', 'Neutrophils (%)', ['%'], 'haematology'),
  a('bands_pct', 'Band neutrophils (%)', ['%'], 'haematology'),
  a('plt', 'Platelets', ['×10⁹/L', '×10³/µL'], 'haematology'),
  a('crp', 'C-reactive protein (CRP)', ['mg/L', 'mg/dL'], 'infection'),
  a('pct', 'Procalcitonin', ['ng/mL', 'mcg/L'], 'infection'),
  a('lactate', 'Lactate', ['mmol/L', 'mg/dL'], 'infection'),
  a('trop', 'Troponin', ['ng/L', 'ng/mL'], 'cardiac'),
  a('bnp', 'BNP', ['pg/mL'], 'cardiac'),
  a('ntprobnp', 'NT-proBNP', ['pg/mL'], 'cardiac'),
  a('ck', 'Creatine kinase (CK)', ['U/L'], 'cardiac'),
  a('tsh', 'TSH', ['mIU/L'], 'other'),
  a('lipase', 'Lipase', ['U/L'], 'other'),
  a('vanco', 'Vancomycin level', ['mg/L', 'mcg/mL'], 'drug_level'),
  a('phenytoin', 'Phenytoin level (total)', ['mg/L', 'mcg/mL', 'µmol/L'], 'drug_level'),
  a('digoxin', 'Digoxin level', ['ng/mL', 'nmol/L'], 'drug_level'),
];

export const ANALYTE_BY_ID: ReadonlyMap<string, AnalyteDef> = new Map(ANALYTES.map((x) => [x.id, x]));

export interface VitalDef {
  id: 'heart_rate' | 'blood_pressure' | 'respiratory_rate' | 'temperature' | 'spo2' | 'gcs' | 'urine_output';
  name: string;
  units: readonly string[];
  /** Definitional bounds only (e.g. GCS is 3–15 by construction). Plausibility limits belong to M2. */
  min?: number;
  max?: number;
  integer?: boolean;
}

export const VITALS: readonly VitalDef[] = [
  { id: 'heart_rate', name: 'Heart rate', units: ['beats/min'], min: 0 },
  { id: 'blood_pressure', name: 'Blood pressure', units: ['mmHg'], min: 0 },
  { id: 'respiratory_rate', name: 'Respiratory rate', units: ['breaths/min'], min: 0 },
  { id: 'temperature', name: 'Temperature', units: ['°C', '°F'] },
  { id: 'spo2', name: 'SpO₂', units: ['%'], min: 0, max: 100 },
  { id: 'gcs', name: 'Glasgow Coma Scale (GCS)', units: ['points'], min: 3, max: 15, integer: true },
  { id: 'urine_output', name: 'Urine output', units: ['mL'], min: 0 },
];
export const VITAL_BY_ID: ReadonlyMap<string, VitalDef> = new Map(VITALS.map((x) => [x.id, x]));

export const ROUTES = [
  'PO',
  'IV',
  'IM',
  'subcut',
  'sublingual',
  'PR',
  'inhaled',
  'nebulised',
  'topical',
  'transdermal',
  'NG tube',
  'intrathecal',
  'intraosseous',
  'ophthalmic',
  'otic',
  'nasal',
  'vaginal',
] as const;

export const FREQUENCIES = [
  'once',
  'STAT',
  'once daily',
  'twice daily',
  'three times daily',
  'four times daily',
  'every 4 hours',
  'every 6 hours',
  'every 8 hours',
  'every 12 hours',
  'every 24 hours',
  'every 36 hours',
  'every 48 hours',
  'once weekly',
  'at bedtime',
  'as needed (PRN)',
  'continuous infusion',
] as const;

export const DOSE_UNITS = [
  'mg',
  'g',
  'mcg',
  'units',
  'mL',
  'mmol',
  'mEq',
  'mg/kg',
  'mcg/kg',
  'units/kg',
  'mg/h',
  'mg/kg/h',
  'mcg/min',
  'mcg/kg/min',
  'units/h',
  'units/kg/h',
  'mL/h',
  'puff',
  'drop',
  'tablet',
  'capsule',
  'sachet',
  'application',
] as const;

export const CULTURE_SPECIMENS = [
  'blood',
  'urine',
  'sputum',
  'tracheal aspirate',
  'wound',
  'CSF',
  'stool',
  'pleural fluid',
  'peritoneal fluid',
  'catheter tip',
] as const;

export const IMAGING_MODALITIES = ['X-ray', 'CT', 'MRI', 'Ultrasound', 'Echocardiography'] as const;

/** Sentinel used by pick-lists that also allow a typed value. */
export const OTHER = 'other';

/**
 * Two synthetic Teaching Cases for the live probe, entered as a trainee
 * would type them (no document reading): every value is invented for
 * testing, and no identifier exists anywhere in them.
 *
 * A — internal medicine: community-acquired pneumonia, acute kidney injury on
 *     chronic kidney disease, type 2 diabetes; metformin and an NSAID still
 *     ordered, enoxaparin at the standard prophylactic dose.
 * B — cardiology: atrial fibrillation and decompensated heart failure; warfarin
 *     with newly started amiodarone, digoxin with hypokalaemia and
 *     hypomagnesaemia, a rising INR.
 */
import type { Store } from '../../src/store/store';
import type { NewEntryInput } from '../../src/store/store';
import type { EntryType } from '../../src/domain/types';
import { ROTATION } from '../unit/helpers';

export interface SyntheticCase {
  name: string;
  caseId: string;
}

type Entry = NewEntryInput<EntryType>;

const lab = (day: number, analyte: string, analyteName: string, value: number, unit: string, ref?: [number, number]): Entry => ({
  type: 'lab',
  hospitalDay: day,
  payload: { analyte, analyteName, result: { kind: 'numeric', value }, unit, ...(ref ? { refLow: ref[0], refHigh: ref[1] } : {}) },
});
const vital = (day: number, v: 'heart_rate' | 'respiratory_rate' | 'temperature' | 'spo2', value: number, unit: string): Entry => ({ type: 'vital', hospitalDay: day, payload: { vital: v, value, unit } });
const bp = (day: number, systolic: number, diastolic: number): Entry => ({ type: 'vital', hospitalDay: day, payload: { vital: 'blood_pressure', systolic, diastolic, unit: 'mmHg' } });
const med = (day: number, medId: string, drug: string, value: number, unit: string, route: string, frequency: string, indication: string): Entry => ({
  type: 'med_start',
  hospitalDay: day,
  payload: { medId, drug, dose: { kind: 'structured', value, unit }, route, frequency, indication },
});
const problem = (day: number, problemId: string, name: string, acuity: 'acute' | 'chronic', primaryDiagnosis = false): Entry => ({
  type: 'note',
  hospitalDay: day,
  payload: { category: 'problem', problemId, name, acuity, status: 'active', primaryDiagnosis },
});
const text = (day: number, category: 'chief_complaint' | 'hpi' | 'pmh' | 'progress', t: string): Entry => ({ type: 'note', hospitalDay: day, payload: { category, text: t } });

async function build(store: Store, c: { name: string; ageYears: number; sex: 'M' | 'F'; heightCm: number; admissionDay0: string; entries: Entry[]; homeMeds: Record<string, string>[] }): Promise<SyntheticCase> {
  const rot = await store.createRotation(ROTATION);
  const k = await store.createCase({ kind: 'teaching', rotationId: rot.id, ageYears: c.ageYears, sex: c.sex, heightCm: c.heightCm, admissionDay0: c.admissionDay0, syntheticDataAttested: true });
  for (const e of c.entries) await store.addEntry(k.id, e);
  for (const h of c.homeMeds) await store.addItem(k.id, 'home_med', h);
  // The app's own calculator: Cockcroft–Gault on the latest creatinine, actual body weight.
  const crcl = await store.calculate(k.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
  if (!crcl.ok) throw new Error(`CrCl refused for case ${c.name}`);
  return { name: c.name, caseId: k.id };
}

/** Admission on Day 0 two days before the store's clock (2026-10-13), so today is Day 2. */
export async function caseA(store: Store): Promise<SyntheticCase> {
  return build(store, {
    name: 'A — pneumonia, AKI on CKD, diabetes',
    ageYears: 67,
    sex: 'M',
    heightCm: 170,
    admissionDay0: '2026-10-11',
    entries: [
      text(0, 'chief_complaint', 'Fever, productive cough and confusion for 3 days.'),
      text(0, 'pmh', 'Type 2 diabetes for 10 years, hypertension, chronic kidney disease stage 3.'),
      { type: 'note', hospitalDay: 0, payload: { category: 'allergy_adr', kind: 'allergy', substance: 'penicillin', reaction: 'rash', severity: 'moderate' } },
      { type: 'note', hospitalDay: 0, payload: { category: 'social_history', khat: 'never', tobacco: 'former', tobaccoDetails: 'stopped 5 years ago' } },
      problem(0, 'p-cap', 'Community-acquired pneumonia', 'acute', true),
      problem(0, 'p-aki', 'Acute kidney injury on chronic kidney disease', 'acute'),
      problem(0, 'p-dm', 'Type 2 diabetes mellitus', 'chronic'),
      problem(0, 'p-htn', 'Hypertension', 'chronic'),
      { type: 'weight', hospitalDay: 0, payload: { value: 72, unit: 'kg', method: 'measured' } },
      vital(0, 'heart_rate', 112, 'beats/min'),
      bp(0, 98, 60),
      vital(0, 'temperature', 38.9, '°C'),
      vital(0, 'spo2', 91, '%'),
      vital(0, 'respiratory_rate', 26, 'breaths/min'),
      lab(0, 'scr', 'Serum creatinine', 2.1, 'mg/dL'),
      lab(0, 'k', 'Potassium', 5.4, 'mmol/L', [3.5, 5.0]),
      lab(0, 'na', 'Sodium', 134, 'mmol/L', [135, 145]),
      lab(0, 'wbc', 'White blood cells (WBC)', 14.2, '×10⁹/L', [4, 11]),
      lab(0, 'crp', 'C-reactive protein (CRP)', 96, 'mg/L'),
      lab(0, 'glucose', 'Glucose', 286, 'mg/dL'),
      { type: 'culture', hospitalDay: 0, payload: { specimen: 'Sputum', status: 'pending' } },
      { type: 'culture', hospitalDay: 0, payload: { specimen: 'Blood (two sets)', status: 'no_growth' } },
      med(0, 'm-cef', 'ceftriaxone', 1, 'g', 'IV', 'every 24 hours', 'community-acquired pneumonia'),
      med(0, 'm-azi', 'azithromycin', 500, 'mg', 'IV', 'once daily', 'community-acquired pneumonia'),
      med(0, 'm-enox', 'enoxaparin', 40, 'mg', 'subcut', 'once daily', 'VTE prophylaxis'),
      med(0, 'm-met', 'metformin', 1000, 'mg', 'PO', 'twice daily', 'type 2 diabetes'),
      med(0, 'm-ibu', 'ibuprofen', 400, 'mg', 'PO', 'three times daily', 'fever and pain'),
      med(0, 'm-ins', 'insulin regular', 4, 'units', 'subcut', 'three times daily', 'hyperglycaemia (sliding scale, before meals)'),
      lab(1, 'scr', 'Serum creatinine', 2.6, 'mg/dL'),
      lab(1, 'k', 'Potassium', 5.1, 'mmol/L', [3.5, 5.0]),
      lab(1, 'glucose', 'Glucose', 248, 'mg/dL'),
      text(1, 'progress', 'Still febrile (38.4 °C); confusion improving; urine output reduced.'),
      lab(2, 'scr', 'Serum creatinine', 2.4, 'mg/dL'),
      lab(2, 'glucose', 'Glucose', 210, 'mg/dL'),
    ],
    homeMeds: [
      { drug: 'metformin', regimen: '1000 mg PO twice daily', indication: 'type 2 diabetes', sources: 'patient|containers' },
      { drug: 'amlodipine', regimen: '10 mg PO once daily', indication: 'hypertension', sources: 'patient|containers' },
      { drug: 'ibuprofen', regimen: '400 mg PO three times daily as needed', indication: 'knee pain', sources: 'patient' },
    ],
  });
}

export async function caseB(store: Store): Promise<SyntheticCase> {
  return build(store, {
    name: 'B — atrial fibrillation, heart failure, warfarin with amiodarone',
    ageYears: 74,
    sex: 'F',
    heightCm: 158,
    admissionDay0: '2026-10-11',
    entries: [
      text(0, 'chief_complaint', 'Breathlessness on minimal exertion and leg swelling for one week; palpitations.'),
      text(0, 'pmh', 'Atrial fibrillation on warfarin for 4 years; heart failure with reduced ejection fraction (ejection fraction 30 % on the last echocardiogram); hypertension.'),
      { type: 'note', hospitalDay: 0, payload: { category: 'allergy_adr', kind: 'nkda' } },
      problem(0, 'p-hf', 'Acute decompensated heart failure with reduced ejection fraction', 'acute', true),
      problem(0, 'p-af', 'Atrial fibrillation with rapid ventricular response', 'chronic'),
      problem(0, 'p-hypok', 'Hypokalaemia', 'acute'),
      { type: 'weight', hospitalDay: 0, payload: { value: 61, unit: 'kg', method: 'measured' } },
      vital(0, 'heart_rate', 128, 'beats/min'),
      bp(0, 104, 68),
      vital(0, 'spo2', 93, '%'),
      lab(0, 'k', 'Potassium', 3.1, 'mmol/L', [3.5, 5.0]),
      lab(0, 'mg', 'Magnesium', 1.5, 'mg/dL', [1.7, 2.2]),
      lab(0, 'scr', 'Serum creatinine', 1.3, 'mg/dL'),
      lab(0, 'inr', 'INR', 2.4, 'unitless'),
      lab(0, 'digoxin', 'Digoxin level', 2.3, 'ng/mL', [0.5, 2.0]),
      lab(0, 'bnp', 'BNP', 1450, 'pg/mL'),
      med(0, 'm-war', 'warfarin', 5, 'mg', 'PO', 'once daily', 'atrial fibrillation'),
      med(0, 'm-amio', 'amiodarone', 200, 'mg', 'PO', 'three times daily', 'atrial fibrillation (loading)'),
      med(0, 'm-dig', 'digoxin', 0.25, 'mg', 'PO', 'once daily', 'atrial fibrillation rate control'),
      med(0, 'm-furo', 'furosemide', 40, 'mg', 'IV', 'twice daily', 'heart failure'),
      med(0, 'm-spiro', 'spironolactone', 25, 'mg', 'PO', 'once daily', 'heart failure'),
      med(0, 'm-carv', 'carvedilol', 6.25, 'mg', 'PO', 'twice daily', 'heart failure'),
      lab(2, 'inr', 'INR', 3.9, 'unitless'),
      lab(2, 'k', 'Potassium', 3.4, 'mmol/L', [3.5, 5.0]),
      lab(2, 'scr', 'Serum creatinine', 1.5, 'mg/dL'),
      text(2, 'progress', 'Breathing easier; ankle oedema reduced; heart rate 96 beats/min, irregular.'),
    ],
    homeMeds: [
      { drug: 'warfarin', regimen: '5 mg PO once daily', indication: 'atrial fibrillation', sources: 'patient|prescription' },
      { drug: 'digoxin', regimen: '0.25 mg PO once daily', indication: 'atrial fibrillation', sources: 'patient|prescription' },
      { drug: 'furosemide', regimen: '40 mg PO once daily', indication: 'heart failure', sources: 'patient|prescription' },
      { drug: 'carvedilol', regimen: '6.25 mg PO twice daily', indication: 'heart failure', sources: 'prescription' },
    ],
  });
}

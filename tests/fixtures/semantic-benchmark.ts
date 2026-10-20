/**
 * The semantic benchmark of the verifier (M5 preparation, 20 October 2026):
 * claims beside the sources they cite, with the verdicts a careful reader
 * would give. It measures what code alone cannot: a claim that reuses its
 * source's numbers with another meaning (a threshold misapplied, a direction
 * reversed, a unit or a frequency changed) passes the number check of M3–M4
 * and must still fail here.
 *
 * Case-data sources are written as the drafting model receives them. The
 * reference passages are TEST PASSAGES written for this benchmark in the
 * manner of product-label wording; they are not sources for practice and are
 * never shown in the app. The expected verdicts were written by the coding
 * agent and are to be reviewed by the owner.
 */
import type { FinalVerdict } from '../../src/ai/verification/check';
import type { VerifySource } from '../../src/ai/verification/contract';

export interface BenchItem {
  id: string;
  /** What the item tests. */
  kind:
    | 'restated'
    | 'arithmetic'
    | 'direction'
    | 'interpretation'
    | 'range'
    | 'drug'
    | 'negation'
    | 'event'
    | 'number'
    | 'unit'
    | 'threshold'
    | 'condition'
    | 'multi_part'
    | 'population'
    | 'certainty'
    | 'frequency'
    | 'route';
  claim: string;
  sources: string[];
  /** Every verdict a careful reader could defend; the first is the most likely. */
  expected: FinalVerdict[];
  why: string;
}

const P = 'Test passage written for the benchmark, not a source for practice: ';

export const BENCH_SOURCES: readonly VerifySource[] = [
  { id: 'H', label: 'Case header', text: 'Case: {"kind":"teaching","age":67,"sex":"M","heightCm":170,"status":"active","hospitalDayToday":2}', context: true },
  { id: 'E1', label: 'Serum creatinine Day 0', text: 'Day 0 Serum creatinine: 2.1 mg/dL' },
  { id: 'E2', label: 'Serum creatinine Day 1', text: 'Day 1 Serum creatinine: 2.6 mg/dL' },
  { id: 'E3', label: 'Potassium Day 0', text: 'Day 0 Potassium: 5.4 mmol/L; reference range 3.5–5.0 mmol/L; high' },
  { id: 'E4', label: 'Allergy', text: 'Day 0 Allergy: penicillin; reaction: rash; severity: moderate' },
  { id: 'E5', label: 'Weight', text: 'Day 0 Weight: 72 kg (measured)' },
  { id: 'E6', label: 'INR Day 2', text: 'Day 2 INR: 3.8' },
  { id: 'M1', label: 'Enoxaparin', text: 'enoxaparin 40 mg SC once daily from Day 0 active for VTE prophylaxis' },
  { id: 'C1', label: 'CrCl Day 1', text: 'Creatinine clearance (Cockcroft–Gault): 26 mL/min — Day 1' },
  { id: 'C2', label: 'CrCl (another patient)', text: 'Creatinine clearance (Cockcroft–Gault): 45 mL/min — Day 1' },
  {
    id: 'G1',
    label: 'Enoxaparin, renal impairment',
    text: `${P}In patients with severe renal impairment (creatinine clearance below 30 mL/min), the recommended prophylactic dose is 30 mg once daily by subcutaneous injection. No dose adjustment is recommended in moderate (creatinine clearance 30–50 mL/min) or mild (creatinine clearance 50–80 mL/min) renal impairment, but these patients should be observed carefully for signs and symptoms of bleeding.`,
  },
  {
    id: 'G2',
    label: 'Ceftriaxone, renal and hepatic impairment',
    text: `${P}No dosage adjustment is necessary for patients with impairment of renal or hepatic function; however, blood levels should be monitored in patients with severe renal impairment (for example, patients on dialysis) and in patients with both renal and hepatic dysfunction.`,
  },
  {
    id: 'G3',
    label: 'Metformin, renal impairment',
    text: `${P}Metformin is contraindicated in patients with an eGFR below 30 mL/min/1.73 m2. Starting metformin in patients with an eGFR between 30 and 45 mL/min/1.73 m2 is not recommended. In patients whose eGFR later falls below 45 mL/min/1.73 m2, assess the benefit and risk of continuing treatment.`,
  },
  {
    id: 'G4',
    label: 'Amiodarone and warfarin',
    text: `${P}Coadministration of amiodarone with warfarin increases the prothrombin time. When amiodarone is started, reduce the warfarin dose by one-third to one-half and monitor the INR closely.`,
  },
  {
    id: 'G5',
    label: 'Digoxin and potassium',
    text: `${P}Hypokalemia may sensitize the myocardium to digoxin and increase the risk of toxicity. Maintain serum potassium within the normal range in patients receiving digoxin.`,
  },
  {
    id: 'G6',
    label: 'NSAIDs, advanced renal disease',
    text: `${P}Avoid NSAIDs in patients with advanced renal disease unless the benefits are expected to outweigh the risk of worsening renal function. If an NSAID is used, monitor renal function closely.`,
  },
  {
    id: 'G7',
    label: 'Vancomycin, AUC target',
    text: `${P}For serious MRSA infections in adults, an AUC/MIC ratio of 400 to 600 (assuming an MIC of 1 mg/L) is advised as the target to achieve clinical efficacy while improving patient safety.`,
  },
];

const s = (...ids: string[]) => ['H', ...ids];

export const BENCH_ITEMS: readonly BenchItem[] = [
  // ---------------------------------------------------------------- against the case data
  { id: 'b01', kind: 'arithmetic', claim: 'Serum creatinine rose from 2.1 mg/dL on Day 0 to 2.6 mg/dL on Day 1.', sources: s('E1', 'E2'), expected: ['supported'], why: 'Both values and the rise are in the data.' },
  { id: 'b02', kind: 'direction', claim: 'Serum creatinine fell from 2.6 mg/dL to 2.1 mg/dL between Day 0 and Day 1.', sources: s('E1', 'E2'), expected: ['contradicted'], why: 'Every number is in the data, but the change is reversed.' },
  { id: 'b03', kind: 'interpretation', claim: 'Serum creatinine rose from 2.1 to 2.6 mg/dL, which confirms acute kidney injury.', sources: s('E1', 'E2'), expected: ['partial'], why: 'The rise is in the data; the diagnosis is an interpretation the data does not state.' },
  { id: 'b04', kind: 'range', claim: 'Potassium was within the normal range on Day 0 (5.4 mmol/L).', sources: s('E3'), expected: ['contradicted'], why: 'The value is right, but the laboratory marks it high, above 3.5–5.0.' },
  { id: 'b05', kind: 'restated', claim: 'Potassium was high on Day 0, at 5.4 mmol/L.', sources: s('E3'), expected: ['supported'], why: 'Stated by the laboratory entry.' },
  { id: 'b06', kind: 'drug', claim: 'The patient has a documented allergy to ceftriaxone (rash).', sources: s('E4'), expected: ['contradicted', 'unsupported'], why: 'The allergy recorded is to penicillin.' },
  { id: 'b07', kind: 'negation', claim: 'The patient has no documented drug allergy.', sources: s('E4'), expected: ['contradicted'], why: 'A penicillin allergy is documented.' },
  { id: 'b08', kind: 'restated', claim: 'A penicillin allergy with rash is documented.', sources: s('E4'), expected: ['supported'], why: 'A restatement.' },
  { id: 'b09', kind: 'event', claim: 'Enoxaparin was stopped on Day 1.', sources: s('M1'), expected: ['contradicted', 'unsupported'], why: 'The course is recorded as active; no stop is recorded.' },
  { id: 'b10', kind: 'restated', claim: 'Enoxaparin 40 mg SC once daily is ordered for VTE prophylaxis.', sources: s('M1'), expected: ['supported'], why: 'A restatement of the order.' },
  { id: 'b11', kind: 'restated', claim: 'The Cockcroft–Gault creatinine clearance is 26 mL/min on Day 1.', sources: s('C1'), expected: ['supported'], why: 'The calculation result.' },
  { id: 'b12', kind: 'number', claim: 'The creatinine clearance is 62 mL/min.', sources: s('C1'), expected: ['contradicted', 'unsupported'], why: 'The result is 26 mL/min (the number check catches this one too).' },
  { id: 'b13', kind: 'unit', claim: 'The patient weighs 72 lb.', sources: s('E5'), expected: ['contradicted', 'unsupported'], why: 'The number is right; the unit is not (72 kg).' },
  { id: 'b14', kind: 'interpretation', claim: 'The INR on Day 2 is 3.8, above the usual target range of 2 to 3.', sources: s('E6'), expected: ['partial'], why: 'The value is in the data; the target range is not.' },
  { id: 'b15', kind: 'restated', claim: 'A 67-year-old man had a serum creatinine of 2.6 mg/dL on Day 1.', sources: s('E2'), expected: ['supported'], why: 'Age and sex from the case header, the value from the entry.' },

  // ---------------------------------------------------------------- against a reference passage (with case data)
  { id: 'b16', kind: 'threshold', claim: 'With a creatinine clearance of 26 mL/min, below 30 mL/min, the prophylactic enoxaparin dose is 30 mg once daily.', sources: s('C1', 'G1'), expected: ['supported'], why: 'The threshold is applied correctly.' },
  { id: 'b17', kind: 'threshold', claim: 'With a creatinine clearance of 45 mL/min, the prophylactic enoxaparin dose should be reduced to 30 mg once daily.', sources: s('C2', 'G1'), expected: ['contradicted'], why: 'Every number is in the sources, but 45 mL/min is moderate impairment, where no adjustment is recommended.' },
  { id: 'b18', kind: 'condition', claim: 'Enoxaparin is contraindicated in renal impairment.', sources: s('G1'), expected: ['contradicted', 'unsupported'], why: 'The passage adjusts the dose in severe impairment; it does not contraindicate the drug.' },
  { id: 'b19', kind: 'restated', claim: 'In moderate renal impairment no enoxaparin dose adjustment is recommended, but the patient should be watched for bleeding.', sources: s('G1'), expected: ['supported'], why: 'A restatement.' },
  { id: 'b20', kind: 'restated', claim: 'Ceftriaxone needs no dose adjustment for renal impairment alone.', sources: s('G2'), expected: ['supported'], why: 'Stated.' },
  { id: 'b21', kind: 'negation', claim: 'Ceftriaxone requires a dose reduction in renal impairment.', sources: s('G2'), expected: ['contradicted'], why: 'The passage says no adjustment is necessary.' },
  { id: 'b22', kind: 'multi_part', claim: 'Ceftriaxone needs no renal dose adjustment and covers atypical pathogens such as Mycoplasma.', sources: s('G2'), expected: ['partial'], why: 'The first part is stated; the second is not in the passage.' },
  { id: 'b23', kind: 'threshold', claim: 'Metformin is contraindicated when the eGFR is below 45 mL/min/1.73 m2.', sources: s('G3'), expected: ['contradicted', 'unsupported'], why: 'The contraindication is below 30; below 45, starting is not recommended and continuing is reassessed.' },
  { id: 'b24', kind: 'restated', claim: 'Metformin should not be started when the eGFR is between 30 and 45 mL/min/1.73 m2.', sources: s('G3'), expected: ['supported'], why: 'Stated.' },
  { id: 'b25', kind: 'direction', claim: 'Amiodarone decreases the effect of warfarin, so the warfarin dose should be increased.', sources: s('G4'), expected: ['contradicted'], why: 'The passage says the prothrombin time increases and the dose is reduced.' },
  { id: 'b26', kind: 'restated', claim: 'Amiodarone raises the prothrombin time in patients taking warfarin; the warfarin dose should be reduced and the INR monitored closely.', sources: s('G4'), expected: ['supported'], why: 'A restatement.' },
  { id: 'b27', kind: 'restated', claim: 'When amiodarone is started, the warfarin dose is reduced by one-third to one-half.', sources: s('G4'), expected: ['supported'], why: 'Stated.' },
  { id: 'b28', kind: 'drug', claim: 'Amiodarone increases the prothrombin time in patients taking apixaban.', sources: s('G4'), expected: ['unsupported'], why: 'The passage is about warfarin.' },
  { id: 'b29', kind: 'certainty', claim: 'Hypokalemia always causes digoxin toxicity.', sources: s('G5'), expected: ['unsupported', 'contradicted', 'partial'], why: 'The passage says it may sensitize and increase the risk.' },
  { id: 'b30', kind: 'restated', claim: 'In a patient on digoxin, potassium should be kept within the normal range because hypokalemia may increase the risk of toxicity.', sources: s('G5'), expected: ['supported'], why: 'A restatement.' },
  { id: 'b31', kind: 'condition', claim: 'NSAIDs are safe in advanced renal disease if renal function is monitored.', sources: s('G6'), expected: ['contradicted', 'unsupported'], why: 'The passage says to avoid them unless the benefit outweighs the risk; it never calls them safe.' },
  { id: 'b32', kind: 'restated', claim: 'NSAIDs should be avoided in advanced renal disease unless the benefit outweighs the risk of worsening renal function.', sources: s('G6'), expected: ['supported'], why: 'Stated.' },
  { id: 'b33', kind: 'population', claim: 'For all MRSA infections, including mild skin infections, an AUC/MIC target of 400 to 600 is advised.', sources: s('G7'), expected: ['partial', 'unsupported'], why: 'The passage is about serious infections in adults.' },
  { id: 'b34', kind: 'restated', claim: 'For serious MRSA infections in adults, an AUC/MIC ratio of 400 to 600 is advised, assuming an MIC of 1 mg/L.', sources: s('G7'), expected: ['supported'], why: 'Stated.' },
  { id: 'b35', kind: 'unit', claim: 'In severe renal impairment, the prophylactic enoxaparin dose is 30 units once daily.', sources: s('G1'), expected: ['contradicted', 'unsupported'], why: 'The passage gives 30 mg.' },
  { id: 'b36', kind: 'frequency', claim: 'In severe renal impairment, the prophylactic enoxaparin dose is 30 mg twice daily.', sources: s('G1'), expected: ['contradicted'], why: 'The passage gives once daily.' },
  { id: 'b37', kind: 'route', claim: 'In severe renal impairment, the prophylactic enoxaparin dose is 30 mg once daily given intravenously.', sources: s('G1'), expected: ['contradicted', 'unsupported'], why: 'The passage gives subcutaneous injection.' },
];

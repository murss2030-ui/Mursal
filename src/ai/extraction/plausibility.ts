/**
 * Physiologic plausibility limits used only to catch reading errors in
 * extracted values (Section 13: "physiologic range checks (potassium 1–10
 * mmol/L and so on)"). They are deliberately wide — a value outside them is
 * almost certainly misread (a lost decimal point, a wrong unit), not a
 * clinical finding. They are not reference ranges and not clinical
 * thresholds, never block a value, and only mark it uncertain for the
 * trainee to check against the source.
 */

type Limits = Record<string, readonly [number, number]>;

/** Laboratory limits by catalogue id, then unit. */
const LAB: Record<string, Limits> = {
  scr: { 'mg/dL': [0.05, 30], 'µmol/L': [4, 2700] },
  bun: { 'mg/dL': [1, 300] },
  urea: { 'mmol/L': [0.3, 110], 'mg/dL': [2, 660] },
  na: { 'mmol/L': [90, 200], 'mEq/L': [90, 200] },
  k: { 'mmol/L': [1, 10], 'mEq/L': [1, 10] },
  cl: { 'mmol/L': [50, 160], 'mEq/L': [50, 160] },
  hco3: { 'mmol/L': [2, 60], 'mEq/L': [2, 60] },
  ca_total: { 'mg/dL': [2, 20], 'mmol/L': [0.5, 5] },
  ca_ionized: { 'mmol/L': [0.2, 3], 'mg/dL': [1, 12] },
  mg: { 'mg/dL': [0.2, 12], 'mmol/L': [0.1, 5], 'mEq/L': [0.2, 10] },
  phos: { 'mg/dL': [0.2, 25], 'mmol/L': [0.05, 8] },
  albumin: { 'g/dL': [0.5, 7], 'g/L': [5, 70] },
  glucose: { 'mg/dL': [10, 2500], 'mmol/L': [0.5, 140] },
  hba1c: { '%': [2, 25], 'mmol/mol': [0, 240] },
  uric: { 'mg/dL': [0.2, 40], 'µmol/L': [10, 2400] },
  tbil: { 'mg/dL': [0, 80], 'µmol/L': [0, 1400] },
  dbil: { 'mg/dL': [0, 60], 'µmol/L': [0, 1000] },
  alt: { 'U/L': [0, 30000] },
  ast: { 'U/L': [0, 30000] },
  alp: { 'U/L': [0, 10000] },
  ggt: { 'U/L': [0, 10000] },
  inr: { unitless: [0.5, 25] },
  pt: { s: [5, 200] },
  aptt: { s: [10, 300] },
  hb: { 'g/dL': [1, 25], 'g/L': [10, 250] },
  wbc: { '×10⁹/L': [0, 1000], '×10³/µL': [0, 1000] },
  neut_abs: { '×10⁹/L': [0, 800], '×10³/µL': [0, 800] },
  neut_pct: { '%': [0, 100] },
  bands_pct: { '%': [0, 100] },
  plt: { '×10⁹/L': [0, 5000], '×10³/µL': [0, 5000] },
  crp: { 'mg/L': [0, 1000], 'mg/dL': [0, 100] },
  pct: { 'ng/mL': [0, 1000], 'mcg/L': [0, 1000] },
  lactate: { 'mmol/L': [0, 40], 'mg/dL': [0, 360] },
  trop: { 'ng/L': [0, 1000000], 'ng/mL': [0, 1000] },
  bnp: { 'pg/mL': [0, 50000] },
  ntprobnp: { 'pg/mL': [0, 300000] },
  ck: { 'U/L': [0, 500000] },
  tsh: { 'mIU/L': [0, 1000] },
  lipase: { 'U/L': [0, 100000] },
  vanco: { 'mg/L': [0, 200], 'mcg/mL': [0, 200] },
  phenytoin: { 'mg/L': [0, 150], 'mcg/mL': [0, 150], 'µmol/L': [0, 600] },
  digoxin: { 'ng/mL': [0, 20], 'nmol/L': [0, 25] },
};

const VITAL: Limits = {
  'heart_rate:beats/min': [10, 300],
  'respiratory_rate:breaths/min': [2, 80],
  'temperature:°C': [25, 45],
  'temperature:°F': [77, 113],
  'spo2:%': [30, 100],
  'gcs:points': [3, 15],
  'urine_output:mL': [0, 20000],
  'systolic:mmHg': [30, 300],
  'diastolic:mmHg': [10, 200],
};

export const WEIGHT_LIMITS_KG = [0.3, 400] as const;

/** undefined when no limit is defined for that test and unit (nothing to check), else whether the value lies within it. */
export function labPlausible(analyte: string, unit: string, value: number): boolean | undefined {
  const lim = LAB[analyte]?.[unit];
  return lim ? value >= lim[0] && value <= lim[1] : undefined;
}

export function vitalPlausible(kind: string, unit: string, value: number): boolean | undefined {
  const lim = VITAL[`${kind}:${unit}`];
  return lim ? value >= lim[0] && value <= lim[1] : undefined;
}

export function weightPlausible(kg: number): boolean {
  return kg >= WEIGHT_LIMITS_KG[0] && kg <= WEIGHT_LIMITS_KG[1];
}

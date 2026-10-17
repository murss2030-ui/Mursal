/**
 * Explicit unit conversion for the calculation engine (Section 9, hard rules).
 *
 * Every quantity a calculator reads has one canonical unit — the unit its
 * formula is written in — and a closed list of accepted units, each with an
 * exact conversion in both directions. A unit that is not on the list is
 * rejected, never assumed. Conversion factors and their basis:
 *
 * - creatinine 1 mg/dL = 88.4 µmol/L (molar mass 113.12 g/mol; the factor KDIGO uses)
 * - albumin 1 g/dL = 10 g/L
 * - calcium 1 mmol/L = 4.008 mg/dL (atomic mass 40.08)
 * - weight 1 lb = 0.45359237 kg (exact, by definition)
 * - height 1 in = 2.54 cm (exact, by definition)
 * - temperature °F = °C × 9/5 + 32
 * - urea 1 mmol/L = 6.006 mg/dL of urea (molar mass 60.06) = 2.801 mg/dL of urea nitrogen (BUN, 2 × 14.007)
 * - bilirubin 1 mg/dL = 17.1 µmol/L (molar mass 584.66)
 * - phenytoin 1 mg/L = 1 mcg/mL = 3.964 µmol/L (molar mass 252.27)
 * - monovalent electrolytes 1 mmol/L = 1 mEq/L; cell counts ×10⁹/L = ×10³/µL
 */
import { formatNumber } from '../domain/numbers';

export type QuantityId =
  | 'creatinine'
  | 'albumin'
  | 'calcium'
  | 'weight'
  | 'height'
  | 'temperature'
  | 'urea'
  | 'bilirubin'
  | 'electrolyte'
  | 'phenytoin'
  | 'vancomycin'
  | 'cell_count'
  | 'percent'
  | 'inr'
  | 'qt'
  | 'heart_rate'
  | 'pressure'
  | 'resp_rate'
  | 'age'
  | 'dose'
  | 'duration'
  | 'gcs'
  | 'factor';

interface UnitDef {
  unit: string;
  toCanonical: (v: number) => number;
  fromCanonical: (v: number) => number;
  /** How the conversion is written in an explanation, e.g. "÷ 88.4". Absent for the canonical unit. */
  rule?: string;
}

export interface QuantityDef {
  id: QuantityId;
  canonical: string;
  units: readonly UnitDef[];
}

const same = (unit: string): UnitDef => ({ unit, toCanonical: (v) => v, fromCanonical: (v) => v });
const factor = (unit: string, perCanonical: number): UnitDef => ({
  // `perCanonical` of this unit make one canonical unit (e.g. 88.4 µmol/L per mg/dL).
  unit,
  toCanonical: (v) => v / perCanonical,
  fromCanonical: (v) => v * perCanonical,
  rule: `÷ ${formatNumber(perCanonical)}`,
});
const times = (unit: string, canonicalPerUnit: number): UnitDef => ({
  // One of this unit is `canonicalPerUnit` canonical units (e.g. 1 lb = 0.45359237 kg).
  unit,
  toCanonical: (v) => v * canonicalPerUnit,
  fromCanonical: (v) => v / canonicalPerUnit,
  rule: `× ${formatNumber(canonicalPerUnit)}`,
});

export const CREATININE_UMOL_PER_MGDL = 88.4;
export const CALCIUM_MGDL_PER_MMOL = 4.008;
export const UREA_MGDL_PER_MMOL = 6.006;
export const BUN_MGDL_PER_MMOL_UREA = 2.801;
export const BILIRUBIN_UMOL_PER_MGDL = 17.1;
export const PHENYTOIN_UMOL_PER_MGL = 3.964;
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

/** Unit label for urea nitrogen. A BUN result in mg/dL is converted with the nitrogen factor, not the urea one. */
export const BUN_UNIT = 'mg/dL (BUN)';

export const QUANTITIES: Readonly<Record<QuantityId, QuantityDef>> = {
  creatinine: { id: 'creatinine', canonical: 'mg/dL', units: [same('mg/dL'), factor('µmol/L', CREATININE_UMOL_PER_MGDL)] },
  albumin: { id: 'albumin', canonical: 'g/dL', units: [same('g/dL'), factor('g/L', 10)] },
  calcium: { id: 'calcium', canonical: 'mg/dL', units: [same('mg/dL'), times('mmol/L', CALCIUM_MGDL_PER_MMOL)] },
  weight: { id: 'weight', canonical: 'kg', units: [same('kg'), times('lb', KG_PER_LB)] },
  height: { id: 'height', canonical: 'cm', units: [same('cm'), times('in', CM_PER_IN)] },
  temperature: {
    id: 'temperature',
    canonical: '°C',
    units: [
      same('°C'),
      { unit: '°F', toCanonical: (f) => ((f - 32) * 5) / 9, fromCanonical: (c) => (c * 9) / 5 + 32, rule: '(°F − 32) × 5/9' },
    ],
  },
  urea: {
    id: 'urea',
    canonical: 'mmol/L',
    units: [same('mmol/L'), factor('mg/dL', UREA_MGDL_PER_MMOL), factor(BUN_UNIT, BUN_MGDL_PER_MMOL_UREA)],
  },
  bilirubin: { id: 'bilirubin', canonical: 'mg/dL', units: [same('mg/dL'), factor('µmol/L', BILIRUBIN_UMOL_PER_MGDL)] },
  electrolyte: { id: 'electrolyte', canonical: 'mmol/L', units: [same('mmol/L'), same('mEq/L')] },
  phenytoin: { id: 'phenytoin', canonical: 'mg/L', units: [same('mg/L'), same('mcg/mL'), factor('µmol/L', PHENYTOIN_UMOL_PER_MGL)] },
  vancomycin: { id: 'vancomycin', canonical: 'mg/L', units: [same('mg/L'), same('mcg/mL')] },
  cell_count: { id: 'cell_count', canonical: '×10⁹/L', units: [same('×10⁹/L'), same('×10³/µL')] },
  percent: { id: 'percent', canonical: '%', units: [same('%')] },
  inr: { id: 'inr', canonical: 'unitless', units: [same('unitless')] },
  qt: { id: 'qt', canonical: 'ms', units: [same('ms'), times('s', 1000)] },
  heart_rate: { id: 'heart_rate', canonical: 'beats/min', units: [same('beats/min')] },
  pressure: { id: 'pressure', canonical: 'mmHg', units: [same('mmHg')] },
  resp_rate: { id: 'resp_rate', canonical: 'breaths/min', units: [same('breaths/min')] },
  age: { id: 'age', canonical: 'years', units: [same('years')] },
  dose: { id: 'dose', canonical: 'mg', units: [same('mg'), times('g', 1000)] },
  duration: { id: 'duration', canonical: 'h', units: [same('h'), factor('min', 60)] },
  gcs: { id: 'gcs', canonical: 'points', units: [same('points')] },
  factor: { id: 'factor', canonical: 'unitless', units: [same('unitless')] },
};

/**
 * Spelling variants of the same unit, mapped to the spelling used here.
 * Only typography is normalised (the Greek letter mu for the micro sign, "u"
 * typed for "µ"); a different unit is never mapped onto another.
 */
export function normaliseUnit(unit: string): string {
  return unit
    .trim()
    .replace(/μ/g, 'µ') // Greek small letter mu → micro sign, as in the lab catalogue
    .replace(/^u(mol\/L)$/i, 'µ$1')
    .replace(/^micromol\/L$/i, 'µmol/L');
}

export type Converted =
  | { ok: true; value: number; unit: string; rule?: string }
  | { ok: false; reason: 'unknown_unit'; unit: string; accepted: readonly string[] };

export function acceptedUnits(q: QuantityId): readonly string[] {
  return QUANTITIES[q].units.map((u) => u.unit);
}

function unitDef(q: QuantityId, unit: string): UnitDef | undefined {
  const u = normaliseUnit(unit);
  return QUANTITIES[q].units.find((d) => d.unit === u);
}

/** A recorded value in the quantity's canonical unit, or a refusal naming the accepted units. */
export function toCanonical(q: QuantityId, value: number, unit: string): Converted {
  const d = unitDef(q, unit);
  if (!d) return { ok: false, reason: 'unknown_unit', unit, accepted: acceptedUnits(q) };
  return { ok: true, value: d.toCanonical(value), unit: QUANTITIES[q].canonical, ...(d.rule ? { rule: d.rule } : {}) };
}

/** A canonical value expressed in another accepted unit. */
export function fromCanonical(q: QuantityId, value: number, unit: string): Converted {
  const d = unitDef(q, unit);
  if (!d) return { ok: false, reason: 'unknown_unit', unit, accepted: acceptedUnits(q) };
  return { ok: true, value: d.fromCanonical(value), unit: d.unit };
}

export function convert(q: QuantityId, value: number, from: string, to: string): Converted {
  const c = toCanonical(q, value, from);
  return c.ok ? fromCanonical(q, c.value, to) : c;
}

/** Rounds for display only; stored values keep full precision. */
export function round(v: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round((v + Number.EPSILON * Math.sign(v)) * p) / p;
}

/** A value for an explanation: rounded, without trailing zeros, with its unit. */
export function show(v: number, unit: string, decimals = 2): string {
  const n = formatNumber(round(v, decimals));
  return unit === 'unitless' || unit === '' ? n : `${n} ${unit}`;
}

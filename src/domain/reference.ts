/**
 * Reference tables the trainee maintains (they apply to every case):
 *
 * - the local formulary and brand-alias table (Decision 11; Section 7
 *   LocalFormularyItem), initially empty, with the hospital's high-alert flag
 *   (M2 plan decision 3, proposed default: maintained by the trainee with its
 *   source — the ISMP list is copyrighted and not shipped);
 * - the renal and hepatic dose-adjustment table the rules engine reads
 *   (Section 10: "against a trainee-sourced table with page or URL recorded").
 *   An entry says when an adjustment is required and where that is written;
 *   PRECEPTOR never computes or suggests the adjusted dose;
 * - the hospital laboratory's critical thresholds (M2 plan decision 4,
 *   proposed default: none shipped; each entered with its source);
 * - the department's vancomycin dosing-interval table (owner decision 6,
 *   18 October 2026: empiric weight-based dosing with the interval set from
 *   Cockcroft–Gault creatinine clearance). The decision names the method, not
 *   the bands, so none are shipped: each band is entered with its source.
 *
 * Every record is versioned and audited; "removed" is a new version with a
 * reason, never a deletion.
 */
import { isValidISODate } from './dates';
import { ANALYTE_BY_ID } from './catalogue';
import { L } from './label';
import { formatNumber, parseDecimal } from './numbers';
import type { Versioned } from './types';

export type ReferenceStatus = 'active' | 'retracted';

interface RefBase extends Versioned {
  id: string;
  status: ReferenceStatus;
  createdAt: string;
  verifiedBy: string;
  /** YYYY-MM-DD */
  verifiedAt: string;
}

export interface FormularyItem extends RefBase {
  genericName: string;
  /** RxNorm concept of the generic name, when matched (ingredient or combination). */
  rxcui?: string;
  /** M2 extension: the RxNorm ingredients the rules engine checks; empty when the name is not matched. */
  ingredients: string[];
  /** Locally available brands (e.g. Egyptian, Indian, Jordanian), used as aliases for matching. */
  brandNames: string[];
  strengths: string[];
  dosageForms: string[];
  availableInHospital: boolean;
  /** M2 extension (decision 3): on the hospital's high-alert list. */
  highAlert: boolean;
  highAlertSource?: string;
  sourceNote: string;
}

export type AdjustmentMeasure = 'crcl_cg' | 'egfr_ckdepi2021' | 'child_pugh';

export interface AdjustmentRule extends RefBase {
  drugName: string;
  ingredients: string[];
  organ: 'renal' | 'hepatic';
  /** Which calculated value the threshold refers to, as the source states it. */
  measure: AdjustmentMeasure;
  /** Renal: adjustment required below this value (mL/min or mL/min/1.73 m²). */
  below?: number;
  /** Hepatic: adjustment required from this Child–Pugh class. */
  fromClass?: 'B' | 'C';
  /** What the source says, transcribed by the trainee. PRECEPTOR never computes the adjusted dose. */
  sourceText: string;
  /** The reference, with page or URL. */
  source: string;
}

export interface LabThreshold extends RefBase {
  analyte: string;
  unit: string;
  /** Critical below this value. */
  low?: number;
  /** Critical above this value. */
  high?: number;
  source: string;
}

/** One band of the department's vancomycin interval table. */
export interface VancomycinIntervalBand extends RefBase {
  /** Creatinine clearance (Cockcroft–Gault, mL/min) from this value, inclusive; no lower end when absent. */
  crclFrom?: number;
  /** Up to this value, exclusive; no upper end when absent. */
  crclBelow?: number;
  /** `interval`: one dose every `intervalHours`. `levels`: the department sets no fixed interval in this band. */
  action: 'interval' | 'levels';
  intervalHours?: number;
  /** The reference, with page or URL. */
  source: string;
}

export type ReferenceKind = 'formulary' | 'adjustment' | 'threshold' | 'vancomycin_interval';
export type RefError = 'required' | 'invalidChoice' | 'number' | 'date' | 'tooLong' | 'order' | 'unit' | 'range';
export type RefErrors = Record<string, RefError>;
export type RefResult<T> = { ok: true; value: T } | { ok: false; errors: RefErrors };

const MAX = 300;
const MAX_LONG = 2000;

/** Comma-, semicolon- or line-separated lists ("Augmentin, Megamox"), trimmed, without duplicates. */
export function splitList(s: string | undefined): string[] {
  return [...new Set((s ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
}

class Check {
  errors: RefErrors = {};
  constructor(private readonly v: Readonly<Record<string, string>>) {}
  text(k: string, required: boolean, max = MAX): string | undefined {
    const s = (this.v[k] ?? '').trim();
    if (!s) {
      if (required) this.errors[k] = 'required';
      return undefined;
    }
    if (s.length > max) this.errors[k] = 'tooLong';
    return s;
  }
  choice<T extends string>(k: string, options: readonly T[], required = true): T | undefined {
    const s = (this.v[k] ?? '').trim();
    if (!s) {
      if (required) this.errors[k] = 'required';
      return undefined;
    }
    if (!(options as readonly string[]).includes(s)) {
      this.errors[k] = 'invalidChoice';
      return undefined;
    }
    return s as T;
  }
  num(k: string, required: boolean): number | undefined {
    const s = (this.v[k] ?? '').trim();
    if (!s) {
      if (required) this.errors[k] = 'required';
      return undefined;
    }
    const r = parseDecimal(s);
    if (!r.ok || r.value < 0) {
      this.errors[k] = 'number';
      return undefined;
    }
    return r.value;
  }
  date(k: string): string {
    const s = (this.v[k] ?? '').trim();
    if (!s) this.errors[k] = 'required';
    else if (!isValidISODate(s)) this.errors[k] = 'date';
    return s;
  }
  result<T>(value: T): RefResult<T> {
    return Object.keys(this.errors).length ? { ok: false, errors: this.errors } : { ok: true, value };
  }
}

type Fields<T> = Omit<T, keyof RefBase>;
const meta = (c: Check) => ({ verifiedBy: c.text('verifiedBy', true) ?? '', verifiedAt: c.date('verifiedAt') });

export function normalizeFormulary(v: Readonly<Record<string, string>>, match: { rxcui?: string; ingredients: string[] }): RefResult<Fields<FormularyItem> & Pick<RefBase, 'verifiedBy' | 'verifiedAt'>> {
  const c = new Check(v);
  const genericName = c.text('genericName', true) ?? '';
  const highAlert = c.choice('highAlert', ['yes', 'no'] as const) === 'yes';
  const highAlertSource = c.text('highAlertSource', highAlert);
  const value = {
    genericName,
    ...(match.rxcui ? { rxcui: match.rxcui } : {}),
    ingredients: [...new Set(match.ingredients)],
    brandNames: splitList(v.brandNames),
    strengths: splitList(v.strengths),
    dosageForms: splitList(v.dosageForms),
    availableInHospital: c.choice('availableInHospital', ['yes', 'no'] as const) === 'yes',
    highAlert,
    ...(highAlert && highAlertSource ? { highAlertSource } : {}),
    sourceNote: c.text('sourceNote', true, MAX_LONG) ?? '',
    ...meta(c),
  };
  if (value.brandNames.some((b) => b.length > MAX)) c.errors.brandNames = 'tooLong';
  if (match.ingredients.some((i) => !/^\d{1,10}$/.test(i)) || (match.rxcui && !/^\d{1,10}$/.test(match.rxcui))) c.errors.genericName = 'invalidChoice';
  return c.result(value);
}

export function normalizeAdjustment(v: Readonly<Record<string, string>>, ingredients: string[]): RefResult<Fields<AdjustmentRule> & Pick<RefBase, 'verifiedBy' | 'verifiedAt'>> {
  const c = new Check(v);
  const organ = c.choice('organ', ['renal', 'hepatic'] as const);
  const measure = c.choice('measure', organ === 'hepatic' ? (['child_pugh'] as const) : (['crcl_cg', 'egfr_ckdepi2021'] as const));
  const below = organ === 'renal' ? c.num('below', true) : undefined;
  const fromClass = organ === 'hepatic' ? c.choice('fromClass', ['B', 'C'] as const) : undefined;
  return c.result({
    drugName: c.text('drugName', true) ?? '',
    ingredients: [...new Set(ingredients)],
    organ: organ ?? 'renal',
    measure: measure ?? 'crcl_cg',
    ...(below !== undefined ? { below } : {}),
    ...(fromClass ? { fromClass } : {}),
    sourceText: c.text('sourceText', true, MAX_LONG) ?? '',
    source: c.text('source', true) ?? '',
    ...meta(c),
  });
}

export function normalizeThreshold(v: Readonly<Record<string, string>>): RefResult<Fields<LabThreshold> & Pick<RefBase, 'verifiedBy' | 'verifiedAt'>> {
  const c = new Check(v);
  const analyte = c.text('analyte', true) ?? '';
  const def = ANALYTE_BY_ID.get(analyte);
  if (analyte && !def) c.errors.analyte = 'invalidChoice';
  const unit = c.text('unit', true) ?? '';
  if (def && unit && !def.units.includes(unit)) c.errors.unit = 'unit';
  const low = c.num('low', false);
  const high = c.num('high', false);
  if (low === undefined && high === undefined && !c.errors.low && !c.errors.high) c.errors.low = 'required';
  if (low !== undefined && high !== undefined && low >= high) c.errors.high = 'order';
  return c.result({
    analyte,
    unit,
    ...(low !== undefined ? { low } : {}),
    ...(high !== undefined ? { high } : {}),
    source: c.text('source', true) ?? '',
    ...meta(c),
  });
}

/** Longest dosing interval a band may give (one week). */
export const MAX_INTERVAL_HOURS = 168;

export function normalizeVancomycinInterval(v: Readonly<Record<string, string>>): RefResult<Fields<VancomycinIntervalBand> & Pick<RefBase, 'verifiedBy' | 'verifiedAt'>> {
  const c = new Check(v);
  const crclFrom = c.num('crclFrom', false);
  const crclBelow = c.num('crclBelow', false);
  if (crclFrom === undefined && crclBelow === undefined && !c.errors.crclFrom && !c.errors.crclBelow) c.errors.crclFrom = 'required';
  if (crclFrom !== undefined && crclBelow !== undefined && crclFrom >= crclBelow) c.errors.crclBelow = 'order';
  const action = c.choice('action', ['interval', 'levels'] as const);
  const intervalHours = action === 'interval' ? c.num('intervalHours', true) : undefined;
  if (intervalHours !== undefined && (intervalHours <= 0 || intervalHours > MAX_INTERVAL_HOURS)) c.errors.intervalHours = 'range';
  return c.result({
    ...(crclFrom !== undefined ? { crclFrom } : {}),
    ...(crclBelow !== undefined ? { crclBelow } : {}),
    action: action ?? 'interval',
    ...(intervalHours !== undefined ? { intervalHours } : {}),
    source: c.text('source', true) ?? '',
    ...meta(c),
  });
}

/** Does this band hold a creatinine clearance (mL/min)? */
export function bandCovers(b: Pick<VancomycinIntervalBand, 'crclFrom' | 'crclBelow'>, crcl: number): boolean {
  return (b.crclFrom === undefined || crcl >= b.crclFrom) && (b.crclBelow === undefined || crcl < b.crclBelow);
}

/** The band's range in words: "50 to below 90 mL/min", "90 mL/min or more", "below 20 mL/min". */
export function bandRange(b: Pick<VancomycinIntervalBand, 'crclFrom' | 'crclBelow'>): L {
  const f = formatNumber;
  if (b.crclFrom !== undefined && b.crclBelow !== undefined)
    return L(`${f(b.crclFrom)} to below ${f(b.crclBelow)} mL/min`, `من ${f(b.crclFrom)} إلى أقل من ${f(b.crclBelow)} mL/min`);
  if (b.crclFrom !== undefined) return L(`${f(b.crclFrom)} mL/min or more`, `${f(b.crclFrom)} mL/min أو أكثر`);
  return L(`below ${f(b.crclBelow ?? 0)} mL/min`, `أقل من ${f(b.crclBelow ?? 0)} mL/min`);
}

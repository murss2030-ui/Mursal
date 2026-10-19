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
 * - the ONC high-priority interaction list (owner decision, 19 October
 *   2026): the publisher's site cannot be reached from the build, so the
 *   administrator enters each pair here, with its source. A pair names drugs
 *   or drug classes on each side; the rules raise it to critical.
 *
 * Every record is versioned and audited; "removed" is a new version with a
 * reason, never a deletion.
 */
import { isValidISODate } from './dates';
import { ANALYTE_BY_ID } from './catalogue';
import { parseDecimal } from './numbers';
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

/**
 * One side of an ONC pair: the names as the administrator entered them, and
 * what they resolved to in the offline vocabulary — single-ingredient drugs,
 * and FDA or VA drug classes whose members are read from the vocabulary when
 * the rules run.
 */
export interface OncSide {
  names: string[];
  ingredients: string[];
  classes: { id: string; name: string }[];
}

/** One pair of the ONC high-priority interaction list, entered by the administrator. */
export interface OncPair extends RefBase {
  /** The pair as the source names it, e.g. "Atazanavir — proton pump inhibitors". */
  label: string;
  sideA: OncSide;
  sideB: OncSide;
  /** The reference, with page or table. */
  source: string;
}

/** A side of an ONC pair as the editor resolved it: names it could not resolve block the save. */
export interface OncResolved {
  side: OncSide;
  unrecognised: string[];
}

export type ReferenceKind = 'formulary' | 'adjustment' | 'threshold' | 'onc';
export type RefError = 'required' | 'invalidChoice' | 'number' | 'date' | 'tooLong' | 'order' | 'unit' | 'unrecognised';
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

const NO_SIDE: OncResolved = { side: { names: [], ingredients: [], classes: [] }, unrecognised: [] };

/**
 * An ONC pair. Each side needs at least one name, and every name must have
 * resolved (to one ingredient or a drug class) — a name the vocabulary does
 * not know would silently never match.
 */
export function normalizeOnc(
  v: Readonly<Record<string, string>>,
  sides: { sideA: OncResolved; sideB: OncResolved } = { sideA: NO_SIDE, sideB: NO_SIDE },
): RefResult<Fields<OncPair> & Pick<RefBase, 'verifiedBy' | 'verifiedAt'>> {
  const c = new Check(v);
  const label = c.text('label', true) ?? '';
  for (const k of ['sideA', 'sideB'] as const) {
    c.text(k, true, MAX_LONG);
    if (!c.errors[k] && (sides[k].unrecognised.length || !sides[k].side.names.length)) c.errors[k] = sides[k].side.names.length ? 'unrecognised' : 'required';
  }
  return c.result({
    label,
    sideA: sides.sideA.side,
    sideB: sides.sideB.side,
    source: c.text('source', true) ?? '',
    ...meta(c),
  });
}

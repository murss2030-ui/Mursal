/**
 * Is serum creatinine stable? The KDIGO creatinine criteria for acute kidney
 * injury: a rise of ≥ 0.3 mg/dL (≥ 26.5 µmol/L) within 48 hours, or a rise to
 * ≥ 1.5 times a value from the prior 7 days (KDIGO Clinical Practice Guideline
 * for Acute Kidney Injury, Kidney Int Suppl 2012;2:1–138, recommendation
 * 2.1.1). A fall of the same size also means creatinine is not at steady
 * state. The urine-output criterion is not checked here.
 *
 * Used to warn that an estimate of kidney function is unreliable (Cockcroft–
 * Gault, CKD-EPI), and by the rules engine's rate-of-change rule. It flags;
 * it does not diagnose.
 */
import { L } from '../domain/label';
import type { EntryOf, TimelineEntry } from '../domain/types';
import { minutesOf } from './gather';
import { show, toCanonical } from './units';

export const KDIGO_CITATION =
  'KDIGO Acute Kidney Injury Work Group. KDIGO Clinical Practice Guideline for Acute Kidney Injury. Kidney Int Suppl 2012;2(1):1–138 (recommendation 2.1.1).';

export interface ScrPoint {
  entryId: string;
  day: number;
  time?: string;
  mgdl: number;
}

export interface ScrChange {
  kind: 'rise_48h' | 'rise_7d' | 'fall_48h' | 'fall_7d';
  from: ScrPoint;
  to: ScrPoint;
  /** False when clock times are missing and the two days only allow, not prove, 48 hours or less. */
  certainWithin48h: boolean;
}

/** Numeric creatinine results in mg/dL, oldest first. Unverified values are left out. */
export function scrSeries(current: readonly TimelineEntry[]): ScrPoint[] {
  const out: ScrPoint[] = [];
  for (const e of current) {
    if (e.type !== 'lab' || e.payload.analyte !== 'scr' || e.payload.result.kind !== 'numeric') continue;
    if (e.provenance === 'extracted_unverified') continue;
    const c = toCanonical('creatinine', e.payload.result.value, e.payload.unit);
    if (!c.ok) continue;
    out.push({ entryId: e.id, day: e.hospitalDay, ...(e.timeOfDay ? { time: e.timeOfDay } : {}), mgdl: c.value });
  }
  return out.sort((a, b) => order(a) - order(b) || (a.entryId < b.entryId ? -1 : 1));
}

function order(p: ScrPoint): number {
  return minutesOf(p.day, p.time ?? '00:00') + (p.time ? 0 : 0.5);
}

/** Hours between two points: exact with clock times, else the range the days allow. */
function hours(a: ScrPoint, b: ScrPoint): { min: number; max: number } {
  if (a.time && b.time) {
    const h = (minutesOf(b.day, b.time) - minutesOf(a.day, a.time)) / 60;
    return { min: h, max: h };
  }
  const d = b.day - a.day;
  return { min: Math.max(0, (d - 1) * 24), max: (d + 1) * 24 };
}

/**
 * Changes that make creatinine unstable, looking back from `at` (the value a
 * calculation uses; the latest value when omitted) over the previous 7 days.
 */
export function creatinineChanges(series: readonly ScrPoint[], atEntryId?: string): ScrChange[] {
  const idx = atEntryId ? series.findIndex((p) => p.entryId === atEntryId) : series.length - 1;
  if (idx < 0) return [];
  const window = series.slice(0, idx + 1);
  const changes: ScrChange[] = [];
  for (let j = 1; j < window.length; j++) {
    const b = window[j]!;
    for (let i = 0; i < j; i++) {
      const a = window[i]!;
      const h = hours(a, b);
      if (h.min > 7 * 24) continue;
      const within48 = h.min <= 48;
      const certain = h.max <= 48;
      const diff = b.mgdl - a.mgdl;
      if (within48 && diff >= 0.3 - 1e-9) changes.push({ kind: 'rise_48h', from: a, to: b, certainWithin48h: certain });
      else if (within48 && -diff >= 0.3 - 1e-9) changes.push({ kind: 'fall_48h', from: a, to: b, certainWithin48h: certain });
      if (b.mgdl >= 1.5 * a.mgdl - 1e-9) changes.push({ kind: 'rise_7d', from: a, to: b, certainWithin48h: certain });
      else if (a.mgdl >= 1.5 * b.mgdl - 1e-9) changes.push({ kind: 'fall_7d', from: a, to: b, certainWithin48h: certain });
    }
  }
  return changes;
}

const at = (p: ScrPoint) => `${show(p.mgdl, 'mg/dL')} (Day ${p.day}${p.time ? ` ${p.time}` : ''})`;
const atAr = (p: ScrPoint) => `${show(p.mgdl, 'mg/dL')} (اليوم ${p.day}${p.time ? ` ${p.time}` : ''})`;

/** One warning describing the most telling change, or none when creatinine looks stable. */
export function stabilityWarning(series: readonly ScrPoint[], atEntryId?: string): L | undefined {
  const changes = creatinineChanges(series, atEntryId);
  const rise = changes.find((c) => c.kind === 'rise_48h' || c.kind === 'rise_7d');
  if (rise) {
    const criterion =
      rise.kind === 'rise_48h'
        ? L(
            rise.certainWithin48h ? 'a rise of at least 0.3 mg/dL within 48 hours' : 'a rise of at least 0.3 mg/dL within 2 hospital days (clock times not recorded)',
            rise.certainWithin48h ? 'ارتفاع لا يقل عن 0.3 mg/dL خلال 48 ساعة' : 'ارتفاع لا يقل عن 0.3 mg/dL خلال يومين (لم تُسجَّل أوقات السحب)',
          )
        : L('a rise to at least 1.5 times a value from the previous 7 days', 'ارتفاع إلى 1.5 ضعف قيمة خلال الأيام السبعة السابقة على الأقل');
    return L(
      `Creatinine is not stable: ${at(rise.from)} → ${at(rise.to)}, ${criterion.en}, which meets a KDIGO creatinine criterion for acute kidney injury. Estimates of kidney function assume a stable creatinine and are unreliable now.`,
      `الكرياتينين غير مستقر: ${atAr(rise.from)} ← ${atAr(rise.to)}، ${criterion.ar}، وهو ما يحقق معيار KDIGO للكرياتينين في الإصابة الكلوية الحادة. تفترض تقديرات وظيفة الكلى ثبات الكرياتينين ولا يُعتمد عليها الآن.`,
    );
  }
  const fall = changes.find((c) => c.kind === 'fall_48h' || c.kind === 'fall_7d');
  if (fall) {
    return L(
      `Creatinine is changing: ${at(fall.from)} → ${at(fall.to)}. It is not at steady state, so estimates of kidney function are unreliable now.`,
      `الكرياتينين يتغير: ${atAr(fall.from)} ← ${atAr(fall.to)}. لم يصل إلى حالة الثبات، لذا لا يُعتمد على تقديرات وظيفة الكلى الآن.`,
    );
  }
  return undefined;
}

/** For calculators that read serum creatinine: a stability warning for the value they used. */
export function scrStabilityWarnings(scrEntryId: string | undefined, current: readonly TimelineEntry[]): L[] {
  const w = stabilityWarning(scrSeries(current), scrEntryId);
  return w ? [w] : [];
}

export type ScrEntry = EntryOf<'lab'>;

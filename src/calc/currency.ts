/**
 * Is a saved result still based on the current record?
 *
 * A CalcResult is never changed. When an input it used is corrected or
 * retracted, when a newer value of that input is recorded, or when the
 * case's age, sex or height changes, the result is shown as out of date with
 * the reasons, and a new calculation creates a new result.
 */
import { L } from '../domain/label';
import type { TimelineEntry } from '../domain/types';
import { compareEntries } from '../domain/timeline';
import type { GatherContext, PendingValue } from './gather';
import { candidates } from './gather';
import type { CalcResult, CalculatorDef } from './types';
import type { ExtractionRun } from '../domain/types';

export type Currency = { current: true } | { current: false; reasons: L[] };

export function resultCurrency(result: CalcResult, def: CalculatorDef, ctx: GatherContext): Currency {
  const reasons: L[] = [];
  const specs = new Map([...def.requiredInputs, ...def.optionalInputs].map((s) => [s.key, s]));
  const currentIds = new Set(ctx.current.map((e) => e.id));
  for (const v of Object.values(result.inputs.detail)) {
    const spec = specs.get(v.key);
    const label = spec?.label ?? L(v.key, v.key);
    const s = v.source;
    if (s.kind === 'entry') {
      if (!currentIds.has(s.entryId)) {
        reasons.push(L(`${label.en} (Day ${s.day}) was corrected or marked entered in error.`, `${label.ar} (اليوم ${s.day}) صُحّح أو عُلّم كإدخال خاطئ.`));
        continue;
      }
      if (!spec || spec.pickRequired) continue;
      const used = ctx.current.find((e) => e.id === s.entryId)!;
      const newer = candidates(spec, ctx.current).find((e) => compareEntries(e, used) > 0);
      if (newer) {
        reasons.push(L(`A newer ${label.en.toLowerCase()} was recorded (Day ${newer.hospitalDay}).`, `سُجّلت قيمة أحدث لـ ${label.ar} (اليوم ${newer.hospitalDay}).`));
      }
    } else if (s.kind === 'case') {
      const now =
        s.field === 'ageYears' ? ctx.demographics.ageYears : s.field === 'sex' ? (ctx.demographics.sex === 'F' ? 1 : 0) : ctx.demographics.heightCm;
      if (now !== v.value) reasons.push(L(`${label.en} in the case record has changed.`, `تغيّر ${label.ar} في سجل الحالة.`));
    }
  }
  return reasons.length ? { current: false, reasons } : { current: true };
}

/** The most recent result of each calculator, by computation time. */
export function latestResults(results: readonly CalcResult[]): Map<string, CalcResult> {
  const out = new Map<string, CalcResult>();
  for (const r of [...results].sort((a, b) => (a.computedAt < b.computedAt ? -1 : a.computedAt > b.computedAt ? 1 : 0))) out.set(r.calc, r);
  return out;
}

/**
 * Values read from documents and not yet confirmed by the trainee (Section 13):
 * they are named as unverified by the calculators and never used.
 */
export function pendingFromRuns(runs: readonly ExtractionRun[], activeAttachmentIds?: ReadonlySet<string>): PendingValue[] {
  const out: PendingValue[] = [];
  for (const run of runs) {
    if (activeAttachmentIds && !activeAttachmentIds.has(run.attachmentId)) continue;
    for (const f of run.fields) {
      if (f.decision || f.target.kind !== 'entry') continue;
      if (f.target.type === 'lab' && f.values.analyte) out.push({ kind: 'lab', analyte: f.values.analyte });
      else if (f.target.type === 'vital' && f.values.vital) out.push({ kind: 'vital', vital: f.values.vital as PendingValue['vital'] });
      else if (f.target.type === 'weight') out.push({ kind: 'weight' });
    }
  }
  return out;
}

export function entryLabel(e: TimelineEntry): string {
  return `Day ${e.hospitalDay}${e.timeOfDay ? ` ${e.timeOfDay}` : ''}`;
}

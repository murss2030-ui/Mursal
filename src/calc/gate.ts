/**
 * The Verify gate for assessments (Section 8). Each calculator declares its
 * own mandatory inputs (src/calc/types.ts); an assessment declares its own
 * here. If any is absent the assessment is refused and the missing fields
 * are named explicitly — never hidden behind a polished analysis.
 *
 * "A renally-cleared drug's dose review requires age, weight, sex, serum
 * creatinine with its draw date, dialysis status, current dose and route,
 * and indication. Missing creatinine date blocks the review — it does not get
 * a guess." Every timeline entry carries the hospital day it was taken, so a
 * creatinine on the timeline always has its draw day; a creatinine read from
 * a document and not yet confirmed with its day is refused as unverified.
 */
import { L } from '../domain/label';
import { compareEntries, type MedCourse } from '../domain/timeline';
import type { EntryOf, NoteCategory, TimelineEntry } from '../domain/types';
import type { GatherContext } from './gather';

export type GateState = 'ok' | 'missing' | 'unverified';

export interface GateItem {
  key: 'age' | 'sex' | 'weight' | 'scr' | 'dialysis' | 'dose_route' | 'indication';
  label: L;
  state: GateState;
  /** What was found (clinical English). */
  value?: string;
  day?: number;
  /** Where to record it. */
  add?: { kind: 'entry'; type: 'weight' | 'lab'; category?: undefined } | { kind: 'entry'; type: 'note'; category: NoteCategory } | { kind: 'medication' } | { kind: 'case_details' };
}

export interface GateResult {
  ok: boolean;
  items: GateItem[];
}

const latest = <T extends TimelineEntry>(xs: readonly T[]): T | undefined => [...xs].sort(compareEntries).pop();

const RRT_TEXT = { none: 'not on dialysis', intermittent_hd: 'intermittent haemodialysis', peritoneal: 'peritoneal dialysis', crrt: 'CRRT' } as const;

export const RENAL_REVIEW_LABELS: Record<GateItem['key'], L> = {
  age: L('Age', 'العمر'),
  sex: L('Sex', 'الجنس'),
  weight: L('Weight', 'الوزن'),
  scr: L('Serum creatinine with its draw day', 'الكرياتينين في الدم مع يوم سحبه'),
  dialysis: L('Dialysis status', 'حالة الغسيل الكلوي'),
  dose_route: L('Current dose and route', 'الجرعة الحالية وطريقة الإعطاء'),
  indication: L('Indication', 'دواعي الاستعمال'),
};

/** Renal dose review of one medication course (Task 8): the mandatory inputs and whether each is recorded. */
export function renalDoseReviewGate(ctx: GatherContext, course: MedCourse): GateResult {
  const { current, demographics } = ctx;
  const pending = ctx.pending ?? [];
  const items: GateItem[] = [];
  const item = (key: GateItem['key'], state: GateState, extra: Partial<GateItem> = {}) => items.push({ key, label: RENAL_REVIEW_LABELS[key], state, ...extra });

  item('age', 'ok', { value: `${demographics.ageYears} years` });
  item('sex', 'ok', { value: demographics.sex === 'F' ? 'female' : 'male' });

  const weights = current.filter((e): e is EntryOf<'weight'> => e.type === 'weight');
  const w = latest(weights);
  if (w && w.provenance !== 'extracted_unverified') item('weight', 'ok', { value: `${w.payload.value} kg (${w.payload.method})`, day: w.hospitalDay });
  else if (w || pending.some((p) => p.kind === 'weight')) item('weight', 'unverified', { add: { kind: 'entry', type: 'weight' } });
  else item('weight', 'missing', { add: { kind: 'entry', type: 'weight' } });

  const scrs = current.filter((e): e is EntryOf<'lab'> => e.type === 'lab' && e.payload.analyte === 'scr' && e.payload.result.kind === 'numeric');
  const s = latest(scrs);
  if (s && s.provenance !== 'extracted_unverified') {
    const r = s.payload.result.kind === 'numeric' ? s.payload.result.value : NaN;
    item('scr', 'ok', { value: `${r} ${s.payload.unit}${s.timeOfDay ? ` at ${s.timeOfDay}` : ''}`, day: s.hospitalDay });
  } else if (s || pending.some((p) => p.kind === 'lab' && p.analyte === 'scr')) item('scr', 'unverified', { add: { kind: 'entry', type: 'lab' } });
  else item('scr', 'missing', { add: { kind: 'entry', type: 'lab' } });

  const rrt = latest(current.filter((e): e is EntryOf<'note'> => e.type === 'note' && e.payload.category === 'renal_replacement'));
  if (rrt && rrt.payload.category === 'renal_replacement') item('dialysis', 'ok', { value: RRT_TEXT[rrt.payload.status], day: rrt.hospitalDay });
  else item('dialysis', 'missing', { add: { kind: 'entry', type: 'note', category: 'renal_replacement' } });

  const dose = course.dose.kind === 'structured' ? `${course.dose.value} ${course.dose.unit}` : course.dose.text.trim();
  if (dose && course.route.trim()) item('dose_route', 'ok', { value: `${dose} ${course.route}` });
  else item('dose_route', 'missing', { add: { kind: 'medication' } });

  if (course.indication?.trim()) item('indication', 'ok', { value: course.indication.trim() });
  else item('indication', 'missing', { add: { kind: 'medication' } });

  return { ok: items.every((i) => i.state === 'ok'), items };
}

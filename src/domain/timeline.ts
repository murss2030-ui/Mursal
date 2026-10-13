/**
 * Reading the append-only timeline.
 *
 * Entries are never changed. A correction is a new entry whose
 * `supersedesEntryId` points at the entry it replaces; both stay readable.
 * The "effective" record is the set of chain heads that are not retractions.
 */
import type { DoseSpec, EntryOf, NotePayload, TimelineEntry } from './types';
import { formatNumber } from './numbers';

export function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
  if (a.hospitalDay !== b.hospitalDay) return a.hospitalDay - b.hospitalDay;
  const ta = a.timeOfDay ?? '';
  const tb = b.timeOfDay ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface TimelineIndex {
  byId: ReadonlyMap<string, TimelineEntry>;
  /** The entry that directly supersedes the given entry id. */
  successorOf: ReadonlyMap<string, TimelineEntry>;
  /** Entries nothing supersedes. */
  heads: TimelineEntry[];
  /** The effective record: heads that are not retractions, in clinical order. */
  current: TimelineEntry[];
  /** Root → … → head for the chain containing the entry. */
  chainOf(id: string): TimelineEntry[];
  /** The head of the chain containing the entry. */
  headOf(id: string): TimelineEntry | undefined;
}

export function indexTimeline(entries: readonly TimelineEntry[]): TimelineIndex {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const successorOf = new Map<string, TimelineEntry>();
  for (const e of entries) if (e.supersedesEntryId) successorOf.set(e.supersedesEntryId, e);
  const heads = entries.filter((e) => !successorOf.has(e.id));
  const current = heads.filter((e) => e.correction?.kind !== 'retract').sort(compareEntries);

  const headOf = (id: string): TimelineEntry | undefined => {
    let e = byId.get(id);
    const seen = new Set<string>();
    while (e && successorOf.has(e.id) && !seen.has(e.id)) {
      seen.add(e.id);
      e = successorOf.get(e.id);
    }
    return e;
  };
  const chainOf = (id: string): TimelineEntry[] => {
    const head = headOf(id);
    if (!head) return [];
    const chain: TimelineEntry[] = [head];
    let e: TimelineEntry | undefined = head;
    const seen = new Set<string>([head.id]);
    while (e?.supersedesEntryId) {
      const prev = byId.get(e.supersedesEntryId);
      if (!prev || seen.has(prev.id)) break;
      seen.add(prev.id);
      chain.unshift(prev);
      e = prev;
    }
    return chain;
  };
  return { byId, successorOf, heads, current, chainOf, headOf };
}

// ---------------------------------------------------------------- medication courses

export interface MedCourse {
  medId: string;
  drug: string;
  brand?: string;
  start: EntryOf<'med_start'>;
  changes: EntryOf<'med_change'>[];
  stop?: EntryOf<'med_stop'>;
  /** Regimen after applying every current change in clinical order. */
  dose: DoseSpec;
  route: string;
  frequency: string;
  indication?: string;
  status: 'active' | 'stopped';
  startDay: number;
  stopDay?: number;
}

export function deriveMedCourses(current: readonly TimelineEntry[]): MedCourse[] {
  const courses = new Map<string, MedCourse>();
  const sorted = [...current].sort(compareEntries);
  for (const e of sorted) {
    if (e.type !== 'med_start') continue;
    const p = e.payload;
    courses.set(p.medId, {
      medId: p.medId,
      drug: p.drug,
      brand: p.brand,
      start: e,
      changes: [],
      dose: p.dose,
      route: p.route,
      frequency: p.frequency,
      indication: p.indication,
      status: 'active',
      startDay: e.hospitalDay,
    });
  }
  for (const e of sorted) {
    if (e.type === 'med_change') {
      const c = courses.get(e.payload.medId);
      if (!c) continue; // its start was retracted
      c.changes.push(e);
      if (e.payload.dose) c.dose = e.payload.dose;
      if (e.payload.route) c.route = e.payload.route;
      if (e.payload.frequency) c.frequency = e.payload.frequency;
    } else if (e.type === 'med_stop') {
      const c = courses.get(e.payload.medId);
      if (!c) continue;
      c.stop = e;
      c.status = 'stopped';
      c.stopDay = e.hospitalDay;
    }
  }
  return [...courses.values()].sort((x, y) => x.startDay - y.startDay || x.drug.localeCompare(y.drug));
}

// ---------------------------------------------------------------- problems

export type ProblemNote = Extract<NotePayload, { category: 'problem' }>;
export interface ProblemThread {
  problemId: string;
  latest: EntryOf<'note'> & { payload: ProblemNote };
  history: (EntryOf<'note'> & { payload: ProblemNote })[];
}

export function deriveProblems(current: readonly TimelineEntry[]): ProblemThread[] {
  const threads = new Map<string, ProblemThread>();
  for (const e of [...current].sort(compareEntries)) {
    if (e.type !== 'note' || e.payload.category !== 'problem') continue;
    const pe = e as EntryOf<'note'> & { payload: ProblemNote };
    const t = threads.get(pe.payload.problemId);
    if (t) {
      t.history.push(pe);
      t.latest = pe;
    } else threads.set(pe.payload.problemId, { problemId: pe.payload.problemId, latest: pe, history: [pe] });
  }
  return [...threads.values()];
}

// ---------------------------------------------------------------- display text (clinical vocabulary stays English)

export function doseText(d: DoseSpec): string {
  return d.kind === 'text' ? d.text : `${formatNumber(d.value)} ${d.unit}`;
}

export function regimenText(c: Pick<MedCourse, 'dose' | 'route' | 'frequency'>): string {
  return `${doseText(c.dose)} ${c.route} ${c.frequency}`.trim();
}

export function unitText(unit: string): string {
  return unit === 'unitless' ? '' : unit;
}

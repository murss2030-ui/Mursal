/**
 * The case as sent for analysis: de-identified by construction (Section 18).
 * It is built from the confirmed record only — case kind, age (a band over
 * 89), sex, height, hospital days, the current timeline, medication courses,
 * problems and register rows — never from identifiers, which live in a
 * separate group this module does not read. Every item gets a short
 * reference (E1, M1, P1, R1) so the model can say what each statement rests
 * on, and the code can check that it exists.
 */
import { parseClaims, parseLinks } from '../../domain/card-data';
import { hospitalDayOf } from '../../domain/dates';
import { REGISTERS } from '../../domain/workflow/registers';
import { TASKS, type ModuleDef, type ScopedSection, type TaskDef } from '../../domain/workflow/catalogue';
import { compareEntries, deriveMedCourses, deriveProblems, indexTimeline, regimenText } from '../../domain/timeline';
import { CALC_BY_ID } from '../../calc/registry';
import type { CalcResult } from '../../calc/types';
import { show } from '../../calc/units';
import type { Case, RegisterItem, TaskRecord, TimelineEntry } from '../../domain/types';
import { translate } from '../../i18n/i18n';
import { entryText } from '../../ui/format';
import { fieldLimit, modelMayAddTo, modelMayAnswer, UNDRAFTED_TASKS } from './limits';

export interface RefTarget {
  kind: 'entry' | 'item' | 'medication' | 'problem' | 'calc';
  id: string;
  label: string;
  /** All the text sent for this reference; the numbers in it are the ones a statement citing it may use. */
  text: string;
  /** M4: the timeline entry a Problem Card's claim citing this reference points to (a medication's latest order, a problem's latest note). */
  entryId?: string;
}

export interface CasePayload {
  /** The JSON text sent to the model. */
  text: string;
  /** The case's own header as sent (age, sex, height, today's hospital day): its numbers are data any statement may use. */
  context: string;
  refs: Map<string, RefTarget>;
  basedOn: { entryIds: string[]; items: string[] };
  tasks: TaskDef[];
}

const tEn = { t: (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate('en', k, v) };

/** Only what the model may answer (limits.ts): checklist items about what a person did are left to the trainee. */
const askable = (def: TaskDef, checks: readonly { id: string; label: { en: string } }[]) =>
  checks.filter((c) => modelMayAnswer(def.id, c.id)).map((c) => ({ id: c.id, label: c.label.en }));

function scoped(def: TaskDef, sec: ScopedSection | undefined) {
  if (!sec) return undefined;
  const checks = askable(def, sec.checks);
  if (!checks.length) return undefined;
  return { ...(sec.applies ? { appliesQuestion: sec.applies.en } : {}), checks };
}

/** The registers and fields of a task the model may draft rows for, with the values it may use. */
export function draftableRegisters(def: TaskDef) {
  return (def.registers ?? []).filter(modelMayAddTo).map((r) => ({
    register: r,
    title: REGISTERS[r].title.en,
    fields: REGISTERS[r].fields
      .filter((f) => f.kind !== 'confirm' && fieldLimit(r, f.id) !== 'never')
      .map((f) => {
        const limit = fieldLimit(r, f.id);
        const allowed = f.options?.map((o) => o.value).filter((v) => !Array.isArray(limit) || limit.includes(v));
        const format = f.kind === 'links' ? { format: 'references to timeline entries and calculation results (E#, C#), comma-separated' } : f.kind === 'multi' ? { format: 'allowed values joined with |' } : {};
        return { id: f.id, label: f.label.en, kind: f.kind, ...(f.required ? { required: true } : {}), ...(allowed ? { allowed } : {}), ...format };
      }),
  }));
}

function taskSpec(def: TaskDef, rec: TaskRecord | undefined) {
  const perMedication = scoped(def, def.perMedication);
  const perProblem = scoped(def, def.perProblem);
  return {
    taskId: def.id,
    number: def.number,
    title: def.title.en,
    purpose: def.purpose.en,
    checks: askable(def, def.case?.checks ?? []),
    ...(perMedication ? { perMedication } : {}),
    ...(perProblem ? { perProblem } : {}),
    registers: draftableRegisters(def),
    traineeAnswersSoFar: rec ? { status: rec.status, checks: rec.checks } : { status: 'not_started' },
  };
}

export function buildCasePayload(input: {
  case: Case;
  entries: readonly TimelineEntry[];
  items: readonly RegisterItem[];
  tasks: readonly TaskRecord[];
  module: ModuleDef;
  today: string;
  /** M4: calculation results, and which are current; only current results are sent (C1, C2 …). */
  calcResults?: readonly CalcResult[];
  calcOutOfDate?: ReadonlySet<string>;
}): CasePayload {
  const c = input.case;
  const refs = new Map<string, RefTarget>();
  const idx = indexTimeline(input.entries);
  const current = idx.current;
  const courses = deriveMedCourses(current);
  const problems = deriveProblems(current);
  const medRef = new Map<string, string>();
  const probRef = new Map<string, string>();
  const entryRef = new Map<string, string>();

  const meds = courses.map((m, i) => {
    const ref = `M${i + 1}`;
    medRef.set(m.medId, ref);
    const text = `${m.drug} ${regimenText(m)} from Day ${m.startDay}${m.stopDay !== undefined ? ` to Day ${m.stopDay}` : ''} ${m.status}${m.indication ? ` for ${m.indication}` : ''}`;
    const last = [m.start, ...m.changes, ...(m.stop ? [m.stop] : [])].sort(compareEntries).at(-1)!;
    refs.set(ref, { kind: 'medication', id: m.medId, label: m.drug, text, entryId: last.id });
    return { ref, drug: m.drug, regimen: regimenText(m), startDay: m.startDay, ...(m.stopDay !== undefined ? { stopDay: m.stopDay } : {}), status: m.status, ...(m.indication ? { indication: m.indication } : {}) };
  });
  const probs = problems.map((p, i) => {
    const ref = `P${i + 1}`;
    probRef.set(p.problemId, ref);
    const pl = p.latest.payload;
    refs.set(ref, { kind: 'problem', id: p.problemId, label: pl.name, text: `${pl.name} ${pl.acuity} ${pl.status}`, entryId: p.latest.id });
    return { ref, name: pl.name, acuity: pl.acuity, status: pl.status, primary: pl.primaryDiagnosis };
  });

  const timeline = current
    .filter((e) => !e.type.startsWith('med_') && !(e.type === 'note' && e.payload.category === 'problem'))
    .map((e, i) => {
      const ref = `E${i + 1}`;
      entryRef.set(e.id, ref);
      const tx = entryText(e, tEn);
      const text = [tx.main, ...tx.details].join('; ');
      refs.set(ref, { kind: 'entry', id: e.id, label: tx.main, text: `Day ${e.hospitalDay} ${e.timeOfDay ?? ''} ${text}` });
      return { ref, day: e.hospitalDay, ...(e.timeOfDay ? { time: e.timeOfDay } : {}), type: e.type, text };
    });

  // M4: the current calculation results, each with its formula's result, unit and day (a dose may come only from one of these).
  const calcRef = new Map<string, string>();
  const calculations = (input.calcResults ?? [])
    .filter((r) => !input.calcOutOfDate?.has(r.id))
    .map((r, i) => {
      const ref = `C${i + 1}`;
      calcRef.set(r.id, ref);
      const name = CALC_BY_ID.get(r.calc)?.name ?? r.calc;
      const secondary = (r.secondary ?? []).map((x) => `${x.label.en}: ${show(x.value, x.unit, x.decimals)}`).join('; ');
      const text = `${name}: ${show(r.value, r.unit, r.decimals)}${r.category ? ` (${r.category.label.en})` : ''}${secondary ? `; ${secondary}` : ''}${r.day !== undefined ? ` — Day ${r.day}` : ''}`;
      refs.set(ref, { kind: 'calc', id: r.id, label: name, text });
      return { ref, text };
    });

  /** Links and claims of a Problem Card, with the references of this payload in place of internal ids. */
  const ref = (l: { kind: 'entry' | 'calc'; id: string }) => (l.kind === 'entry' ? entryRef.get(l.id) : calcRef.get(l.id));
  const cardValue = (kind: 'links' | 'claims', v: string): string => {
    if (kind === 'links') return parseLinks(v).flatMap((l) => ref(l) ?? []).join(', ');
    const SOURCE = { entry: 'case data', calc: 'a calculation', dataset: 'the offline interaction check', reading: 'a source the trainee read', none: 'general knowledge' } as const;
    return parseClaims(v)
      .map((c) => {
        const r = (c.source === 'entry' || c.source === 'calc') && c.ref ? ref({ kind: c.source, id: c.ref }) : undefined;
        return `${c.text} [${r ?? SOURCE[c.source]}]`;
      })
      .join(' | ');
  };

  const rows = input.items
    .filter((r) => r.status === 'active')
    .map((r, i) => {
      const ref = `R${i + 1}`;
      const def = REGISTERS[r.register];
      const fields: Record<string, string> = {};
      for (const f of def.fields) {
        const v = r.fields[f.id];
        if (v === undefined || f.kind === 'confirm') continue;
        // References inside rows are given as the references of this payload, never as internal ids.
        fields[f.id] =
          f.kind === 'medRef'
            ? medRef.get(v) ?? ''
            : f.kind === 'problemRef'
              ? probRef.get(v) ?? ''
              : f.kind === 'entryRef'
                ? entryRef.get(v) ?? ''
                : f.kind === 'links' || f.kind === 'claims'
                  ? cardValue(f.kind, v)
                  : v;
      }
      refs.set(ref, { kind: 'item', id: r.id, label: `${def.title.en}: ${r.fields[def.titleField] ?? ''}`, text: Object.values(fields).join(' ') });
      return { ref, register: r.register, fields };
    });

  const tasks = input.module.tasks.filter((id) => !UNDRAFTED_TASKS.has(id)).map((id) => TASKS.get(id)!).filter(Boolean);
  const byTask = new Map(input.tasks.map((t) => [t.taskId, t]));
  const age = c.demographics.ageYears >= 90 ? '90 or older' : c.demographics.ageYears;
  const payload = {
    case: {
      kind: c.kind,
      age,
      sex: c.demographics.sex,
      ...(c.demographics.heightCm ? { heightCm: c.demographics.heightCm } : {}),
      status: c.status,
      hospitalDayToday: c.status === 'active' ? hospitalDayOf(c.admissionDay0, input.today) : null,
    },
    timeline,
    medications: meds,
    problems: probs,
    calculations,
    registerRows: rows,
    module: { id: input.module.id, title: input.module.title.en },
    tasks: tasks.map((d) => taskSpec(d, byTask.get(d.id))),
  };
  return {
    text: JSON.stringify(payload),
    context: JSON.stringify(payload.case),
    refs,
    basedOn: { entryIds: current.map((e) => e.id).sort(), items: input.items.filter((r) => r.status === 'active').map((r) => `${r.id}@${r.version}`).sort() },
    tasks,
  };
}

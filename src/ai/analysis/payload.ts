/**
 * The case as sent for analysis: de-identified by construction (Section 18).
 * It is built from the confirmed record only — case kind, age (a band over
 * 89), sex, height, hospital days, the current timeline, medication courses,
 * problems and register rows — never from identifiers, which live in a
 * separate group this module does not read. Every item gets a short
 * reference (E1, M1, P1, R1) so the model can say what each statement rests
 * on, and the code can check that it exists.
 */
import { hospitalDayOf } from '../../domain/dates';
import { REGISTERS } from '../../domain/workflow/registers';
import { TASKS, type ModuleDef, type ScopedSection, type TaskDef } from '../../domain/workflow/catalogue';
import { deriveMedCourses, deriveProblems, indexTimeline, regimenText } from '../../domain/timeline';
import type { Case, RegisterItem, TaskRecord, TimelineEntry } from '../../domain/types';
import { translate } from '../../i18n/i18n';
import { entryText } from '../../ui/format';

export interface RefTarget {
  kind: 'entry' | 'item' | 'medication' | 'problem';
  id: string;
  label: string;
  /** All the text sent for this reference; the numbers in it are the ones a statement citing it may use. */
  text: string;
}

export interface CasePayload {
  /** The JSON text sent to the model. */
  text: string;
  refs: Map<string, RefTarget>;
  basedOn: { entryIds: string[]; items: string[] };
  tasks: TaskDef[];
}

const tEn = { t: (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate('en', k, v) };

function scoped(sec: ScopedSection | undefined) {
  if (!sec) return undefined;
  return {
    ...(sec.applies ? { appliesQuestion: sec.applies.en } : {}),
    checks: sec.checks.map((c) => ({ id: c.id, label: c.label.en })),
  };
}

function taskSpec(def: TaskDef, rec: TaskRecord | undefined) {
  return {
    taskId: def.id,
    number: def.number,
    title: def.title.en,
    purpose: def.purpose.en,
    checks: (def.case?.checks ?? []).map((c) => ({ id: c.id, label: c.label.en })),
    ...(def.perMedication ? { perMedication: scoped(def.perMedication) } : {}),
    ...(def.perProblem ? { perProblem: scoped(def.perProblem) } : {}),
    registers: (def.registers ?? []).map((r) => ({
      register: r,
      title: REGISTERS[r].title.en,
      fields: REGISTERS[r].fields
        .filter((f) => f.kind !== 'confirm')
        .map((f) => ({ id: f.id, label: f.label.en, kind: f.kind, ...(f.required ? { required: true } : {}), ...(f.options ? { allowed: f.options.map((o) => o.value) } : {}) })),
    })),
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
    refs.set(ref, { kind: 'medication', id: m.medId, label: m.drug, text });
    return { ref, drug: m.drug, regimen: regimenText(m), startDay: m.startDay, ...(m.stopDay !== undefined ? { stopDay: m.stopDay } : {}), status: m.status, ...(m.indication ? { indication: m.indication } : {}) };
  });
  const probs = problems.map((p, i) => {
    const ref = `P${i + 1}`;
    probRef.set(p.problemId, ref);
    const pl = p.latest.payload;
    refs.set(ref, { kind: 'problem', id: p.problemId, label: pl.name, text: `${pl.name} ${pl.acuity} ${pl.status}` });
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
        fields[f.id] = f.kind === 'medRef' ? medRef.get(v) ?? '' : f.kind === 'problemRef' ? probRef.get(v) ?? '' : f.kind === 'entryRef' ? entryRef.get(v) ?? '' : v;
      }
      refs.set(ref, { kind: 'item', id: r.id, label: `${def.title.en}: ${r.fields[def.titleField] ?? ''}`, text: Object.values(fields).join(' ') });
      return { ref, register: r.register, fields };
    });

  const tasks = input.module.tasks.map((id) => TASKS.get(id)!).filter(Boolean);
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
    registerRows: rows,
    module: { id: input.module.id, title: input.module.title.en },
    tasks: tasks.map((d) => taskSpec(d, byTask.get(d.id))),
  };
  return {
    text: JSON.stringify(payload),
    refs,
    basedOn: { entryIds: current.map((e) => e.id).sort(), items: input.items.filter((r) => r.status === 'active').map((r) => `${r.id}@${r.version}`).sort() },
    tasks,
  };
}

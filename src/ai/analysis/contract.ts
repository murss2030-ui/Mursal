/**
 * The analysis contract (Section 12, as amended by the owner on 16 October
 * 2026, decision D3): the model drafts, for one module, a first pass at each
 * task — checklist answers, register rows, missing data and questions — and
 * says for every statement whether it rests on the case data (with
 * references) or on general knowledge (shown as "no source — unverified").
 * It never gives a number that is not in the case data, and never cites.
 */
import type { TaskDef } from '../../domain/workflow/catalogue';
import { S, type OutputSchema } from '../schema';

export const ANALYSE_PROMPT_VERSION = 'analyse-v1';

export interface RawSuggestionBase {
  reason: string;
  basis: 'case_data' | 'general_knowledge';
  refs: string[];
}
export interface RawCheck extends RawSuggestionBase {
  checkId: string;
  scopeRef: string | null;
  answer: 'ok' | 'issue' | 'na';
}
export interface RawItem extends RawSuggestionBase {
  register: string;
  fields: { field: string; value: string }[];
}
export interface RawTaskDraft {
  taskId: string;
  summary: string;
  checks: RawCheck[];
  items: RawItem[];
  missingData: string[];
  questions: string[];
}
export interface RawAnalysis {
  tasks: RawTaskDraft[];
}

const BASE = {
  reason: S.str('Why, in one or two sentences'),
  basis: S.enumOf(['case_data', 'general_knowledge'], 'case_data only when the statement follows from the referenced data'),
  refs: S.arr(S.str(), 12, 'References such as E1, M2, P1, R3'),
};

export function analysisSchema(tasks: readonly TaskDef[]): OutputSchema {
  const taskIds = tasks.map((t) => t.id);
  const checkIds = [...new Set(tasks.flatMap((t) => [...(t.case?.checks ?? []), ...(t.perMedication?.checks ?? []), ...(t.perProblem?.checks ?? [])].map((c) => c.id)))];
  const registers = [...new Set(tasks.flatMap((t) => t.registers ?? []))];
  return S.obj({
    tasks: S.arr(
      S.obj({
        taskId: S.enumOf(taskIds),
        summary: S.str('What the data shows for this task, at most four sentences'),
        checks: S.arr(S.obj({ checkId: checkIds.length ? S.enumOf(checkIds) : S.str(), scopeRef: S.strOrNull('M# or P# for a per-medication or per-problem check'), answer: S.enumOf(['ok', 'issue', 'na']), ...BASE }), 40),
        items: S.arr(
          S.obj({ register: registers.length ? S.enumOf(registers) : S.str(), fields: S.arr(S.obj({ field: S.str(), value: S.str() }), 30), ...BASE }),
          15,
        ),
        missingData: S.arr(S.str(), 15),
        questions: S.arr(S.str(), 10),
      }),
      tasks.length,
    ),
  });
}

export const ANALYSE_SYSTEM = `You prepare, for a supervised clinical pharmacy trainee, a first draft of the tasks of one module of their case workup. It is an educational exercise: the trainee checks and decides every item; you never decide, and nothing you write is used until the trainee accepts it.

Rules:
1. Base statements on the case data provided and list in refs the references (E1, M2, P1, R3 …) each one rests on. Use basis "case_data" only when the statement follows from those references.
2. You may add general clinical knowledge when it helps; then set basis to "general_knowledge" — it will be shown as "no source — unverified".
3. Never state a dose, concentration, rate, interval, duration, threshold or score that is not already in the case data. Write "dose to be calculated" instead. Numbers that are not found in the case data are removed automatically.
4. Never cite: no guideline names with years, study titles, authors, years, DOIs, URLs, PMIDs or grades of recommendation.
5. Do not invent data. When something needed is missing, put it in missingData. Put the questions the trainee should ask the team or the patient in questions.
6. Checklist answers: "ok" only when the data shows the check is satisfied, "issue" when the data shows a problem, "na" only when it clearly does not apply. Leave out a check you cannot answer from the data. For per-medication or per-problem checks give scopeRef (M# or P#).
7. Register rows only for the registers listed for that task, with only the listed field ids and allowed values.
8. Be concise. Write in English. There are no names or identifiers in the data; never invent any.
Return JSON only.`;

export function analyseHeader(moduleId: string, taskIds: readonly string[]): string {
  return [`TASK: analyse`, `PROMPT: ${ANALYSE_PROMPT_VERSION}`, `MODULE: ${moduleId}`, `TASKS: ${taskIds.join(', ')}`, 'CASE DATA (JSON) below.'].join('\n');
}

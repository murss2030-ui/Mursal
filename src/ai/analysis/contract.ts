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
import { modelMayAddTo, modelMayAnswer } from './limits';

/** v4 (M5, after the live probe of 20 October 2026): data, not process; no references in the text; a claim may cite several values; one card per problem; PCNE coherence; time words. */
export const ANALYSE_PROMPT_VERSION = 'analyse-v4';

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
/** M4: one statement a Problem Card rests on, with what it rests on. */
export interface RawClaim {
  text: string;
  basis: 'case_data' | 'general_knowledge';
  refs: string[];
}
export interface RawItem extends RawSuggestionBase {
  register: string;
  fields: { field: string; value: string }[];
  /** Problem Cards (register drp) only. */
  claims?: RawClaim[];
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

const BASE_CLAIM = {
  basis: BASE.basis,
  refs: S.arr(S.str(), 8, 'References such as E1, C1, M2, P1 — every value the statement uses (a change cites both values)'),
};

export function analysisSchema(tasks: readonly TaskDef[]): OutputSchema {
  const taskIds = tasks.map((t) => t.id);
  const checkIds = [
    ...new Set(
      tasks.flatMap((t) =>
        [...(t.case?.checks ?? []), ...(t.perMedication?.checks ?? []), ...(t.perProblem?.checks ?? [])].filter((c) => modelMayAnswer(t.id, c.id)).map((c) => c.id),
      ),
    ),
  ];
  const registers = [...new Set(tasks.flatMap((t) => (t.registers ?? []).filter(modelMayAddTo)))];
  return S.obj({
    tasks: S.arr(
      S.obj({
        taskId: S.enumOf(taskIds),
        summary: S.str('What the data shows for this task, at most four sentences'),
        checks: S.arr(S.obj({ checkId: checkIds.length ? S.enumOf(checkIds) : S.str(), scopeRef: S.strOrNull('M# or P# for a per-medication or per-problem check'), answer: S.enumOf(['ok', 'issue', 'na']), ...BASE }), 40),
        items: S.arr(
          S.obj(
            {
              register: registers.length ? S.enumOf(registers) : S.str(),
              fields: S.arr(S.obj({ field: S.str(), value: S.str() }), 40),
              ...BASE,
              claims: S.arr(S.obj({ text: S.str('One statement the card rests on'), ...BASE_CLAIM }), 10, 'Problem Cards (register drp) only'),
            },
            ['register', 'fields', 'reason', 'basis', 'refs'],
          ),
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
1. Base statements on the case data provided and list in refs the references (E1, M2, P1, R3, C1 …) each one rests on — every value it uses. Use basis "case_data" only when the statement follows from those references. Write references only in refs, never inside a text ("amlodipine (R2)" is wrong).
2. State the data itself, never what was done with it: "Creatinine 2.1 mg/dL on Day 2, up from 1.0 mg/dL on Day 0", not "renal function was assessed" or "medications were reconciled".
3. Each of these is a claim of its own and needs a reference that states it, or basis "general_knowledge": a property of a drug (nephrotoxic, renally cleared, interacts with …), a reason or purpose ("for the management of", "due to"), an absence ("not ordered", "not documented"), a judgement ("requires", "significant"). Give each value with its hospital day; write "currently", "still" or "now" only for a value recorded on today's hospital day (hospitalDayToday). A change ("rose", "fell", "improved") cites both values.
4. You may add general clinical knowledge when it helps; then set basis to "general_knowledge" — it will be shown as "no source — unverified".
5. Never state a dose, concentration, rate, interval, duration, threshold or score that is not already in the case data. Write "dose to be calculated" instead. Numbers that are not found in the case data are removed automatically.
6. Never cite: no guideline names with years, study titles, authors, years, DOIs, URLs, PMIDs or grades of recommendation.
7. Do not invent data. When something needed is missing, put it in missingData. Put the questions the trainee should ask the team or the patient in questions.
8. Checklist answers: "ok" only when the data shows the check is satisfied, "issue" when the data shows a problem, "na" only when it clearly does not apply. Leave out a check you cannot answer from the data. For per-medication or per-problem checks give scopeRef (M# or P#). The reason gives the data that answers the check.
9. Register rows only for the registers listed for that task, with only the listed field ids and allowed values.
10. Never state that something was done or happened unless the data says so: interviews, counselling, communication with the team, discussions, double-checks, reports, implementation and outcomes are recorded by the trainee alone. A recommendation you propose is a proposal, never an implemented one.
11. Be concise. Write in English. There are no names or identifiers in the data; never invent any.
12. Drug-related problems (register drp) are Problem Cards — one card per problem. Do not draft a card for a problem that already has one in registerRows or cardsAwaitingDecision, and never two cards for one problem. Classify each with PCNE V9.1 using only the allowed codes: pcneProblem (the problem), pcneType (potential or manifest) and pcneCauses (every cause that applies, joined with "|"; C9.3 only if there is no obvious cause, never with another cause) — the problem and its cause are separate. Keep the codes consistent with the problem sentence: P1 is the effect of treatment or its lack, P2.1 an adverse drug event (harm, toxicity); C3.1 means the dose is too low and C3.2 too high, so a card about toxicity is never C3.1; "potential" means it may happen and "manifest" that it has happened, so a sentence beginning "Risk of" or "Potential" is potential. Put in "supporting" the references of the values it rests on (E#, C#), comma-separated. List in "claims" each statement the card rests on, with its basis and every reference it uses. Propose the priority with its reason, and urgency, significance and impact (high, medium or low). Write "teaching" as the clinical question this problem teaches the trainee to ask (general knowledge). A dose may appear only if it is in a calculation result (C#) you cite. Never propose a review decision, communication, implementation or outcome.
Return JSON only.`;

export function analyseHeader(moduleId: string, taskIds: readonly string[]): string {
  return [`TASK: analyse`, `PROMPT: ${ANALYSE_PROMPT_VERSION}`, `MODULE: ${moduleId}`, `TASKS: ${taskIds.join(', ')}`, 'CASE DATA (JSON) below.'].join('\n');
}

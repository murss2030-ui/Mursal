/**
 * The research contract (Section 12 as applied to retrieval, plan M5d). The
 * model is given a clinical question, the minimum case context, and the
 * passages the app retrieved — each with an id. It drafts statements *only
 * from those passages*: each statement cites exactly one passage and quotes
 * it word for word. It never names a guideline, an author, a year, a DOI, a
 * URL or a grade (the app renders every citation from the source's record),
 * and when the passages do not answer the question it says so and stops.
 */
import { S, type OutputSchema } from '../schema';
import { RESEARCH_ROLES, type Pico, type ResearchRole, type SentPassage } from '../../domain/research';

export const RESEARCH_PROMPT_VERSION = 'research-v1';

export const MAX_STATEMENTS = 12;
export const MAX_QUOTE = 600;
export const MIN_QUOTE = 12;

export interface RawResearchStatement {
  role: ResearchRole;
  text: string;
  sourceId: string;
  quote: string;
  caseRefs: string[];
}

export interface RawResearch {
  answerable: boolean;
  statements: RawResearchStatement[];
  missingData: string[];
}

export type SentSource = SentPassage;

/** Case data the model may point to when a statement concerns the patient's values: C# for a calculation, E# for an entry. */
export interface CaseValue {
  label: string;
  kind: 'entry' | 'calc';
  id: string;
  text: string;
}

export function researchSchema(sources: readonly SentSource[], values: readonly CaseValue[]): OutputSchema {
  return S.obj({
    answerable: S.bool('false when the passages do not answer the question'),
    statements: S.arr(
      S.obj({
        role: S.enumOf(RESEARCH_ROLES, 'recommendation: what the passages say to do; supporting: what supports it; conflicting: a passage that says otherwise or limits it'),
        text: S.str('One statement, in plain words, that the quote shows'),
        sourceId: sources.length ? S.enumOf(sources.map((s) => s.id)) : S.str(),
        quote: S.str('Exact words copied from that passage, character for character'),
        caseRefs: S.arr(values.length ? S.enumOf(values.map((v) => v.label)) : S.str(), 6, 'Case values (C#, E#) the statement is about, if any'),
      }),
      MAX_STATEMENTS,
    ),
    missingData: S.arr(S.str('Patient data the passages need and the case does not give'), 10),
  });
}

export const RESEARCH_SYSTEM = `You help a supervised clinical pharmacy trainee find what retrieved sources say about one clinical question. It is an educational exercise: you draft, the trainee reads the sources and decides; nothing you write is used until they accept it.

Rules:
1. Use only the passages in SOURCES. Never use your own knowledge, even when you are sure of it. If the passages do not answer the question, set answerable to false, return no statements, and say in missingData what the passages lack.
2. Every statement cites exactly one passage by its id (sourceId) and gives a quote: exact words copied from that passage, character for character, the shortest span that shows the statement. A statement the quote does not show must not be written.
3. Roles: "recommendation" is what the passages say to do for this question (state it as the passage states it, with the passage's conditions: population, thresholds, exceptions); "supporting" is another passage or part that supports it; "conflicting" is a passage that says otherwise, adds a condition, or limits it. Write conflicts down; never hide them.
4. A passage from a study is evidence to appraise, not guidance: say what the study found, never that it recommends. A drug label states the manufacturer's labelling.
5. Never write a dose, concentration, rate, interval, duration, threshold or score that is not in the quote of that statement. Never convert, round or combine numbers across passages.
6. Never write a guideline name, an author, a journal, a year, a DOI, a URL, a PMID or a grade of recommendation or of evidence in a statement: the app shows the citation from its record.
7. Do not state patient values. The case context tells you which population the question concerns; point to it in caseRefs only when a statement is about one of those values. If a passage's recommendation depends on data the case lacks (for example creatinine clearance), put it in missingData.
8. Never state that something was done, discussed or decided. Be concise. Write in English.
Return JSON only.`;

export function researchHeader(count: number): string {
  return [`TASK: research`, `PROMPT: ${RESEARCH_PROMPT_VERSION}`, `SOURCES: ${count}`, 'QUESTION, CASE CONTEXT AND SOURCES (JSON) below.'].join('\n');
}

export function researchRequestText(input: { question: string; pico: Pico; context: string; values: readonly CaseValue[]; sources: readonly SentSource[] }): string {
  return JSON.stringify({
    question: input.question,
    pico: input.pico,
    caseContext: input.context,
    caseValues: input.values.map((v) => ({ ref: v.label, text: v.text })),
    sources: input.sources.map((s) => ({ id: s.id, kind: s.describe, text: s.text })),
  });
}

/**
 * The learning modes and the portfolio (plan M8: "Teach Me, Assessment Mode,
 * Argue With Me, competency tagging and the portfolio").
 *
 * All three modes are built from the trainee's own record and the app's
 * tested knowledge, with no model: nothing here can invent a dose, a citation
 * or a fact. *Teach me* explains what a card's PCNE codes mean and what to
 * read; *Assessment mode* asks the trainee to reproduce the app's validated
 * calculations from the case's own values and marks the answer against the
 * calculator; *Argue with me* puts to the trainee the questions a preceptor
 * would, drawn from the card's own gaps, the safety alerts the app raised and
 * the kind of problem it is — the trainee's answers are kept as the trainee's
 * own words. What the trainee did is kept append-only and tagged with
 * competency areas; the portfolio gathers it, with the rest of the record, as
 * evidence to discuss with the preceptor — counts, never grades.
 */
import type { CalcResult } from '../calc/types';
import { parseDecimal } from './numbers';
import { cardPcne } from './problem-card';
import type { CompetencyArea, RegisterItem, TaskRecord } from './types';
import { L, type L as Label } from './label';

export const LEARNING_MODES = ['teach', 'assess', 'argue'] as const;
export type LearningMode = (typeof LEARNING_MODES)[number];

/** Competency areas each mode practises (the trainee can see and keep these tags). */
export const MODE_COMPETENCIES: Readonly<Record<LearningMode, readonly CompetencyArea[]>> = {
  teach: ['continuing_development', 'pharmacotherapy_knowledge'],
  assess: ['pharmacotherapy_knowledge'],
  argue: ['pharmacotherapy_knowledge', 'communication'],
};

export interface LearningRecord {
  id: string;
  caseId: string;
  itemId?: string;
  mode: LearningMode;
  competencies: CompetencyArea[];
  /** What was asked (assessment: the question; argue: the challenge; teach: the card studied). */
  prompt: string;
  /** The trainee's own words, or the number they entered. */
  answer?: string;
  /** Assessment only. */
  score?: { correct: boolean; expected: string };
  at: string;
}

// ---------------------------------------------------------------- assessment mode

export interface AssessQuestion {
  /** The calculation result it is about. */
  resultId: string;
  text: string;
  unit: string;
  expected: number;
  decimals: number;
  /** Shown after the answer: the calculator's formula and steps. */
  feedback: string[];
}

/** One question per current calculation result: reproduce the app's validated result from the case's own inputs. */
export function assessmentQuestions(results: readonly CalcResult[], outOfDate: ReadonlySet<string>, name: (r: CalcResult) => string, inputs: (r: CalcResult) => string, formula: (r: CalcResult) => string | undefined): AssessQuestion[] {
  return results
    .filter((r) => !outOfDate.has(r.id) && Number.isFinite(r.value) && Object.keys(r.inputs.detail).length > 0)
    .map((r) => ({
      resultId: r.id,
      text: `Using the values recorded for this patient — ${inputs(r)} — what is the ${name(r)}?`,
      unit: r.unit,
      expected: Number(r.value.toFixed(r.decimals)),
      decimals: r.decimals,
      feedback: [...(formula(r) ? [`Formula: ${formula(r)}`] : []), ...r.steps],
    }));
}

/** Marks an answer against the calculator's result: within 5 % or one unit of the last place the calculator shows. */
export function markAnswer(q: Pick<AssessQuestion, 'expected' | 'decimals'>, raw: string): { ok: boolean; correct: boolean; entered?: number } {
  const p = parseDecimal(raw);
  if (!p.ok) return { ok: false, correct: false };
  const tol = Math.max(Math.abs(q.expected) * 0.05, 10 ** -q.decimals);
  return { ok: true, correct: Math.abs(p.value - q.expected) <= tol, entered: p.value };
}

// ---------------------------------------------------------------- argue with me

export interface Challenge {
  id: string;
  text: string;
  /** Where it comes from: the card's own gap, an alert the app raised, the kind of problem, or always. */
  from: 'gap' | 'alert' | 'cause' | 'always';
}

const CAUSE_PROMPTS: Readonly<Record<string, string>> = {
  C1: 'You classified this as a drug-selection problem. What is the best alternative, why is it better for this patient, and what would make you keep the current drug?',
  C2: 'The cause is the drug form. What form would you choose, and what in this patient makes it matter?',
  C3: 'The cause is the dose. Show how you reached the dose you recommend, which of this patient’s values it depends on, and what monitoring tells you it is right — and when.',
  C4: 'The cause is the duration. What stops the treatment, and what would you check before stopping it?',
  C5: 'The cause is in dispensing. What exactly went wrong, and how would you stop it recurring?',
  C6: 'The cause is in how the drug is used or given. Who needs to change what, and how would you check it was done?',
  C7: 'The cause is patient-related. What did you ask the patient, and what would you do if they cannot or will not change?',
  C8: 'The cause is at a transfer of care. What was lost, and what does the next team need to be told?',
  C9: 'You found no obvious cause. What would you look at next, and what would change your mind?',
};

export function challengesFor(card: Readonly<Record<string, string>>, alerts: readonly { key: string; title: string }[], missing: readonly string[]): Challenge[] {
  const out: Challenge[] = [];
  for (const [i, m] of missing.entries()) out.push({ id: `gap:${i}`, from: 'gap', text: `Your card says this is missing: “${m}”. If you had it, what would change in your recommendation? If it comes back the other way, what do you recommend instead?` });
  for (const a of alerts.slice(0, 4)) out.push({ id: `alert:${a.key}`, from: 'alert', text: `The app raised: “${a.title}”. How does your recommendation take it into account?` });
  const groups = [...new Set(cardPcne(card).causes.map((c) => c.code.split('.')[0]!))];
  for (const g of groups) if (CAUSE_PROMPTS[g]) out.push({ id: `cause:${g}`, from: 'cause', text: CAUSE_PROMPTS[g]! });
  out.push(
    { id: 'always:against', from: 'always', text: 'Give the strongest argument against your own recommendation, and answer it.' },
    { id: 'always:declined', from: 'always', text: 'The team declines. What is your fallback, and what would you monitor to keep the patient safe?' },
  );
  return out;
}

// ---------------------------------------------------------------- teach me

export interface TeachSection {
  title: Label;
  items: Label[];
}

/** What the card's classification means and what to read, from PCNE's own wording. No model text. */
export function teachSections(card: Readonly<Record<string, string>>): TeachSection[] {
  const p = cardPcne(card);
  const out: TeachSection[] = [];
  if (p.problem) out.push({ title: L('The problem, in PCNE V9.1', 'المشكلة وفق PCNE V9.1'), items: [L(`${p.problem.code} ${p.problem.label.en}${p.type ? ` — ${p.type}` : ''}`, `${p.problem.code} ${p.problem.label.ar}${p.type ? ` — ${p.type === 'potential' ? 'محتملة' : 'قائمة'}` : ''}`)] });
  if (p.causes.length) out.push({ title: L('Its causes', 'أسبابها'), items: p.causes.map((c) => L(`${c.code} ${c.label.en}`, `${c.code} ${c.label.ar}`)) });
  if (card.teaching?.trim()) out.push({ title: L('The question this problem teaches you to ask (general knowledge, labelled as such)', 'السؤال الذي تعلّمك هذه المشكلة طرحه (معرفة عامة، موسومة)'), items: [L(card.teaching.trim(), card.teaching.trim())] });
  return out;
}

// ---------------------------------------------------------------- the portfolio

export interface PortfolioEntry {
  kind: 'card' | 'reflection' | 'assessment' | 'argue' | 'teach' | 'counselling' | 'round' | 'monitoring' | 'reconciliation' | 'preceptor' | 'research_idea' | 'teaching_delivered';
  caseId: string;
  text: string;
  detail?: string;
}

export interface PortfolioCase {
  caseId: string;
  rotationId: string;
  items: readonly RegisterItem[];
  tasks: readonly TaskRecord[];
  learning: readonly LearningRecord[];
}

export type Portfolio = Record<CompetencyArea, PortfolioEntry[]>;

const split = (v: string | undefined) => (v ?? '').split('|').filter(Boolean);

export function buildPortfolio(cases: readonly PortfolioCase[]): Portfolio {
  const p: Portfolio = { direct_patient_care: [], pharmacotherapy_knowledge: [], systems_based_care: [], communication: [], professionalism: [], continuing_development: [] };
  for (const c of cases) {
    const active = c.items.filter((i) => i.status === 'active');
    for (const i of active.filter((x) => x.register === 'drp')) {
      const f = i.fields;
      p.direct_patient_care.push({ kind: 'card', caseId: c.caseId, text: f.problem ?? '', detail: `${f.implemented === 'yes' ? 'implemented' : 'proposed'}${f.goalMet && f.goalMet !== 'not_measured' ? `; outcome: ${f.goalMet}` : '; outcome not measured'}` });
      if (f.response && f.response !== 'not_communicated') p.communication.push({ kind: 'card', caseId: c.caseId, text: f.problem ?? '', detail: `team response: ${f.response}` });
      if (f.preceptorReviewed === 'yes') p.professionalism.push({ kind: 'preceptor', caseId: c.caseId, text: f.problem ?? '', detail: 'discussed with my preceptor' });
    }
    for (const i of active.filter((x) => x.register === 'counseling')) p.communication.push({ kind: 'counselling', caseId: c.caseId, text: i.fields.meds ?? 'Counselling session' });
    for (const i of active.filter((x) => x.register === 'rounds')) p.systems_based_care.push({ kind: 'round', caseId: c.caseId, text: i.fields.points ?? 'Round', detail: i.fields.roundType });
    for (const i of active.filter((x) => x.register === 'monitoring')) p.systems_based_care.push({ kind: 'monitoring', caseId: c.caseId, text: i.fields.parameter ?? '' });
    for (const i of active.filter((x) => x.register === 'home_med' && x.fields.admissionStatus && x.fields.admissionStatus !== 'not_reviewed')) p.systems_based_care.push({ kind: 'reconciliation', caseId: c.caseId, text: i.fields.drug ?? '' });
    const t25 = c.tasks.find((t) => t.taskId === 't25');
    if (t25) {
      const f = t25.fields;
      const tagged = split(f.competencies) as CompetencyArea[];
      const text = [f.learning, f.differently].filter((x) => x?.trim()).join(' — ');
      if (text) for (const a of tagged.length ? tagged : (['continuing_development'] as CompetencyArea[])) p[a]?.push({ kind: 'reflection', caseId: c.caseId, text });
      if (f.research?.trim()) p.continuing_development.push({ kind: 'research_idea', caseId: c.caseId, text: f.research.trim() });
      if (f.teaching?.trim()) p.communication.push({ kind: 'teaching_delivered', caseId: c.caseId, text: f.teaching.trim() });
    }
    for (const r of c.learning) {
      const detail = r.mode === 'assess' && r.score ? (r.score.correct ? 'answered correctly' : `answered, expected ${r.score.expected}`) : r.mode === 'argue' && r.answer ? `my answer: ${r.answer.slice(0, 400)}` : undefined;
      for (const a of r.competencies) p[a]?.push({ kind: r.mode === 'assess' ? 'assessment' : r.mode, caseId: c.caseId, text: r.prompt.slice(0, 160), ...(detail ? { detail } : {}) });
    }
  }
  return p;
}

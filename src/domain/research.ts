/**
 * "Research this question" (Section 11, plan M5d). From a Problem Card the app
 * builds the clinical question in PICO form for the trainee to edit, retrieves
 * evidence (the trainee's library first, then the open sources), and has the
 * model draft *only from the retrieved passages*. A ResearchRun is the
 * AnalysisVersion of Section 7 for a question: versioned, never overwritten,
 * and stale like a card when the data it rests on changes.
 *
 * Nothing in a run is a citation the model wrote: every statement points at
 * one retrieved source and quotes it word for word, and the app renders the
 * citation from that source's record. The limits of confidence are computed
 * here in code from what was retrieved and checked, not asserted by a model.
 */
import { L } from './label';
import { namedDrugs } from './pcne-coherence';
import { cardStaleness, contentHash, type CardContext } from './problem-card';
import type { SourceRecord } from './sources';
import { isLiterature } from './sources';
import { claimKey, passesGate, type ClaimVerification } from './verdicts';
import type { RegisterItem, Versioned } from './types';

export const RESEARCH_ROLES = ['recommendation', 'supporting', 'conflicting'] as const;
export type ResearchRole = (typeof RESEARCH_ROLES)[number];

/** What the code checks found in a statement (Section 12, checks 1, 2, 3 and 5; the verifier is check 4). */
export const RESEARCH_FLAGS = [
  /** It cited a source that was not retrieved (the statement is kept, shown as unsupported, never added). */
  'source_not_retrieved',
  /** Its quote is not found, word for word, in the source it cites. */
  'quote_not_found',
  /** A number the quote does not contain was removed from the statement. */
  'number_removed',
  /** A dose, concentration or rate the quote does not contain was withheld. */
  'dose_withheld',
  /** A dose differs from the calculation the card cites for the same quantity: red, and never shown as the model wrote it. */
  'differs_from_calculation',
  /** A citation, a URL, an author or a grade the model wrote was removed: the app renders the citation from the record. */
  'citation_removed',
  /** The statement names a guideline or a body the app did not retrieve. */
  'source_named',
] as const;
export type ResearchFlag = (typeof RESEARCH_FLAGS)[number];

/** Flags that stop a statement being added to a card, whatever the verifier says. */
export const BLOCKING_FLAGS: ReadonlySet<ResearchFlag> = new Set<ResearchFlag>(['source_not_retrieved', 'quote_not_found', 'number_removed', 'dose_withheld', 'differs_from_calculation']);

export interface Pico {
  population: string;
  intervention: string;
  comparison: string;
  outcome: string;
}

export interface CaseRef {
  kind: 'entry' | 'calc';
  id: string;
  /** The label the model saw (E1, C2); kept to show which values the statement was compared with. */
  label: string;
}

export interface ResearchStatement {
  n: number;
  role: ResearchRole;
  /** The words shown: the model's, after the code checks removed what they require. */
  text: string;
  /** The retrieved source it rests on (SourceRecord.id). */
  sourceId: string;
  /** Which part of that source (a label's section), when it has parts. */
  section?: string;
  /** Copied from the source, word for word (check 3). */
  quote: string;
  caseRefs: CaseRef[];
  flags: ResearchFlag[];
  /** For `differs_from_calculation`: what the calculation says. */
  differsFrom?: { label: string; result: string }[];
}

/** A retrieved passage as the model read it. */
export interface SentPassage {
  /** S1, S2 … — the id the model cites. */
  id: string;
  /** SourceRecord.id in the run. */
  recordId: string;
  /** Which part of the record this is (a label's section), when it has parts. */
  section?: string;
  /** What kind of source it is, in words the model may rely on. */
  describe: string;
  /** The text sent: the only place a quote may come from. */
  text: string;
}

export interface ResearchRun extends Versioned {
  id: string;
  caseId: string;
  /** The Problem Card the question came from, and its version at the time. */
  itemId: string;
  itemVersion: number;
  createdAt: string;
  /** The question as the trainee confirmed it, with its parts. */
  question: string;
  pico: Pico;
  /** The words searched in the library and the literature. */
  query: string;
  drugs: string[];
  model: string;
  promptVersion: string;
  /** Everything retrieved, with the text kept: a citation opens what was actually read. */
  sources: SourceRecord[];
  /** The passages whose text was sent to the model, exactly as sent (a document kept for local search is never among them). */
  sent: SentPassage[];
  /** Library passages offered to the model (ids), for the audit. */
  retrievedChunkIds: string[];
  /** What could not be reached or found, said plainly. */
  notes: RetrievalNote[];
  status: 'answered' | 'insufficient';
  statements: ResearchStatement[];
  missingData: string[];
  /** Statements the checks removed outright (an unknown role or an empty text). */
  dropped: number;
  /** What the card said when it was run, for staleness. */
  basedOn: { problemHash: string; links: string[] };
  /** The question kept as an open item for the preceptor (nothing adequate was found). */
  openQuestion?: true;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export type RetrievalNote = 'open_sources_offline' | 'open_sources_failed' | 'library_empty' | 'library_local_only' | 'identifier_refused';

// ---------------------------------------------------------------- the question in PICO form

export interface PicoInput {
  problem?: string;
  drugs?: string;
  ageYears?: number;
  sex?: string;
  renal?: string;
}

/** The card's fields as the question's first draft; the trainee edits every part before anything is sent. */
export function defaultPico(card: PicoInput): Pico {
  const who = [card.ageYears !== undefined ? `${card.ageYears}-year-old` : '', card.sex === 'F' ? 'female' : card.sex === 'M' ? 'male' : '', card.renal ?? ''].filter(Boolean).join(' ');
  const drugs = namedDrugs(card.drugs);
  return {
    population: who ? `Adult ${who} patient` : 'Adult patient',
    intervention: drugs ? drugs.join(', ') : '',
    comparison: '',
    outcome: (card.problem ?? '').trim(),
  };
}

/** The question as one sentence, from its parts. */
export function picoQuestion(p: Pico): string {
  const parts = [
    p.population.trim() ? `In ${p.population.trim()}` : '',
    p.intervention.trim() ? `how should ${p.intervention.trim()} be used` : '',
    p.comparison.trim() ? `compared with ${p.comparison.trim()}` : '',
    p.outcome.trim() ? `given: ${p.outcome.trim()}` : '',
  ].filter(Boolean);
  return `${parts.join(', ')}?`.replace(/\?\?$/, '?');
}

const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'with', 'is', 'are', 'be', 'by', 'at', 'as', 'how', 'should', 'used', 'given', 'compared', 'patient', 'adult', 'year', 'old', 'male', 'female', 'while', 'when', 'after', 'before', 'than', 'that', 'this', 'from', 'into', 'does', 'did', 'was', 'were']);

/** The words searched: the intervention and the outcome's clinical words, without the sentence around them. */
export function picoQuery(p: Pico): string {
  const words = `${p.intervention} ${p.outcome} ${p.comparison}`
    .toLowerCase()
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)].slice(0, 12).join(' ');
}

// ---------------------------------------------------------------- statements and the gate

/** The key under which a statement's verdict is stored (verdicts.ts claimKey targets). */
export const researchTarget = (runId: string, n: number): string => `research:${runId}:${n}`;

/**
 * Whether a statement may be added to a card: it passed the gate (supported,
 * shown by a literal quote) and no code check removed or withheld anything.
 */
export function addable(s: ResearchStatement, verdict: Pick<ClaimVerification, 'verdict' | 'quotes'> | undefined): boolean {
  return passesGate(verdict) && !s.flags.some((f) => BLOCKING_FLAGS.has(f));
}

// ---------------------------------------------------------------- the limits of confidence, as factors

export type FactorLevel = 'good' | 'caution' | 'limit';

export interface ConfidenceFactor {
  id: 'sources' | 'abstracts' | 'age' | 'verification' | 'conflict' | 'missing' | 'local_only' | 'offline' | 'calculation';
  level: FactorLevel;
  /** Numbers for the sentence shown. */
  n?: number;
  years?: number;
}

/**
 * The factors that limit confidence in a run's answer, computed from what was
 * retrieved, cited and checked. There is no single score: each factor is shown
 * with its own reason (Section 12: confidence is shown as limits, not a number).
 */
export function confidenceFactors(run: ResearchRun, verdicts: ReadonlyMap<string, ClaimVerification>, today: string): ConfidenceFactor[] {
  const out: ConfidenceFactor[] = [];
  const stated = run.statements.filter((s) => s.role !== 'conflicting');
  const cited = new Set(stated.map((s) => s.sourceId));
  const citedSources = run.sources.filter((s) => cited.has(s.id));
  if (citedSources.length) {
    const primary = citedSources.some((s) => s.kind === 'library' && s.role === 'primary');
    const onlyLiterature = citedSources.every(isLiterature);
    out.push({ id: 'sources', level: primary ? 'good' : onlyLiterature ? 'limit' : 'caution' });
    if (citedSources.some((s) => s.scope === 'abstract_only')) out.push({ id: 'abstracts', level: 'caution' });
    const oldest = Math.max(0, ...citedSources.filter((s) => s.kind === 'library' && s.old).map((s) => Number(today.slice(0, 4)) - Number((s.date ?? '').slice(0, 4))));
    if (oldest > 0) out.push({ id: 'age', level: 'caution', years: oldest });
  }
  if (stated.length) {
    const ok = stated.filter((s) => addable(s, verdicts.get(researchKey(run.id, s)))).length;
    out.push({ id: 'verification', level: ok === stated.length ? 'good' : ok === 0 ? 'limit' : 'caution', n: ok });
  }
  if (run.statements.some((s) => s.role === 'conflicting')) out.push({ id: 'conflict', level: 'caution' });
  if (run.missingData.length) out.push({ id: 'missing', level: 'caution', n: run.missingData.length });
  const localOnly = run.sources.filter((s) => s.localOnly).length;
  if (localOnly) out.push({ id: 'local_only', level: 'caution', n: localOnly });
  if (run.notes.includes('open_sources_offline') || run.notes.includes('open_sources_failed')) out.push({ id: 'offline', level: 'caution' });
  if (run.statements.some((s) => s.flags.includes('differs_from_calculation'))) out.push({ id: 'calculation', level: 'limit' });
  return out;
}

/** The key of a statement's verdict: exactly its words and the statement it is. */
export const researchKey = (runId: string, s: Pick<ResearchStatement, 'n' | 'text'>): string => claimKey(s.text, [researchTarget(runId, s.n)]);

// ---------------------------------------------------------------- staleness

/** A fingerprint of what the question was about: the card's problem sentence and its medications. */
export const problemHash = (f: Readonly<Record<string, string>>): string => contentHash({ problem: f.problem ?? '', drugs: f.drugs ?? '' });

/**
 * A run is stale like the card it came from (Section 7): when the card's
 * problem or medications changed, when the card was removed, or when the case
 * data the card cites was corrected, retracted or superseded by a newer value.
 */
export function researchStaleness(run: ResearchRun, item: RegisterItem | undefined, ctx: CardContext): { stale: boolean; reasons: L[] } {
  if (!item || item.status !== 'active') return { stale: true, reasons: [L('The Problem Card it came from was removed.', 'أُزيلت بطاقة المشكلة التي صدر عنها.')] };
  const reasons: L[] = [];
  if (problemHash(item.fields) !== run.basedOn.problemHash) reasons.push(L('The card’s problem or medications changed after this research.', 'تغيّرت مشكلة البطاقة أو أدويتها بعد هذا البحث.'));
  reasons.push(...cardStaleness(item, ctx).reasons);
  return { stale: reasons.length > 0, reasons };
}

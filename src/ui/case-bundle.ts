/**
 * Everything the Clinical Modules need about one case, decrypted and derived
 * once: the effective timeline, medication courses, problems, worksheets,
 * register rows, source documents, calculations and the Problem Cards.
 */
import { useMemo } from 'react';
import { hospitalDayOf } from '../domain/dates';
import { L } from '../domain/label';
import { deriveMedCourses, deriveProblems, indexTimeline, type MedCourse, type ProblemThread } from '../domain/timeline';
import type { Attachment, CardReview, Case, CaseAnalysis, CaseIdentifiers, CausalityAssessment, RegisterId, RegisterItem, Suggestion, TaskRecord, TimelineEntry } from '../domain/types';
import { analysisStale } from '../store/store';
import { indexTasks } from '../domain/workflow/tasks';
import { buildCard, rankCards, type CardContext, type CardModel } from '../domain/problem-card';
import { useAnalyses, useAttachments, useCalcResults, useCardReviews, useCausality, useCaseVersions, useClaimChecks, useEntries, useExtractions, useIdentifiers, useItems, useTasks } from './data';
import { indexVerdicts, originKey, type ClaimVerification, type VerifiedOrigin } from '../domain/verdicts';
import { pendingFromRuns, resultCurrency } from '../calc/currency';
import type { GatherContext } from '../calc/gather';
import { CALC_BY_ID } from '../calc/registry';
import type { CalcResult } from '../calc/types';
import { useSession } from './session-context';

export interface CaseBundle {
  case: Case;
  identifiers?: CaseIdentifiers;
  entries: TimelineEntry[];
  current: TimelineEntry[];
  courses: MedCourse[];
  activeCourses: MedCourse[];
  problems: ProblemThread[];
  tasks: TaskRecord[];
  taskById: Map<string, TaskRecord>;
  /** Every register row, including retracted ones. */
  allItems: RegisterItem[];
  items: RegisterItem[];
  itemsOf: (r: RegisterId) => RegisterItem[];
  attachments: Attachment[];
  activeAttachments: Attachment[];
  /** Today's hospital day (null when the case is not active). */
  today: number | null;
  /** M3: the latest AI draft of each module, and whether the record has moved on since. */
  draftOf: (moduleId: string) => { analysis: CaseAnalysis; stale: boolean } | undefined;
  /** M2: every calculation result, oldest first, and what the calculators read. */
  calcResults: CalcResult[];
  calcContext: GatherContext;
  /** Ids of results whose inputs changed since they were computed. */
  calcOutOfDate: ReadonlySet<string>;
  /** M2: the latest Naranjo and WHO-UMC assessment of each suspected ADR. */
  causalityOf: (itemId: string) => CausalityAssessment[];
  /** M4: every decision on the Problem Cards, and what a card's checks and staleness read. */
  reviews: CardReview[];
  cardContext: CardContext;
  /** M4: the active Problem Cards, ranked (owner decision D5). */
  cards: CardModel[];
  /** The model's suggestion a register row was accepted from, if any. */
  suggestionOf: (item: RegisterItem) => Suggestion | undefined;
  /** M5: the verifier's latest verdict on a statement, by where it is (a draft's reason, note or claim; a card's claim). */
  verdictAt: (origin: VerifiedOrigin) => ClaimVerification | undefined;
  /** M5: the verdicts by where they are, for the gate on drafts (verdicts.ts). */
  verdictsByOrigin: ReadonlyMap<string, ClaimVerification>;
}

export type BundleState = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'missing' } | { status: 'ready'; b: CaseBundle };

const calcName = (id: string) => {
  const c = CALC_BY_ID.get(id as never);
  return c ? L(c.name, c.nameAr) : undefined;
};

export function useCaseBundle(caseId: string): BundleState {
  const { store } = useSession();
  const versions = useCaseVersions(caseId);
  const entries = useEntries(caseId);
  const tasks = useTasks(caseId);
  const items = useItems(caseId);
  const atts = useAttachments(caseId);
  const ids = useIdentifiers(caseId);
  const analyses = useAnalyses(caseId);
  const calcs = useCalcResults(caseId);
  const runs = useExtractions(caseId);
  const causality = useCausality(caseId);
  const reviews = useCardReviews(caseId);
  const checks = useClaimChecks(caseId);
  const today = store.today();
  return useMemo((): BundleState => {
    const all = [versions, entries, tasks, items, atts, ids, analyses, calcs, runs, causality, reviews, checks];
    const err = all.find((x) => x.status === 'error');
    if (err && err.status === 'error') return { status: 'error', error: err.error };
    if (
      versions.status !== 'ready' ||
      entries.status !== 'ready' ||
      tasks.status !== 'ready' ||
      items.status !== 'ready' ||
      atts.status !== 'ready' ||
      ids.status !== 'ready' ||
      analyses.status !== 'ready' ||
      calcs.status !== 'ready' ||
      runs.status !== 'ready' ||
      causality.status !== 'ready' ||
      reviews.status !== 'ready' ||
      checks.status !== 'ready'
    ) {
      return { status: 'loading' };
    }
    const verdicts = indexVerdicts(checks.data);
    const c = versions.data.at(-1);
    if (!c) return { status: 'missing' };
    const current = indexTimeline(entries.data).current;
    const courses = deriveMedCourses(current);
    const active = items.data.filter((i) => i.status === 'active');
    const latest = new Map<string, CaseAnalysis>();
    for (const a of analyses.data) latest.set(a.moduleId, a); // oldest first, so the last one wins
    const drafts = new Map([...latest].map(([m, a]) => [m, { analysis: a, stale: analysisStale(a, entries.data, items.data) }]));
    const activeIds = new Set(atts.data.filter((a) => a.status === 'active').map((a) => a.id));
    const calcContext: GatherContext = { demographics: c.demographics, current, pending: pendingFromRuns(runs.data, activeIds) };
    const calcOutOfDate = new Set(
      calcs.data
        .filter((r) => {
          const def = CALC_BY_ID.get(r.calc);
          return def ? !resultCurrency(r, def, calcContext).current : false;
        })
        .map((r) => r.id),
    );
    const cardContext: CardContext = { entries: entries.data, calcResults: calcs.data, calcOutOfDate, reviews: reviews.data, calcName, verdicts: verdicts.byKey };
    return {
      status: 'ready',
      b: {
        case: c,
        identifiers: ids.data,
        entries: entries.data,
        current,
        courses,
        activeCourses: courses.filter((m) => m.status === 'active'),
        problems: deriveProblems(current),
        tasks: tasks.data,
        taskById: indexTasks(tasks.data),
        allItems: items.data,
        items: active,
        itemsOf: (r) => active.filter((i) => i.register === r),
        attachments: atts.data,
        activeAttachments: atts.data.filter((a) => a.status === 'active'),
        today: c.status === 'active' ? hospitalDayOf(c.admissionDay0, today) : null,
        draftOf: (m) => drafts.get(m),
        calcResults: calcs.data,
        calcContext,
        calcOutOfDate,
        causalityOf: (itemId) => causality.data.filter((a) => a.itemId === itemId),
        reviews: reviews.data,
        cardContext,
        cards: rankCards(active.filter((i) => i.register === 'drp')).map((i) => buildCard(i, cardContext)),
        suggestionOf: (item) => {
          const o = item.origin;
          if (o?.kind !== 'suggestion') return undefined;
          return analyses.data.find((a) => a.id === o.analysisId)?.suggestions.find((x) => x.id === o.suggestionId);
        },
        verdictAt: (o) => verdicts.byOrigin.get(originKey(o)),
        verdictsByOrigin: verdicts.byOrigin,
      },
    };
  }, [versions, entries, tasks, items, atts, ids, analyses, calcs, runs, causality, reviews, checks, today]);
}

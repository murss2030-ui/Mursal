/**
 * Everything the Clinical Modules need about one case, decrypted and derived
 * once: the effective timeline, medication courses, problems, worksheets,
 * register rows and source documents.
 */
import { useMemo } from 'react';
import { hospitalDayOf } from '../domain/dates';
import { deriveMedCourses, deriveProblems, indexTimeline, type MedCourse, type ProblemThread } from '../domain/timeline';
import type { Attachment, Case, CaseAnalysis, CaseIdentifiers, RegisterId, RegisterItem, TaskRecord, TimelineEntry } from '../domain/types';
import { analysisStale } from '../store/store';
import { indexTasks } from '../domain/workflow/tasks';
import { useAnalyses, useAttachments, useCaseVersions, useEntries, useIdentifiers, useItems, useTasks } from './data';
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
}

export type BundleState = { status: 'loading' } | { status: 'error'; error: Error } | { status: 'missing' } | { status: 'ready'; b: CaseBundle };

export function useCaseBundle(caseId: string): BundleState {
  const { store } = useSession();
  const versions = useCaseVersions(caseId);
  const entries = useEntries(caseId);
  const tasks = useTasks(caseId);
  const items = useItems(caseId);
  const atts = useAttachments(caseId);
  const ids = useIdentifiers(caseId);
  const analyses = useAnalyses(caseId);
  const today = store.today();
  return useMemo((): BundleState => {
    const all = [versions, entries, tasks, items, atts, ids, analyses];
    const err = all.find((x) => x.status === 'error');
    if (err && err.status === 'error') return { status: 'error', error: err.error };
    if (
      versions.status !== 'ready' ||
      entries.status !== 'ready' ||
      tasks.status !== 'ready' ||
      items.status !== 'ready' ||
      atts.status !== 'ready' ||
      ids.status !== 'ready' ||
      analyses.status !== 'ready'
    ) {
      return { status: 'loading' };
    }
    const c = versions.data.at(-1);
    if (!c) return { status: 'missing' };
    const current = indexTimeline(entries.data).current;
    const courses = deriveMedCourses(current);
    const active = items.data.filter((i) => i.status === 'active');
    const latest = new Map<string, CaseAnalysis>();
    for (const a of analyses.data) latest.set(a.moduleId, a); // oldest first, so the last one wins
    const drafts = new Map([...latest].map(([m, a]) => [m, { analysis: a, stale: analysisStale(a, entries.data, items.data) }]));
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
      },
    };
  }, [versions, entries, tasks, items, atts, ids, analyses, today]);
}

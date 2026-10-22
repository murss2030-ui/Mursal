import type { LearningRecord } from '../../domain/learning';
import { useLiveDecoded } from '../hooks';

/** The trainee's records in the learning modes for one case, oldest first, live. */
export const useLearningState = (caseId: string) =>
  useLiveDecoded(
    (s) => s.db.learning.where('caseId').equals(caseId).toArray(),
    (s, rows): Promise<LearningRecord[]> => s.openRows<LearningRecord>('learning', rows).then((l) => l.sort((a, b) => (a.at < b.at ? -1 : 1))),
    [caseId],
  );

export function useLearning(caseId: string): LearningRecord[] {
  const s = useLearningState(caseId);
  return s.status === 'ready' ? s.data : [];
}

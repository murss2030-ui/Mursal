import { useI18n } from '../../i18n/i18n';
import { Banner } from '../components/ui';
import { useAnalyses } from '../data';
import { ItemEditor } from './ItemEditor';

/** Opens the register editor pre-filled with a row the model suggested; saving records the decision "edited". */
export function EditSuggestion({ caseId, analysisId, suggestionId }: { caseId: string; analysisId: string; suggestionId: string }) {
  const { t } = useI18n();
  const analyses = useAnalyses(caseId);
  if (analyses.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;
  const a = analyses.data.find((x) => x.id === analysisId);
  const s = a?.suggestions.find((x) => x.id === suggestionId);
  if (!a || !s || s.kind !== 'item') return <Banner tone="warning">{t('review.notFound')}</Banner>;
  if (s.decision) return <Banner tone="info">{t('review.alreadyDecided')}</Banner>;
  return <ItemEditor caseId={caseId} mode={{ kind: 'suggested', analysisId, suggestion: s, back: `/cases/${caseId}/task/${s.taskId}` }} query={new URLSearchParams()} />;
}

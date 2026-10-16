import { useI18n } from '../../i18n/i18n';
import { Banner } from '../components/ui';
import { useExtractions } from '../data';
import { EntryEditor } from './EntryEditor';
import { ItemEditor } from './ItemEditor';

/** Opens the right editor, pre-filled with what was read, to correct one extracted value. */
export function FixExtracted({ caseId, runId, fieldId }: { caseId: string; runId: string; fieldId: string }) {
  const { t } = useI18n();
  const runs = useExtractions(caseId);
  if (runs.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;
  const run = runs.data.find((r) => r.id === runId);
  const field = run?.fields.find((f) => f.id === fieldId);
  if (!run || !field) return <Banner tone="warning">{t('review.notFound')}</Banner>;
  if (field.decision) return <Banner tone="info">{t('review.alreadyDecided')}</Banner>;
  const mode = { kind: 'extracted' as const, runId, field, attachmentId: run.attachmentId, back: `/cases/${caseId}/review/${runId}` };
  return field.target.kind === 'entry' ? <EntryEditor caseId={caseId} mode={mode} /> : <ItemEditor caseId={caseId} mode={mode} query={new URLSearchParams()} />;
}

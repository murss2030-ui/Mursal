import type { Case } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { useAttachments } from '../data';
import { Banner } from '../components/ui';
import { AddSourceTiles, SourceList } from './SourceIntake';

export function SourcesTab({ c }: { c: Case }) {
  const { t } = useI18n();
  const atts = useAttachments(c.id);
  return (
    <div className="flex flex-col gap-4" data-testid="sources-tab">
      <p className="text-sm text-slate-700">{t('sources.lead')}</p>
      {atts.status === 'error' ? <Banner tone="danger">{atts.error.message}</Banner> : <SourceList caseId={c.id} attachments={atts.status === 'ready' ? atts.data : []} />}
      {c.status !== 'archived' && (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-slate-900">{t('sources.addMore')}</h2>
          <AddSourceTiles c={c} back="sources" />
        </section>
      )}
    </div>
  );
}

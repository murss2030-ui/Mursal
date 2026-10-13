import type { AuditEvent } from '../../domain/types';
import { Term, useI18n } from '../../i18n/i18n';
import { Banner, PageTitle } from '../components/ui';
import { useAudit } from '../data';

function EventRow({ e }: { e: AuditEvent }) {
  const { t, when } = useI18n();
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3" data-testid="audit-event" data-action={e.action} data-entity={e.entity}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium" dir="ltr">
          {e.entity} · {e.action}
        </span>
        <span className="text-xs text-slate-600">
          {when(e.at)} · {t(`audit.actor.${e.actor}`)}
        </span>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-slate-600" dir="ltr">
        {e.entityId}
      </p>
      <details className="mt-1">
        <summary className="min-h-touch cursor-pointer py-2 text-sm font-medium text-teal-900">{t('audit.details')}</summary>
        <pre dir="ltr" className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-800">
          {JSON.stringify(e.diff, null, 2)}
        </pre>
      </details>
    </li>
  );
}

export function AuditList({ caseId }: { caseId?: string }) {
  const { t } = useI18n();
  const audit = useAudit(caseId);
  if (audit.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (audit.status === 'error') return <Banner tone="danger">{audit.error.message}</Banner>;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">{t('audit.lead')}</p>
      {audit.data.length === 0 ? (
        <p className="text-slate-600">{t('audit.empty')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {audit.data.map((e) => (
            <EventRow key={e.id} e={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

export function AuditPage() {
  return (
    <div>
      <PageTitle back="#/more">
        <Term id="audit_log" />
      </PageTitle>
      <AuditList />
    </div>
  );
}

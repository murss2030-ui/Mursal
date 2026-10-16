import { useEffect, useState } from 'react';
import type { Attachment } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { useI18n } from '../../i18n/i18n';
import { Icon, type IconName } from '../components/Icon';
import { Banner, Button, Card, DayLabel, LinkButton, Num, PageTitle, TextField, useErrorText } from '../components/ui';
import { useAttachments, useEntries } from '../data';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { entryText } from '../format';
import { useAttachmentUrl } from './panels';

const ORIGIN_ICON: Record<Attachment['origin'], IconName> = {
  typed: 'type',
  text_file: 'file-text',
  camera: 'camera',
  image_file: 'image',
  pdf_page: 'file-text',
};

export function useAttachmentText(a: Attachment | undefined): string | undefined {
  const { store } = useSession();
  const [text, setText] = useState<string>();
  useEffect(() => {
    if (!a || a.kind !== 'text' || a.status !== 'active') return;
    let cancelled = false;
    void store.attachmentText(a.caseId, a.id).then((x) => !cancelled && setText(x));
    return () => {
      cancelled = true;
    };
  }, [a, store]);
  return text;
}

function Content({ a, compact = false }: { a: Attachment; compact?: boolean }) {
  const { t } = useI18n();
  const url = useAttachmentUrl(a, 'content');
  const text = useAttachmentText(a);
  if (a.status !== 'active') return <Banner tone="info">{t('source.contentPurged', { reason: a.removedReason ?? '' })}</Banner>;
  if (a.kind === 'image') {
    return url ? (
      <img src={url} alt={t('source.imageAlt')} className={`w-full rounded-xl border border-line bg-white ${compact ? 'max-h-[45vh] object-contain' : ''}`} data-testid="source-image" />
    ) : (
      <p className="text-sm text-slate-600">{t('common.loading')}</p>
    );
  }
  return (
    <pre
      dir="auto"
      className={`overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-white p-3 font-sans text-sm leading-relaxed text-slate-900 ${compact ? 'max-h-[40vh]' : ''}`}
      data-testid="source-text"
    >
      {text ?? t('common.loading')}
    </pre>
  );
}

/** The source beside the entry form while transcribing (Section 13, side-by-side confirmation). */
export function SourcePeek({ caseId, attachmentId }: { caseId: string; attachmentId: string }) {
  const { t } = useI18n();
  const atts = useAttachments(caseId);
  const a = atts.status === 'ready' ? atts.data.find((x) => x.id === attachmentId) : undefined;
  if (!a) return null;
  return (
    <details open className="surface group" data-testid="source-peek">
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-semibold text-slate-900">
        <span className="flex items-center gap-2">
          <Icon name="eye" className="h-4 w-4 text-teal-800" />
          {t('source.transcribingFrom', { type: t(`source.docType.${a.docType}`) })}
        </span>
        <Icon name="chevron-down" className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line p-3">
        <Content a={a} compact />
      </div>
    </details>
  );
}

export function SourceViewer({ caseId, attachmentId }: { caseId: string; attachmentId: string }) {
  const { t, when } = useI18n();
  const errText = useErrorText();
  const { store } = useSession();
  const atts = useAttachments(caseId);
  const entries = useEntries(caseId);
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  if (atts.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;
  const a = atts.data.find((x) => x.id === attachmentId);
  if (!a) return <Banner tone="warning">{t('source.notFound')}</Banner>;
  const linked = entries.status === 'ready' ? entries.data.filter((e) => e.sourceAttachmentId === a.id) : [];
  const here = `/cases/${caseId}/sources/${a.id}`;

  const remove = async () => {
    try {
      await store.removeAttachment(caseId, a.id, reason);
      setRemoving(false);
    } catch (e) {
      setError(e instanceof ValidationError ? 'required' : (e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="source-viewer">
      <PageTitle back={`#/cases/${caseId}/sources`}>{t(`source.docType.${a.docType}`)}</PageTitle>
      <ul className="-mt-3 flex flex-wrap gap-1.5 text-xs text-slate-700" data-testid="source-meta">
        {a.title && (
          <li className="rounded-full border border-line bg-white px-2.5 py-1 font-medium text-slate-900" dir="auto">
            {a.title}
          </li>
        )}
        <li className="rounded-full border border-line bg-white px-2.5 py-1">{a.hospitalDay !== undefined ? <DayLabel day={a.hospitalDay} /> : t('source.noDay')}</li>
        <li className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1">
          <Icon name={ORIGIN_ICON[a.origin]} className="h-3.5 w-3.5 text-slate-500" />
          {t(`source.origin.${a.origin}`)}
          {a.page !== undefined && <> · {t('source.page', { n: a.page })}</>}
        </li>
        <li className="rounded-full border border-line bg-white px-2.5 py-1">
          <Num>{when(a.createdAt)}</Num>
        </li>
      </ul>
      {a.status === 'active' && (
        <Banner tone="info">
          <span className="flex items-center gap-2">
            <Icon name="eye-off" className="h-4 w-4" />
            {t('source.redactedNote')}
          </span>
        </Banner>
      )}

      <Content a={a} />

      {a.status === 'active' && (
        <Card title={t('source.transcribeTitle')}>
          <p className="mb-3 text-sm text-slate-700">{t('source.transcribeLead')}</p>
          <LinkButton href={`#/cases/${caseId}/entry/new?src=${a.id}&back=${encodeURIComponent(here)}`} variant="primary" icon="plus">
            {t('source.transcribe')}
          </LinkButton>
          {linked.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-800">{t('source.linkedN', { n: linked.length })}</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-slate-700">
                {linked.map((e) => (
                  <li key={e.id} dir="auto">
                    <DayLabel day={e.hospitalDay} /> · {entryText(e, { t }).main}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {a.status === 'active' && (
        <Card>
          {removing ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-slate-700">{t('source.removeLead')}</p>
              <TextField label={t('source.removeReason')} value={reason} onChange={setReason} error={error === 'required' ? errText('required') : undefined} />
              {error && error !== 'required' && <Banner tone="danger">{error}</Banner>}
              <div className="flex gap-2">
                <Button variant="danger" icon="trash" onClick={remove}>
                  {t('source.removeConfirm')}
                </Button>
                <Button variant="ghost" onClick={() => setRemoving(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" icon="trash" className="text-red-800" onClick={() => setRemoving(true)}>
              {t('source.remove')}
            </Button>
          )}
        </Card>
      )}
      {a.status !== 'active' && (
        <Button variant="secondary" onClick={() => navigate(`/cases/${caseId}/sources`)}>
          {t('common.back')}
        </Button>
      )}
    </div>
  );
}

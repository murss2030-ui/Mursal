import { useMemo, useState } from 'react';
import { RELEASE_GATE_MET } from '../../config/release';
import { hospitalDayOf } from '../../domain/dates';
import type { SourceDocType } from '../../domain/types';
import { SOURCE_DOC_TYPES } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { findIdentifiers, removeIdentifiers, type IdentifierHit } from '../../domain/workflow/deidentify';
import { useI18n } from '../../i18n/i18n';
import { Banner, Button, Card, CheckboxField, PageTitle, SelectField, TextAreaField, TextField, useErrorText } from '../components/ui';
import { useCaseVersions, useIdentifiers } from '../data';
import { usePersistentDraft } from '../hooks';
import { navigate, useHashLocation } from '../router';
import { useSession } from '../session-context';
import { TEXT_DRAFT_ID } from './SourceIntake';
import type { Errors } from '../../domain/entries';

const EMPTY = { text: '', docType: '', day: '', title: '', origin: 'typed' };

/** Shows the text with likely identifiers highlighted, so the trainee can see what will be removed. */
function Highlighted({ text, hits }: { text: string; hits: readonly IdentifierHit[] }) {
  const parts: { s: string; hit: boolean }[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) parts.push({ s: text.slice(pos, h.start), hit: false });
    parts.push({ s: text.slice(h.start, h.end), hit: true });
    pos = h.end;
  }
  parts.push({ s: text.slice(pos), hit: false });
  return (
    <pre dir="auto" className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-paper p-3 font-sans text-sm text-slate-800" data-testid="identifier-preview">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded bg-rose-200 px-0.5 text-rose-950">
            {p.s}
          </mark>
        ) : (
          <span key={i}>{p.s}</span>
        ),
      )}
    </pre>
  );
}

export function TextSourceEditor({ caseId, back }: { caseId: string; back: string }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const { store } = useSession();
  const { query } = useHashLocation();
  const versions = useCaseVersions(caseId);
  const ids = useIdentifiers(caseId);
  const draft = usePersistentDraft<Record<string, string>>(TEXT_DRAFT_ID(caseId), EMPTY);
  const v = draft.values;
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const hits = useMemo(() => findIdentifiers(v.text ?? '', ids.status === 'ready' ? ids.data ?? {} : {}), [v.text, ids]);
  const backPath = back === 'intake' ? `/cases/${caseId}/intake` : `/cases/${caseId}/sources`;

  if (versions.status !== 'ready' || !draft.ready) return <p className="text-slate-600">{t('common.loading')}</p>;
  const c = versions.data.at(-1);
  if (!c) return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const todayDay = c.status === 'active' ? hospitalDayOf(c.admissionDay0, store.today()) : null;

  const set = (k: string, x: string) => {
    if (k === 'text') setConfirmed(false);
    draft.set(k, x);
  };

  const save = async () => {
    const e: Errors = {};
    if (!v.docType) e.docType = 'required';
    if (!(v.text ?? '').trim()) e.text = 'required';
    const day = (v.day ?? '').trim();
    if (day && !/^-?\d+$/.test(day)) e.day = 'hospitalDay';
    if (!confirmed) e.confirm = 'confirm';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await store.addAttachment(caseId, {
        kind: 'text',
        docType: v.docType as SourceDocType,
        hospitalDay: day ? Number(day) : undefined,
        title: v.title,
        origin: v.origin === 'text_file' ? 'text_file' : 'typed',
        redactionConfirmed: true,
        text: v.text,
      });
      await draft.clear();
      navigate(backPath);
    } catch (err) {
      if (err instanceof ValidationError) setErrors({ ...err.errors, ...(err.errors.hospitalDay ? { day: err.errors.hospitalDay } : {}) });
      else setFailure(t('err.generic', { message: (err as Error).message }));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="text-source-editor">
      <PageTitle back={`#${backPath}`}>{t('source.textTitle')}</PageTitle>
      {draft.restored && query.get('import') !== '1' && <Banner tone="info">{t('ed.restored')}</Banner>}
      {query.get('import') === '1' && <Banner tone="info">{t('source.imported')}</Banner>}
      {!RELEASE_GATE_MET && <Banner tone="warning">{t('intake.syntheticOnly')}</Banner>}
      <Card>
        <div className="flex flex-col gap-4">
          <SelectField
            label={t('source.docType')}
            name="docType"
            value={v.docType ?? ''}
            onChange={(x) => set('docType', x)}
            error={errText(errors.docType)}
            options={SOURCE_DOC_TYPES.map((d) => ({ value: d, label: t(`source.docType.${d}`) }))}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextField label={t('source.hospitalDay')} optional inputMode="numeric" name="day" value={v.day ?? ''} onChange={(x) => set('day', x)} error={errText(errors.day)} />
              </div>
              {todayDay !== null && !v.day && (
                <Button className="mb-[2px]" onClick={() => set('day', String(todayDay))}>
                  {t('ed.today', { d: todayDay })}
                </Button>
              )}
            </div>
            <TextField label={t('source.title')} optional name="title" value={v.title ?? ''} onChange={(x) => set('title', x)} />
          </div>
          <TextAreaField label={t('source.text')} hint={t('source.textHint')} name="sourceText" rows={10} value={v.text ?? ''} onChange={(x) => set('text', x)} error={errText(errors.text)} />
        </div>
      </Card>

      <Card
        title={hits.length ? t('source.hitsFound', { n: hits.length }) : t('source.hitsNone')}
        actions={
          hits.length > 0 ? (
            <Button variant="danger" icon="eye-off" onClick={() => set('text', removeIdentifiers(v.text ?? '', hits))}>
              {t('source.removeAll')}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3" data-testid="identifier-check">
          <p className="text-sm text-slate-700">{hits.length ? t('source.hitsHelp') : t('source.hitsNoneHelp')}</p>
          {hits.length > 0 && (
            <>
              <Highlighted text={v.text ?? ''} hits={hits} />
              <ul className="flex flex-wrap gap-1.5">
                {hits.map((h, i) => (
                  <li key={`${h.start}-${i}`}>
                    <button
                      type="button"
                      onClick={() => set('text', removeIdentifiers(v.text ?? '', [h]))}
                      className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 text-xs font-medium text-rose-900 hover:bg-rose-100"
                      title={t('source.removeOne')}
                    >
                      <span className="text-rose-700">{t(`source.hit.${h.kind}`)}:</span>
                      <span dir="auto">{h.text}</span>
                      <span aria-hidden="true">✕</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <CheckboxField label={t('source.confirmText')} checked={confirmed} onChange={setConfirmed} error={errText(errors.confirm)} name="confirmText" />
        </div>
      </Card>

      {failure && (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={save} disabled={busy} icon="check">
          {busy ? t('common.saving') : t('source.save')}
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await draft.discard();
            navigate(backPath);
          }}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

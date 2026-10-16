/**
 * Side-by-side confirmation (Section 13): the page with the box of every value
 * read, and one card per value. Each value is confirmed, corrected or
 * rejected on its own — there is no "confirm all", and Confirm is never the
 * pre-selected or focused action. Until a value is confirmed it is used
 * nowhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { checkCandidate, INFO_FLAGS } from '../../ai/extraction/candidates';
import type { Attachment, ExtractedField, ExtractionFlag, ExtractionRun } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { Icon } from '../components/Icon';
import { Banner, Button, DayLabel, LinkButton, Num, PageTitle, TextField } from '../components/ui';
import { useAttachments, useExtractions } from '../data';
import { fieldSummary } from '../extraction-format';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { useAttachmentUrl } from './panels';
import { useAttachmentText } from './SourceViewer';

const KIND_ICON: Record<ExtractedField['kind'], Parameters<typeof Icon>[0]['name']> = {
  lab: 'flask',
  vital: 'heart',
  weight: 'weight',
  medication: 'pill',
  allergy: 'alert-triangle',
  problem: 'target',
  history: 'note',
  social: 'user',
  culture: 'microscope',
  imaging: 'image',
  procedure: 'activity',
  event: 'calendar',
};

function targetLabel(f: ExtractedField, t: (k: MsgKey, p?: Record<string, string | number>) => string): string {
  if (f.target.kind === 'register') return t(f.target.register === 'home_med' ? 'review.to.home_med' : 'review.to.discharge_med');
  return t(`review.to.${f.target.type}` as MsgKey);
}

/** The page, with every value's box; the selected one stands out. */
function SourcePane({ a, run, selected }: { a: Attachment; run: ExtractionRun; selected?: string }) {
  const { t } = useI18n();
  const url = useAttachmentUrl(a, 'content');
  const text = useAttachmentText(a);
  const pre = useRef<HTMLPreElement>(null);
  // Bring the selected value into view inside the source, without moving the page.
  useEffect(() => {
    const box = pre.current;
    const mark = box?.querySelector('mark');
    if (box && mark) box.scrollTop = Math.max(0, mark.offsetTop - box.clientHeight / 3);
  }, [selected, text]);
  if (a.status !== 'active') return <Banner tone="info">{t('source.contentPurged', { reason: a.removedReason ?? '' })}</Banner>;
  if (a.kind === 'image') {
    if (!url) return <p className="text-sm text-slate-600">{t('common.loading')}</p>;
    return (
      <div className="relative overflow-hidden rounded-xl border border-line bg-white" data-testid="review-source">
        <img src={url} alt={t('source.imageAlt')} className="block w-full" />
        {run.fields
          .filter((f) => f.box)
          .map((f) => {
            const [y0, x0, y1, x1] = f.box!;
            const on = f.id === selected;
            return (
              <span
                key={f.id}
                aria-hidden="true"
                data-box={f.id}
                className={`absolute rounded-sm border-2 ${on ? 'border-saffron-500 bg-saffron-300/25' : f.decision ? 'border-emerald-500/50' : 'border-sky-500/70'}`}
                style={{ top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` }}
              />
            );
          })}
      </div>
    );
  }
  // Text: the selected value's raw text is highlighted where it occurs.
  const sel = run.fields.find((f) => f.id === selected)?.rawText ?? '';
  const body = text ?? '';
  const at = sel ? body.indexOf(sel) : -1;
  return (
    // A fixed height: selecting a value must never move the buttons under the trainee's finger.
    <pre
      ref={pre}
      dir="auto"
      className="relative h-[40vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-white p-3 font-sans text-sm leading-relaxed text-slate-900 [overflow-anchor:none]"
      data-testid="review-source"
    >
      {text === undefined ? (
        t('common.loading')
      ) : at < 0 ? (
        body
      ) : (
        <>
          {body.slice(0, at)}
          <mark className="rounded bg-saffron-200 px-0.5">{body.slice(at, at + sel.length)}</mark>
          {body.slice(at + sel.length)}
        </>
      )}
    </pre>
  );
}

function FlagChips({ flags }: { flags: readonly ExtractionFlag[] }) {
  const { t } = useI18n();
  if (!flags.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <li key={f} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${INFO_FLAGS.has(f) ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-900'}`} data-flag={f}>
          {!INFO_FLAGS.has(f) && <Icon name="alert-triangle" className="h-3.5 w-3.5" />}
          {t(`review.flag.${f}` as MsgKey)}
        </li>
      ))}
    </ul>
  );
}

function FieldCard({ run, f, selected, onSelect }: { run: ExtractionRun; f: ExtractedField; selected: boolean; onSelect: () => void }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { store } = useSession();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();
  const errors = useMemo(() => checkCandidate(f), [f]);
  const blocked = Object.keys(errors);
  const look = f.flags.filter((x) => !INFO_FLAGS.has(x));

  const decide = async (d: { kind: 'confirm' } | { kind: 'reject'; reason?: string }) => {
    setBusy(true);
    setFailure(undefined);
    try {
      await store.decideExtractedField(run.caseId, run.id, f.id, d);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (f.decision) {
    const k = f.decision.kind;
    return (
      <li className="flex items-center gap-3 rounded-xl border border-line bg-white/70 px-3 py-2 text-sm" data-testid="review-field" data-field={f.id} data-decision={k}>
        <span className={`flex h-7 w-7 items-center justify-center rounded-full ${k === 'rejected' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-800'}`}>
          <Icon name={k === 'rejected' ? 'x' : 'check'} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${k === 'rejected' ? 'text-slate-500 line-through' : 'text-slate-900'}`} dir="auto">
            {fieldSummary(f, i18n)}
          </span>
          <span className="text-xs text-slate-600">
            {t(`review.decided.${k}`)}
            {f.decision.reason ? ` — ${f.decision.reason}` : ''}
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <section
        className={`surface flex flex-col gap-3 p-4 ${selected ? 'ring-2 ring-saffron-400' : ''}`}
        data-testid="review-field"
        data-field={f.id}
        data-decision="pending"
        // Select on click, or on keyboard focus — never on a mouse or finger press: re-rendering between press
        // and release would move the page and make a tap on Confirm miss.
        onFocusCapture={(e) => {
          if ((e.target as HTMLElement).matches(':focus-visible')) onSelect();
        }}
        onClick={onSelect}
      >
        <div className="flex items-start gap-3">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${look.length ? 'bg-amber-100 text-amber-900' : 'bg-teal-50 text-teal-800'}`}>
            <Icon name={KIND_ICON[f.kind]} className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{targetLabel(f, t)}</span>
            {/* The value as it would be stored: amber and italic until confirmed (extracted_unverified). */}
            <span className="font-semibold italic text-amber-900" dir="auto" data-testid="review-value">
              {fieldSummary(f, i18n) || t('review.nothingRead')}
            </span>
            {/* A list row (pre-admission or discharge medicine) has no hospital day. */}
            {f.target.kind === 'entry' && (
              <span className="text-xs text-slate-600">
                {f.day !== undefined ? <DayLabel day={f.day} /> : t('review.noDay')}
                {f.timeOfDay ? ` · ${f.timeOfDay}` : ''}
              </span>
            )}
          </div>
        </div>
        <p className="rounded-lg bg-paper px-3 py-2 text-sm text-slate-800" data-testid="review-raw">
          <span className="text-xs font-medium text-slate-500">{t('review.readAs')} </span>
          <q dir="auto" className="font-mono text-[13px]">
            {f.rawText}
          </q>
        </p>
        {f.alternative && (
          <p className="text-sm text-amber-900">
            {t('review.secondReading')} <q dir="auto">{f.alternative}</q>
          </p>
        )}
        {f.drug && (
          <p className="text-xs text-slate-600" data-testid="review-rxnorm" data-status={f.drug.status}>
            {f.drug.status === 'matched' ? t('review.rx.matched', { name: f.drug.name ?? f.values.drug ?? '', rxcui: f.drug.rxcui ?? '' }) : t(`review.rx.${f.drug.status}`)}
          </p>
        )}
        {f.note && <p className="text-xs text-slate-600">{t('review.modelNote', { note: f.note })}</p>}
        <FlagChips flags={f.flags} />
        {blocked.length > 0 && <p className="text-sm text-slate-700">{t('review.needs', { fields: blocked.join(', ') })}</p>}
        {failure && (
          <Banner tone="danger" role="alert">
            {failure}
          </Banner>
        )}
        {rejecting ? (
          <div className="flex flex-col gap-2">
            <TextField label={t('review.rejectReason')} optional value={reason} onChange={setReason} name={`reason-${f.id}`} />
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" icon="x" disabled={busy} onClick={() => void decide({ kind: 'reject', reason })}>
                {t('review.reject')}
              </Button>
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {/* Never the default, never focused: confirming is a deliberate act on this one value. */}
            <Button variant="secondary" icon="check" disabled={busy || blocked.length > 0} onClick={() => void decide({ kind: 'confirm' })}>
              {t('review.confirm')}
            </Button>
            <Button variant="secondary" icon="pencil" onClick={() => navigate(`/cases/${run.caseId}/review/${run.id}/fix/${f.id}`)}>
              {t('review.correct')}
            </Button>
            <Button variant="ghost" icon="x" onClick={() => setRejecting(true)}>
              {t('review.reject')}
            </Button>
          </div>
        )}
      </section>
    </li>
  );
}

export function ExtractionReview({ caseId, runId }: { caseId: string; runId: string }) {
  const { t, when } = useI18n();
  const runs = useExtractions(caseId);
  const atts = useAttachments(caseId);
  const [selected, setSelected] = useState<string>();
  const sourceRef = useRef<HTMLDivElement>(null);
  if (runs.status !== 'ready' || atts.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;
  const run = runs.data.find((r) => r.id === runId);
  const a = run ? atts.data.find((x) => x.id === run.attachmentId) : undefined;
  if (!run || !a) return <Banner tone="warning">{t('review.notFound')}</Banner>;
  const pending = run.fields.filter((f) => !f.decision);
  const decided = run.fields.filter((f) => f.decision);
  const nextRun = runs.data.find((r) => r.id !== run.id && r.fields.some((f) => !f.decision));

  return (
    <div className="flex flex-col gap-4" data-testid="extraction-review">
      <PageTitle back={`#/cases/${caseId}/analyse`}>{t('review.title')}</PageTitle>
      <p className="-mt-3 flex flex-wrap gap-x-2 text-sm text-slate-600">
        <span className="font-medium text-slate-900">{t(`source.docType.${a.docType}`)}</span>
        {a.page !== undefined && <span>{t('source.page', { n: a.page })}</span>}
        <span>
          <Num>{when(run.runAt)}</Num>
        </span>
        <span>{t(run.passes === 2 ? 'review.twoReadings' : 'review.oneReading')}</span>
      </p>
      <Banner tone="info">{t('review.lead')}</Banner>
      {run.sent.identifiersMasked > 0 && <Banner tone="warning">{t('review.masked', { n: run.sent.identifiersMasked })}</Banner>}
      {!run.readable && <Banner tone="warning">{t('review.unreadable')}</Banner>}
      <div ref={sourceRef} className="lg:sticky lg:top-2">
        <SourcePane a={a} run={run} selected={selected} />
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-900" data-testid="review-counts">
          {t('review.counts', { pending: pending.length, total: run.fields.length })}
        </span>
      </div>
      {run.fields.length === 0 && <p className="text-sm text-slate-600">{t('review.empty')}</p>}
      <ol className="flex flex-col gap-3">
        {pending.map((f) => (
          <FieldCard key={f.id} run={run} f={f} selected={selected === f.id} onSelect={() => setSelected(f.id)} />
        ))}
      </ol>
      {decided.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700">{t('review.decidedTitle', { n: decided.length })}</h2>
          <ol className="flex flex-col gap-1.5">
            {decided.map((f) => (
              <FieldCard key={f.id} run={run} f={f} selected={false} onSelect={() => setSelected(f.id)} />
            ))}
          </ol>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {nextRun && pending.length === 0 && (
          <LinkButton href={`#/cases/${caseId}/review/${nextRun.id}`} variant="primary" icon="arrow">
            {t('review.nextDocument')}
          </LinkButton>
        )}
        <LinkButton href={`#/cases/${caseId}/analyse`} variant={nextRun && pending.length === 0 ? 'secondary' : 'primary'} icon="chevron-back">
          {t('review.backToAnalysis')}
        </LinkButton>
      </div>
    </div>
  );
}

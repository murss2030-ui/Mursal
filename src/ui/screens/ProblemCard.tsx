/**
 * The Clinical Problem Card (Section 14), one view wherever a drug-related
 * problem appears: Tasks 5, 13 and 29, the case's Problems list, and the
 * department form's Sections 8 and 9. Each of the thirteen fields shows its
 * content or says what is missing — never a blank. The review (field 10) is
 * decided here, on this card alone.
 */
import { useState, type ReactNode } from 'react';
import { CIPOLLE_NOT_EQUIVALENT } from '../../domain/pcne-maps';
import type { CardFieldStatus, CardModel } from '../../domain/problem-card';
import { buildCard, fromModel } from '../../domain/problem-card';
import type { CardDecision } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { choiceLabel } from '../../domain/workflow/registers';
import { TASKS } from '../../domain/workflow/catalogue';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Banner, Button, CheckboxField, Chip, DayLabel, LinkButton, Num, PageTitle, TextField } from '../components/ui';
import { navigate } from '../router';
import { useSession } from '../session-context';
import { useCaseRules } from '../rules/useCaseRules';
import { BoxList, LinkLine, MapDraftNote, ReviewChip, StaleBadge, StageStepper, calcLabel, entryLabel } from './card-parts';
import { ItemHistory } from './ItemEditor';

const PRIORITY_TONE = { critical: 'red', important: 'amber', informational: 'slate' } as const;

function Field({ status, children, testId }: { status: CardFieldStatus; children?: ReactNode; testId?: string }) {
  const tl = useL();
  const { t } = useI18n();
  return (
    <section className="flex flex-col gap-1.5 border-b border-slate-100 py-3 last:border-b-0" data-testid={testId ?? `card-field-${status.no}`} data-card-field={status.no} data-missing={!!status.missing}>
      <h3 className="text-sm font-semibold text-slate-800">
        <span className="me-1.5 font-mono text-teal-800">{status.no}</span>
        {tl(status.label)}
      </h3>
      {status.missing ? (
        <p className="flex items-start gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-sm text-red-900" data-testid="card-missing">
          <Icon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>{t('card.missing')}</strong> — {tl(status.missing)}
          </span>
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 text-sm text-slate-900">{children}</div>
      )}
      {status.notes.map((n, i) => (
        <p key={i} className="flex items-start gap-1.5 text-xs text-amber-900" data-testid="card-note">
          <Icon name="alert-triangle" className="mt-px h-3.5 w-3.5 shrink-0" />
          {tl(n)}
        </p>
      ))}
    </section>
  );
}

function Text({ children }: { children?: string }) {
  return (
    <p dir="auto" className="whitespace-pre-wrap">
      {children}
    </p>
  );
}

const choice = (field: string, v: string | undefined) => (v ? choiceLabel('drp', field, v) : undefined);

// ---------------------------------------------------------------- field 7: claims with their source and their check

function Claims({ b, card }: { b: CaseBundle; card: CardModel }) {
  const { t, lang } = useI18n();
  return (
    <ul className="flex flex-col gap-2" data-testid="card-claims">
      {card.claims.map(({ claim, check }, i) => {
        const e = claim.source === 'entry' ? b.entries.find((x) => x.id === claim.ref) : undefined;
        const r = claim.source === 'calc' ? b.calcResults.find((x) => x.id === claim.ref) : undefined;
        const label = e ? entryLabel(e, t) : r ? calcLabel(r, lang, t) : claim.title ?? '';
        const ok = check.kind === 'numbers_found';
        const unverified = check.kind === 'not_checked' && check.why !== 'dataset';
        return (
          <li key={i} className={`rounded-lg border px-2 py-1.5 ${claim.source === 'none' ? 'border-dashed border-amber-500 bg-amber-50/60' : 'border-line bg-white'}`} data-claim-source={claim.source} data-check={check.kind}>
            <p dir="auto">{claim.text}</p>
            <p className="mt-1 text-xs text-slate-700">{t(`claims.from.${claim.source}` as MsgKey, { label })}</p>
            <p className={`mt-0.5 text-xs ${ok ? 'text-teal-900' : unverified ? 'text-amber-900' : check.kind === 'not_checked' ? 'text-slate-700' : 'font-medium text-red-800'}`}>
              {check.kind === 'numbers_not_found'
                ? t('claims.check.numbers_not_found', { numbers: check.numbers.join(', ') })
                : check.kind === 'not_checked'
                  ? t(`claims.check.not_checked.${check.why}` as MsgKey)
                  : t(`claims.check.${check.kind}` as MsgKey)}
              {claim.by === 'model' && ` · ${t('claims.byModel')}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- field 10: the review

const REASON_DECISIONS: readonly CardDecision[] = ['rejected', 'needs_evidence', 'needs_senior_review'];

function ReviewPanel({ b, card, readOnly }: { b: CaseBundle; card: CardModel; readOnly: boolean }) {
  const { t, when } = useI18n();
  const { store } = useSession();
  const [open, setOpen] = useState<CardDecision | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const model = fromModel(card.item);
  // D9: the trainee's own card is referred for senior review, then decided with the preceptor.
  const [withPreceptor, setWithPreceptor] = useState(!model);

  const decide = async (decision: Exclude<CardDecision, 'edited'>) => {
    setBusy(true);
    setError(undefined);
    try {
      await store.reviewCard(b.case.id, card.item.id, { decision, ...(REASON_DECISIONS.includes(decision) ? { reason } : {}), withPreceptor: model ? withPreceptor : decision !== 'needs_senior_review' });
      setOpen(null);
      setReason('');
    } catch (e) {
      setError(e instanceof ValidationError ? t('cardReview.reasonRequired') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const editHref = `#/cases/${b.case.id}/item/${card.item.id}?back=card&review=edit${model ? '' : '&preceptor=1'}`;
  const stale = card.staleness.stale;
  const buttons: { d: CardDecision; label: MsgKey; icon: Parameters<typeof Icon>[0]['name'] }[] = [
    { d: 'accepted', label: 'cardReview.accept', icon: 'check' },
    { d: 'edited', label: 'cardReview.edit', icon: 'pencil' },
    { d: 'rejected', label: 'cardReview.reject', icon: 'x' },
    { d: 'needs_evidence', label: 'cardReview.evidence', icon: 'search' },
    { d: 'needs_senior_review', label: 'cardReview.senior', icon: 'graduation' },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="card-review">
      <div className="flex flex-wrap items-center gap-2">
        <ReviewChip review={card.review} />
        {card.review.kind === 'decided' && card.review.changedSince && <span className="text-xs text-slate-600">{t('cardReview.changedSince')}</span>}
      </div>
      {!readOnly && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-slate-50/70 p-3">
          <p className="text-xs text-slate-700">{model ? t('cardReview.lead.model') : t('cardReview.lead.trainee')}</p>
          {!model && <p className="text-xs font-medium text-slate-800">{t('cardReview.withPreceptorLead')}</p>}
          {/* One card, one decision, one click: nothing is pre-selected and nothing acts on other cards. */}
          <div className="flex flex-wrap gap-2">
            {buttons.map(({ d, label, icon }) =>
              d === 'edited' ? (
                <LinkButton key={d} href={editHref} icon={icon}>
                  {t(label)}
                </LinkButton>
              ) : (
                <Button
                  key={d}
                  icon={icon}
                  variant={open === d ? 'primary' : 'secondary'}
                  disabled={busy || (d === 'accepted' && stale)}
                  data-decision={d}
                  onClick={() => {
                    setError(undefined);
                    if (d === 'accepted') {
                      setOpen(open === d ? null : d);
                      return;
                    }
                    setOpen(open === d ? null : d);
                    setReason('');
                  }}
                >
                  {t(label)}
                </Button>
              ),
            )}
          </div>
          {stale && <p className="text-xs text-amber-900">{t('cardReview.staleNoAccept')}</p>}
          {open && (
            <div className="flex flex-col gap-2 rounded-lg border border-slate-300 bg-white p-3" data-testid="review-confirm" data-decision={open}>
              {REASON_DECISIONS.includes(open) && (
                <TextField label={t(`cardReview.reason.${open}` as MsgKey)} value={reason} onChange={setReason} name="review-reason" />
              )}
              {model && open !== 'needs_senior_review' && <CheckboxField label={t('cardReview.withPreceptor')} checked={withPreceptor} onChange={setWithPreceptor} name="with-preceptor" />}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={open === 'rejected' ? 'danger' : 'primary'}
                  disabled={busy || (REASON_DECISIONS.includes(open) && reason.trim().length < 3)}
                  onClick={() => void decide(open as Exclude<CardDecision, 'edited'>)}
                >
                  {t('cardReview.confirm', { decision: t(`cardReview.decision.${open}` as MsgKey) })}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
          {error && (
            <Banner tone="danger" role="alert">
              {error}
            </Banner>
          )}
        </div>
      )}
      {card.reviews.length > 0 ? (
        <ol className="flex flex-col gap-1.5" data-testid="review-history">
          {[...card.reviews].reverse().map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs" data-decision={r.decision}>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <strong className="text-slate-900">{t(`cardReview.decision.${r.decision}` as MsgKey)}</strong>
                <Num>{when(r.at)}</Num>
                <span className="text-slate-600">{t('cardReview.onVersion', { n: r.itemVersion })}</span>
                {r.withPreceptor && <Chip tone="violet">{t('cardReview.withPreceptorShort')}</Chip>}
                {r.fromSuggestion && <Chip tone="violet">{t('cardReview.fromDraft')}</Chip>}
              </span>
              {r.reason && (
                <span className="mt-0.5 block text-slate-800" dir="auto">
                  {r.reason}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-slate-600">{model ? t('cardReview.none') : t('cardReview.noneYours')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- staleness: re-review on the current data (owner decision D8)

function StaleBanner({ b, card, readOnly }: { b: CaseBundle; card: CardModel; readOnly: boolean }) {
  const { t } = useI18n();
  const tl = useL();
  const { store } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!card.staleness.stale) return null;
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await store.reconfirmCard(b.case.id, card.item.id, reason);
      setOpen(false);
      setReason('');
    } catch (e) {
      setError(e instanceof ValidationError ? t('cardReview.reasonRequired') : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="flex flex-col gap-2 rounded-2xl border-2 border-amber-500 bg-amber-50 p-4" data-testid="card-stale">
      <div className="flex flex-wrap items-center gap-2">
        <StaleBadge card={card} />
        <h2 className="text-base font-semibold text-amber-950">{t('card.stale.title')}</h2>
      </div>
      <ul className="list-disc ps-5 text-sm text-amber-950">
        {card.staleness.reasons.map((r, i) => (
          <li key={i}>{tl(r)}</li>
        ))}
      </ul>
      <p className="text-sm text-amber-950">{t('card.stale.lead')}</p>
      {!readOnly &&
        (open ? (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-white p-3">
            <TextField label={t('card.stale.reason')} value={reason} onChange={setReason} name="reconfirm-reason" />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>
                {t('card.stale.save')}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button icon="rotate" onClick={() => setOpen(true)}>
              {t('card.stale.reconfirm')}
            </Button>
            <LinkButton href={`#/cases/${b.case.id}/item/${card.item.id}?back=card`} icon="pencil" variant="ghost">
              {t('card.stale.edit')}
            </LinkButton>
          </div>
        ))}
      {error && (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the card

export function CardBody({ b, card, readOnly }: { b: CaseBundle; card: CardModel; readOnly: boolean }) {
  const { t, lang } = useI18n();
  const tl = useL();
  const f = card.item.fields;
  const st = (n: number) => card.fields[n - 1]!;
  const diagnosis = f.linkedProblemId ? b.problems.find((p) => p.problemId === f.linkedProblemId)?.latest.payload.name : undefined;
  const rank = b.cards.findIndex((c) => c.item.id === card.item.id);
  const rated = (k: 'urgency' | 'significance' | 'impact') => (f[k] ? tl(choice(k, f[k])!) : t('card.f6.notRated'));
  return (
    <div className="surface flex flex-col px-4 py-1" data-testid="problem-card" data-item={card.item.id} data-stale={card.staleness.stale}>
      <Field status={st(1)}>
        <p dir="auto" className="text-base font-semibold">
          {f.problem}
        </p>
        {f.drugs && <p className="text-slate-700">{t('card.f1.drugs', { drugs: f.drugs })}</p>}
        {diagnosis && <p className="text-slate-700">{t('card.f1.diagnosis', { name: diagnosis })}</p>}
      </Field>

      <Field status={st(2)}>
        {card.links.length > 0 && (
          <ul className="flex flex-col gap-1" data-testid="card-links">
            {card.links.map(({ link }) => (
              <li key={`${link.kind}:${link.id}`}>
                <LinkLine b={b} link={link} />
              </li>
            ))}
          </ul>
        )}
        {f.evidence && (
          <p dir="auto" className="whitespace-pre-wrap">
            <span className="text-slate-600">{t('card.f2.words')} </span>
            {f.evidence}
          </p>
        )}
      </Field>

      <Field status={st(3)}>
        <Text>{f.missing}</Text>
      </Field>

      <Field status={st(4)}>
        <Text>{f.assessment}</Text>
      </Field>

      <Field status={st(5)}>
        {card.pcne.problem && (
          <div className="flex flex-col gap-1" data-testid="card-pcne">
            <p>
              <span className="me-1.5 rounded bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-white">{card.pcne.problem.code}</span>
              <span lang="en" dir="ltr">
                {card.pcne.problem.label.en}
              </span>
              {lang === 'ar' && <span className="block text-xs text-slate-600">{card.pcne.problem.label.ar}</span>}
            </p>
            {card.pcne.type && <p className="text-slate-700">{tl(choice('pcneType', card.pcne.type)!)}</p>}
            {card.pcne.causes.length > 0 && (
              <ul className="flex flex-col gap-0.5">
                {card.pcne.causes.map((c) => (
                  <li key={c.code}>
                    <span className="me-1.5 rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs">{c.code}</span>
                    <span lang="en" dir="ltr">
                      {c.label.en}
                    </span>
                    {lang === 'ar' && <span className="block text-xs text-slate-600">{c.label.ar}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-line p-2" data-testid="card-boxes" data-source={card.boxes.source}>
          <p className="text-xs font-medium text-slate-700">{t('card.f5.boxes')}</p>
          <BoxList boxes={card.boxes.boxes} />
          {card.boxes.otherText.length > 0 && <p className="text-xs text-slate-700">{t('card.f5.other', { text: card.boxes.otherText.join('; ') })}</p>}
          {card.boxes.source === 'adjusted' && <p className="text-xs text-slate-700">{t('card.f5.adjusted', { reason: card.boxes.reason ?? '' })}</p>}
          {card.boxes.source === 'legacy' && <p className="text-xs text-slate-700">{t('card.f5.legacy')}</p>}
          {(card.boxes.source === 'pcne' || card.boxes.source === 'adjusted') && <MapDraftNote />}
        </div>
        {card.pcne.problem && (
          <details className="rounded-lg border border-violet-200 bg-violet-50/50 px-2" data-testid="card-cipolle">
            <summary className="min-h-touch cursor-pointer py-2 text-xs font-medium text-violet-950">{t('card.f5.cipolle')}</summary>
            <div className="flex flex-col gap-1 pb-2 text-xs">
              <p className="text-violet-950">{tl(CIPOLLE_NOT_EQUIVALENT)}</p>
              <p className="text-sm font-medium text-slate-900">
                {card.cipolle.category ? tl(card.cipolle.category.label) : t('card.f5.cipolleNone')}
                {card.cipolle.from && <span className="ms-1.5 text-xs font-normal text-slate-600">{t('card.f5.cipolleFrom', { code: card.cipolle.from })}</span>}
              </p>
            </div>
          </details>
        )}
      </Field>

      <Field status={st(6)}>
        <p className="flex flex-wrap items-center gap-2">
          {f.priority && <Chip tone={PRIORITY_TONE[f.priority as keyof typeof PRIORITY_TONE] ?? 'slate'}>{tl(choice('priority', f.priority)!)}</Chip>}
          {rank >= 0 && <span className="text-xs text-slate-600">{t('card.f6.rank', { n: rank + 1, total: b.cards.length })}</span>}
        </p>
        {f.priorityReason && <Text>{f.priorityReason}</Text>}
        <p className="text-xs text-slate-700" data-testid="card-factors">
          {t('card.f6.factors', { u: rated('urgency'), s: rated('significance'), i: rated('impact') })}
        </p>
        <p className="text-xs text-slate-700">{t('card.f6.evidence', { e: t(`card.evidence.${card.evidence}` as MsgKey) })}</p>
      </Field>

      <Field status={st(7)}>
        <Claims b={b} card={card} />
        {f.references && <p className="text-xs text-slate-700">{t('card.f7.references', { refs: f.references })}</p>}
        <p className="text-xs text-slate-600">{t('card.f7.limits')}</p>
      </Field>

      <Field status={st(8)}>
        <Text>{f.recommendation}</Text>
        <span className="inline-flex items-center gap-1 self-start rounded-md border border-dashed border-slate-400 px-1.5 py-0.5 text-xs font-medium text-slate-700" data-drp-state="proposed">
          {f.recStatus === 'final' ? t('drp.proposedFinal') : t('drp.proposedDraft')}
        </span>
      </Field>

      <Field status={st(9)}>
        <Text>{f.monitoring}</Text>
      </Field>

      <Field status={st(10)}>
        <ReviewPanel b={b} card={card} readOnly={readOnly} />
        {f.preceptorReviewed && <p className="text-xs text-slate-700">{t('card.f10.discussed', { v: tl(choice('preceptorReviewed', f.preceptorReviewed)!) })}</p>}
      </Field>

      <Field status={st(11)}>
        {f.response && (
          <p>
            {tl(choice('response', f.response)!)}
            {f.communicatedTo && ` — ${tl(choice('communicatedTo', f.communicatedTo)!)}`}
            {f.communicatedDay && (
              <>
                {' · '}
                <DayLabel day={Number(f.communicatedDay)} />
              </>
            )}
          </p>
        )}
        {f.declineReason && <Text>{t('card.f11.declined', { reason: f.declineReason })}</Text>}
        {f.implemented === 'yes' ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <ProvenanceBadge state="implemented" detail={f.implementedBy} />
            {f.implementedDay && <DayLabel day={Number(f.implementedDay)} />}
          </span>
        ) : (
          <span className="self-start rounded-md border border-dashed border-slate-400 px-1.5 py-0.5 text-xs font-medium text-slate-700">{t('card.f11.notImplemented')}</span>
        )}
      </Field>

      <Field status={st(12)}>
        {f.goalMet === 'not_measured' ? (
          <p className="text-slate-700">{t('drp.notMeasured')}</p>
        ) : (
          f.goalMet && (
            <>
              <span className="flex flex-wrap items-center gap-1.5">
                <ProvenanceBadge state="outcome_documented" />
                <span>{tl(choice('goalMet', f.goalMet)!)}</span>
                {f.outcomeDay && <DayLabel day={Number(f.outcomeDay)} />}
              </span>
              <Text>{f.outcome}</Text>
            </>
          )
        )}
      </Field>

      <Field status={st(13)}>
        <Text>{f.teaching}</Text>
      </Field>
    </div>
  );
}

export function ProblemCardScreen({ caseId, itemId, query }: { caseId: string; itemId: string; query: URLSearchParams }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  const rules = useCaseRules(state.status === 'ready' ? state.b : undefined);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const item = b.allItems.find((i) => i.id === itemId && i.register === 'drp');
  if (!item) return <Banner tone="warning">{t('card.notFound')}</Banner>;
  const alertKeys = rules.ready ? new Set(rules.alerts.map((a) => a.key)) : undefined;
  const card = buildCard(item, { ...b.cardContext, ...(alertKeys ? { alertKeys } : {}) });
  const task = query.get('task');
  const back = task && TASKS.has(task) ? `#/cases/${b.case.id}/task/${task}` : `#/cases/${b.case.id}/problems`;
  const readOnly = b.case.status === 'archived' || item.status === 'retracted';
  return (
    <div className="flex flex-col gap-4" data-testid="card-screen">
      <PageTitle back={back}>{t('card.title')}</PageTitle>
      <div className="-mt-3 flex flex-wrap items-center gap-2">
        <ReviewChip review={card.review} />
        <StaleBadge card={card} />
        <span className="text-xs text-slate-600">{t('common.version', { n: item.version })}</span>
      </div>
      <StageStepper stage={card.stage} />
      {item.status === 'retracted' && <Banner tone="warning">{t('item.isRetracted', { reason: item.changeReason ?? '' })}</Banner>}
      <StaleBanner b={b} card={card} readOnly={readOnly} />
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button icon="pencil" onClick={() => navigate(`/cases/${b.case.id}/item/${item.id}?back=card${task ? `&task=${task}` : ''}`)}>
            {t('card.edit')}
          </Button>
        </div>
      )}
      <CardBody b={b} card={card} readOnly={readOnly} />
      <ItemHistory itemId={item.id} />
    </div>
  );
}

/**
 * The case's Problems list (Section 8, Identify DRPs): "a prioritised set of
 * Problem Cards, not an undifferentiated alert list". Ranked by priority,
 * then urgency, clinical significance, potential impact and the derived
 * strength of the evidence (owner decision D5); each card says why it sits
 * where it does, its stage, its review state and whether it is stale.
 */
import type { CardModel } from '../../domain/problem-card';
import type { Case } from '../../domain/types';
import { choiceLabel } from '../../domain/workflow/registers';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { Banner, Chip, LinkButton } from '../components/ui';
import { ReviewChip, StaleBadge, StageStepper } from './card-parts';

const PRIORITY_TONE = { critical: 'red', important: 'amber', informational: 'slate' } as const;

/** One card, compact: in the Problems list and in the drug-related problem list of Tasks 5, 13 and 29. */
export function CardSummary({ b, card, rank, taskId }: { b: CaseBundle; card: CardModel; rank?: number; taskId?: string }) {
  const { t } = useI18n();
  const tl = useL();
  const f = card.item.fields;
  const label = (k: string, v?: string) => (v ? tl(choiceLabel('drp', k, v)!) : t('card.f6.notRated'));
  const missing = card.fields.filter((x) => x.missing).length;
  const rejected = card.review.kind === 'decided' && card.review.decision === 'rejected';
  return (
    <a
      href={`#/cases/${b.case.id}/card/${card.item.id}${taskId ? `?task=${taskId}` : ''}`}
      className={`flex flex-col gap-2 rounded-xl border bg-white p-3 hover:border-teal-600 ${card.staleness.stale ? 'border-amber-500' : 'border-line'} ${rejected ? 'opacity-70' : ''}`}
      data-testid="card-summary"
      data-item={card.item.id}
      data-stale={card.staleness.stale}
      data-review={card.review.kind === 'decided' ? card.review.decision : card.review.kind}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`font-semibold text-slate-900 ${rejected ? 'line-through' : ''}`} dir="auto">
          {rank !== undefined && <span className="me-1.5 font-mono text-sm text-teal-800">#{rank}</span>}
          {f.problem}
        </span>
        <Icon name="chevron-forward" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {f.priority && <Chip tone={PRIORITY_TONE[f.priority as keyof typeof PRIORITY_TONE] ?? 'slate'}>{tl(choiceLabel('drp', 'priority', f.priority)!)}</Chip>}
        {card.pcne.problem ? (
          <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-white" data-testid="card-pcne-code">
            {[card.pcne.problem.code, ...card.pcne.causes.map((c) => c.code)].join(' · ')}
          </span>
        ) : (
          <Chip tone="red">{t('problems.noPcne')}</Chip>
        )}
        <ReviewChip review={card.review} />
        <StaleBadge card={card} />
        {missing > 0 && (
          <span data-testid="card-missing-count">
            <Chip tone="red">{t('problems.missingN', { n: missing })}</Chip>
          </span>
        )}
      </div>
      {f.drugs && (
        <p className="text-sm text-slate-700" dir="auto">
          {f.drugs}
        </p>
      )}
      <p className="text-xs text-slate-600" data-testid="card-why">
        {t('problems.why', { u: label('urgency', f.urgency), s: label('significance', f.significance), i: label('impact', f.impact), e: t(`card.evidence.${card.evidence}` as MsgKey) })}
      </p>
      <StageStepper stage={card.stage} compact />
    </a>
  );
}

export function ProblemsTab({ c }: { c: Case }) {
  const { t } = useI18n();
  const state = useCaseBundle(c.id);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const readOnly = c.status === 'archived';
  const retracted = b.allItems.filter((i) => i.register === 'drp' && i.status === 'retracted');
  const stale = b.cards.filter((x) => x.staleness.stale).length;
  return (
    <div className="flex flex-col gap-3" data-testid="problems-tab">
      <section className="surface flex flex-col gap-2 p-4">
        <h2 className="text-base font-semibold text-slate-900">
          {t('problems.title')} <span className="text-sm font-normal text-slate-600">({b.cards.length})</span>
        </h2>
        <p className="text-sm text-slate-700">{t('problems.lead')}</p>
        {stale > 0 && <Banner tone="warning">{t('problems.staleN', { n: stale })}</Banner>}
        {!readOnly && (
          <div>
            <LinkButton href={`#/cases/${c.id}/item/new/drp?back=problems`} icon="plus">
              {t('problems.add')}
            </LinkButton>
          </div>
        )}
      </section>
      {b.cards.length === 0 ? (
        <p className="text-sm text-slate-600">{t('problems.none')}</p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="problems-list">
          {b.cards.map((card, i) => (
            <li key={card.item.id}>
              <CardSummary b={b} card={card} rank={i + 1} />
            </li>
          ))}
        </ol>
      )}
      {retracted.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-touch cursor-pointer py-2 text-slate-700">{t('item.retractedN', { n: retracted.length })}</summary>
          <ul className="flex flex-col gap-1">
            {retracted.map((i) => (
              <li key={i.id}>
                <a href={`#/cases/${c.id}/card/${i.id}`} className="text-slate-600 line-through" dir="auto">
                  {i.fields.problem}
                </a>
                {i.changeReason && <span className="ms-2 text-xs text-slate-600">— {i.changeReason}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

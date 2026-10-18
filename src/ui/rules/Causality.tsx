/**
 * Naranjo and WHO-UMC causality questionnaires for a suspected ADR
 * (Section 10). Every question is answered by the trainee — nothing is
 * defaulted — and scored by fixed rules shown with the result; each save is a
 * new version. The trainee's own WHO-UMC category on the ADR row stays as
 * written: a difference is shown, never overwritten.
 */
import { useState } from 'react';
import type { L } from '../../domain/label';
import type { CausalityAssessment, RegisterItem } from '../../domain/types';
import { ValidationError } from '../../domain/validation';
import { choiceLabel } from '../../domain/workflow/registers';
import { useI18n } from '../../i18n/i18n';
import {
  assessUmc,
  NARANJO_CATEGORY_LABEL,
  NARANJO_CITATION,
  NARANJO_QUESTIONS,
  scoreNaranjo,
  UMC_CATEGORY_LABEL,
  UMC_CITATION,
  UMC_QUESTIONS,
  type NaranjoCategory,
  type UmcCategory,
} from '../../rules/causality';
import { useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Banner, Button, Card, LinkButton, Num, PageTitle, RadioGroup } from '../components/ui';
import { navigate } from '../router';
import { useSession } from '../session-context';

export type CausalityMethod = 'naranjo' | 'who_umc';
export const isCausalityMethod = (s: string): s is CausalityMethod => s === 'naranjo' || s === 'who_umc';

export function causalityLabel(a: Pick<CausalityAssessment, 'method' | 'category'>): L {
  return a.method === 'naranjo' ? NARANJO_CATEGORY_LABEL[a.category as NaranjoCategory] : UMC_CATEGORY_LABEL[a.category as UmcCategory];
}

/** Compact results for an ADR row in a register list. */
export function CausalityChips({ b, item }: { b: CaseBundle; item: RegisterItem }) {
  const { t } = useI18n();
  const tl = useL();
  return (
    <>
      {b.causalityOf(item.id).map((a) => (
        <span key={a.method} className="inline-flex items-center rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900" data-testid={`causality-chip-${a.method}`}>
          {t(`caus.method.${a.method}`)}: {tl(causalityLabel(a))}
        </span>
      ))}
    </>
  );
}

/** On the ADR row: both questionnaires, their latest results, and any difference from the trainee's own category. */
export function CausalityPanel({ b, item, readOnly }: { b: CaseBundle; item: RegisterItem; readOnly: boolean }) {
  const { t, when } = useI18n();
  const tl = useL();
  const done = b.causalityOf(item.id);
  const umc = done.find((a) => a.method === 'who_umc');
  const own = item.fields.causality;
  const ownLabel = own ? choiceLabel('adr', 'causality', own) : undefined;
  return (
    <Card title={t('caus.title')}>
      <div className="flex flex-col gap-3" data-testid="causality-panel">
        <p className="text-sm text-slate-700">{t('caus.lead')}</p>
        {(['naranjo', 'who_umc'] as const).map((m) => {
          const a = done.find((x) => x.method === m);
          return (
            <div key={m} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3" data-method={m}>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-slate-900">{t(`caus.method.${m}`)}</span>
                {a ? (
                  <span className="text-sm text-slate-800" data-testid={`causality-result-${m}`}>
                    {tl(causalityLabel(a))}
                    {a.score !== undefined && (
                      <>
                        {' · '}
                        <Num>{t('caus.score', { n: a.score })}</Num>
                      </>
                    )}
                    <span className="block text-xs text-slate-600">{t('caus.version', { n: a.version, when: when(a.versionCreatedAt) })}</span>
                  </span>
                ) : (
                  <span className="text-sm text-slate-600">{t('caus.notDone')}</span>
                )}
              </span>
              {!readOnly && (
                <LinkButton href={`#/cases/${b.case.id}/item/${item.id}/causality/${m}`} variant={a ? 'ghost' : 'secondary'}>
                  {a ? t('caus.review') : t('caus.answer')}
                </LinkButton>
              )}
            </div>
          );
        })}
        {umc && own && own !== umc.category && ownLabel && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="causality-differs">
            {t('caus.differs', { own: tl(ownLabel), q: tl(causalityLabel(umc)) })}
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- the questionnaire

export function CausalityScreen({ caseId, itemId, method }: { caseId: string; itemId: string; method: CausalityMethod }) {
  const { t } = useI18n();
  const state = useCaseBundle(caseId);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const item = b.items.find((i) => i.id === itemId && i.register === 'adr');
  if (!item) return <Banner tone="warning">{t('item.notFound')}</Banner>;
  const existing = b.causalityOf(itemId).find((a) => a.method === method);
  return <Questionnaire key={`${method}@${existing?.version ?? 0}`} b={b} item={item} method={method} existing={existing} />;
}

function Questionnaire({ b, item, method, existing }: { b: CaseBundle; item: RegisterItem; method: CausalityMethod; existing?: CausalityAssessment }) {
  const { t } = useI18n();
  const tl = useL();
  const { store } = useSession();
  const [answers, setAnswers] = useState<Record<string, string>>(existing?.answers ?? {});
  const [missing, setMissing] = useState<string[]>([]);
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const readOnly = b.case.status === 'archived';
  const back = `/cases/${b.case.id}/item/${item.id}`;
  const set = (id: string) => (v: string) => {
    setMissing((m) => m.filter((x) => x !== id));
    setAnswers((a) => ({ ...a, [id]: v }));
  };

  const naranjo = method === 'naranjo' ? scoreNaranjo(answers) : undefined;
  const umc = method === 'who_umc' ? assessUmc(answers) : undefined;
  // WHO-UMC: when the information is not sufficient, the other criteria do not apply.
  const umcQuestions = UMC_QUESTIONS.filter((q) => q.id === 'information' || answers.information === 'sufficient');

  const save = async () => {
    setFailure(undefined);
    setBusy(true);
    try {
      const relevant = method === 'who_umc' ? Object.fromEntries(Object.entries(answers).filter(([k]) => umcQuestions.some((q) => q.id === k))) : answers;
      await store.saveCausality(b.case.id, item.id, method, relevant);
      navigate(back);
    } catch (e) {
      if (e instanceof ValidationError) setMissing(Object.keys(e.errors));
      else setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unanswered = (id: string) => (missing.includes(id) ? t('caus.unanswered') : undefined);

  return (
    <div className="flex flex-col gap-4" data-testid="causality-form" data-method={method}>
      <PageTitle back={`#${back}`}>{t(`caus.method.${method}`)}</PageTitle>
      <p className="-mt-3 text-sm text-slate-700" dir="auto">
        {t('caus.for', { drug: item.fields.drug ?? '', reaction: item.fields.reaction ?? '' })}
      </p>
      <Banner tone="info">{t(method === 'naranjo' ? 'caus.naranjoLead' : 'caus.umcLead')}</Banner>
      <Card>
        <fieldset disabled={readOnly || busy} className="flex flex-col gap-5">
          {method === 'naranjo'
            ? NARANJO_QUESTIONS.map((q, i) => (
                <RadioGroup
                  key={q.id}
                  name={q.id}
                  label={`${i + 1}. ${tl(q.label)}`}
                  value={answers[q.id] ?? ''}
                  onChange={set(q.id)}
                  error={unanswered(q.id)}
                  options={(['yes', 'no', 'unknown'] as const).map((a) => ({ value: a, label: `${t(`caus.answer.${a}`)} (${q.points[a] > 0 ? '+' : ''}${q.points[a]})` }))}
                />
              ))
            : umcQuestions.map((q) => (
                <RadioGroup key={q.id} name={q.id} label={tl(q.label)} value={answers[q.id] ?? ''} onChange={set(q.id)} error={unanswered(q.id)} options={q.options.map((o) => ({ value: o.value, label: tl(o.label) }))} />
              ))}
        </fieldset>
      </Card>

      <section className="surface flex flex-col gap-2 p-4" data-testid="causality-live" aria-live="polite">
        <h2 className="text-base font-semibold text-slate-900">{t('caus.result')}</h2>
        {naranjo &&
          (naranjo.ok ? (
            <>
              <p className="text-lg font-semibold text-slate-900">
                <Num>{t('caus.score', { n: naranjo.score })}</Num> → {tl(NARANJO_CATEGORY_LABEL[naranjo.category])}
              </p>
              <details>
                <summary className="min-h-touch cursor-pointer py-2 text-sm font-medium text-teal-900">{t('caus.steps')}</summary>
                <ol className="font-mono text-xs text-slate-700" dir="ltr">
                  {naranjo.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </details>
            </>
          ) : (
            <p className="text-sm text-slate-700">{t('caus.remaining', { n: naranjo.unanswered.length })}</p>
          ))}
        {umc &&
          (umc.ok ? (
            <>
              <p className="text-lg font-semibold text-slate-900">{tl(UMC_CATEGORY_LABEL[umc.category])}</p>
              <p className="text-sm text-slate-700">{tl(umc.reason)}</p>
            </>
          ) : (
            <p className="text-sm text-slate-700">{t('caus.remaining', { n: umc.unanswered.length })}</p>
          ))}
        <p className="text-xs text-slate-600">
          {t('caus.citation')}: {method === 'naranjo' ? NARANJO_CITATION : UMC_CITATION}
        </p>
        <p className="text-xs text-slate-600">{t('caus.judgement')}</p>
      </section>

      {missing.length > 0 && (
        <Banner tone="danger" role="alert">
          {t('caus.answerAll')}
        </Banner>
      )}
      {failure && (
        <Banner tone="danger" role="alert">
          {failure}
        </Banner>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="check" onClick={() => void save()} disabled={busy} data-testid="causality-save">
            {t('caus.save')}
          </Button>
          <LinkButton href={`#${back}`} variant="ghost">
            {t('common.cancel')}
          </LinkButton>
        </div>
      )}
    </div>
  );
}

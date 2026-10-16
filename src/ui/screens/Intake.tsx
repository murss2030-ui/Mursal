import { useI18n } from '../../i18n/i18n';
import { useAttachments, useCaseVersions } from '../data';
import { Icon } from '../components/Icon';
import { Banner, LinkButton } from '../components/ui';
import { AddSourceTiles, SourceList } from './SourceIntake';

export function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const { t } = useI18n();
  const steps = [t('intake.step1'), t('intake.step2'), t('intake.stepAnalyse'), t('intake.step3')];
  return (
    <ol className="flex items-center gap-2 text-xs font-medium" aria-label={t('intake.steps')}>
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3 | 4;
        const done = n < step;
        const on = n === step;
        return (
          <li key={s} className="flex flex-1 items-center gap-2" aria-current={on ? 'step' : undefined}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-600 text-white' : on ? 'bg-ink text-white' : 'border border-slate-300 bg-white text-slate-500'}`}
            >
              {done ? <Icon name="check" className="h-4 w-4" /> : n}
            </span>
            <span className={on ? 'text-slate-900' : 'text-slate-500'}>{s}</span>
            {n < steps.length && <span className="h-px flex-1 bg-slate-300" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Step 2 of a new case: the patient file. "Next" opens the Clinical Modules. */
export function Intake({ caseId }: { caseId: string }) {
  const { t } = useI18n();
  const versions = useCaseVersions(caseId);
  const atts = useAttachments(caseId);
  if (versions.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;
  const c = versions.data.at(-1);
  if (!c) return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  if (c.status === 'archived') return <Banner tone="info">{t('caseView.archived')}</Banner>;
  const list = atts.status === 'ready' ? atts.data : [];
  const count = list.filter((a) => a.status === 'active').length;
  return (
    <div className="flex flex-col gap-4" data-testid="intake">
      <Stepper step={2} />
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t('intake.title')}</h1>
        <p className="mt-1 text-sm text-slate-700">
          <span className="font-mono" dir="ltr">
            {c.id}
          </span>{' '}
          · {t('intake.lead')}
        </p>
      </div>
      <AddSourceTiles c={c} back="intake" />
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-slate-900">{t('intake.added', { n: count })}</h2>
        <SourceList caseId={c.id} attachments={list} />
      </section>
      <NextToModules caseId={c.id} count={count} />
    </div>
  );
}

/**
 * The "Next" bar of the patient file (intake step 2 and the Patient file tab):
 * Next analyses the file (owner decision D2); the Clinical Modules stay one
 * tap away for working by hand.
 */
export function NextToModules({ caseId, count, help }: { caseId: string; count: number; help?: string }) {
  const { t } = useI18n();
  return (
    <div className="sticky bottom-[112px] z-10 flex flex-col gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lift backdrop-blur" data-testid="next-to-modules">
      <LinkButton href={`#/cases/${caseId}/analyse`} variant="primary" icon="sparkle" className="w-full">
        {t('intake.nextAnalyse')}
      </LinkButton>
      <a href={`#/cases/${caseId}/modules`} className="inline-flex min-h-touch items-center justify-center gap-1 text-sm font-medium text-teal-900 underline">
        {t('intake.skipToModules')}
      </a>
      <p className="text-center text-xs text-slate-600">{help ?? (count === 0 ? t('intake.nextEmpty') : t('intake.nextHelp'))}</p>
    </div>
  );
}

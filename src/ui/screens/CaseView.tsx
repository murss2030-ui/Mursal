import { RELEASE_GATE_MET } from '../../config/release';
import { hospitalDayOf } from '../../domain/dates';
import type { Case } from '../../domain/types';
import { caseTally } from '../../domain/workflow/tasks';
import { Term, useI18n } from '../../i18n/i18n';
import { Banner, DayLabel, Num } from '../components/ui';
import { Icon } from '../components/Icon';
import { ProgressRing } from '../components/Progress';
import { useCaseVersions, useTasks } from '../data';
import { useSession } from '../session-context';
import { AuditList } from './AuditPage';
import { DetailsTab } from './DetailsTab';
import { FormTab } from './FormTab';
import { ModulesHub } from './ModulesHub';
import { SourcesTab } from './SourcesTab';
import { TimelineTab } from './TimelineTab';

const TABS = ['modules', 'timeline', 'sources', 'form', 'details', 'audit'] as const;
type Tab = (typeof TABS)[number];

export function CaseHero({ c }: { c: Case }) {
  const { t } = useI18n();
  const { store } = useSession();
  const tasks = useTasks(c.id);
  const tally = caseTally(tasks.status === 'ready' ? tasks.data : []);
  return (
    <section className="relative overflow-hidden rounded-2xl bg-ink p-4 text-white shadow-lift" data-testid="case-hero">
      <div aria-hidden="true" className="pointer-events-none absolute -end-10 -top-10 h-40 w-40 rounded-full bg-teal-500/20 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <a href="#/cases" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-teal-100 hover:bg-white/10" aria-label={t('common.back')}>
              <Icon name="chevron-back" className="h-5 w-5" />
            </a>
            <h1 className="font-mono text-2xl font-semibold tracking-wide" dir="ltr">
              {c.id}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-teal-50">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.kind === 'clinical' ? 'bg-violet-200 text-violet-950' : 'bg-teal-200 text-teal-950'}`}>
              <Term id={c.kind === 'clinical' ? 'clinical_case' : 'teaching_case'} />
            </span>
            <span>{t('case.ageSex', { age: c.demographics.ageYears, sex: t(`sex.${c.demographics.sex}`) })}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-teal-100">
            {c.status === 'active' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 font-medium text-white">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-saffron-400" />
                <DayLabel day={hospitalDayOf(c.admissionDay0, store.today())} />
              </span>
            ) : (
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{t(`case.status.${c.status}`)}</span>
            )}
            {c.ward && (
              <span className="inline-flex min-w-0 items-center gap-1" dir="auto">
                <Icon name="bed" className="h-4 w-4 shrink-0 text-teal-200" />
                <span className="truncate">{c.ward}</span>
              </span>
            )}
          </div>
        </div>
        <ProgressRing
          value={tally.complete}
          total={tally.total}
          size={76}
          stroke={8}
          trackClass="stroke-white/15"
          barClass="stroke-saffron-400"
          label={t('modules.progressLabel', { done: tally.complete, total: tally.total })}
        >
          <span className="flex flex-col items-center leading-none">
            <Num>
              <span className="text-lg font-semibold">{tally.complete}</span>
              <span className="text-xs text-teal-100">/{tally.total}</span>
            </Num>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-teal-100">{t('modules.tasksShort')}</span>
          </span>
        </ProgressRing>
      </div>
    </section>
  );
}

export function CaseView({ caseId, tab }: { caseId: string; tab: string }) {
  const { t } = useI18n();
  const versions = useCaseVersions(caseId);
  const active: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'modules';

  if (versions.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (versions.status === 'error') return <Banner tone="danger">{versions.error.message}</Banner>;
  const c: Case | undefined = versions.data.at(-1);
  if (!c) return <Banner tone="warning">{t('caseView.notFound')}</Banner>;

  return (
    <div className="flex flex-col gap-3">
      <CaseHero c={c} />
      {!RELEASE_GATE_MET && <Banner tone="warning">{t('caseView.synthetic')}</Banner>}
      {c.status === 'archived' && <Banner tone="info">{t('caseView.archived')}</Banner>}

      <nav
        role="tablist"
        aria-label={t('caseView.tabs')}
        className="sticky top-[78px] z-10 -mx-4 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 px-3 py-1.5 backdrop-blur [scrollbar-width:none]"
      >
        {TABS.map((k) => (
          <a
            key={k}
            role="tab"
            aria-selected={active === k}
            href={`#/cases/${c.id}/${k}`}
            className={`flex min-h-[40px] shrink-0 items-center justify-center rounded-full px-3.5 text-sm font-medium ${active === k ? 'bg-ink text-white' : 'text-slate-700 hover:bg-white'}`}
          >
            {t(`caseView.tab.${k}`)}
          </a>
        ))}
      </nav>

      {active === 'modules' && <ModulesHub caseId={c.id} />}
      {active === 'timeline' && <TimelineTab c={c} />}
      {active === 'sources' && <SourcesTab c={c} />}
      {active === 'form' && <FormTab c={c} />}
      {active === 'details' && <DetailsTab c={c} versions={versions.data} />}
      {active === 'audit' && <AuditList caseId={c.id} />}
    </div>
  );
}

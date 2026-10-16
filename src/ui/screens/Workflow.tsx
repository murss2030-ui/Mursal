import { hospitalDayOf } from '../../domain/dates';
import type { Case, RegisterItem, TaskRecord } from '../../domain/types';
import { caseTally, nextTask } from '../../domain/workflow/tasks';
import { Term, useI18n } from '../../i18n/i18n';
import { Bi } from '../bilingual';
import { Icon } from '../components/Icon';
import { ProgressRing } from '../components/Progress';
import { Banner, DayLabel, LinkButton, Num, PageTitle } from '../components/ui';
import { useAllItems, useAllTasks, useCases } from '../data';
import { useSession } from '../session-context';

export interface Attention {
  awaiting: number;
  overdue: number;
  dueToday: number;
}

export function attentionOf(c: Case, items: readonly RegisterItem[], today: string): Attention {
  const mine = items.filter((i) => i.caseId === c.id && i.status === 'active');
  const day = c.status === 'active' ? hospitalDayOf(c.admissionDay0, today) : null;
  const mon = mine.filter((i) => i.register === 'monitoring' && i.fields.status === 'active' && i.fields.nextDay !== undefined);
  return {
    awaiting: mine.filter((i) => i.register === 'drp' && i.fields.response === 'awaiting').length,
    overdue: day === null ? 0 : mon.filter((i) => Number(i.fields.nextDay) < day).length,
    dueToday: day === null ? 0 : mon.filter((i) => Number(i.fields.nextDay) === day).length,
  };
}

export function AttentionChips({ a }: { a: Attention }) {
  const { t } = useI18n();
  if (!a.awaiting && !a.overdue && !a.dueToday) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {a.overdue > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-900">{t('workflow.overdue', { n: a.overdue })}</span>}
      {a.dueToday > 0 && <span className="rounded-full bg-saffron-100 px-2 py-0.5 text-xs font-medium text-saffron-900">{t('workflow.dueToday', { n: a.dueToday })}</span>}
      {a.awaiting > 0 && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">{t('workflow.awaiting', { n: a.awaiting })}</span>}
    </span>
  );
}

function CaseWork({ c, tasks, items }: { c: Case; tasks: readonly TaskRecord[]; items: readonly RegisterItem[] }) {
  const { t } = useI18n();
  const { store } = useSession();
  const mine = tasks.filter((x) => x.caseId === c.id);
  const tally = caseTally(mine);
  const next = nextTask(mine);
  const att = attentionOf(c, items, store.today());
  return (
    <section className="surface flex flex-col gap-3 p-4" data-testid="workflow-case">
      <div className="flex items-center gap-3">
        <ProgressRing value={tally.complete} total={tally.total} size={56} stroke={6} label={t('modules.progressLabel', { done: tally.complete, total: tally.total })}>
          <Num>
            <span className="text-sm font-semibold">{tally.complete}</span>
          </Num>
        </ProgressRing>
        <div className="flex min-w-0 flex-1 flex-col">
          <a href={`#/cases/${c.id}/modules`} className="font-mono text-lg font-semibold text-slate-900 hover:underline" dir="ltr">
            {c.id}
          </a>
          <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Term id={c.kind === 'clinical' ? 'clinical_case' : 'teaching_case'} />
            <span>{t('case.ageSex', { age: c.demographics.ageYears, sex: t(`sex.${c.demographics.sex}`) })}</span>
            <DayLabel day={hospitalDayOf(c.admissionDay0, store.today())} />
          </span>
          <span className="mt-1 text-xs text-slate-700">{t('modules.progressLabel', { done: tally.complete, total: tally.total })}</span>
        </div>
      </div>
      <AttentionChips a={att} />
      {next && (
        <a href={`#/cases/${c.id}/task/${next.id}`} className="flex items-center gap-3 rounded-xl bg-paper p-3 hover:bg-saffron-50">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white tabular">{next.number}</span>
          <Bi l={next.title} className="min-w-0 flex-1 text-sm font-medium text-slate-900" />
          <Icon name="arrow" className="h-5 w-5 text-slate-500" />
        </a>
      )}
    </section>
  );
}

export function Workflow() {
  const { t } = useI18n();
  const cases = useCases();
  const tasks = useAllTasks();
  const items = useAllItems();
  if (cases.status !== 'ready' || tasks.status !== 'ready' || items.status !== 'ready') return <p className="text-slate-600">{t('common.loading')}</p>;
  const active = cases.data.filter((c) => c.status === 'active').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return (
    <div className="flex flex-col gap-4" data-testid="workflow">
      <PageTitle>{t('workflow.title')}</PageTitle>
      <p className="-mt-3 text-sm text-slate-700">{t('workflow.lead')}</p>
      {active.length === 0 ? (
        <Banner tone="info">
          <span className="flex flex-col items-start gap-2">
            {t('workflow.empty')}
            <LinkButton href="#/cases/new" variant="primary" icon="plus">
              {t('home.newCase')}
            </LinkButton>
          </span>
        </Banner>
      ) : (
        active.map((c) => <CaseWork key={c.id} c={c} tasks={tasks.data} items={items.data} />)
      )}
    </div>
  );
}

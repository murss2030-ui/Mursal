import { MODULES, TASKS, type ModuleDef } from '../../domain/workflow/catalogue';
import type { TaskStatus } from '../../domain/types';
import { moduleTally, nextTask, statusOf } from '../../domain/workflow/tasks';
import { useI18n } from '../../i18n/i18n';
import { Bi, useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/Progress';
import { Banner, LinkButton, Num } from '../components/ui';
import { MODULE_STYLE } from '../modules-style';

/** A task's status as a compact, labelled marker. Shape and text, not colour alone, carry the state. */
export function StatusDot({ n, status, solid }: { n: number; status: TaskStatus; solid: string }) {
  const { t } = useI18n();
  const cls =
    status === 'done'
      ? `${solid} border-transparent text-white`
      : status === 'not_applicable'
        ? 'border-slate-300 bg-slate-200 text-slate-600 line-through'
        : status === 'in_progress'
          ? 'border-current bg-white text-slate-900 border-dashed'
          : 'border-slate-300 bg-white text-slate-500';
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-1.5 text-[11px] font-semibold tabular ${cls}`}
      title={`${n} — ${t(`modules.status.${status}`)}`}
    >
      <span aria-hidden="true">{status === 'done' ? '✓' : n}</span>
      <span className="sr-only">
        {t('modules.taskN', { n })}: {t(`modules.status.${status}`)}
      </span>
    </span>
  );
}

export function StatusChip({ status }: { status: TaskStatus }) {
  const { t } = useI18n();
  const cls = {
    not_started: 'border-slate-300 bg-white text-slate-700',
    in_progress: 'border-saffron-300 bg-saffron-50 text-saffron-900',
    done: 'border-emerald-300 bg-emerald-50 text-emerald-900',
    not_applicable: 'border-slate-300 bg-slate-100 text-slate-700',
  }[status];
  const icon = { not_started: '○', in_progress: '◐', done: '✓', not_applicable: '—' }[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`} data-status={status}>
      <span aria-hidden="true">{icon}</span>
      {t(`modules.status.${status}`)}
    </span>
  );
}

function ModuleCard({ m, b }: { m: ModuleDef; b: CaseBundle }) {
  const { t } = useI18n();
  const tl = useL();
  const st = MODULE_STYLE[m.id];
  const tally = moduleTally(m.id, b.tasks);
  return (
    <a
      href={`#/cases/${b.case.id}/modules/${m.id}`}
      className="surface group flex flex-col gap-3 p-4 transition-shadow hover:shadow-lift"
      data-testid={`module-${m.id}`}
    >
      <div className="flex items-start gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${st.soft} ${st.text}`}>
          <Icon name={st.icon} className="h-6 w-6" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <Bi l={m.title} className="text-base font-semibold text-slate-900" />
          <span className="mt-0.5 text-xs text-slate-600">{tl(m.subtitle)}</span>
        </div>
        <Icon name="chevron-forward" className="mt-1 h-5 w-5 text-slate-400 group-hover:text-slate-700" />
      </div>
      <div className="flex items-center gap-3">
        <ProgressBar value={tally.complete} total={tally.total} barClass={st.bar} label={t('modules.moduleProgress', { done: tally.complete, total: tally.total })} />
        <span className="shrink-0 text-xs font-medium text-slate-700">
          <Num>
            {tally.complete}/{tally.total}
          </Num>
        </span>
      </div>
      <div className={`flex flex-wrap gap-1.5 ${st.text}`}>
        {m.tasks.map((id) => {
          const d = TASKS.get(id)!;
          return <StatusDot key={id} n={d.number} status={statusOf(b.taskById.get(id))} solid={st.solid} />;
        })}
      </div>
    </a>
  );
}

export function ModulesHub({ caseId }: { caseId: string }) {
  const { t } = useI18n();
  const tl = useL();
  const state = useCaseBundle(caseId);
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const next = nextTask(b.tasks);
  const started = next ? statusOf(b.taskById.get(next.id)) === 'in_progress' : false;

  return (
    <div className="flex flex-col gap-4" data-testid="modules-hub">
      {b.activeAttachments.length === 0 && b.case.status !== 'archived' && (
        <a href={`#/cases/${b.case.id}/intake`} className="surface flex items-center gap-3 border-dashed p-4 hover:shadow-lift">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-saffron-50 text-saffron-800">
            <Icon name="file-plus" className="h-5 w-5" />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold text-slate-900">{t('hub.addFileTitle')}</span>
            <span className="text-sm text-slate-600">{t('hub.addFileLead')}</span>
          </span>
          <Icon name="chevron-forward" className="h-5 w-5 text-slate-400" />
        </a>
      )}

      {next ? (
        <section className="surface flex flex-col gap-3 border-saffron-300 bg-gradient-to-br from-white to-saffron-50 p-4" data-testid="next-task">
          <span className="text-xs font-semibold uppercase tracking-wide text-saffron-800">{started ? t('hub.continueLabel') : t('hub.nextLabel')}</span>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-semibold text-white tabular">{next.number}</span>
            <div className="flex min-w-0 flex-col">
              <Bi l={next.title} className="font-semibold text-slate-900" />
              <span className="mt-1 text-sm text-slate-700">{tl(next.purpose)}</span>
            </div>
          </div>
          <LinkButton href={`#/cases/${b.case.id}/task/${next.id}`} variant="primary" icon="arrow" className="self-start">
            {started ? t('hub.continue') : t('hub.start')}
          </LinkButton>
        </section>
      ) : (
        <Banner tone="success">{t('hub.allDone')}</Banner>
      )}

      <a href={`#/cases/${b.case.id}/calc`} className="surface flex items-center gap-3 p-4 hover:shadow-lift" data-testid="open-calculators">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-900">
          <Icon name="function" className="h-5 w-5" />
        </span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold text-slate-900">{t('calc.title')}</span>
          <span className="text-sm text-slate-600">{t('calc.subtitle')}</span>
        </span>
        <Icon name="chevron-forward" className="h-5 w-5 text-slate-400 rtl:rotate-180" />
      </a>

      <div className="flex items-end justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">{t('hub.journey')}</h2>
        <span className="text-xs text-slate-600">{t('hub.journeyLead')}</span>
      </div>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODULES.map((m, i) => (
          <li key={m.id} className="relative">
            <span className="absolute -start-1 -top-1 z-[1] flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-white tabular" aria-hidden="true">
              {i + 1}
            </span>
            <ModuleCard m={m} b={b} />
          </li>
        ))}
      </ol>
    </div>
  );
}

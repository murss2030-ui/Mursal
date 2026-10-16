import { MODULE_BY_ID, MODULES, TASKS, type ModuleId } from '../../domain/workflow/catalogue';
import { moduleTally, statusOf, taskProgress } from '../../domain/workflow/tasks';
import { useI18n } from '../../i18n/i18n';
import { Bi, useL } from '../bilingual';
import { useCaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/Progress';
import { Banner, Num } from '../components/ui';
import { MODULE_STYLE } from '../modules-style';
import { StatusChip } from './ModulesHub';

export function ModulePage({ caseId, moduleId }: { caseId: string; moduleId: string }) {
  const { t } = useI18n();
  const tl = useL();
  const state = useCaseBundle(caseId);
  const m = MODULE_BY_ID.get(moduleId as ModuleId);
  if (!m) return <Banner tone="warning">{t('modules.unknown')}</Banner>;
  if (state.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (state.status === 'error') return <Banner tone="danger">{state.error.message}</Banner>;
  if (state.status === 'missing') return <Banner tone="warning">{t('caseView.notFound')}</Banner>;
  const b = state.b;
  const st = MODULE_STYLE[m.id];
  const tally = moduleTally(m.id, b.tasks);
  const idx = MODULES.findIndex((x) => x.id === m.id);
  const prev = MODULES[idx - 1];
  const next = MODULES[idx + 1];
  const scope = { medIds: b.activeCourses.map((c) => c.medId), problemIds: b.problems.map((p) => p.problemId) };

  return (
    <div className="flex flex-col gap-4" data-testid="module-page">
      <section className={`surface overflow-hidden`}>
        <div className={`flex items-start gap-3 p-4 ${st.soft}`}>
          <a href={`#/cases/${caseId}/modules`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-white/60" aria-label={t('common.back')}>
            <Icon name="chevron-back" className="h-6 w-6" />
          </a>
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white ${st.text}`}>
            <Icon name={st.icon} className="h-7 w-7" />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className={`text-xs font-semibold uppercase tracking-wide ${st.text}`}>
              {t('modules.moduleN', { n: idx + 1 })} · <span className="font-mono" dir="ltr">{caseId}</span>
            </span>
            <h1 className="text-xl font-semibold text-slate-900">
              <Bi l={m.title} subClassName="text-sm font-normal text-slate-600" />
            </h1>
            <p className="mt-1 text-sm text-slate-700">{tl(m.subtitle)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <ProgressBar value={tally.complete} total={tally.total} barClass={st.bar} label={t('modules.moduleProgress', { done: tally.complete, total: tally.total })} />
          <span className="shrink-0 text-sm font-medium text-slate-700">{t('modules.moduleProgress', { done: tally.complete, total: tally.total })}</span>
        </div>
      </section>

      <ol className="flex flex-col gap-3">
        {m.tasks.map((id) => {
          const d = TASKS.get(id)!;
          const rec = b.taskById.get(id);
          const status = statusOf(rec);
          const p = taskProgress(d, rec, scope);
          return (
            <li key={id}>
              <a href={`#/cases/${caseId}/task/${id}`} className="surface flex items-start gap-3 p-4 hover:shadow-lift" data-testid={`task-row-${d.number}`}>
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular ${status === 'done' ? `${st.solid} text-white` : `${st.soft} ${st.text}`}`}>
                  {status === 'done' ? <Icon name="check" className="h-5 w-5" /> : d.number}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Bi l={d.title} className="font-semibold text-slate-900" />
                  <span className="text-sm text-slate-600">{tl(d.purpose)}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip status={status} />
                    {p.total > 0 && (
                      <span className="text-xs text-slate-600">
                        <Num>{t('modules.answered', { a: p.answered, n: p.total })}</Num>
                      </span>
                    )}
                    {p.issues > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-800">
                        <Icon name="alert-triangle" className="h-3.5 w-3.5" />
                        {t('modules.issues', { n: p.issues })}
                      </span>
                    )}
                  </div>
                </div>
                <Icon name="chevron-forward" className="mt-2 h-5 w-5 text-slate-400" />
              </a>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-2">
        {prev ? (
          <a href={`#/cases/${caseId}/modules/${prev.id}`} className="inline-flex min-h-touch items-center gap-1 rounded-lg px-2 text-sm font-medium text-teal-900 hover:bg-white">
            <Icon name="chevron-back" className="h-4 w-4" />
            {tl(prev.title)}
          </a>
        ) : (
          <span />
        )}
        {next && (
          <a href={`#/cases/${caseId}/modules/${next.id}`} className="inline-flex min-h-touch items-center gap-1 rounded-lg px-2 text-sm font-medium text-teal-900 hover:bg-white">
            {tl(next.title)}
            <Icon name="chevron-forward" className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

import { hospitalDayOf } from '../../domain/dates';
import { currentRotation, rotationProgress } from '../../domain/rotation';
import type { Case, Rotation } from '../../domain/types';
import { caseTally } from '../../domain/workflow/tasks';
import { Term, useI18n } from '../../i18n/i18n';
import type { TermId } from '../../i18n/terms';
import { Icon } from '../components/Icon';
import { ProgressBar, ProgressRing } from '../components/Progress';
import { Banner, Button, Chip, DayLabel, LinkButton, Num } from '../components/ui';
import { useInstallPrompt } from '../pwa';
import { useAllItems, useAllTasks, useCases, useRotations } from '../data';
import { useSession } from '../session-context';
import { attentionOf, AttentionChips } from './Workflow';

export function rotationName(r: Rotation, term: (id: TermId) => string): string {
  return r.department === 'other' && r.departmentOther ? r.departmentOther : term(`dept.${r.department}` as TermId);
}

export function CaseRow({ c }: { c: Case }) {
  const { t } = useI18n();
  const { store } = useSession();
  const tasks = useAllTasks();
  const items = useAllItems();
  const today = store.today();
  const tally = caseTally(tasks.status === 'ready' ? tasks.data.filter((x) => x.caseId === c.id) : []);
  return (
    <a href={`#/cases/${c.id}`} className="flex min-h-touch items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5 shadow-card hover:border-teal-600" data-testid="case-row">
      <ProgressRing value={tally.complete} total={tally.total} size={44} stroke={5} label={t('modules.progressLabel', { done: tally.complete, total: tally.total })}>
        <span className="text-[11px] font-semibold tabular">{tally.complete}</span>
      </ProgressRing>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-base font-semibold text-slate-900" dir="ltr">
          {c.id}
        </span>
        <span className="text-sm text-slate-600">
          {t('case.ageSex', { age: c.demographics.ageYears, sex: t(`sex.${c.demographics.sex}`) })}
          {c.ward ? ` · ${c.ward}` : ''}
        </span>
        {items.status === 'ready' && <AttentionChips a={attentionOf(c, items.data, today)} />}
      </div>
      <div className="flex flex-col items-end gap-1">
        <Chip tone={c.kind === 'clinical' ? 'violet' : 'teal'}>
          <Term id={c.kind === 'clinical' ? 'clinical_case' : 'teaching_case'} />
        </Chip>
        {c.status === 'active' ? (
          <span className="text-xs text-slate-600">
            <DayLabel day={hospitalDayOf(c.admissionDay0, today)} />
          </span>
        ) : (
          <span className="text-xs text-slate-600">{t(`case.status.${c.status}`)}</span>
        )}
      </div>
    </a>
  );
}

export function Home() {
  const { t, term, date } = useI18n();
  const { store } = useSession();
  const rotations = useRotations();
  const cases = useCases();
  const install = useInstallPrompt();
  const today = store.today();

  const rot = rotations.status === 'ready' ? currentRotation(rotations.data, today) : undefined;
  const active =
    cases.status === 'ready'
      ? cases.data.filter((c) => c.status === 'active').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      : [];
  const prog = rot ? rotationProgress(rot, today) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <section className="relative overflow-hidden rounded-2xl bg-ink p-5 text-white shadow-lift" data-testid="home-hero">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -end-10 h-48 w-48 rounded-full bg-saffron-400/20 blur-3xl" />
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-saffron-300">{t('home.rotation')}</span>
        {rotations.status !== 'ready' ? (
          <p className="mt-2 text-teal-100">{t('common.loading')}</p>
        ) : rot && prog ? (
          <div className="relative mt-1 flex flex-col gap-2" data-testid="current-rotation">
            <p className="text-2xl font-semibold">{rotationName(rot, term)}</p>
            <p className="text-sm text-teal-100">
              <Num>
                {date(rot.startDate)} – {date(rot.endDate)}
              </Num>{' '}
              · {t('home.rotationDay', { d: prog.day, total: prog.total })}
            </p>
            <ProgressBar value={prog.day} total={prog.total} barClass="bg-saffron-400" label={t('home.rotationDay', { d: prog.day, total: prog.total })} />
            {rot.competencies.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rot.competencies.map((c) => (
                  <span key={c} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-teal-50">
                    <Term id={`comp.${c}` as TermId} />
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="relative mt-2 flex flex-col gap-3">
            <p className="text-teal-50">{t('home.noRotation')}</p>
            <a href="#/rotations/new" className="inline-flex min-h-touch items-center gap-2 self-start rounded-xl bg-saffron-400 px-4 font-semibold text-ink hover:bg-saffron-300">
              <Icon name="plus" />
              {t('home.createRotation')}
            </a>
          </div>
        )}
      </section>

      <a href="#/cases/new" className="surface flex items-center gap-4 p-4 transition-shadow hover:shadow-lift" data-testid="home-new-case">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-saffron-100 text-saffron-800">
          <Icon name="plus" className="h-6 w-6" />
        </span>
        <span className="flex flex-col">
          <span className="text-base font-semibold text-slate-900">{t('home.newCaseTitle')}</span>
          <span className="text-sm text-slate-600">{t('home.newCaseLead')}</span>
        </span>
        <Icon name="chevron-forward" className="ms-auto h-5 w-5 text-slate-400" />
      </a>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{t('home.activeCases')}</h2>
          <a href="#/cases" className="inline-flex min-h-touch items-center text-sm font-medium text-teal-900 underline">
            {t('home.allCases')}
          </a>
        </div>
        {cases.status !== 'ready' ? (
          <p className="text-slate-600">{t('common.loading')}</p>
        ) : active.length === 0 ? (
          <p className="text-slate-600">{t('home.noActiveCases')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {active.slice(0, 8).map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>

      {install && (
        <Button icon="download" onClick={() => void install()}>
          {t('install.button')}
        </Button>
      )}
      <Banner tone="info">{t('home.buildStatus')}</Banner>
      <LinkButton href="#/workflow" icon="workflow" className="self-start">
        {t('home.openWorkflow')}
      </LinkButton>
    </div>
  );
}

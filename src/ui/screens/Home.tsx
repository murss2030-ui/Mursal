import { hospitalDayOf } from '../../domain/dates';
import { currentRotation, rotationProgress } from '../../domain/rotation';
import type { Case, Rotation } from '../../domain/types';
import { Term, useI18n } from '../../i18n/i18n';
import type { TermId } from '../../i18n/terms';
import { Banner, Card, Chip, DayLabel, LinkButton, Num } from '../components/ui';
import { useInstallPrompt } from '../pwa';
import { useCases, useRotations } from '../data';
import { useSession } from '../session-context';
import { Button } from '../components/ui';

export function rotationName(r: Rotation, term: (id: TermId) => string): string {
  return r.department === 'other' && r.departmentOther ? r.departmentOther : term(`dept.${r.department}` as TermId);
}

export function CaseRow({ c }: { c: Case }) {
  const { t } = useI18n();
  const { store } = useSession();
  const today = store.today();
  return (
    <a
      href={`#/cases/${c.id}`}
      className="flex min-h-touch items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-teal-600"
      data-testid="case-row"
    >
      <div className="flex min-w-0 flex-col">
        <span className="font-mono text-base font-semibold text-slate-900" dir="ltr">
          {c.id}
        </span>
        <span className="text-sm text-slate-600">
          {t('case.ageSex', { age: c.demographics.ageYears, sex: t(`sex.${c.demographics.sex}`) })}
          {c.ward ? ` · ${c.ward}` : ''}
        </span>
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

  return (
    <div className="flex flex-col gap-4">
      <Card title={t('home.rotation')}>
        {rotations.status !== 'ready' ? (
          <p className="text-slate-600">{t('common.loading')}</p>
        ) : rot ? (
          <div className="flex flex-col gap-1" data-testid="current-rotation">
            <p className="text-lg font-semibold">{rotationName(rot, term)}</p>
            <p className="text-sm text-slate-700">
              <Num>
                {date(rot.startDate)} – {date(rot.endDate)}
              </Num>{' '}
              · {t('home.rotationDay', { d: rotationProgress(rot, today).day, total: rotationProgress(rot, today).total })}
            </p>
            {rot.competencies.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {rot.competencies.map((c) => (
                  <Chip key={c}>
                    <Term id={`comp.${c}` as TermId} />
                  </Chip>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-slate-700">{t('home.noRotation')}</p>
            <LinkButton href="#/rotations/new" variant="primary" icon="plus">
              {t('home.createRotation')}
            </LinkButton>
          </div>
        )}
      </Card>

      <Card
        title={t('home.activeCases')}
        actions={
          <LinkButton href="#/cases/new" variant="primary" icon="plus">
            {t('home.newCase')}
          </LinkButton>
        }
      >
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
        <a href="#/cases" className="mt-3 inline-flex min-h-touch items-center text-sm font-medium text-teal-900 underline">
          {t('home.allCases')}
        </a>
      </Card>

      {install && (
        <Button icon="download" onClick={() => void install()}>
          {t('install.button')}
        </Button>
      )}
      <Banner tone="info">{t('home.buildStatus')}</Banner>
    </div>
  );
}

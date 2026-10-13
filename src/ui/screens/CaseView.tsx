import { RELEASE_GATE_MET } from '../../config/release';
import { hospitalDayOf } from '../../domain/dates';
import type { Case } from '../../domain/types';
import { Term, useI18n } from '../../i18n/i18n';
import { Banner, Chip, DayLabel, PageTitle } from '../components/ui';
import { useCaseVersions } from '../data';
import { useSession } from '../session-context';
import { AuditList } from './AuditPage';
import { DetailsTab } from './DetailsTab';
import { FormTab } from './FormTab';
import { TimelineTab } from './TimelineTab';

const TABS = ['timeline', 'form', 'details', 'audit'] as const;
type Tab = (typeof TABS)[number];

export function CaseView({ caseId, tab }: { caseId: string; tab: string }) {
  const { t } = useI18n();
  const { store } = useSession();
  const versions = useCaseVersions(caseId);
  const active: Tab = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : 'timeline';

  if (versions.status === 'loading') return <p className="text-slate-600">{t('common.loading')}</p>;
  if (versions.status === 'error') return <Banner tone="danger">{versions.error.message}</Banner>;
  const c: Case | undefined = versions.data.at(-1);
  if (!c) return <Banner tone="warning">{t('caseView.notFound')}</Banner>;

  return (
    <div className="flex flex-col gap-3">
      <PageTitle back="#/cases">
        <span className="font-mono" dir="ltr">
          {c.id}
        </span>
      </PageTitle>
      <div className="-mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <Chip tone={c.kind === 'clinical' ? 'violet' : 'teal'}>
          <Term id={c.kind === 'clinical' ? 'clinical_case' : 'teaching_case'} />
        </Chip>
        <span>{t('case.ageSex', { age: c.demographics.ageYears, sex: t(`sex.${c.demographics.sex}`) })}</span>
        {c.status === 'active' ? (
          <span>
            <Term id="hospital_day" />: <DayLabel day={hospitalDayOf(c.admissionDay0, store.today())} />
          </span>
        ) : (
          <Chip>{t(`case.status.${c.status}`)}</Chip>
        )}
      </div>
      {!RELEASE_GATE_MET && <Banner tone="warning">{t('caseView.synthetic')}</Banner>}
      {c.status === 'archived' && <Banner tone="info">{t('caseView.archived')}</Banner>}

      <nav role="tablist" className="sticky top-[76px] z-10 -mx-4 grid grid-cols-4 border-b border-slate-300 bg-slate-50 px-2">
        {TABS.map((k) => (
          <a
            key={k}
            role="tab"
            aria-selected={active === k}
            href={`#/cases/${c.id}/${k}`}
            className={`flex min-h-touch items-center justify-center border-b-2 text-sm font-medium ${active === k ? 'border-teal-800 text-teal-900' : 'border-transparent text-slate-600'}`}
          >
            {t(`caseView.tab.${k}`)}
          </a>
        ))}
      </nav>

      {active === 'timeline' && <TimelineTab c={c} />}
      {active === 'form' && <FormTab c={c} />}
      {active === 'details' && <DetailsTab c={c} versions={versions.data} />}
      {active === 'audit' && <AuditList caseId={c.id} />}
    </div>
  );
}

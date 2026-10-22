import { useI18n } from '../../i18n/i18n';
import { Card, LinkButton, PageTitle } from '../components/ui';
import { useCases } from '../data';
import { CaseRow } from './Home';

export function Reports() {
  const { t } = useI18n();
  const cases = useCases();
  const list = cases.status === 'ready' ? [...cases.data].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) : [];
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{t('reports.title')}</PageTitle>
      <p className="text-sm text-slate-700">{t('reports.lead')}</p>
      <LinkButton href="#/presentation" icon="layers">
        {t('pres.open')}
      </LinkButton>
      {cases.status === 'ready' && list.length === 0 && <p className="text-slate-600">{t('reports.empty')}</p>}
      {list.map((c) => (
        <Card key={c.id}>
          <div className="flex flex-col gap-2">
            <CaseRow c={c} />
            <LinkButton href={`#/cases/${c.id}/form`} icon="file-text">
              {t('reports.openForm')}
            </LinkButton>
          </div>
        </Card>
      ))}
    </div>
  );
}

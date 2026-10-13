import { useState } from 'react';
import type { CaseStatus } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { LinkButton, PageTitle, TextField } from '../components/ui';
import { useCases } from '../data';
import { CaseRow } from './Home';

type Filter = CaseStatus | 'all';

export function CaseList() {
  const { t } = useI18n();
  const cases = useCases();
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const list =
    cases.status === 'ready'
      ? cases.data
          .filter((c) => filter === 'all' || c.status === filter)
          .filter((c) => c.id.toLowerCase().includes(q.trim().toLowerCase()))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      : [];
  const filters: Filter[] = ['active', 'discharged', 'archived', 'all'];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <PageTitle>{t('cases.title')}</PageTitle>
        <LinkButton href="#/cases/new" variant="primary" icon="plus">
          {t('cases.new')}
        </LinkButton>
      </div>
      <div role="tablist" className="flex gap-1 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`min-h-touch rounded-full border px-3 text-sm ${filter === f ? 'border-teal-800 bg-teal-800 text-white' : 'border-slate-300 bg-white text-slate-800'}`}
          >
            {t(`cases.filter.${f}`)}
          </button>
        ))}
      </div>
      <TextField label={t('cases.search')} value={q} onChange={setQ} dir="ltr" name="case-search" />
      {cases.status === 'ready' && list.length === 0 && <p className="text-slate-600">{t('cases.empty')}</p>}
      <div className="flex flex-col gap-2">
        {list.map((c) => (
          <CaseRow key={c.id} c={c} />
        ))}
      </div>
    </div>
  );
}

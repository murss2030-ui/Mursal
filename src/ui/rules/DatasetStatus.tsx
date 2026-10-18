/**
 * Which offline datasets are installed, with version, retrieval date,
 * checksum and licence (M2 plan 2.4: attribution and licence for every
 * dataset) — and which are not, with what that means for the checks.
 */
import { DATASETS } from '../../drugs/useVocabulary';
import { useI18n } from '../../i18n/i18n';
import { Card, Chip, Num } from '../components/ui';

export function DatasetStatus() {
  const { t, date } = useI18n();
  const installed = Object.entries(DATASETS).filter((e): e is [string, NonNullable<(typeof e)[1]>] => !!e[1]);
  return (
    <Card title={t('ds.title')}>
      <div className="flex flex-col gap-3" data-testid="dataset-status">
        {installed.map(([id, d]) => (
          <section key={id} className="flex flex-col gap-1 rounded-xl border border-slate-200 p-3" data-dataset={id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{d.title}</span>
              <Chip tone="teal">{t('ds.installed')}</Chip>
              {d.testFixture && <Chip tone="red">{t('ds.testFixture')}</Chip>}
            </div>
            <p className="text-sm text-slate-700">{t('ds.version', { v: d.version, d: date(d.retrievedAt) })}</p>
            {d.counts && (
              <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600" dir="ltr">
                {Object.entries(d.counts).map(([k, n]) => (
                  <li key={k}>
                    {k}: <Num>{n}</Num>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-slate-600">{d.source}</p>
            <p className="break-all font-mono text-[11px] text-slate-500" dir="ltr">
              {t('ds.checksum', { sha: d.sha256 })}
            </p>
            <details>
              <summary className="min-h-touch cursor-pointer py-2 text-sm font-medium text-teal-900">{t('ds.licence')}</summary>
              <p className="text-xs text-slate-700">{d.licence}</p>
            </details>
          </section>
        ))}
        {!DATASETS.interactions && (
          <p className="rounded-xl border border-dashed border-slate-400 p-3 text-sm text-slate-800" data-dataset="interactions" data-installed="false">
            <Chip>{t('ds.notInstalled')}</Chip> {t('ds.missing.interactions')}
          </p>
        )}
        {!DATASETS.aware && (
          <p className="rounded-xl border border-dashed border-slate-400 p-3 text-sm text-slate-800" data-dataset="aware" data-installed="false">
            <Chip>{t('ds.notInstalled')}</Chip> {t('ds.missing.aware')}
          </p>
        )}
      </div>
    </Card>
  );
}

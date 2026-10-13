import { APP_VERSION, CURRENT_MILESTONE, RELEASE_GATE_MET } from '../../config/release';
import { PROVENANCE_VISUALS } from '../../domain/provenance';
import { PROVENANCE_STATES } from '../../domain/types';
import { useI18n } from '../../i18n/i18n';
import { IntendedUseStatement } from '../components/IntendedUse';
import { ProvenanceBadge } from '../components/ProvenanceBadge';
import { Banner, Card, PageTitle } from '../components/ui';

export function About() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/more">{t('about.title')}</PageTitle>
      <Card title={t('about.intendedUse')}>
        <IntendedUseStatement />
        <p className="mt-3 text-sm text-slate-800">{t('ack.notReplacement')}</p>
      </Card>
      <Card title={t('about.build')}>
        <p className="text-sm">{t('about.version', { v: APP_VERSION, m: CURRENT_MILESTONE })}</p>
        {!RELEASE_GATE_MET && (
          <Banner tone="warning" className="mt-2">
            {t('about.releaseGate')}
          </Banner>
        )}
        <h3 className="mt-3 text-sm font-semibold">{t('about.inBuild')}</h3>
        <p className="text-sm text-slate-700">{t('about.inBuildList')}</p>
        <h3 className="mt-3 text-sm font-semibold">{t('about.notYet')}</h3>
        <p className="text-sm text-slate-700">{t('about.notYetList')}</p>
      </Card>
      <Card title={t('about.legend')}>
        <p className="mb-3 text-sm text-slate-700">{t('about.legendLead')}</p>
        <ul className="flex flex-col gap-3" data-testid="provenance-legend">
          {PROVENANCE_STATES.map((s) => (
            <li key={s} className="flex flex-col gap-1">
              <span>
                <ProvenanceBadge state={s} />
              </span>
              <span className="text-xs text-slate-700" lang="en" dir="ltr">
                {PROVENANCE_VISUALS[s].rule}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title={t('about.privacy')}>
        <p className="text-sm text-slate-700">{t('about.privacyText')}</p>
      </Card>
      <Card title={t('about.sources')}>
        <p className="text-sm text-slate-700">{t('about.sourcesText')}</p>
      </Card>
    </div>
  );
}

import { useI18n } from '../../i18n/i18n';
import { Icon } from '../components/Icon';
import { Chip, PageTitle } from '../components/ui';

export function Resources() {
  const { t } = useI18n();
  const row = 'flex min-h-touch items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3';
  return (
    <div className="flex flex-col gap-3">
      <PageTitle>{t('res.title')}</PageTitle>
      <a href="#/about" className={`${row} hover:border-teal-600`}>
        <Icon name="info" className="h-5 w-5 text-teal-800" />
        <span className="flex-1">{t('nav.about')}</span>
        <Icon name="chevron-forward" className="h-5 w-5 text-slate-500" />
      </a>
      <a href="#/about" className={`${row} hover:border-teal-600`}>
        <Icon name="check-circle" className="h-5 w-5 text-teal-800" />
        <span className="flex-1">{t('res.legendLink')}</span>
        <Icon name="chevron-forward" className="h-5 w-5 text-slate-500" />
      </a>
      <div className={`${row} text-slate-500`} aria-disabled="true">
        <Icon name="book" className="h-5 w-5" />
        <span className="flex-1">{t('res.guidelines')}</span>
        <Chip>{t('nav.notYet', { m: 'M5' })}</Chip>
      </div>
      <div className={`${row} text-slate-500`} aria-disabled="true">
        <Icon name="pill" className="h-5 w-5" />
        <span className="flex-1">{t('res.formulary')}</span>
        <Chip>{t('nav.notYet', { m: 'M2' })}</Chip>
      </div>
    </div>
  );
}

import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { Icon, type IconName } from '../components/Icon';
import { Chip, PageTitle } from '../components/ui';
import { useSession } from '../session-context';

const LINKS: { href: string; key: MsgKey; icon: IconName }[] = [
  { href: '#/resources', key: 'nav.resources', icon: 'book' },
  { href: '#/library', key: 'res.guidelines', icon: 'book' },
  { href: '#/rotations', key: 'nav.rotations', icon: 'calendar' },
  { href: '#/learning', key: 'nav.learning', icon: 'graduation' },
  { href: '#/portfolio', key: 'nav.portfolio', icon: 'briefcase' },
  { href: '#/reference', key: 'nav.reference', icon: 'pill' },
  { href: '#/audit', key: 'nav.audit', icon: 'history' },
  { href: '#/settings', key: 'nav.settings', icon: 'sliders' },
  { href: '#/about', key: 'nav.about', icon: 'info' },
];

/** Primary navigation items whose milestone is not built yet are listed, disabled, with the milestone that builds them. */
const NOT_YET: { key: MsgKey; icon: IconName; m: string }[] = [];

export function More() {
  const { t } = useI18n();
  const { session } = useSession();
  const row = 'flex min-h-touch items-center gap-3 rounded-xl border border-line bg-white px-3 py-3 shadow-card';
  return (
    <div className="flex flex-col gap-3">
      <PageTitle>{t('more.title')}</PageTitle>
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} className={`${row} hover:border-teal-600`}>
          <Icon name={l.icon} className="h-5 w-5 text-teal-800" />
          <span className="flex-1">{t(l.key)}</span>
          <Icon name="chevron-forward" className="h-5 w-5 text-slate-500" />
        </a>
      ))}
      {NOT_YET.map((n) => (
        <div key={n.key} className={`${row} text-slate-500`} aria-disabled="true">
          <Icon name={n.icon} className="h-5 w-5" />
          <span className="flex-1">{t(n.key)}</span>
          <Chip>{t('nav.notYet', { m: n.m })}</Chip>
        </div>
      ))}
      <button type="button" onClick={() => void session.lock()} className={`${row} text-start hover:border-teal-600`}>
        <Icon name="lock" className="h-5 w-5 text-teal-800" />
        <span className="flex-1">{t('nav.lock')}</span>
      </button>
    </div>
  );
}

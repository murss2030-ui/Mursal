import { useI18n } from '../../i18n/i18n';
import { useSession } from '../session-context';

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { lang, t } = useI18n();
  const { setPrefs } = useSession();
  return (
    <button
      type="button"
      onClick={() => void setPrefs({ language: lang === 'ar' ? 'en' : 'ar' })}
      className={`inline-flex min-h-touch min-w-touch items-center justify-center rounded-lg px-3 text-sm font-medium hover:bg-white/10 ${className}`}
      lang={lang === 'ar' ? 'en' : 'ar'}
    >
      {t('shell.switchLanguage')}
    </button>
  );
}

/**
 * Bilingual catalogue text (Clinical Modules). The interface language comes
 * first; for titles the other language is shown small beneath, because the
 * owner's task list is itself bilingual and trainees work in both.
 */
import type { L } from '../domain/label';
import { useI18n } from '../i18n/i18n';

export function useL(): (l: L) => string {
  const { lang } = useI18n();
  return (l) => (lang === 'ar' ? l.ar : l.en);
}

export function Bi({ l, className = '', subClassName = 'text-xs font-normal text-slate-600' }: { l: L; className?: string; subClassName?: string }) {
  const { lang } = useI18n();
  const [main, sub, mainLang, subLang] = lang === 'ar' ? [l.ar, l.en, 'ar', 'en'] : [l.en, l.ar, 'en', 'ar'];
  return (
    <span className={`flex flex-col ${className}`}>
      <span lang={mainLang} dir={mainLang === 'ar' ? 'rtl' : 'ltr'} className="text-start">
        {main}
      </span>
      {sub !== main && (
        <span lang={subLang} dir={subLang === 'ar' ? 'rtl' : 'ltr'} className={`text-start ${subClassName}`}>
          {sub}
        </span>
      )}
    </span>
  );
}

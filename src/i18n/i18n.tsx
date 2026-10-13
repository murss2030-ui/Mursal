import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Language } from '../store/session';
import { ar } from './ar';
import { en, type MsgKey } from './en';
import { TERMS, type TermId } from './terms';

export type Vars = Record<string, string | number>;

export interface I18n {
  lang: Language;
  dir: 'ltr' | 'rtl';
  t: (key: MsgKey, vars?: Vars) => string;
  /** Clinical term as plain text: English, plus the Arabic explanation in the Arabic interface. */
  term: (id: TermId) => string;
  /** Formats an ISO timestamp with Western digits (clinical numbers are never localised). */
  when: (iso: string) => string;
  /** Formats a YYYY-MM-DD date. */
  date: (ymd: string) => string;
}

const DICTS: Record<Language, Record<MsgKey, string>> = { en, ar };

export function translate(lang: Language, key: MsgKey, vars?: Vars): string {
  let s = DICTS[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const t = useCallback((key: MsgKey, vars?: Vars) => translate(lang, key, vars), [lang]);
  const value = useMemo<I18n>(() => {
    const locale = lang === 'ar' ? 'ar-YE-u-nu-latn' : 'en-GB';
    const dt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    const d = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
    return {
      lang,
      dir,
      t,
      term: (id) => (lang === 'ar' ? `${TERMS[id].en} — ${TERMS[id].ar}` : TERMS[id].en),
      when: (iso) => dt.format(new Date(iso)),
      date: (ymd) => d.format(new Date(`${ymd}T00:00:00Z`)),
    };
  }, [lang, dir, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** A clinical term: English always, Arabic explanation beside it in the Arabic interface. */
export function Term({ id, className }: { id: TermId; className?: string }) {
  const { lang } = useI18n();
  const term = TERMS[id];
  return (
    <span className={className}>
      <span lang="en" dir="ltr">
        {term.en}
      </span>
      {lang === 'ar' && (
        <span lang="ar" className="ms-1 text-[0.85em] font-normal text-slate-600">
          ({term.ar})
        </span>
      )}
    </span>
  );
}

import { INTENDED_USE_STATEMENT, INTENDED_USE_STATEMENT_AR } from '../../domain/intendedUse';
import { useI18n } from '../../i18n/i18n';

/** The verbatim statement (English, authoritative), with an Arabic translation in the Arabic interface. */
export function IntendedUseStatement() {
  const { t, lang } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <pre
        lang="en"
        dir="ltr"
        data-testid="intended-use-statement"
        className="whitespace-pre-wrap rounded-lg border border-slate-300 bg-slate-50 p-3 font-sans text-sm leading-relaxed text-slate-900"
      >
        {INTENDED_USE_STATEMENT}
      </pre>
      {lang === 'ar' && (
        <div>
          <p className="mb-1 text-xs text-slate-600">{t('ack.translationTitle')}</p>
          <p lang="ar" className="whitespace-pre-line rounded-lg border border-slate-200 bg-white p-3 text-sm leading-relaxed text-slate-900">
            {INTENDED_USE_STATEMENT_AR}
          </p>
        </div>
      )}
    </div>
  );
}

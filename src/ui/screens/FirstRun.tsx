import { useState } from 'react';
import { useI18n } from '../../i18n/i18n';
import { Banner, Button, CheckboxField } from '../components/ui';
import { IntendedUseStatement } from '../components/IntendedUse';
import { LanguageToggle } from '../components/LanguageToggle';
import { useSession } from '../session-context';

/** Mandatory on first run (Section 3, Section 5): the verbatim intended-use statement, acknowledged explicitly. */
export function FirstRun() {
  const { t } = useI18n();
  const { session } = useSession();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-screen max-w-screen-sm flex-col gap-4 p-4">
      <div className="flex items-center justify-between rounded-xl bg-teal-900 p-3 text-white">
        <div>
          <p className="text-xl font-semibold">{t('app.name')}</p>
          <p className="text-sm text-teal-100">{t('app.tagline')}</p>
        </div>
        <LanguageToggle />
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">{t('ack.title')}</h1>
      <p className="text-slate-700">{t('ack.lead')}</p>
      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('ack.statementTitle')}</h2>
        <IntendedUseStatement />
      </section>
      <Banner tone="info">{t('ack.notReplacement')}</Banner>
      <Banner tone="warning">{t('ack.syntheticOnly')}</Banner>
      <CheckboxField label={t('ack.checkbox')} checked={checked} onChange={setChecked} name="ack" />
      <Button
        variant="primary"
        disabled={!checked || busy}
        onClick={async () => {
          setBusy(true);
          await session.acknowledgeIntendedUse();
        }}
      >
        {t('ack.continue')}
      </Button>
    </main>
  );
}

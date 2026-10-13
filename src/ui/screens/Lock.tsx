import { useState } from 'react';
import { WrongPassphraseError } from '../../crypto/crypto';
import { useI18n } from '../../i18n/i18n';
import { Banner, Button, Card, TextField } from '../components/ui';
import { Icon } from '../components/Icon';
import { LanguageToggle } from '../components/LanguageToggle';
import { useSession } from '../session-context';

export function Lock() {
  const { t } = useI18n();
  const { session } = useSession();
  const [pass, setPass] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [eraseText, setEraseText] = useState('');

  const unlock = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await session.unlock(pass);
    } catch (e) {
      setError(e instanceof WrongPassphraseError ? t('lock.wrong') : t('err.generic', { message: (e as Error).message }));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-screen-sm flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold text-teal-900">{t('app.name')}</span>
        <LanguageToggle className="text-teal-900 hover:bg-teal-50" />
      </div>
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <div className="flex items-center gap-2">
            <Icon name="lock" className="h-6 w-6 text-teal-800" />
            <h1 className="text-xl font-semibold">{t('lock.title')}</h1>
          </div>
          <p className="text-sm text-slate-700">{t('lock.lead')}</p>
          <TextField
            label={t('setup.passphrase')}
            type="password"
            name="passphrase"
            autoComplete="current-password"
            value={pass}
            onChange={setPass}
            error={error}
          />
          <Button type="submit" variant="primary" disabled={busy || pass.length === 0}>
            {busy ? t('lock.unlocking') : t('lock.unlock')}
          </Button>
        </form>
      </Card>
      <button type="button" className="min-h-touch text-sm text-teal-900 underline" onClick={() => setShowForgot((v) => !v)}>
        {t('lock.forgot')}
      </button>
      {showForgot && (
        <Card>
          <div className="flex flex-col gap-3">
            <Banner tone="danger">{t('lock.forgotText')}</Banner>
            <TextField label={t('lock.eraseLabel')} value={eraseText} onChange={setEraseText} dir="ltr" name="erase-confirm" />
            <Button variant="danger" disabled={eraseText !== 'ERASE'} onClick={() => void session.eraseInstallation()}>
              {t('lock.erase')}
            </Button>
          </div>
        </Card>
      )}
    </main>
  );
}

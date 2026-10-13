import { useState } from 'react';
import { DecryptionError, MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from '../../crypto/crypto';
import { useI18n } from '../../i18n/i18n';
import { BackupFormatError, restoreBackup } from '../../store/backup';
import { Banner, Button, Card, CheckboxField, FieldShell, TextField } from '../components/ui';
import { LanguageToggle } from '../components/LanguageToggle';
import { useSession } from '../session-context';

async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported: the Settings screen reports the state */
  }
}

export function Setup() {
  const { t } = useI18n();
  const { session } = useSession();
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ pass?: string; confirm?: string; understood?: string; form?: string }>({});

  const [file, setFile] = useState<File | null>(null);
  const [restorePass, setRestorePass] = useState('');
  const [restoreError, setRestoreError] = useState<string>();
  const [restoring, setRestoring] = useState(false);

  const create = async () => {
    const e: typeof errors = {};
    if (pass.length < MIN_PASSPHRASE_LENGTH) e.pass = t('setup.tooShort', { n: MIN_PASSPHRASE_LENGTH });
    if (confirm !== pass) e.confirm = t('setup.mismatch');
    if (!understood) e.understood = t('err.required');
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await session.setup(pass);
      await requestPersistence();
    } catch (err) {
      setErrors({ form: t('err.generic', { message: (err as Error).message }) });
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!file) {
      setRestoreError(t('err.required'));
      return;
    }
    setRestoring(true);
    setRestoreError(undefined);
    try {
      await restoreBackup(session, await file.text(), restorePass);
      await requestPersistence();
    } catch (err) {
      setRestoreError(
        err instanceof WrongPassphraseError
          ? t('lock.wrong')
          : err instanceof DecryptionError
            ? t('setup.restoreDamaged')
            : err instanceof BackupFormatError
              ? t('setup.restoreBadFile')
              : t('err.generic', { message: (err as Error).message }),
      );
      setRestoring(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-screen-sm flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t('setup.title')}</h1>
        <LanguageToggle className="text-teal-900 hover:bg-teal-50" />
      </div>
      <p className="text-slate-700">{t('setup.lead')}</p>
      <Card>
        <div className="flex flex-col gap-4">
          <TextField
            label={t('setup.passphrase')}
            type="password"
            name="passphrase"
            autoComplete="new-password"
            value={pass}
            onChange={setPass}
            hint={t('setup.passphraseHint', { n: MIN_PASSPHRASE_LENGTH })}
            error={errors.pass}
          />
          <TextField
            label={t('setup.confirm')}
            type="password"
            name="passphrase-confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            error={errors.confirm}
          />
          <Banner tone="danger">
            <p className="font-semibold">{t('setup.warningTitle')}</p>
            <p>{t('setup.warning')}</p>
          </Banner>
          <CheckboxField label={t('setup.warningCheckbox')} checked={understood} onChange={setUnderstood} error={errors.understood} name="understood" />
          {errors.form && <Banner tone="danger" role="alert">{errors.form}</Banner>}
          {busy && <Banner tone="info" role="status">{t('setup.deriving')}</Banner>}
          <Button variant="primary" onClick={create} disabled={busy}>
            {t('setup.create')}
          </Button>
        </div>
      </Card>
      <p className="text-center text-sm text-slate-600">{t('setup.or')}</p>
      <Card title={t('setup.restoreTitle')}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-700">{t('setup.restoreLead')}</p>
          <FieldShell label={t('setup.restoreFile')}>
            {({ id }) => (
              <input
                id={id}
                type="file"
                accept="application/json,.json"
                className="min-h-touch text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            )}
          </FieldShell>
          <TextField
            label={t('setup.restorePassphrase')}
            type="password"
            name="restore-passphrase"
            autoComplete="current-password"
            value={restorePass}
            onChange={setRestorePass}
          />
          {restoreError && <Banner tone="danger" role="alert">{restoreError}</Banner>}
          <Button onClick={restore} disabled={restoring} icon="upload">
            {restoring ? t('setup.deriving') : t('setup.restore')}
          </Button>
        </div>
      </Card>
    </main>
  );
}

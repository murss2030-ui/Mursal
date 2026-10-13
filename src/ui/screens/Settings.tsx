import { useEffect, useState } from 'react';
import { MIN_PASSPHRASE_LENGTH, WrongPassphraseError } from '../../crypto/crypto';
import { useI18n } from '../../i18n/i18n';
import { createBackup } from '../../store/backup';
import { IDLE_LOCK_CHOICES } from '../../store/session';
import { Banner, Button, Card, PageTitle, SelectField, TextField } from '../components/ui';
import { useTrainee } from '../data';
import { useSession } from '../session-context';

function TraineeCard() {
  const { t } = useI18n();
  const { store } = useSession();
  const trainee = useTrainee();
  const [name, setName] = useState('');
  const [programme, setProgramme] = useState('');
  const [saved, setSaved] = useState(false);
  const loaded = trainee.status === 'ready' ? trainee.data : undefined;
  useEffect(() => {
    if (loaded) {
      setName(loaded.traineeName ?? '');
      setProgramme(loaded.programme ?? '');
    }
  }, [loaded?.traineeName, loaded?.programme]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title={t('set.trainee')}>
      <div className="flex flex-col gap-4">
        <TextField label={t('set.traineeName')} name="traineeName" value={name} onChange={(x) => { setName(x); setSaved(false); }} />
        <TextField label={t('set.programme')} name="programme" optional value={programme} onChange={(x) => { setProgramme(x); setSaved(false); }} />
        {saved && <Banner tone="success" role="status">{t('set.saved')}</Banner>}
        <Button
          onClick={async () => {
            await store.updateTraineeSettings({ traineeName: name, programme });
            setSaved(true);
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </Card>
  );
}

function PassphraseCard() {
  const { t } = useI18n();
  const { session } = useSession();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string }>();
  const [busy, setBusy] = useState(false);
  const change = async () => {
    if (next.length < MIN_PASSPHRASE_LENGTH) return setMsg({ tone: 'danger', text: t('setup.tooShort', { n: MIN_PASSPHRASE_LENGTH }) });
    if (next !== confirm) return setMsg({ tone: 'danger', text: t('setup.mismatch') });
    setBusy(true);
    try {
      await session.changePassphrase(cur, next);
      setMsg({ tone: 'success', text: t('set.passChanged') });
      setCur('');
      setNext('');
      setConfirm('');
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof WrongPassphraseError ? t('lock.wrong') : t('err.generic', { message: (e as Error).message }) });
    }
    setBusy(false);
  };
  return (
    <Card title={t('set.changePass')}>
      <div className="flex flex-col gap-4">
        <TextField label={t('set.currentPass')} type="password" name="currentPass" autoComplete="current-password" value={cur} onChange={setCur} />
        <TextField label={t('set.newPass')} type="password" name="newPass" autoComplete="new-password" value={next} onChange={setNext} hint={t('setup.passphraseHint', { n: MIN_PASSPHRASE_LENGTH })} />
        <TextField label={t('setup.confirm')} type="password" name="confirmPass" autoComplete="new-password" value={confirm} onChange={setConfirm} />
        <Banner tone="warning">{t('setup.warning')}</Banner>
        {msg && <Banner tone={msg.tone} role="status">{msg.text}</Banner>}
        <Button onClick={change} disabled={busy || !cur}>
          {busy ? t('setup.deriving') : t('set.changePass')}
        </Button>
      </div>
    </Card>
  );
}

function BackupCard() {
  const { t } = useI18n();
  const { session } = useSession();
  const [msg, setMsg] = useState<string>();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null));
  }, []);
  const exportBackup = async () => {
    const { filename, json } = await createBackup(session);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMsg(t('set.backupDone', { name: filename }));
  };
  return (
    <>
      <Card title={t('set.backup')}>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-700">{t('set.backupHelp')}</p>
          {msg && <Banner tone="success" role="status">{msg}</Banner>}
          <Button icon="download" onClick={exportBackup}>
            {t('set.exportBackup')}
          </Button>
        </div>
      </Card>
      <Card title={t('set.storage')}>
        <div className="flex flex-col gap-3">
          {persisted !== null && (
            <Banner tone={persisted ? 'success' : 'warning'}>{persisted ? t('set.storagePersisted') : t('set.storageNotPersisted')}</Banner>
          )}
          {!persisted && (
            <Button
              onClick={async () => {
                setPersisted((await navigator.storage?.persist?.()) ?? null);
              }}
            >
              {t('set.requestPersist')}
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}

export function Settings() {
  const { t } = useI18n();
  const { prefs, setPrefs } = useSession();
  return (
    <div className="flex flex-col gap-4">
      <PageTitle back="#/more">{t('set.title')}</PageTitle>
      <Card>
        <div className="flex flex-col gap-4">
          <SelectField
            label={t('set.language')}
            name="language"
            value={prefs.language}
            onChange={(x) => x && void setPrefs({ language: x as 'en' | 'ar' })}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ar', label: 'العربية' },
            ]}
          />
          <SelectField
            label={t('set.idle')}
            name="idle"
            value={String(prefs.idleLockMinutes)}
            onChange={(x) => x && void setPrefs({ idleLockMinutes: Number(x) })}
            options={IDLE_LOCK_CHOICES.map((n) => ({ value: String(n), label: t('set.minutes', { n }) }))}
          />
        </div>
      </Card>
      <TraineeCard />
      <PassphraseCard />
      <BackupCard />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nProvider, useI18n } from '../i18n/i18n';
import { DEFAULT_PREFS, type GateState, type Prefs, type Session } from '../store/session';
import { SessionContext, type SessionContextValue } from './session-context';
import { FirstRun } from './screens/FirstRun';
import { Lock } from './screens/Lock';
import { Setup } from './screens/Setup';
import { Shell } from './Shell';

export function App({ session }: { session: Session }) {
  const [gate, setGate] = useState<GateState | 'loading'>('loading');
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  const [storageError, setStorageError] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([session.gateState(), session.getPrefs()]);
      setGate(g);
      setPrefsState(p);
    } catch {
      // IndexedDB refused (private window, blocked site data, some embedded frames).
      setStorageError(true);
    }
  }, [session]);

  useEffect(() => {
    void refresh();
    return session.subscribe(() => void refresh());
  }, [session, refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      store: session.store,
      gate,
      prefs,
      refresh,
      setPrefs: async (p) => {
        setPrefsState(await session.setPrefs(p));
      },
    }),
    [session, gate, prefs, refresh],
  );

  return (
    <SessionContext.Provider value={value}>
      <I18nProvider lang={prefs.language}>
        {storageError ? (
          <StorageUnavailable />
        ) : gate === 'loading' ? (
          <div className="p-6 text-slate-600" aria-busy="true">
            PRECEPTOR…
          </div>
        ) : gate === 'needs_ack' ? (
          <FirstRun />
        ) : gate === 'needs_setup' ? (
          <Setup />
        ) : gate === 'locked' ? (
          <Lock />
        ) : (
          <Shell />
        )}
      </I18nProvider>
    </SessionContext.Provider>
  );
}

function StorageUnavailable() {
  const { t } = useI18n();
  return (
    <main className="mx-auto max-w-screen-sm p-4">
      <div role="alert" className="rounded-lg border border-red-400 bg-red-50 p-4 text-red-950">
        <p className="font-semibold">{t('app.storageErrorTitle')}</p>
        <p className="mt-1 text-sm">{t('app.storageError')}</p>
      </div>
    </main>
  );
}

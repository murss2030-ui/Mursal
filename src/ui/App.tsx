import { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nProvider } from '../i18n/i18n';
import { DEFAULT_PREFS, type GateState, type Prefs, type Session } from '../store/session';
import { SessionContext, type SessionContextValue } from './session-context';
import { FirstRun } from './screens/FirstRun';
import { Lock } from './screens/Lock';
import { Setup } from './screens/Setup';
import { Shell } from './Shell';

export function App({ session }: { session: Session }) {
  const [gate, setGate] = useState<GateState | 'loading'>('loading');
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);

  const refresh = useCallback(async () => {
    const [g, p] = await Promise.all([session.gateState(), session.getPrefs()]);
    setGate(g);
    setPrefsState(p);
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
        {gate === 'loading' ? (
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

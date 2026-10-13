import { createContext, useContext } from 'react';
import type { GateState, Prefs, Session } from '../store/session';
import type { Store } from '../store/store';

export interface SessionContextValue {
  session: Session;
  store: Store;
  gate: GateState | 'loading';
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => Promise<void>;
  refresh: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionContext');
  return v;
}

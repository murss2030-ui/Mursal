import { useCallback, useEffect, useState } from 'react';
import { AiError, fetchRelayStatus } from '../ai/client';
import type { RelayStatus } from '../ai/protocol';
import type { AiSettings } from '../ai/settings';
import { useSession } from './session-context';

export type AiStatusState =
  | { kind: 'loading' }
  | { kind: 'ready'; status: RelayStatus; settings: AiSettings }
  | { kind: 'error'; error: AiError; settings: AiSettings };

/** The relay's status and the trainee's AI settings, refreshed on demand. */
export function useAiStatus(): { state: AiStatusState; refresh: () => void } {
  const { store } = useSession();
  const [state, setState] = useState<AiStatusState>({ kind: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const settings = await store.getAiSettings();
      try {
        const status = await fetchRelayStatus(store);
        if (!cancelled) setState({ kind: 'ready', status, settings });
      } catch (e) {
        const error = e instanceof AiError ? e : new AiError('network', (e as Error).message);
        if (!cancelled) setState({ kind: 'error', error, settings });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { state, refresh };
}

/** Whether the model service can be used now, and the models chosen for every task. */
export function aiReady(state: AiStatusState): boolean {
  if (state.kind !== 'ready' || !state.status.configured) return false;
  const m = state.settings.models;
  return Boolean(m.extract && m.analyse);
}

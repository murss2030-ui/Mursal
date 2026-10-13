import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isIdleExpired, type Session } from '../store/session';
import type { Store } from '../store/store';
import { useSession } from './session-context';

export type Loaded<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: Error };

/**
 * Live, decrypted data. The raw query runs inside Dexie's liveQuery (Dexie
 * calls only, so change tracking is reliable, including across tabs); the
 * Web Crypto decryption runs afterwards, outside it.
 */
export function useLiveDecoded<R, T>(
  query: (store: Store) => Promise<R>,
  decode: (store: Store, raw: R) => Promise<T>,
  deps: unknown[],
): Loaded<T> {
  const { store } = useSession();
  // Wrapped so that a query legitimately returning `undefined` is distinguishable from "still loading".
  const raw = useLiveQuery(async () => ({ v: await query(store) }), deps);
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const decodeRef = useRef(decode);
  decodeRef.current = decode;
  useEffect(() => {
    if (raw === undefined) return;
    let cancelled = false;
    decodeRef
      .current(store, raw.v)
      .then((data) => !cancelled && setState({ status: 'ready', data }))
      .catch((error: Error) => !cancelled && setState({ status: 'error', error }));
    return () => {
      cancelled = true;
    };
  }, [raw, store]);
  return state;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Locks after `minutes` without interaction. Uses elapsed wall-clock time, so a backgrounded phone still locks. */
export function useIdleLock(session: Session, minutes: number): void {
  useEffect(() => {
    let last = Date.now();
    const touch = () => {
      last = Date.now();
    };
    const check = () => {
      if (isIdleExpired(last, Date.now(), minutes)) void session.lock();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, 5_000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [session, minutes]);
}

/**
 * Form state that survives interruption: saved encrypted (debounced) to the
 * working-draft table, flushed before the app locks, and restored on return.
 */
export function usePersistentDraft<T extends Record<string, string>>(
  draftId: string,
  initial: T,
): {
  values: T;
  set: (k: keyof T & string, v: string) => void;
  replace: (v: T) => void;
  restored: boolean;
  ready: boolean;
  clear: () => Promise<void>;
  /** Drops the saved draft and returns to the initial values. */
  discard: () => Promise<void>;
} {
  const { session, store } = useSession();
  const [values, setValues] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const [ready, setReady] = useState(false);
  const pending = useRef<T | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const valuesRef = useRef<T>(values);
  valuesRef.current = values;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    store
      .getUiDraft<T>(draftId)
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setValues(d);
          setRestored(true);
        }
        setReady(true);
      })
      .catch(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [draftId, store]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const v = pending.current;
    pending.current = null;
    if (v && session.isUnlocked) await store.putUiDraft(draftId, v);
  }, [draftId, session, store]);

  useEffect(() => session.registerFlusher(flush), [session, flush]);
  useEffect(
    () => () => {
      void flush();
    },
    [flush],
  );

  const schedule = (next: T) => {
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  };

  return {
    values,
    ready,
    restored,
    set: (k, v) => {
      const next = { ...valuesRef.current, [k]: v };
      valuesRef.current = next;
      setValues(next);
      schedule(next);
    },
    replace: (v) => {
      valuesRef.current = v;
      setValues(v);
      schedule(v);
    },
    clear: async () => {
      window.clearTimeout(timer.current);
      pending.current = null;
      await store.deleteUiDraft(draftId);
    },
    discard: async () => {
      window.clearTimeout(timer.current);
      pending.current = null;
      await store.deleteUiDraft(draftId);
      valuesRef.current = initial;
      setValues(initial);
      setRestored(false);
    },
  };
}

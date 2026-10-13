/**
 * Service-worker registration (precached app shell for offline cold starts),
 * the "new version available" prompt, and the install prompt.
 * Updates are never applied silently: reloading mid-entry could lose work.
 */
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let needRefresh = false;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function initPwa(): void {
  try {
    if (!('serviceWorker' in navigator)) return;
    applyUpdate = registerSW({
      immediate: true,
      onNeedRefresh() {
        needRefresh = true;
        notify();
      },
    });
  } catch {
    // Some browsers and embedded frames refuse service workers outright. The app still works
    // without one; only offline start-up and installation are unavailable.
    return;
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    notify();
  });
}

function usePwaState<T>(read: () => T): T {
  const [v, setV] = useState(read);
  useEffect(() => {
    const l = () => setV(read());
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, [read]);
  return v;
}

const readNeedRefresh = () => needRefresh;
const readInstall = () => installEvent;

export function useUpdateAvailable(): { available: boolean; reload: () => void } {
  const available = usePwaState(readNeedRefresh);
  return { available, reload: () => void applyUpdate?.(true) };
}

export function useInstallPrompt(): (() => Promise<void>) | null {
  const ev = usePwaState(readInstall);
  if (!ev) return null;
  return async () => {
    await ev.prompt();
    installEvent = null;
    notify();
  };
}

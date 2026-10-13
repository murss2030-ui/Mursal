import { useState, type ReactNode } from 'react';
import { CURRENT_MILESTONE, RELEASE_GATE_MET } from '../config/release';
import { useI18n } from '../i18n/i18n';
import type { MsgKey } from '../i18n/en';
import { Icon, type IconName } from './components/Icon';
import { LanguageToggle } from './components/LanguageToggle';
import { Button } from './components/ui';
import { useIdleLock, useOnline } from './hooks';
import { useUpdateAvailable } from './pwa';
import { match, useHashLocation } from './router';
import { useSession } from './session-context';
import { About } from './screens/About';
import { AuditPage } from './screens/AuditPage';
import { CaseList } from './screens/CaseList';
import { CaseView } from './screens/CaseView';
import { EntryEditor } from './screens/EntryEditor';
import { Home } from './screens/Home';
import { More } from './screens/More';
import { NewCase } from './screens/NewCase';
import { Reports } from './screens/Reports';
import { Resources } from './screens/Resources';
import { RotationEditor, Rotations } from './screens/Rotations';
import { Settings } from './screens/Settings';

function Route({ path, query }: { path: string; query: URLSearchParams }): ReactNode {
  let m: Record<string, string> | null;
  if (path === '/' || path === '') return <Home />;
  if (path === '/cases') return <CaseList />;
  if (path === '/cases/new') return <NewCase />;
  if ((m = match('/cases/:id/entry/new', path))) {
    return <EntryEditor caseId={m.id!} mode={{ kind: 'new', type: query.get('type') ?? '', category: query.get('category') ?? '' }} />;
  }
  if ((m = match('/cases/:id/entry/:entryId/correct', path))) {
    return <EntryEditor caseId={m.id!} mode={{ kind: 'correct', entryId: m.entryId! }} />;
  }
  if ((m = match('/cases/:id/med/:medId/change', path))) return <EntryEditor caseId={m.id!} mode={{ kind: 'med_change', medId: m.medId! }} />;
  if ((m = match('/cases/:id/med/:medId/stop', path))) return <EntryEditor caseId={m.id!} mode={{ kind: 'med_stop', medId: m.medId! }} />;
  if ((m = match('/cases/:id/problem/:problemId/update', path))) {
    return <EntryEditor caseId={m.id!} mode={{ kind: 'problem_update', problemId: m.problemId! }} />;
  }
  if ((m = match('/cases/:id', path))) return <CaseView caseId={m.id!} tab="timeline" />;
  if ((m = match('/cases/:id/:tab', path))) return <CaseView caseId={m.id!} tab={m.tab!} />;
  if (path === '/rotations') return <Rotations />;
  if (path === '/rotations/new') return <RotationEditor />;
  if ((m = match('/rotations/:id/edit', path))) return <RotationEditor rotationId={m.id!} />;
  if (path === '/reports') return <Reports />;
  if (path === '/resources') return <Resources />;
  if (path === '/more') return <More />;
  if (path === '/audit') return <AuditPage />;
  if (path === '/settings') return <Settings />;
  if (path === '/about') return <About />;
  return <Home />;
}

function OfflineIndicator() {
  const online = useOnline();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="connection-status"
        className={`inline-flex min-h-touch items-center gap-1 rounded-lg px-2 text-sm font-medium ${online ? 'text-teal-50 hover:bg-white/10' : 'bg-amber-300 text-amber-950'}`}
      >
        <Icon name={online ? 'wifi' : 'wifi-off'} className="h-4 w-4" />
        {online ? t('offline.online') : t('offline.offline')}
      </button>
      {open && (
        <div role="status" className="absolute end-0 z-30 mt-1 w-72 rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 shadow-lg">
          {t('offline.details')}
        </div>
      )}
    </div>
  );
}

const NAV: { href: string; key: MsgKey; icon: IconName; prefix: string }[] = [
  { href: '#/', key: 'nav.home', icon: 'home', prefix: '/' },
  { href: '#/cases', key: 'nav.cases', icon: 'folder', prefix: '/cases' },
  { href: '#/reports', key: 'nav.reports', icon: 'file-text', prefix: '/reports' },
  { href: '#/resources', key: 'nav.resources', icon: 'book', prefix: '/resources' },
  { href: '#/more', key: 'nav.more', icon: 'more', prefix: '/more' },
];

export function Shell() {
  const { t } = useI18n();
  const { session, prefs } = useSession();
  const { path, query } = useHashLocation();
  const update = useUpdateAvailable();
  useIdleLock(session, prefs.idleLockMinutes);

  const active = (prefix: string) => (prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-teal-900 text-white shadow">
        <div className="mx-auto flex max-w-screen-md items-center justify-between gap-2 px-3 py-1">
          <a href="#/" className="text-lg font-semibold tracking-wide">
            {t('app.name')}
          </a>
          <div className="flex items-center gap-1">
            <OfflineIndicator />
            <LanguageToggle />
            <button
              type="button"
              onClick={() => void session.lock()}
              className="inline-flex min-h-touch min-w-touch items-center justify-center gap-1 rounded-lg px-2 text-sm hover:bg-white/10"
              aria-label={t('shell.lock')}
            >
              <Icon name="lock" className="h-5 w-5" />
            </button>
          </div>
        </div>
        {!RELEASE_GATE_MET && (
          <p className="bg-amber-200 px-3 py-1 text-center text-xs font-medium text-amber-950" data-testid="prerelease-banner">
            {t('shell.preRelease', { m: CURRENT_MILESTONE })}
          </p>
        )}
      </header>

      {update.available && (
        <div className="mx-auto mt-2 flex w-full max-w-screen-md items-center justify-between gap-2 rounded-lg bg-sky-100 px-3 py-2 text-sm text-sky-950">
          {t('update.available')}
          <Button onClick={update.reload}>{t('update.reload')}</Button>
        </div>
      )}

      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 pb-40 pt-4">
        <Route path={path} query={query} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-300 bg-white pb-[env(safe-area-inset-bottom)]">
        <p
          className="mx-auto max-w-screen-md border-b border-slate-200 bg-slate-100 px-3 py-1 text-center text-[11px] leading-snug text-slate-700"
          data-testid="disclaimer-footer"
        >
          {t('disclaimer.short')}
        </p>
        <nav aria-label={t('nav.primary')} className="mx-auto grid max-w-screen-md grid-cols-5">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              aria-current={active(n.prefix) ? 'page' : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active(n.prefix) ? 'text-teal-800' : 'text-slate-600'}`}
            >
              <Icon name={n.icon} className="h-6 w-6" />
              {t(n.key)}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}

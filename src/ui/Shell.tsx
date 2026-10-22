import { EditSuggestion } from './screens/EditSuggestion';
import { AnalyseScreen } from './screens/Analyse';
import { ExtractionReview } from './screens/ExtractionReview';
import { FixExtracted } from './screens/FixExtracted';
import { AiSettingsScreen } from './screens/AiSettings';
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
import { Intake } from './screens/Intake';
import { ItemEditor } from './screens/ItemEditor';
import { ProblemCardScreen } from './screens/ProblemCard';
import { ModulePage } from './screens/ModulePage';
import { SourceViewer } from './screens/SourceViewer';
import { TaskPage } from './screens/TaskPage';
import { CalculatorScreen, CalculatorsScreen } from './calc/CalculatorsScreen';
import { CaseAlertsGate } from './rules/SafetyViews';
import { CausalityScreen, isCausalityMethod } from './rules/Causality';
import { isReferenceKind, ReferenceEditor, ReferenceHub, ReferenceList } from './screens/Reference';
import { ExportScreen } from './screens/ExportScreen';
import { ResearchRunScreen, ResearchScreen } from './screens/Research';
import { LibraryDocumentScreen, LibraryPageScreen, LibraryScreen } from './screens/Library';
import { TextSourceEditor } from './screens/TextSourceEditor';
import { Workflow } from './screens/Workflow';

function Route({ path, query }: { path: string; query: URLSearchParams }): ReactNode {
  let m: Record<string, string> | null;
  if (path === '/' || path === '') return <Home />;
  if (path === '/cases') return <CaseList />;
  if (path === '/cases/new') return <NewCase />;
  if ((m = match('/cases/:id/entry/new', path))) {
    return (
      <EntryEditor
        caseId={m.id!}
        mode={{ kind: 'new', type: query.get('type') ?? '', category: query.get('category') ?? '', src: query.get('src') ?? undefined, back: query.get('back') ?? undefined }}
      />
    );
  }
  if ((m = match('/cases/:id/entry/:entryId/correct', path))) {
    return <EntryEditor caseId={m.id!} mode={{ kind: 'correct', entryId: m.entryId! }} />;
  }
  if ((m = match('/cases/:id/med/:medId/change', path))) return <EntryEditor caseId={m.id!} mode={{ kind: 'med_change', medId: m.medId! }} />;
  if ((m = match('/cases/:id/med/:medId/stop', path))) return <EntryEditor caseId={m.id!} mode={{ kind: 'med_stop', medId: m.medId! }} />;
  if ((m = match('/cases/:id/problem/:problemId/update', path))) {
    return <EntryEditor caseId={m.id!} mode={{ kind: 'problem_update', problemId: m.problemId! }} />;
  }
  if ((m = match('/cases/:id/intake', path))) return <Intake caseId={m.id!} />;
  if ((m = match('/cases/:id/analyse', path))) return <AnalyseScreen caseId={m.id!} />;
  if ((m = match('/cases/:id/review/:runId/fix/:fieldId', path))) return <FixExtracted caseId={m.id!} runId={m.runId!} fieldId={m.fieldId!} />;
  if ((m = match('/cases/:id/review/:runId', path))) return <ExtractionReview caseId={m.id!} runId={m.runId!} />;
  if ((m = match('/cases/:id/suggestion/:analysisId/:suggestionId/edit', path))) {
    return <EditSuggestion caseId={m.id!} analysisId={m.analysisId!} suggestionId={m.suggestionId!} />;
  }
  if ((m = match('/cases/:id/sources/new/text', path))) return <TextSourceEditor caseId={m.id!} back={query.get('back') ?? 'sources'} />;
  if ((m = match('/cases/:id/sources/:attId', path))) return <SourceViewer caseId={m.id!} attachmentId={m.attId!} />;
  if ((m = match('/cases/:id/modules/:moduleId', path))) return <ModulePage caseId={m.id!} moduleId={m.moduleId!} />;
  if ((m = match('/cases/:id/task/:taskId', path))) return <TaskPage caseId={m.id!} taskId={m.taskId!} />;
  if ((m = match('/cases/:id/calc', path))) return <CalculatorsScreen caseId={m.id!} />;
  if ((m = match('/cases/:id/calc/:calcId', path))) return <CalculatorScreen caseId={m.id!} calcId={m.calcId!} />;
  if ((m = match('/cases/:id/item/new/:register', path))) {
    return <ItemEditor caseId={m.id!} mode={{ kind: 'new', register: m.register! }} query={query} />;
  }
  if ((m = match('/cases/:id/item/:itemId/causality/:method', path)) && isCausalityMethod(m.method!)) return <CausalityScreen caseId={m.id!} itemId={m.itemId!} method={m.method} />;
  if ((m = match('/cases/:id/item/:itemId', path))) return <ItemEditor caseId={m.id!} mode={{ kind: 'edit', itemId: m.itemId! }} query={query} />;
  if ((m = match('/cases/:id/export', path))) return <ExportScreen caseId={m.id!} copy={query.get('copy') === 'ward' ? 'ward' : 'teaching'} />;
  if ((m = match('/cases/:id/card/:itemId/research', path))) return <ResearchScreen caseId={m.id!} itemId={m.itemId!} />;
  if ((m = match('/cases/:id/research/:runId', path))) return <ResearchRunScreen caseId={m.id!} runId={m.runId!} />;
  if ((m = match('/cases/:id/card/:itemId', path))) return <ProblemCardScreen caseId={m.id!} itemId={m.itemId!} query={query} />;
  if ((m = match('/cases/:id', path))) return <CaseView caseId={m.id!} tab="modules" />;
  if ((m = match('/cases/:id/:tab', path))) return <CaseView caseId={m.id!} tab={m.tab!} />;
  if (path === '/rotations') return <Rotations />;
  if (path === '/rotations/new') return <RotationEditor />;
  if ((m = match('/rotations/:id/edit', path))) return <RotationEditor rotationId={m.id!} />;
  if (path === '/workflow') return <Workflow />;
  if (path === '/reports') return <Reports />;
  if (path === '/resources') return <Resources />;
  if (path === '/library') return <LibraryScreen />;
  if ((m = match('/library/:docId/page/:page', path))) return <LibraryPageScreen docId={m.docId!} page={Math.max(1, Math.floor(Number(m.page)) || 1)} />;
  if ((m = match('/library/:docId', path))) return <LibraryDocumentScreen docId={m.docId!} />;
  if (path === '/more') return <More />;
  if (path === '/audit') return <AuditPage />;
  if (path === '/settings') return <Settings />;
  if (path === '/settings/ai') return <AiSettingsScreen />;
  if (path === '/about') return <About />;
  if (path === '/reference') return <ReferenceHub />;
  if ((m = match('/reference/:kind', path)) && isReferenceKind(m.kind!)) return <ReferenceList kind={m.kind} />;
  if ((m = match('/reference/:kind/new', path)) && isReferenceKind(m.kind!)) return <ReferenceEditor kind={m.kind} query={query} />;
  if ((m = match('/reference/:kind/:id', path)) && isReferenceKind(m.kind!)) return <ReferenceEditor kind={m.kind} id={m.id!} />;
  return <Home />;
}

/**
 * The case screens where an unacknowledged critical alert interrupts. Not the
 * editors: there the trainee is entering or correcting the record, and the
 * alert is shown again (or not, if the correction resolved it) on return.
 */
const INTERRUPTING = ['/cases/:id', '/cases/:id/:tab', '/cases/:id/modules/:moduleId', '/cases/:id/task/:taskId', '/cases/:id/calc/:calcId'];

function interruptingCaseId(path: string): string | undefined {
  for (const p of INTERRUPTING) {
    const m = match(p, path);
    if (m && m.id !== 'new' && m.tab !== 'intake') return m.id;
  }
  return undefined;
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
        className={`inline-flex min-h-touch items-center gap-1.5 rounded-full px-3 text-sm font-medium ${online ? 'text-teal-50 hover:bg-white/10' : 'bg-saffron-300 text-saffron-900'}`}
      >
        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-saffron-800'}`} />
        <Icon name={online ? 'wifi' : 'wifi-off'} className="h-4 w-4" />
        <span className="hidden sm:inline">{online ? t('offline.online') : t('offline.offline')}</span>
        <span className="sr-only sm:hidden">{online ? t('offline.online') : t('offline.offline')}</span>
      </button>
      {open && (
        <div role="status" className="absolute end-0 z-30 mt-2 w-72 rounded-xl border border-line bg-white p-3 text-sm text-slate-800 shadow-lift">
          {t('offline.details')}
        </div>
      )}
    </div>
  );
}

const NAV: { href: string; key: MsgKey; icon: IconName; prefix: string }[] = [
  { href: '#/', key: 'nav.home', icon: 'home', prefix: '/' },
  { href: '#/cases', key: 'nav.cases', icon: 'folder', prefix: '/cases' },
  { href: '#/workflow', key: 'nav.workflow', icon: 'workflow', prefix: '/workflow' },
  { href: '#/reports', key: 'nav.reports', icon: 'file-text', prefix: '/reports' },
  { href: '#/more', key: 'nav.more', icon: 'more', prefix: '/more' },
];

export function Shell() {
  const { t } = useI18n();
  const { session, prefs } = useSession();
  const { path, query } = useHashLocation();
  const update = useUpdateAvailable();
  useIdleLock(session, prefs.idleLockMinutes);

  const active = (prefix: string) => (prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`));
  const alertCase = interruptingCaseId(path);

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-20 bg-ink text-white shadow-lift">
        <div className="mx-auto flex max-w-screen-md items-center justify-between gap-2 px-3 py-1.5">
          <a href="#/" className="flex min-h-touch items-center gap-2 rounded-lg pe-2" aria-label={t('app.name')}>
            <img src="/icons/icon.svg" alt="" className="h-8 w-8 rounded-lg ring-1 ring-white/20" />
            <span className="text-base font-semibold tracking-[0.14em]">{t('app.name')}</span>
          </a>
          <div className="flex items-center gap-0.5">
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
          <p className="bg-saffron-100 px-3 py-1 text-center text-xs font-medium text-saffron-900" data-testid="prerelease-banner">
            {t('shell.preRelease', { m: CURRENT_MILESTONE })}
          </p>
        )}
      </header>

      {update.available && (
        <div className="mx-auto mt-2 flex w-full max-w-screen-md items-center justify-between gap-2 rounded-xl bg-sky-100 px-3 py-2 text-sm text-sky-950">
          {t('update.available')}
          <Button onClick={update.reload}>{t('update.reload')}</Button>
        </div>
      )}

      <main className="mx-auto w-full max-w-screen-md flex-1 px-4 pb-44 pt-4">
        <Route path={path} query={query} />
      </main>
      {alertCase && <CaseAlertsGate key={alertCase} caseId={alertCase} />}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <p
          className="mx-auto max-w-screen-md border-b border-line bg-paper px-3 py-1 text-center text-[11px] leading-snug text-slate-700"
          data-testid="disclaimer-footer"
        >
          {t('disclaimer.short')}
        </p>
        <nav aria-label={t('nav.primary')} className="mx-auto grid max-w-screen-md grid-cols-5 px-1">
          {NAV.map((n) => {
            const on = active(n.prefix);
            return (
              <a
                key={n.href}
                href={n.href}
                aria-current={on ? 'page' : undefined}
                className={`flex min-h-[58px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${on ? 'text-teal-900' : 'text-slate-600'}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${on ? 'bg-teal-100' : ''}`}>
                  <Icon name={n.icon} className="h-5 w-5" />
                </span>
                {t(n.key)}
              </a>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

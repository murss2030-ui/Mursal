/**
 * "Next: Analyse the file" (owner decision D2). Three steps, each visible and
 * each under the trainee's control:
 *   1. Read the documents — the model reads each de-identified document.
 *   2. Check what was read — every value confirmed, corrected or rejected.
 *   3. Draft the 30 tasks — module by module, from the confirmed record only.
 * Without a connection or a configured service the screen says what is
 * missing and keeps the manual path open.
 */
import { useMemo, useState } from 'react';
import { analyseModule } from '../../ai/analysis/run';
import { AiError, clinicalCaseBlocked } from '../../ai/client';
import { readDocument } from '../../ai/extraction/run';
import type { Attachment, CaseAnalysis, ExtractionRun } from '../../domain/types';
import { MODULES } from '../../domain/workflow/catalogue';
import { useI18n } from '../../i18n/i18n';
import type { MsgKey } from '../../i18n/en';
import { aiReady, useAiStatus } from '../ai-status';
import { Bi, useL } from '../bilingual';
import { Icon } from '../components/Icon';
import { ProgressBar } from '../components/Progress';
import { Banner, Button, LinkButton, Num, PageTitle } from '../components/ui';
import { useAnalyses, useAttachments, useCaseVersions, useEntries, useExtractions, useItems } from '../data';
import { analysisStale } from '../../store/store';
import { useOnline } from '../hooks';
import { useSession } from '../session-context';
import { Stepper } from './Intake';

const usd = (n: number) => `US$${n.toFixed(n < 1 ? 3 : 2)}`;

function errorText(e: unknown, t: (k: MsgKey, v?: Record<string, string | number>) => string): string {
  if (e instanceof AiError) {
    const key = `ai.err.${e.code}` as MsgKey;
    const fixed = t(key);
    if (fixed === key) return e.message;
    const b = e.detail.budget;
    return e.code === 'budget_exhausted' && b ? `${fixed} ${t('ai.budgetUsed', { spent: usd(b.spentUsd), budget: usd(b.budgetUsd) })}` : fixed;
  }
  return (e as Error).message;
}

/** Errors after which no further call this session can succeed. */
const STOPPING = new Set(['budget_exhausted', 'access_denied', 'not_configured', 'relay_missing', 'free_key_clinical', 'no_model', 'offline', 'rate_limited']);

function StepCard({ n, title, done, children, testId }: { n: number; title: string; done: boolean; children: React.ReactNode; testId: string }) {
  return (
    <section className="surface flex flex-col gap-3 p-4" data-testid={testId}>
      <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm ${done ? 'bg-emerald-600 text-white' : 'bg-ink text-white'}`}>
          {done ? <Icon name="check" className="h-4 w-4" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function AnalyseScreen({ caseId }: { caseId: string }) {
  const { t } = useI18n();
  const tl = useL();
  const { store } = useSession();
  const online = useOnline();
  const { state: ai, refresh } = useAiStatus();
  const versions = useCaseVersions(caseId);
  const atts = useAttachments(caseId);
  const runs = useExtractions(caseId);
  const analyses = useAnalyses(caseId);
  const entries = useEntries(caseId);
  const items = useItems(caseId);
  const [reading, setReading] = useState<{ i: number; n: number; label: string } | null>(null);
  const [drafting, setDrafting] = useState<{ i: number; n: number; label: string } | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState<string>();
  const [spent, setSpent] = useState(0);

  const c = versions.status === 'ready' ? versions.data.at(-1) : undefined;
  const active: Attachment[] = atts.status === 'ready' ? atts.data.filter((a) => a.status === 'active') : [];
  const runList: ExtractionRun[] = runs.status === 'ready' ? runs.data : [];
  const latestRun = useMemo(() => {
    const m = new Map<string, ExtractionRun>();
    for (const r of runList) m.set(r.attachmentId, r); // runs are sorted oldest first
    return m;
  }, [runList]);
  const analysisList: CaseAnalysis[] = analyses.status === 'ready' ? analyses.data : [];
  const latestAnalysis = useMemo(() => {
    const m = new Map<string, CaseAnalysis>();
    for (const a of analysisList) m.set(a.moduleId, a);
    return m;
  }, [analysisList]);

  if (!c || atts.status !== 'ready' || runs.status !== 'ready' || analyses.status !== 'ready' || entries.status !== 'ready' || items.status !== 'ready') {
    return <p className="text-slate-600">{t('common.loading')}</p>;
  }

  const unread = active.filter((a) => !latestRun.has(a.id));
  const pendingFields = [...latestRun.values()].reduce((n, r) => n + r.fields.filter((f) => !f.decision).length, 0);
  const firstPending = [...latestRun.values()].find((r) => r.fields.some((f) => !f.decision));
  const status = ai.kind === 'ready' ? ai.status : undefined;
  const blockedClinical = status && clinicalCaseBlocked(status, c.kind);
  const ready = online && aiReady(ai) && !blockedClinical && c.status !== 'archived';
  const busy = Boolean(reading || drafting);

  const readAll = async (list: Attachment[]) => {
    setStopped(undefined);
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      setReading({ i: i + 1, n: list.length, label: t(`source.docType.${a.docType}`) });
      try {
        const r = await readDocument(store, caseId, a.id);
        setSpent((s) => s + r.usage.costUsd);
        setFailures((f) => {
          const { [a.id]: _gone, ...rest } = f;
          return rest;
        });
      } catch (e) {
        setFailures((f) => ({ ...f, [a.id]: errorText(e, t) }));
        if (e instanceof AiError && STOPPING.has(e.code)) {
          setStopped(errorText(e, t));
          break;
        }
      }
    }
    setReading(null);
    refresh();
  };

  const draftAll = async () => {
    setStopped(undefined);
    for (let i = 0; i < MODULES.length; i++) {
      const m = MODULES[i]!;
      setDrafting({ i: i + 1, n: MODULES.length, label: tl(m.title) });
      try {
        const a = await analyseModule(store, caseId, m.id);
        setSpent((s) => s + a.usage.costUsd);
        setFailures((f) => {
          const { [m.id]: _gone, ...rest } = f;
          return rest;
        });
      } catch (e) {
        setFailures((f) => ({ ...f, [m.id]: errorText(e, t) }));
        if (e instanceof AiError && STOPPING.has(e.code)) {
          setStopped(errorText(e, t));
          break;
        }
      }
    }
    setDrafting(null);
    refresh();
  };

  const drafted = MODULES.filter((m) => latestAnalysis.has(m.id)).length;
  const suggestionCount = [...latestAnalysis.values()].reduce((n, a) => n + a.suggestions.length, 0);
  const undecided = [...latestAnalysis.values()].reduce((n, a) => n + a.suggestions.filter((s) => !s.decision).length, 0);

  return (
    <div className="flex flex-col gap-4" data-testid="analyse">
      <Stepper step={3} />
      <PageTitle back={`#/cases/${caseId}/intake`}>{t('analyse.title')}</PageTitle>
      <p className="-mt-3 text-sm text-slate-700">{t('analyse.lead')}</p>

      {/* What stands in the way, said plainly — the manual path always stays open. */}
      {!online && <Banner tone="warning">{t('ai.err.offline')}</Banner>}
      {online && ai.kind === 'error' && (
        <Banner tone="warning">
          <span className="flex flex-col gap-2" data-testid="analyse-unavailable">
            <span>{errorText(ai.error, t)}</span>
            <a className="font-medium underline" href="#/settings/ai">
              {t('analyse.openSettings')}
            </a>
          </span>
        </Banner>
      )}
      {online && ai.kind === 'ready' && !aiReady(ai) && (
        <Banner tone="warning">
          <span className="flex flex-col gap-2" data-testid="analyse-unavailable">
            <span>{ai.status.configured ? t('ai.err.no_model') : t('ai.err.not_configured')}</span>
            <a className="font-medium underline" href="#/settings/ai">
              {t('analyse.openSettings')}
            </a>
          </span>
        </Banner>
      )}
      {blockedClinical && (
        <Banner tone="warning">
          <span data-testid="analyse-free-key">{t('ai.err.free_key_clinical')}</span>
        </Banner>
      )}
      {stopped && (
        <Banner tone="danger" role="alert">
          <span data-testid="analyse-stopped">{stopped}</span>
        </Banner>
      )}
      {spent > 0 && (
        <p className="text-xs text-slate-600" data-testid="analyse-spent">
          <Num>{t('analyse.spent', { usd: usd(spent) })}</Num>
          {status && (
            <>
              {' '}
              · <Num>{t('ai.remaining', { usd: usd(Math.max(0, status.budget.budgetUsd - status.budget.spentUsd)) })}</Num>
            </>
          )}
        </p>
      )}

      <StepCard n={1} title={t('analyse.step1')} done={active.length > 0 && unread.length === 0} testId="analyse-read">
        {active.length === 0 ? (
          <p className="text-sm text-slate-600">{t('analyse.noDocuments')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {active.map((a) => {
              const r = latestRun.get(a.id);
              const look = r ? r.fields.filter((f) => !f.decision).length : 0;
              return (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm" data-testid="analyse-doc" data-read={r ? 'yes' : 'no'}>
                  <Icon name={a.kind === 'image' ? 'image' : 'file-text'} className="h-5 w-5 text-slate-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-slate-900">
                      {t(`source.docType.${a.docType}`)}
                      {a.page !== undefined ? ` · ${t('source.page', { n: a.page })}` : ''}
                    </span>
                    {failures[a.id] ? (
                      <span className="text-xs text-red-700">{failures[a.id]}</span>
                    ) : r ? (
                      <span className="text-xs text-slate-600">{t('analyse.readResult', { n: r.fields.length, look })}</span>
                    ) : (
                      <span className="text-xs text-slate-600">{t('analyse.notRead')}</span>
                    )}
                  </span>
                  {r && !busy && ready && (
                    <Button variant="ghost" onClick={() => void readAll([a])}>
                      {t('analyse.readAgain')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {reading && (
          <div className="flex flex-col gap-1.5" role="status" data-testid="analyse-progress">
            <span className="text-sm text-slate-800">{t('analyse.reading', { i: reading.i, n: reading.n, doc: reading.label })}</span>
            <ProgressBar value={reading.i - 1} total={reading.n} label={t('analyse.step1')} />
          </div>
        )}
        {unread.length > 0 && (
          <Button variant="primary" icon="sparkle" disabled={!ready || busy} onClick={() => void readAll(unread)}>
            {t('analyse.readN', { n: unread.length })}
          </Button>
        )}
      </StepCard>

      <StepCard n={2} title={t('analyse.step2')} done={latestRun.size > 0 && pendingFields === 0} testId="analyse-check">
        {latestRun.size === 0 ? (
          <p className="text-sm text-slate-600">{t('analyse.nothingToCheck')}</p>
        ) : (
          <>
            <p className="text-sm text-slate-700" data-testid="analyse-pending">
              {pendingFields > 0 ? t('analyse.pending', { n: pendingFields }) : t('analyse.allChecked')}
            </p>
            {firstPending && (
              <LinkButton href={`#/cases/${caseId}/review/${firstPending.id}`} variant="primary" icon="eye">
                {t('analyse.checkNow')}
              </LinkButton>
            )}
            <ul className="flex flex-col gap-1 text-sm">
              {[...latestRun.values()].map((r) => {
                const a = active.find((x) => x.id === r.attachmentId);
                if (!a) return null;
                return (
                  <li key={r.id}>
                    <a className="text-teal-900 underline" href={`#/cases/${caseId}/review/${r.id}`}>
                      {t(`source.docType.${a.docType}`)}
                      {a.page !== undefined ? ` · ${t('source.page', { n: a.page })}` : ''}
                    </a>{' '}
                    <span className="text-slate-600">— {t('analyse.runCounts', { left: r.fields.filter((f) => !f.decision).length, n: r.fields.length })}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </StepCard>

      <StepCard n={3} title={t('analyse.step3')} done={drafted === MODULES.length} testId="analyse-draft">
        <p className="text-sm text-slate-700">{t('analyse.step3Lead')}</p>
        {pendingFields > 0 && <Banner tone="info">{t('analyse.pendingNotUsed', { n: pendingFields })}</Banner>}
        <ul className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
          {MODULES.map((m) => {
            const a = latestAnalysis.get(m.id);
            const stale = a ? analysisStale(a, entries.data, items.data) : false;
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-paper px-3 py-2" data-testid={`analyse-module-${m.id}`} data-state={a ? (stale ? 'stale' : 'drafted') : 'none'}>
                <Icon name={a ? (stale ? 'alert-triangle' : 'check-circle') : 'minus'} className={`h-4 w-4 ${a ? (stale ? 'text-amber-700' : 'text-emerald-700') : 'text-slate-400'}`} />
                <Bi l={m.title} className="min-w-0 flex-1 font-medium text-slate-900" />
                <span className="text-xs text-slate-600">
                  {failures[m.id] ? <span className="text-red-700">{t('analyse.failed')}</span> : a ? (stale ? t('analyse.stale') : t('analyse.suggestionsN', { n: a.suggestions.length })) : ''}
                </span>
                {failures[m.id] && (
                  <span className="w-full text-xs text-red-700" data-testid="analyse-module-error">
                    {failures[m.id]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {drafting && (
          <div className="flex flex-col gap-1.5" role="status" data-testid="analyse-progress">
            <span className="text-sm text-slate-800">{t('analyse.drafting', { i: drafting.i, n: drafting.n, module: drafting.label })}</span>
            <ProgressBar value={drafting.i - 1} total={drafting.n} label={t('analyse.step3')} />
          </div>
        )}
        <Button variant={drafted === MODULES.length ? 'secondary' : 'primary'} icon="sparkle" disabled={!ready || busy} onClick={() => void draftAll()}>
          {drafted ? t('analyse.redraft') : t('analyse.draft')}
        </Button>
        {suggestionCount > 0 && <p className="text-sm text-slate-700">{t('analyse.toDecide', { n: undecided, total: suggestionCount })}</p>}
      </StepCard>

      <div className="sticky bottom-[112px] z-10 flex flex-col gap-2 rounded-2xl border border-line bg-white/95 p-3 shadow-lift backdrop-blur">
        <LinkButton href={`#/cases/${caseId}/modules`} variant={drafted ? 'primary' : 'secondary'} icon="arrow" className="w-full">
          {t('intake.next')}
        </LinkButton>
        <p className="text-center text-xs text-slate-600">{drafted ? t('analyse.openModulesHelp') : t('analyse.skipHelp')}</p>
      </div>
    </div>
  );
}

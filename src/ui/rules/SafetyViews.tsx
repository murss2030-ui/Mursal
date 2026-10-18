/**
 * How the three alert levels look (Section 10):
 * - critical: an interruptive dialog that is closed only by acknowledging
 *   with a reason (or by going to the record to correct it);
 * - important: an inline badge on the item, no interruption;
 * - informational: a collapsed group, opened on demand.
 * What could not be checked is always listed — never presented as safe.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Alert, AlertLevel } from '../../rules/types';
import { useI18n } from '../../i18n/i18n';
import { useL } from '../bilingual';
import { useCaseBundle, type CaseBundle } from '../case-bundle';
import { Icon } from '../components/Icon';
import { Button, Card, TextAreaField } from '../components/ui';
import { useSession } from '../session-context';
import { useCaseRules, type CaseRules } from './useCaseRules';

const LEVEL_STYLE: Record<AlertLevel, string> = {
  critical: 'border-red-700 bg-red-50 text-red-950',
  important: 'border-amber-500 bg-amber-50 text-amber-950',
  informational: 'border-slate-300 bg-slate-50 text-slate-800',
};

export function LevelTag({ level }: { level: AlertLevel }) {
  const { t } = useI18n();
  const shape = level === 'critical' ? '‼' : level === 'important' ? '!' : 'i';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${LEVEL_STYLE[level]}`} data-level={level}>
      <span aria-hidden="true">{shape}</span>
      {t(`alert.level.${level}`)}
    </span>
  );
}

function taskHref(caseId: string, a: Alert): string | undefined {
  return a.taskId ? `#/cases/${caseId}/task/${a.taskId}` : undefined;
}

// ---------------------------------------------------------------- critical: interruptive dialog

export function CriticalAlertDialog({ b, rules }: { b: CaseBundle; rules: CaseRules }) {
  const { t } = useI18n();
  const tl = useL();
  const { store } = useSession();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const a = rules.pendingCritical[0];
  useEffect(() => {
    setReason('');
    setError(undefined);
    area.current?.querySelector('textarea')?.focus();
  }, [a?.key, a?.dataHash]);
  if (!a || b.case.status === 'archived') return null;
  const entry = a.entryIds?.[0];
  const med = a.medIds?.length === 1 ? a.medIds[0] : undefined;
  const acknowledge = async () => {
    if (reason.trim().length < 3) {
      setError(t('alert.reasonRequired'));
      return;
    }
    setBusy(true);
    try {
      await store.acknowledgeAlert(b.case.id, a, reason);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" role="presentation">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="critical-title"
        aria-describedby="critical-detail"
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-2xl border-2 border-red-700 bg-white p-4 shadow-lift"
        data-testid="critical-alert"
        data-rule={a.ruleId}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-700 text-white">
            <Icon name="alert-triangle" className="h-6 w-6" />
          </span>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <LevelTag level="critical" />
            <h2 id="critical-title" className="text-lg font-semibold text-red-950">
              {tl(a.title)}
            </h2>
          </div>
        </div>
        <p id="critical-detail" className="text-sm text-slate-900">
          {tl(a.detail)}
        </p>
        <p className="text-xs text-slate-600">
          {t('alert.source')}: {tl(a.source)}
        </p>
        {rules.pendingCritical.length > 1 && <p className="text-xs font-medium text-red-900">{t('alert.more', { n: rules.pendingCritical.length - 1 })}</p>}
        <div ref={area}>
          <TextAreaField label={t('alert.reason')} hint={t('alert.reasonHint')} value={reason} onChange={setReason} rows={3} error={error} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex flex-col gap-1">
            {med && (
              <a href={`#/cases/${b.case.id}/med/${med}/change`} className="text-sm font-medium text-teal-900 underline">
                {t('alert.changeOrder')}
              </a>
            )}
            {entry && (
              <a href={`#/cases/${b.case.id}/entry/${entry}/correct`} className="text-sm font-medium text-teal-900 underline">
                {t('alert.correctRecord')}
              </a>
            )}
          </span>
          <Button variant="danger" onClick={acknowledge} disabled={busy} data-testid="critical-ack">
            {t('alert.acknowledge')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Loads the case and shows its unacknowledged critical alerts on any case screen. */
export function CaseAlertsGate({ caseId }: { caseId: string }) {
  const state = useCaseBundle(caseId);
  const b = state.status === 'ready' ? state.b : undefined;
  const rules = useCaseRules(b);
  if (!b || !rules.ready) return null;
  return <CriticalAlertDialog b={b} rules={rules} />;
}

// ---------------------------------------------------------------- important: inline badges

export function AlertBadges({ alerts, rules, caseId }: { alerts: Alert[]; rules: CaseRules; caseId: string }) {
  const tl = useL();
  const { t } = useI18n();
  if (!alerts.length) return null;
  return (
    <ul className="flex flex-col gap-1" data-testid="alert-badges">
      {alerts.map((a) => (
        <li key={a.key} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 text-xs ${LEVEL_STYLE[a.level]}`} data-level={a.level} data-rule={a.ruleId}>
          <LevelTag level={a.level} />
          <span className="font-medium">{tl(a.title)}</span>
          {rules.isAcked(a) && <span className="text-[11px]">· {t('alert.acknowledged')}</span>}
          {taskHref(caseId, a) && (
            <a href={taskHref(caseId, a)} className="underline">
              {t('alert.open', { n: a.taskId!.replace('t', '').replace(/^0/, '') })}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- the safety card: all levels, and what was not checked

function AlertRow({ a, rules, caseId, taskLink = true, action }: { a: Alert; rules: CaseRules; caseId: string; taskLink?: boolean; action?: ReactNode }) {
  const { t } = useI18n();
  const tl = useL();
  const reason = rules.ackReason(a);
  return (
    <li className={`flex flex-col gap-1 rounded-xl border px-3 py-2 ${LEVEL_STYLE[a.level]}`} data-testid="alert-row" data-level={a.level} data-rule={a.ruleId}>
      <div className="flex flex-wrap items-center gap-2">
        <LevelTag level={a.level} />
        <span className="text-sm font-semibold">{tl(a.title)}</span>
      </div>
      <p className="text-sm">{tl(a.detail)}</p>
      <p className="text-xs opacity-80">
        {t('alert.source')}: {tl(a.source)}
      </p>
      {reason && (
        <p className="text-xs">
          <span className="font-medium">{t('alert.acknowledgedReason')}</span> {reason}
        </p>
      )}
      {taskLink && taskHref(caseId, a) && (
        <a href={taskHref(caseId, a)} className="self-start text-xs font-medium underline">
          {t('alert.open', { n: a.taskId!.replace('t', '').replace(/^0/, '') })}
        </a>
      )}
      {action}
    </li>
  );
}

export function SafetyCard({ b, rules }: { b: CaseBundle; rules: CaseRules }) {
  const { t } = useI18n();
  const tl = useL();
  const by = (l: AlertLevel) => rules.alerts.filter((a) => a.level === l);
  const critical = by('critical');
  const important = by('important');
  const info = by('informational');
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon name="shield" className="h-5 w-5 text-teal-800" />
          {t('alert.title')}
        </span>
      }
    >
      <div className="flex flex-col gap-3" data-testid="safety-card">
        <p className="text-xs text-slate-600">{t('alert.lead')}</p>
        {rules.vocabulary.status === 'error' && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t('alert.vocabularyError')}</p>}
        {!rules.alerts.length && <p className="text-sm text-slate-700">{t('alert.none')}</p>}
        {[...critical, ...important].length > 0 && (
          <ul className="flex flex-col gap-2">
            {[...critical, ...important].map((a) => (
              <AlertRow key={a.key} a={a} rules={rules} caseId={b.case.id} />
            ))}
          </ul>
        )}
        {info.length > 0 && (
          <details className="group rounded-xl border border-slate-200" data-testid="informational-group">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-slate-800">
              <span>{t('alert.informational', { n: info.length })}</span>
              <Icon name="chevron-down" className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="flex flex-col gap-2 border-t border-slate-200 p-2">
              {info.map((a) => (
                <AlertRow key={a.key} a={a} rules={rules} caseId={b.case.id} />
              ))}
            </ul>
          </details>
        )}
        {rules.notChecked.length > 0 && (
          <details className="group rounded-xl border border-dashed border-slate-400" open={rules.notChecked.length <= 3} data-testid="not-checked">
            <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-slate-800">
              <span>{t('alert.notChecked', { n: rules.notChecked.length })}</span>
              <Icon name="chevron-down" className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <ul className="flex flex-col gap-1 border-t border-dashed border-slate-300 p-3 text-sm text-slate-800">
              {rules.notChecked.map((n) => (
                <li key={n.key} className="flex gap-2" data-what={n.what}>
                  <span aria-hidden="true">○</span>
                  <span>{tl(n.reason)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Card>
  );
}

/** The safety card on the case hub, loading its own rules. */
export function CaseSafety({ b }: { b: CaseBundle }) {
  const { t } = useI18n();
  const rules = useCaseRules(b);
  if (!rules.ready) return <p className="text-sm text-slate-600">{t('alert.loading')}</p>;
  return <SafetyCard b={b} rules={rules} />;
}

/** The alerts acted on in one task worksheet: critical and important listed, informational collapsed. */
export function TaskAlerts({ b, taskId }: { b: CaseBundle; taskId: string }) {
  const { t } = useI18n();
  const rules = useCaseRules(b);
  if (!rules.ready) return null;
  const mine = rules.alerts.filter((a) => a.taskId === taskId);
  if (!mine.length) return null;
  const shown = mine.filter((a) => a.level !== 'informational');
  const info = mine.filter((a) => a.level === 'informational');
  // Adding a flag to the trainee's own register is their decision, item by item: only the drug names are carried over.
  const addRow = (a: Alert) => {
    if (a.ruleId !== 'interaction' || a.medIds?.length !== 2 || b.case.status === 'archived') return undefined;
    const [x, y] = a.medIds.map((id) => b.courses.find((c) => c.medId === id)?.drug);
    if (!x || !y) return undefined;
    const q = new URLSearchParams({ task: taskId, kind: 'drug_drug', drugA: x, drugB: y });
    return (
      <a href={`#/cases/${b.case.id}/item/new/interaction?${q.toString()}`} className="self-start text-xs font-medium underline" data-testid="alert-add-row">
        {t('alert.addRow')}
      </a>
    );
  };
  return (
    <section className="surface flex flex-col gap-2 p-4" data-testid="task-alerts">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
        <Icon name="shield" className="h-5 w-5 text-teal-800" />
        {t('alert.forTask')}
      </h2>
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2">
          {shown.map((a) => (
            <AlertRow key={a.key} a={a} rules={rules} caseId={b.case.id} taskLink={false} action={addRow(a)} />
          ))}
        </ul>
      )}
      {info.length > 0 && (
        <details className="group rounded-xl border border-slate-200" data-testid="informational-group">
          <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-slate-800">
            <span>{t('alert.informational', { n: info.length })}</span>
            <Icon name="chevron-down" className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="flex flex-col gap-2 border-t border-slate-200 p-2">
            {info.map((a) => (
              <AlertRow key={a.key} a={a} rules={rules} caseId={b.case.id} taskLink={false} action={addRow(a)} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** What a medication name resolved to offline — or that it was not recognised and so not checked. */
export function DrugMatchLine({ name, rules }: { name: string; rules: CaseRules }) {
  const { t } = useI18n();
  const m = rules.match(name);
  if (!m) return null;
  if (m.status === 'matched') {
    const names = m.ingredients.map((i) => i.name).join(' + ');
    return (
      <p className="text-xs text-slate-600" data-testid="drug-match" data-status="matched">
        {m.via === 'formulary' ? t('match.formulary', { names }) : t('match.rxnorm', { names })}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-amber-900" data-testid="drug-match" data-status="not_checked">
      <span>{m.reason === 'no_vocabulary' ? t('match.noVocabulary') : t('match.none')}</span>
      {m.reason === 'unmatched' && (
        <a href={`#/reference/formulary/new?brand=${encodeURIComponent(name)}`} className="underline">
          {t('match.addFormulary')}
        </a>
      )}
    </p>
  );
}

/** Compact tags for one row of a worksheet (e.g. a medication in Task 28): phrasing content, so they fit in a summary line. */
export function InlineAlertTags({ alerts }: { alerts: readonly Alert[] }) {
  const tl = useL();
  if (!alerts.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" data-testid="row-alerts">
      {alerts.map((a) => (
        <span key={a.key} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${LEVEL_STYLE[a.level]}`} data-level={a.level} data-rule={a.ruleId}>
          <span aria-hidden="true">{a.level === 'critical' ? '‼' : a.level === 'important' ? '!' : 'i'}</span>
          {tl(a.title)}
        </span>
      ))}
    </span>
  );
}

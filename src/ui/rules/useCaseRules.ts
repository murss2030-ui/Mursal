/**
 * The rules engine for one case, as the interface needs it: alerts by level,
 * which are acknowledged (for this exact data), badges per medication, and
 * what could not be checked. First appearances are recorded as firings, for
 * the per-rule counts (Section 10).
 */
import { useEffect, useMemo } from 'react';
import { resultCurrency } from '../../calc/currency';
import { CALC_BY_ID } from '../../calc/registry';
import type { AdjustmentRule, FormularyItem, LabThreshold } from '../../domain/reference';
import { L } from '../../domain/label';
import { aliasesFrom, matchDrug, type DrugMatch } from '../../drugs/normalize';
import { useAware, useInteractions, useVocabulary, type VocabularyState } from '../../drugs/useVocabulary';
import { evaluateRules } from '../../rules/engine';
import type { Alert, NotChecked } from '../../rules/types';
import type { CaseBundle } from '../case-bundle';
import { useAlertAcks, useReference } from '../data';
import { useSession } from '../session-context';

export interface CaseRules {
  ready: boolean;
  vocabulary: VocabularyState;
  alerts: Alert[];
  notChecked: NotChecked[];
  isAcked: (a: Alert) => boolean;
  ackReason: (a: Alert) => string | undefined;
  /** Critical alerts not yet acknowledged for their current data: shown as an interruptive modal. */
  pendingCritical: Alert[];
  /** Important and critical alerts about a medication course, for inline badges. */
  forMed: (medId: string) => Alert[];
  forItem: (itemId: string) => Alert[];
  /** How a drug name resolves offline (RxNorm, or a brand from the formulary); undefined while loading. */
  match: (name: string) => DrugMatch | undefined;
}

export function useCaseRules(b: CaseBundle | undefined): CaseRules {
  const { store } = useSession();
  const vocabulary = useVocabulary();
  const interactions = useInteractions();
  const aware = useAware();
  const formulary = useReference<FormularyItem>('formulary');
  const adjustments = useReference<AdjustmentRule>('adjustment');
  const thresholds = useReference<LabThreshold>('threshold');
  const acks = useAlertAcks(b?.case.id ?? '');
  const ready =
    !!b &&
    vocabulary.status !== 'loading' &&
    interactions.status !== 'loading' &&
    aware.status !== 'loading' &&
    formulary.status === 'ready' && adjustments.status === 'ready' && thresholds.status === 'ready' && acks.status === 'ready';

  const outcome = useMemo(() => {
    if (!b || !ready || formulary.status !== 'ready' || adjustments.status !== 'ready' || thresholds.status !== 'ready') return { alerts: [], notChecked: [] };
    const out = evaluateRules({
      today: b.today,
      current: b.current,
      items: b.items,
      tasks: b.tasks,
      calcResults: b.calcResults,
      isCurrent: (r) => {
        const def = CALC_BY_ID.get(r.calc);
        return def ? resultCurrency(r, def, b.calcContext).current : false;
      },
      formulary: formulary.data,
      adjustments: adjustments.data,
      thresholds: thresholds.data,
      gather: b.calcContext,
      ...(vocabulary.status === 'ready' ? { vocab: vocabulary.vocab } : {}),
      ...(interactions.status === 'ready' ? { interactions: interactions.data } : {}),
      ...(aware.status === 'ready' ? { aware: aware.data } : {}),
    });
    // An installed dataset that could not be loaded is a different reason from one not installed.
    const failed = new Map([
      ['interactions', interactions.status === 'error'],
      ['aware', aware.status === 'error'],
    ]);
    return {
      alerts: out.alerts,
      notChecked: out.notChecked.map((n) =>
        failed.get(n.what)
          ? {
              ...n,
              reason: L(
                `${n.what === 'interactions' ? 'Drug–drug interactions' : 'AWaRe categories'} were not checked: the dataset could not be loaded or failed its integrity check.`,
                `لم تُفحص ${n.what === 'interactions' ? 'التداخلات الدوائية' : 'فئات AWaRe'}: تعذّر تحميل البيانات أو فشل التحقق من سلامتها.`,
              ),
            }
          : n,
      ),
    };
  }, [b, ready, vocabulary, interactions, aware, formulary, adjustments, thresholds]);

  const ackMap = useMemo(() => {
    const m = new Map<string, string>();
    if (acks.status === 'ready') for (const a of acks.data) m.set(`${a.key}#${a.dataHash}`, a.reason);
    return m;
  }, [acks]);

  const caseId = b?.case.id;
  const signature = outcome.alerts.map((a) => `${a.key}#${a.dataHash}`).join('|');
  useEffect(() => {
    if (!caseId || !ready || !outcome.alerts.length || b?.case.status === 'archived') return;
    // Recorded once per distinct set of alerts (the signature), not on every render.
    void store.recordAlertFirings(caseId, outcome.alerts).catch(() => undefined);
  }, [caseId, ready, signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const aliases = useMemo(() => (formulary.status === 'ready' ? aliasesFrom(formulary.data) : undefined), [formulary]);

  const isAcked = (a: Alert) => ackMap.has(`${a.key}#${a.dataHash}`);
  return {
    ready,
    vocabulary,
    alerts: outcome.alerts,
    notChecked: outcome.notChecked,
    isAcked,
    ackReason: (a) => ackMap.get(`${a.key}#${a.dataHash}`),
    pendingCritical: outcome.alerts.filter((a) => a.level === 'critical' && !isAcked(a)),
    forMed: (medId) => outcome.alerts.filter((a) => a.level !== 'informational' && a.medIds?.includes(medId)),
    forItem: (itemId) => outcome.alerts.filter((a) => a.level !== 'informational' && a.itemIds?.includes(itemId)),
    match: (name) => (ready && aliases ? matchDrug(name, vocabulary.status === 'ready' ? vocabulary.vocab : undefined, aliases) : undefined),
  };
}

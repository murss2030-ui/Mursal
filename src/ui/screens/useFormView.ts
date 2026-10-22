import { useMemo } from 'react';
import { resultCurrency } from '../../calc/currency';
import { CALC_BY_ID } from '../../calc/registry';
import type { CalcResult } from '../../calc/types';
import { deriveForm, type CopyMode, type FormContext, type FormView } from '../../domain/form/derive';
import { indexTimeline } from '../../domain/timeline';
import type { Case, TimelineEntry } from '../../domain/types';
import { DATASETS } from '../../drugs/useVocabulary';
import { useCaseBundle } from '../case-bundle';
import { useCalcResults, useEntries, useFormDraft, useIdentifiers, useItems, useTasks, useTrainee } from '../data';
import { useCaseRules } from '../rules/useCaseRules';

/** Ids of calculation results whose inputs changed since (see src/calc/currency.ts). */
export function outOfDate(c: Case, entries: readonly TimelineEntry[], results: readonly CalcResult[]): Set<string> {
  const ctx = { demographics: c.demographics, current: indexTimeline(entries).current };
  const ids = new Set<string>();
  for (const r of results) {
    const def = CALC_BY_ID.get(r.calc);
    if (def && !resultCurrency(r, def, ctx).current) ids.add(r.id);
  }
  return ids;
}

/**
 * The department form as derived from the case, the same wherever it is shown
 * — on screen (FormTab) and in the export — so that nothing the form leaves
 * out can appear in the file.
 */
export function useFormView(c: Case, mode: CopyMode): FormView | null {
  const entries = useEntries(c.id);
  const ids = useIdentifiers(c.id);
  const formDraft = useFormDraft(c.id);
  const trainee = useTrainee();
  const items = useItems(c.id);
  const tasks = useTasks(c.id);
  const calcs = useCalcResults(c.id);
  const bundle = useCaseBundle(c.id);
  const rules = useCaseRules(bundle.status === 'ready' ? bundle.b : undefined);

  const ready =
    entries.status === 'ready' &&
    ids.status === 'ready' &&
    formDraft.status === 'ready' &&
    trainee.status === 'ready' &&
    items.status === 'ready' &&
    tasks.status === 'ready' &&
    calcs.status === 'ready' &&
    rules.ready;
  const automaticInteractions = useMemo((): FormContext['automaticInteractions'] => {
    if (!rules.ready) return undefined;
    // No dataset, or one refused: no check at all. Otherwise the gaps of a partial check are listed with the rows.
    const none = rules.notChecked.find((n) => n.key === 'interactions');
    if (none) return { checked: false, reason: none.reason.en };
    const found = rules.alerts.filter((a) => a.interaction);
    const gaps = rules.notChecked.filter((n) => n.what === 'interactions').map((n) => n.reason.en);
    return { checked: true, source: found[0]?.source.en ?? DATASETS.interactions?.source ?? '', rows: found.map((a) => ({ key: a.key, ...a.interaction! })), gaps };
  }, [rules.ready, rules.notChecked, rules.alerts]);
  const view = useMemo(
    () =>
      ready
        ? deriveForm({
            case: c,
            identifiers: ids.data,
            entries: entries.data,
            draft: formDraft.data,
            trainee: trainee.data,
            items: items.data,
            tasks: tasks.data,
            calcResults: calcs.data,
            calcOutOfDate: outOfDate(c, entries.data, calcs.data),
            reviews: bundle.status === 'ready' ? bundle.b.reviews : [],
            ...(bundle.status === 'ready' && bundle.b.cardContext.verdicts ? { verdicts: bundle.b.cardContext.verdicts } : {}),
            ...(automaticInteractions ? { automaticInteractions } : {}),
            mode,
          })
        : null,
    [ready, c, ids, entries, formDraft, trainee, items, tasks, calcs, automaticInteractions, mode, bundle],
  );
  return view;
}

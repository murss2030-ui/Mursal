/**
 * Loads the offline datasets once per page (served by the app itself,
 * precached for offline use) and verifies each checksum before use. A dataset
 * the manifest does not list is "absent": the checks that need it are
 * reported as not made.
 */
import { useEffect, useState } from 'react';
import { datasets, type DatasetEntry } from 'virtual:preceptor-datasets';
import type { AwareDataset, InteractionDataset } from '../rules/types';
import { buildAware, buildInteractions, loadVerified, type AwareFile, type InteractionFile, type OncFile } from './datasets';
import { loadVocabulary, type DrugVocabulary } from './vocabulary';

export const DATASETS = datasets;
export const RXNORM_DATASET = datasets['rxnorm-subset'];

const url = (d: DatasetEntry) => `${import.meta.env.BASE_URL}${d.file}`;

/** One load per page; a failure (network, checksum) is not cached, so the next screen tries again. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= load().catch((e: unknown) => {
      pending = undefined;
      throw e;
    }));
}

export const appVocabulary = once<DrugVocabulary>(() =>
  RXNORM_DATASET ? loadVocabulary(url(RXNORM_DATASET), RXNORM_DATASET.sha256) : Promise.reject(new Error('The drug vocabulary is not installed.')),
);
const appInteractions = once<InteractionDataset>(async () => {
  const [ddinter, onc] = await Promise.all([
    loadVerified<InteractionFile>(url(datasets.interactions!), datasets.interactions!.sha256),
    datasets.onc ? loadVerified<OncFile>(url(datasets.onc), datasets.onc.sha256) : Promise.resolve(undefined),
  ]);
  return buildInteractions(ddinter, onc);
});
const appAware = once<AwareDataset>(async () => buildAware(await loadVerified<AwareFile>(url(datasets.aware!), datasets.aware!.sha256)));

export type DatasetState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'absent' } | { status: 'error'; error: Error };
export type VocabularyState = { status: 'loading' } | { status: 'ready'; vocab: DrugVocabulary } | { status: 'error'; error: Error };

function useLoaded<T>(present: boolean, load: () => Promise<T>): DatasetState<T> {
  const [state, setState] = useState<DatasetState<T>>(present ? { status: 'loading' } : { status: 'absent' });
  useEffect(() => {
    if (!present) return;
    let live = true;
    load().then(
      (data) => live && setState({ status: 'ready', data }),
      (error: Error) => live && setState({ status: 'error', error }),
    );
    return () => {
      live = false;
    };
  }, [present, load]);
  return state;
}

export function useVocabulary(): VocabularyState {
  const s = useLoaded(true, appVocabulary);
  return s.status === 'ready' ? { status: 'ready', vocab: s.data } : s.status === 'error' ? s : { status: 'loading' };
}

export function useInteractions(): DatasetState<InteractionDataset> {
  return useLoaded(!!datasets.interactions, appInteractions);
}

export function useAware(): DatasetState<AwareDataset> {
  return useLoaded(!!datasets.aware, appAware);
}

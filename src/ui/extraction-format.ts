/** Display of an extracted field: the value as it would be stored, in the timeline's own wording. */
import { buildPayload } from '../domain/entries';
import type { ExtractedField, TimelineEntry } from '../domain/types';
import type { I18n } from '../i18n/i18n';
import { entryText } from './format';

export function fieldSummary(f: Pick<ExtractedField, 'target' | 'values' | 'day'>, i18n: Pick<I18n, 't'>): string {
  const v = f.values;
  if (f.target.kind === 'register') return [v.drug, v.regimen].filter(Boolean).join(' — ');
  const built = buildPayload(f.target.type, v, { newId: () => 'preview' });
  if (built.ok) {
    const e = { id: 'preview', caseId: '', hospitalDay: f.day ?? 0, recordedAt: '', author: 'ai_extracted', provenance: 'extracted_unverified', type: f.target.type, payload: built.payload } as TimelineEntry;
    return entryText(e, i18n).main;
  }
  // Not yet valid: show what was understood, as written.
  return Object.entries(v)
    .filter(([k, x]) => x && !['resultKind', 'doseKind', 'category'].includes(k))
    .map(([, x]) => x)
    .join(' · ');
}

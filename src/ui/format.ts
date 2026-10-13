/**
 * Display text for timeline entries. Clinical content stays in English
 * (Decision 10); category names go through the term glossary.
 */
import { VITAL_BY_ID } from '../domain/catalogue';
import { formatNumber } from '../domain/numbers';
import { doseText, regimenText, unitText } from '../domain/timeline';
import type { EntryType, TimelineEntry } from '../domain/types';
import type { I18n } from '../i18n/i18n';
import type { TermId } from '../i18n/terms';
import type { IconName } from './components/Icon';

export const ENTRY_ICONS: Record<EntryType, IconName> = {
  lab: 'flask',
  vital: 'heart',
  weight: 'weight',
  med_start: 'pill',
  med_change: 'pill',
  med_stop: 'pill',
  culture: 'microscope',
  imaging: 'image',
  procedure: 'activity',
  note: 'note',
  event: 'calendar',
  intervention: 'flag',
  outcome: 'target',
};

export function entryTermId(e: TimelineEntry): TermId {
  if (e.type === 'note') return `note.${e.payload.category}` as TermId;
  return `entry.${e.type}` as TermId;
}

const refRange = (low?: number, high?: number, text?: string, unit?: string): string | undefined => {
  const r =
    low !== undefined || high !== undefined
      ? `ref ${low !== undefined ? formatNumber(low) : ''}–${high !== undefined ? formatNumber(high) : ''} ${unitText(unit ?? '')}`.trim()
      : undefined;
  return [r, text].filter(Boolean).join('; ') || undefined;
};

/** Main line and detail lines for an entry. */
export function entryText(e: TimelineEntry, i18n: Pick<I18n, 't'>): { main: string; details: string[] } {
  const { t } = i18n;
  switch (e.type) {
    case 'lab': {
      const p = e.payload;
      const v = p.result.kind === 'numeric' ? `${formatNumber(p.result.value)} ${unitText(p.unit)}`.trim() : p.result.text;
      return { main: `${p.analyteName}: ${v}`, details: [refRange(p.refLow, p.refHigh, p.refText, p.unit), p.comment].filter(Boolean) as string[] };
    }
    case 'vital': {
      const p = e.payload;
      const name = VITAL_BY_ID.get(p.vital)?.name ?? p.vital;
      const v =
        p.vital === 'blood_pressure'
          ? `${formatNumber(p.systolic ?? 0)}/${formatNumber(p.diastolic ?? 0)} ${p.unit}`
          : `${formatNumber(p.value ?? 0)} ${p.unit}${p.periodHours ? ` / ${formatNumber(p.periodHours)} h` : ''}`;
      return { main: `${name}: ${v}`, details: p.comment ? [p.comment] : [] };
    }
    case 'weight':
      return { main: `${formatNumber(e.payload.value)} kg`, details: [t(`weight.${e.payload.method}`)] };
    case 'med_start': {
      const p = e.payload;
      return {
        main: `${p.drug}${p.brand ? ` (${p.brand})` : ''} — ${regimenText(p)}`,
        details: [p.indication ? `Indication: ${p.indication}` : 'Indication: not recorded', p.notes].filter(Boolean) as string[],
      };
    }
    case 'med_change': {
      const p = e.payload;
      const parts = [p.dose ? `dose → ${doseText(p.dose)}` : '', p.route ? `route → ${p.route}` : '', p.frequency ? `frequency → ${p.frequency}` : ''].filter(Boolean);
      return { main: `${p.drug}: ${parts.join(', ')}`, details: p.reason ? [p.reason] : [] };
    }
    case 'med_stop':
      return { main: `${e.payload.drug} stopped`, details: e.payload.reason ? [e.payload.reason] : [] };
    case 'culture': {
      const p = e.payload;
      return {
        main: `${p.specimen} culture: ${t(`culture.${p.status}`)}`,
        details: [p.organism, p.gramStain ? `Gram stain: ${p.gramStain}` : undefined, p.susceptibility].filter(Boolean) as string[],
      };
    }
    case 'imaging':
      return { main: `${e.payload.modality}${e.payload.region ? ` — ${e.payload.region}` : ''}`, details: [e.payload.reportText] };
    case 'procedure':
      return { main: e.payload.name, details: e.payload.details ? [e.payload.details] : [] };
    case 'note': {
      const p = e.payload;
      if (p.category === 'allergy_adr') {
        if (p.kind === 'nkda') return { main: 'NKDA — no known drug allergies', details: [] };
        return {
          main: `${p.substance ?? ''}${p.reaction ? ` — ${p.reaction}` : ''}`,
          details: [t(`allergy.${p.kind}`), p.severity ? t(`severity.${p.severity}`) : ''].filter(Boolean),
        };
      }
      if (p.category === 'social_history') {
        return {
          main: `Khat use: ${p.khat}${p.khatDetails ? ` (${p.khatDetails})` : ''} · Tobacco: ${p.tobacco}${p.tobaccoDetails ? ` (${p.tobaccoDetails})` : ''}`,
          details: [p.alcohol ? `Alcohol: ${p.alcohol}` : '', p.occupation ? `Occupation: ${p.occupation}` : '', p.other ?? ''].filter(Boolean),
        };
      }
      if (p.category === 'problem') {
        return {
          main: `${p.name} — ${p.acuity}, ${p.status}${p.primaryDiagnosis ? ' (primary diagnosis)' : ''}`,
          details: [p.stage ? `Stage: ${p.stage}` : '', p.problemType ? `Type: ${p.problemType}` : '', p.duration ? `Duration: ${p.duration}` : ''].filter(Boolean),
        };
      }
      return { main: p.text, details: [] };
    }
    case 'event':
      return { main: e.payload.description, details: [t(`event.${e.payload.category}`)] };
    case 'intervention':
      return { main: e.payload.description, details: [] };
    case 'outcome':
      return { main: e.payload.measured, details: [] };
  }
}

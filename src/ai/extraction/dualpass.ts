/**
 * Dual-pass extraction (Section 13): medication documents and anything
 * handwritten are read twice, and any disagreement between the two readings
 * marks the field uncertain automatically.
 */
import type { SourceDocType } from '../../domain/types';
import type { Candidate } from './candidates';

export const needsSecondPass = (docType: SourceDocType, first: readonly Candidate[]): boolean =>
  docType === 'medication_chart' || docType === 'prescription' || first.some((c) => c.handwritten || c.kind === 'medication');

const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** What identifies "the same item" across two readings. */
function identity(c: Candidate): string {
  const v = c.values;
  const name = v.analyte && v.analyte !== 'other' ? v.analyte : v.vital || v.drug || v.analyteOther || v.substance || v.name || v.specimen || v.category || '';
  return `${c.kind}|${c.medContext ?? ''}|${norm(name)}|${c.day ?? ''}`;
}

/** The values that must agree. */
function reading(c: Candidate): string {
  const v = c.values;
  const keys = ['value', 'unit', 'resultText', 'systolic', 'diastolic', 'doseValue', 'doseUnit', 'doseText', 'route', 'routeOther', 'frequency', 'frequencyOther', 'regimen', 'status', 'kind', 'method'];
  return keys.map((k) => `${k}=${norm(v[k])}`).join(';');
}

function describe(c: Candidate): string {
  const v = c.values;
  return [v.value ?? v.resultText, v.unit, v.systolic && `${v.systolic}/${v.diastolic}`, v.doseValue, v.doseUnit, v.doseText, v.route, v.frequency, v.regimen]
    .filter(Boolean)
    .join(' ');
}

/**
 * Merges two readings of one document. Items read the same way twice pass
 * unflagged; a different value flags the first reading and shows the second;
 * an item found by only one reading is kept and flagged.
 */
export function mergePasses(first: readonly Candidate[], second: readonly Candidate[]): Candidate[] {
  const pool = new Map<string, Candidate[]>();
  for (const c of second) {
    const k = identity(c);
    pool.set(k, [...(pool.get(k) ?? []), c]);
  }
  const out: Candidate[] = [];
  for (const c of first) {
    const k = identity(c);
    const candidates = pool.get(k) ?? [];
    const same = candidates.findIndex((x) => reading(x) === reading(c));
    if (same >= 0) {
      candidates.splice(same, 1);
      out.push(c);
    } else if (candidates.length) {
      const other = candidates.shift()!;
      out.push({ ...c, flags: [...new Set([...c.flags, 'dual_pass_disagreement' as const])], alternative: describe(other) || other.rawText });
    } else {
      out.push({ ...c, flags: [...new Set([...c.flags, 'single_pass' as const])] });
    }
  }
  let n = first.length;
  for (const rest of pool.values()) {
    for (const c of rest) out.push({ ...c, id: `f${++n}`, flags: [...new Set([...c.flags, 'single_pass' as const])] });
  }
  return out;
}

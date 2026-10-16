/**
 * Help for removing identifiers from typed or pasted text before it is stored
 * (Sections 13 and 18). It finds likely identifiers — the case's own stored
 * identifiers, labelled lines ("Name:", "MRN:", "Bed:" …), phone numbers and
 * long number runs — so the trainee can review and remove them.
 *
 * It is an aid, not a guarantee: the trainee still confirms that every
 * identifier was removed before anything is saved.
 */

export type IdentifierKind = 'patient_name' | 'mrn' | 'room_bed' | 'consultant' | 'labelled' | 'phone' | 'long_number' | 'doctor';

export interface IdentifierHit {
  kind: IdentifierKind;
  start: number;
  end: number;
  text: string;
}

export interface KnownIdentifiers {
  patientName?: string;
  mrn?: string;
  roomBed?: string;
  consultantName?: string;
}

export const REDACTION_MARK = '[REMOVED]';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matches that work for Arabic and Latin script. */
function wordMatches(text: string, needle: string, kind: IdentifierKind, out: IdentifierHit[]): void {
  const n = needle.trim();
  if (n.length < 3) return;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(re)) out.push({ kind, start: m.index!, end: m.index! + m[0].length, text: m[0] });
}

const LABELS = [
  'patient\\s*name',
  'pt\\.?\\s*name',
  'name',
  'mrn',
  'm\\.r\\.n\\.?',
  'file\\s*(?:no\\.?|number)',
  'record\\s*(?:no\\.?|number)',
  'hospital\\s*(?:no\\.?|number)',
  'national\\s*id',
  'id\\s*(?:no\\.?|number)',
  'bed(?:\\s*no\\.?)?',
  'room(?:\\s*no\\.?)?',
  'consultant',
  'attending',
  'treating\\s*(?:doctor|physician)',
  'phone',
  'tel\\.?',
  'mobile',
  'address',
  'اسم\\s*المريض',
  'الاسم',
  'رقم\\s*الملف',
  'رقم\\s*السجل',
  'رقم\\s*الهوية',
  'الرقم\\s*الوطني',
  'رقم\\s*السرير',
  'السرير',
  'الغرفة',
  'الطبيب\\s*المعالج',
  'الاستشاري',
  'الهاتف',
  'الجوال',
  'العنوان',
];
const LABELLED = new RegExp(`^[ \\t]*(?:${LABELS.join('|')})[ \\t]*[:：\\-–][ \\t]*(\\S[^\\n]*)$`, 'gimu');
/** Yemeni mobile numbers (with or without +967) and other phone-like groups. */
const PHONE = /(?<!\d)(?:\+?967[\s-]?)?7[01378]\d[\s-]?\d{3}[\s-]?\d{3}(?!\d)/gu;
/** Seven or more consecutive digits: record numbers and IDs — laboratory values are not this long. */
const LONG_NUMBER = /(?<![\d.,])\d{7,}(?![\d.,])/gu;
const DOCTOR = /(?:\bDr\.?|\bDoctor)\s+\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?|(?:د\.|الدكتور|الدكتورة|دكتور)\s*\p{L}+(?:\s+\p{L}+)?/gu;

/** Likely identifiers in `text`, sorted, without overlaps (the longest hit wins). */
export function findIdentifiers(text: string, known: KnownIdentifiers = {}): IdentifierHit[] {
  const hits: IdentifierHit[] = [];
  if (known.patientName) {
    wordMatches(text, known.patientName, 'patient_name', hits);
    for (const part of known.patientName.split(/\s+/)) wordMatches(text, part, 'patient_name', hits);
  }
  if (known.mrn) wordMatches(text, known.mrn, 'mrn', hits);
  if (known.roomBed) wordMatches(text, known.roomBed, 'room_bed', hits);
  if (known.consultantName) {
    wordMatches(text, known.consultantName, 'consultant', hits);
    for (const part of known.consultantName.split(/\s+/)) wordMatches(text, part, 'consultant', hits);
  }
  for (const m of text.matchAll(LABELLED)) {
    const value = m[1]!.trimEnd();
    const start = m.index! + m[0].indexOf(m[1]!);
    hits.push({ kind: 'labelled', start, end: start + value.length, text: value });
  }
  for (const m of text.matchAll(PHONE)) hits.push({ kind: 'phone', start: m.index!, end: m.index! + m[0].length, text: m[0] });
  for (const m of text.matchAll(LONG_NUMBER)) hits.push({ kind: 'long_number', start: m.index!, end: m.index! + m[0].length, text: m[0] });
  for (const m of text.matchAll(DOCTOR)) hits.push({ kind: 'doctor', start: m.index!, end: m.index! + m[0].length, text: m[0] });

  // Keep the longest of overlapping hits.
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: IdentifierHit[] = [];
  for (const h of hits) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) {
      if (h.end > last.end) out[out.length - 1] = { ...last, end: h.end, text: text.slice(last.start, h.end) };
      continue;
    }
    out.push(h);
  }
  return out;
}

/** Replaces each hit with a visible removal mark. */
export function removeIdentifiers(text: string, hits: readonly IdentifierHit[]): string {
  let out = '';
  let pos = 0;
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    if (h.start < pos) continue;
    out += text.slice(pos, h.start) + REDACTION_MARK;
    pos = h.end;
  }
  return out + text.slice(pos);
}

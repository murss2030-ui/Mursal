/**
 * The last check before text leaves the device (Section 18): calendar dates
 * become hospital days ("hospital day numbering rather than calendar dates in
 * everything sent to the model"), and anything that still looks like an
 * identifier is masked. The stored document is not changed.
 */
import { hospitalDayOf, isValidISODate } from '../../domain/dates';
import { findIdentifiers, removeIdentifiers, type KnownIdentifiers } from '../../domain/workflow/deidentify';

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');

function iso(y: number, m: number, d: number): string | undefined {
  const year = y < 100 ? 2000 + y : y;
  const s = `${year}-${pad(m)}-${pad(d)}`;
  return isValidISODate(s) ? s : undefined;
}

/** Arabic-Indic and Eastern Arabic-Indic digits → ASCII, one character for one (positions are preserved). */
export function asciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (c) => String((c.charCodeAt(0) & 0xf) % 10));
}

interface Found {
  start: number;
  end: number;
  date?: string;
}

function findDates(text: string): Found[] {
  const t = asciiDigits(text);
  const out: Found[] = [];
  const push = (m: RegExpMatchArray, date: string | undefined) => out.push({ start: m.index!, end: m.index! + m[0].length, date });
  // A full stop may end the sentence after a date; a digit, slash or dash after it means it is something else.
  for (const m of t.matchAll(/(?<![\d/.-])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d/-]|\.\d)/g)) push(m, iso(+m[1]!, +m[2]!, +m[3]!));
  // Day first, as written in Yemen: 16/10/2026, 16-10-26, 16.10.2026.
  for (const m of t.matchAll(/(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?![\d/-]|\.\d)/g)) push(m, iso(+m[4]!, +m[3]!, +m[1]!));
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})\b/g)) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    if (mo) push(m, iso(+m[3]!, mo, +m[1]!));
  }
  for (const m of t.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[1]!.toLowerCase()];
    if (mo) push(m, iso(+m[3]!, mo, +m[2]!));
  }
  // Overlaps: keep the first, longest match.
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Found[] = [];
  for (const f of out) if (!kept.length || f.start >= kept[kept.length - 1]!.end) kept.push(f);
  return kept;
}

/**
 * Replaces calendar dates with "Day N" relative to the admission day (Day 0),
 * or with "[date]" when the date is impossible or implausibly far away.
 */
export function datesToHospitalDays(text: string, admissionDay0: string): { text: string; replaced: number } {
  const found = findDates(text);
  let out = '';
  let pos = 0;
  for (const f of found) {
    out += text.slice(pos, f.start);
    let label = '[date]';
    if (f.date) {
      const day = hospitalDayOf(admissionDay0, f.date);
      if (day >= -3650 && day <= 400) label = `Day ${day}`;
    }
    out += label;
    pos = f.end;
  }
  out += text.slice(pos);
  return { text: out, replaced: found.length };
}

/** Masks anything that still looks like an identifier. Returns how many were masked. */
export function maskIdentifiers(text: string, known: KnownIdentifiers): { text: string; masked: number } {
  const hits = findIdentifiers(text, known);
  return { text: hits.length ? removeIdentifiers(text, hits) : text, masked: hits.length };
}

/** The text exactly as it will be sent. */
export function deidentifyForModel(text: string, admissionDay0: string, known: KnownIdentifiers): { text: string; datesReplaced: number; identifiersMasked: number } {
  const masked = maskIdentifiers(text, known);
  const dated = datesToHospitalDays(masked.text, admissionDay0);
  return { text: dated.text, datesReplaced: dated.replaced, identifiersMasked: masked.masked };
}

/** A calendar date read from an image ("16/10/2026", "2026-10-16", "16 Oct 2026") as a hospital day, when unambiguous. */
export function dateTextToHospitalDay(dateText: string | null | undefined, admissionDay0: string): number | undefined {
  if (!dateText) return undefined;
  const dayMatch = /^\s*day\s*(-?\d{1,4})\s*$/i.exec(asciiDigits(dateText));
  if (dayMatch) return Number(dayMatch[1]);
  const f = findDates(dateText).find((x) => x.date);
  if (!f?.date) return undefined;
  const day = hospitalDayOf(admissionDay0, f.date);
  return day >= -3650 && day <= 400 ? day : undefined;
}

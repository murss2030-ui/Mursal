/**
 * Calendar-date and hospital-day arithmetic.
 *
 * Dates are plain 'YYYY-MM-DD' strings and all arithmetic is done in UTC on
 * those strings, so daylight-saving changes and the device time zone can
 * never shift a hospital day.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export const MIN_HOSPITAL_DAY = -90; // pre-admission data, e.g. outpatient results
export const MAX_HOSPITAL_DAY = 730;

export function isValidISODate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtcMs(s: string): number {
  if (!isValidISODate(s)) throw new Error(`Invalid date: ${s}`);
  const [y, mo, d] = s.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, mo - 1, d);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}

export function addDays(s: string, days: number): string {
  const dt = new Date(toUtcMs(s) + days * MS_PER_DAY);
  return dt.toISOString().slice(0, 10);
}

/** Hospital day of a calendar date: admission day is Day 0. */
export function hospitalDayOf(admissionDay0: string, date: string): number {
  return daysBetween(admissionDay0, date);
}

export function dateOfHospitalDay(admissionDay0: string, hospitalDay: number): string {
  return addDays(admissionDay0, hospitalDay);
}

/** Today's date on the device, in local time. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidTimeOfDay(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function isValidHospitalDay(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_HOSPITAL_DAY && n <= MAX_HOSPITAL_DAY;
}

/**
 * Parsing and formatting of numbers typed at the bedside.
 *
 * Accepts Western digits and Arabic-Indic digits (٠-٩ and ۰-۹), a dot or the
 * Arabic decimal separator (٫) as the decimal mark, and a leading minus sign.
 *
 * Commas are rejected rather than guessed: "1,5" could mean 1.5 or 15, and a
 * guessed value is worse than an error.
 */

export type ParseResult = { ok: true; value: number } | { ok: false; reason: 'empty' | 'comma' | 'invalid' };

const ARABIC_INDIC_ZERO = 0x0660;
const EXT_ARABIC_INDIC_ZERO = 0x06f0;

export function normaliseDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c >= ARABIC_INDIC_ZERO && c <= ARABIC_INDIC_ZERO + 9) out += String(c - ARABIC_INDIC_ZERO);
    else if (c >= EXT_ARABIC_INDIC_ZERO && c <= EXT_ARABIC_INDIC_ZERO + 9) out += String(c - EXT_ARABIC_INDIC_ZERO);
    else if (ch === '٫') out += '.'; // Arabic decimal separator
    else if (ch === '−') out += '-'; // Unicode minus sign
    else out += ch;
  }
  return out;
}

export function parseDecimal(input: string): ParseResult {
  const s = normaliseDigits(input).trim();
  if (s === '') return { ok: false, reason: 'empty' };
  if (s.includes(',') || s.includes('٬') || s.includes('،')) return { ok: false, reason: 'comma' };
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(s)) return { ok: false, reason: 'invalid' };
  const v = Number(s);
  if (!Number.isFinite(v)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: v };
}

export function parseInteger(input: string): ParseResult {
  const r = parseDecimal(input);
  if (!r.ok) return r;
  if (!Number.isInteger(r.value)) return { ok: false, reason: 'invalid' };
  return r;
}

/**
 * Display a number without trailing zeros and with a leading zero
 * ("0.5", never ".5"; "5", never "5.0"), following ISMP error-prone
 * notation guidance.
 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  // Up to 6 significant decimals, trailing zeros removed.
  const s = Number(v.toFixed(6)).toString();
  return s.startsWith('.') ? `0${s}` : s.startsWith('-.') ? `-0${s.slice(1)}` : s;
}

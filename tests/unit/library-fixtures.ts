/**
 * Synthetic guideline pages, as pdf.js would give them (positioned text pieces), for the library tests. No real guidance.
 */
import type { PageText, TextPiece } from '../../src/library/chunk';

/** A line of text as pdf.js would give it: one piece per word, at a size, from the top. */
export function line(text: string, y: number, size = 10, x = 72): TextPiece[] {
  const out: TextPiece[] = [];
  let at = x;
  for (const w of text.split(' ')) {
    const width = w.length * size * 0.5;
    out.push({ str: w, x: at, y, width, size });
    at += width + size * 0.28;
  }
  return out;
}
/** A table row: cells far apart. */
export function row(cells: string[], y: number, size = 9): TextPiece[] {
  return cells.flatMap((c, i) => line(c, y, size, 72 + i * 150));
}
export const page = (n: number, ...lines: TextPiece[][]): PageText => ({ page: n, height: 800, pieces: lines.flat() });

/** A synthetic guideline of three pages (no real guidance). */
export const GUIDE: PageText[] = [
  page(
    1,
    line('Synthetic Society — Test Guideline 2024', 30, 8),
    line('1 Introduction', 80, 16),
    line('This synthetic guideline exists only to test how passages are cut. It describes nothing', 110),
    line('real, and none of its content is clinical guidance for any patient or any drug at all.', 124),
    line('2 Treatment of the synthetic infection', 170, 16),
    line('2.1 Empirical therapy', 200, 13),
    line('Recommendation 1. We recommend that the synthetic agent be given within one hour of', 230),
    line('recognition of the synthetic syndrome in adults.', 244),
    line('(Strong recommendation, moderate-quality evidence)', 258),
    line('A second paragraph explains why the first recommendation exists, in enough words to be a pas-', 300),
    line('sage of its own: it mentions timing, the population of adults and the absence of any real data', 314),
    line('behind it, because the whole document is a test fixture written for the unit tests here.', 328),
    line('3', 780, 8),
  ),
  page(
    2,
    line('Synthetic Society — Test Guideline 2024', 30, 8),
    line('Table 2 Synthetic dose adjustment by kidney function', 80, 10),
    row(['CrCl (mL/min)', 'Dose', 'Interval'], 100),
    row(['>50', '1 g', 'every 8 hours'], 114),
    row(['10-50', '1 g', 'every 12 hours'], 128),
    row(['<10', '500 mg', 'every 24 hours'], 142),
    line('2.2 Drug monographs', 190, 13),
    line('Testamycin 15 mg/kg IV every 12 hours is the synthetic dose used in this fixture; it is not a', 220),
    line('dose of any real medicine and must never be read as one by anybody.', 234),
    line('4', 780, 8),
  ),
  page(3, line('Synthetic Society — Test Guideline 2024', 30, 8), line('R2. We suggest synthetic monitoring every day (weak recommendation, low-quality evidence).', 80), line('5', 780, 8)),
];
export const isDrug = (w: string) => /^testamycin$/i.test(w);

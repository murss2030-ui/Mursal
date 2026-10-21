/**
 * The guard in code on the verifier (verify-v2, M5): an assertion of its own
 * — a drug property, a time, a change, a reason, an absence — that no cited
 * source makes keeps a claim at most partly supported, whatever the verifier
 * answers. Its cases are the six statements the live probe of 20 October 2026
 * saw the verifier accept; it must not fire on a correct claim of the
 * semantic benchmark.
 */
import { describe, expect, it } from 'vitest';
import { checkVerification } from '../../src/ai/verification/check';
import type { RawVerdict, VerifyInput, VerifySource } from '../../src/ai/verification/contract';
import { stem, unsourcedAssertions } from '../../src/ai/verification/guard';
import { BENCH_ITEMS, BENCH_SOURCES } from '../fixtures/semantic-benchmark';

const H: VerifySource = { id: 'H', label: 'Case header', text: 'Case: {"kind":"teaching","age":67,"sex":"M","heightCm":170,"status":"active","hospitalDayToday":2}', context: true };
const src = (id: string, text: string, subject?: string, day?: number): VerifySource => ({ id, label: id, text, ...(subject ? { subject } : {}), ...(day !== undefined ? { day } : {}) });

describe('the probe’s six statements the verifier let through are held back', () => {
  const cases: [string, VerifySource[], string][] = [
    [
      'Acute kidney injury is present, but nephrotoxic agents like ibuprofen and metformin are still active.',
      [src('S1', 'ibuprofen 400 mg PO three times daily from Day 0 active for fever and pain', 'ibuprofen', 0), src('S2', 'metformin 1000 mg PO twice daily from Day 0 active for type 2 diabetes', 'metformin', 0), src('S3', 'Acute kidney injury on chronic kidney disease acute active', 'acute kidney injury on chronic kidney disease')],
      'nephrotoxic',
    ],
    [
      'Nephrotoxic NSAID (ibuprofen) and metformin continue during active AKI.',
      [src('S1', 'ibuprofen 400 mg PO three times daily from Day 0 active for fever and pain', 'ibuprofen', 0), src('S2', 'metformin 1000 mg PO twice daily from Day 0 active for type 2 diabetes', 'metformin', 0)],
      'Nephrotoxic',
    ],
    ['Hypertension is active but home amlodipine is not ordered; blood pressure currently 98/60 mmHg.', [src('S1', 'Day 0 Blood pressure: 98/60 mmHg', 'Blood pressure', 0), src('S2', 'Hypertension chronic active', 'Hypertension')], 'currently'],
    [
      'Elevated creatinine, glucose, and potassium levels are noted without a documented interpretation of the AKI severity or the impact of metformin.',
      [src('S1', 'Day 1 Serum creatinine: 2.6 mg/dL', 'Serum creatinine', 1), src('S2', 'Day 1 Glucose: 248 mg/dL', 'Glucose', 1)],
      'without a documented',
    ],
    [
      'Dose and route were changed for the management of acute decompensation.',
      [src('S1', 'furosemide 40 mg IV twice daily from Day 0 active for heart failure', 'furosemide', 0), src('S2', 'Pre-admission medication: furosemide; 40 mg PO once daily', 'furosemide')],
      'for the management of',
    ],
    ['INR increased to 3.9 on hospital day 2.', [src('S1', 'Day 2 INR: 3.9', 'INR', 2), src('S2', 'warfarin 5 mg PO once daily from Day 0 active for atrial fibrillation', 'warfarin', 0)], 'increased'],
  ];

  it.each(cases)('%s', (claim, sources, words) => {
    const hits = unsourcedAssertions(claim, [H, ...sources]);
    expect(hits.map((h) => h.text)).toContain(words);
    // A "supported" answer from the verifier becomes "partly supported", with the words named.
    const input: VerifyInput = { sources: [H, ...sources], claims: [{ id: 'V1', text: claim, sourceIds: ['H', ...sources.map((s) => s.id)] }] };
    const answer: RawVerdict = { claimId: 'V1', verdict: 'supported', contradicted: false, quotes: [{ sourceId: sources[0]!.id, text: sources[0]!.text }], unsupportedParts: [] };
    const [v] = checkVerification({ results: [answer] }, input);
    expect(v).toMatchObject({ verdict: 'partial' });
    expect(v!.flags).toContain('unsourced_assertion');
    expect(v!.unsupportedParts).toContain(words);
  });
});

describe('the guard does not fire where the sources make the assertion', () => {
  it('a word the source uses, in another form', () => {
    expect(stem('nephrotoxic')).toBe('nephrotox');
    expect(unsourcedAssertions('Ibuprofen is nephrotoxic.', [src('S1', 'NSAIDs: risk of nephrotoxicity in renal disease')])).toEqual([]);
    expect(unsourcedAssertions('Ankle oedema has reduced.', [src('S1', 'Day 2 Breathing easier; ankle oedema reduced', 'Progress', 2)])).toEqual([]);
  });

  it('a change shown by two values of the same test, or by two numbers of the claim found in its sources', () => {
    const scr = [src('S1', 'Day 0 Serum creatinine: 1.3 mg/dL', 'Serum creatinine', 0), src('S2', 'Day 2 Serum creatinine: 1.5 mg/dL', 'Serum creatinine', 2)];
    expect(unsourcedAssertions('Serum creatinine is increasing.', [H, ...scr])).toEqual([]);
    expect(unsourcedAssertions('Serum creatinine rose from 2.1 to 2.6 mg/dL.', [H, src('S1', 'Day 0 Serum creatinine: 2.1 mg/dL'), src('S2', 'Day 1 Serum creatinine: 2.6 mg/dL')])).toEqual([]);
    const k = [src('S3', 'Day 0 Potassium: 3.1 mmol/L', 'Potassium', 0), src('S4', 'Day 2 Potassium: 3.4 mmol/L', 'Potassium', 2)];
    expect(unsourcedAssertions('Potassium remains low.', [H, ...k])).toEqual([]);
    // A day number is not a value: "on Day 2" does not make a second number.
    expect(unsourcedAssertions('The INR increased to 3.8 on Day 2.', [H, src('S1', 'Day 2 INR: 3.8', 'INR', 2)]).map((h) => h.kind)).toEqual(['change']);
  });

  it('"currently" shown by a value recorded today', () => {
    expect(unsourcedAssertions('Potassium is currently 3.4 mmol/L.', [H, src('S1', 'Day 2 Potassium: 3.4 mmol/L', 'Potassium', 2)])).toEqual([]);
    expect(unsourcedAssertions('Potassium is currently 3.1 mmol/L.', [H, src('S1', 'Day 0 Potassium: 3.1 mmol/L', 'Potassium', 0)]).map((h) => h.kind)).toEqual(['current']);
  });

  it('fires on no correct claim of the semantic benchmark, and on each item written for it', () => {
    const byId = new Map(BENCH_SOURCES.map((s) => [s.id, s]));
    const fired = (b: (typeof BENCH_ITEMS)[number]) => unsourcedAssertions(b.claim, b.sources.map((id) => byId.get(id)!)).length > 0;
    expect(BENCH_ITEMS.filter((b) => b.expected[0] === 'supported' && fired(b)).map((b) => b.id)).toEqual([]);
    expect(BENCH_ITEMS.filter((b) => ['b38', 'b39', 'b40', 'b41', 'b42', 'b43'].includes(b.id) && !fired(b)).map((b) => b.id)).toEqual([]);
  });
});

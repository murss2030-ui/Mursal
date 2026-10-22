/**
 * M7: the monthly presentation is assembled only from the verified record —
 * the department form's gate decides which Problem Cards and recommendations
 * appear, nothing unverified is used, it is de-identified like the Teaching
 * copy, and it never shows a proposal as implemented or an unmeasured outcome
 * as measured. Counts carry their denominators.
 */
import { describe, expect, it } from 'vitest';
import { buildDeck, deckText, hashDeck, type DeckCase } from '../../src/domain/presentation';
import { deckCase } from '../../src/presentation/input';
import { newCase, newSession } from './helpers';

const base: DeckCase = {
  caseId: 'CASE-1111',
  kind: 'teaching',
  age: '64 years',
  sex: 'M',
  problems: [{ name: 'Acute kidney injury', status: 'active' }],
  labs: [{ name: 'Serum creatinine', value: '2.4 mg/dL', day: 1 }],
  cards: [],
  leftOut: [],
  monitoring: [{ parameter: 'Serum creatinine', target: '< 1.5 mg/dL', frequency: 'daily' }],
};
const card = (over: Partial<DeckCase['cards'][number]> = {}): DeckCase['cards'][number] => ({ id: 'i1', problem: 'Metformin dose not adjusted', implemented: false, outcome: 'not_measured', discussedWithPreceptor: false, ...over });
const opts = { rotationLabel: 'Internal medicine', period: '2026-10-01 – 2026-10-31', today: '2026-10-22', appVersion: '0.6.0' };

describe('the deck', () => {
  it('opens with a title, one slide per case and per card, monitoring, statistics and a closing statement', () => {
    const d = buildDeck({ ...opts, cases: [{ ...base, cards: [card({ recommendation: 'Hold metformin' })], reflection: { learning: 'Check renal function first' } }] });
    expect(d.slides.map((s) => s.kind)).toEqual(['title', 'case', 'card', 'monitoring', 'learning', 'statistics', 'closing']);
    expect(d.counts).toEqual({ cases: 1, cards: 1 });
    expect(deckText(d)).toContain('does not replace a clinical pharmacist');
    expect(deckText(d)).toContain('Nothing was sent to the care team');
  });

  it('a recommendation is proposed until recorded as implemented; an outcome is not measured until measured; no recommendation says so', () => {
    const text = (c: DeckCase['cards'][number]) => deckText(buildDeck({ ...opts, cases: [{ ...base, cards: [c] }] }));
    expect(text(card({ recommendation: 'Hold metformin' }))).toContain('Recommendation (proposed): Hold metformin');
    expect(text(card({ recommendation: 'Hold metformin' }))).toContain('Outcome: Not measured yet');
    expect(text(card({ recommendation: 'Hold metformin', implemented: true, outcome: 'yes', outcomeNote: 'Creatinine fell' }))).toMatch(/Recommendation \(implemented\).*\n.*Team response.*\n.*Outcome: Goal met — Creatinine fell/s);
    expect(text(card())).toContain('No final recommendation yet');
    expect(text(card())).not.toMatch(/Recommendation \(/);
  });

  it('statistics show counts with their denominators, never a bare percentage', () => {
    const d = buildDeck({ ...opts, cases: [{ ...base, cards: [card({ id: 'a', response: 'Accepted', implemented: true, outcome: 'partly' }), card({ id: 'b', priority: 'Critical' })] }] });
    const s = d.slides.find((x) => x.kind === 'statistics')!;
    expect(s.bullets).toEqual(expect.arrayContaining(['Recommendations communicated and answered by the team: 1 of 2', 'Recommendations recorded as implemented: 1 of 2', expect.stringContaining('Outcome measured: 1 of 2 (goal met 0, partly 1, not met 0)')]));
    expect(s.bullets.join(' ')).not.toContain('%');
    const none = buildDeck({ ...opts, cases: [base] });
    expect(none.slides.find((x) => x.kind === 'statistics')!.bullets).toContain('Recommendations communicated and answered by the team: —');
  });

  it('counts what the gate left out for the builder and puts none of it on a slide', async () => {
    const d = buildDeck({ ...opts, cases: [{ ...base, leftOut: [{ problem: 'Stale problem text', reason: 'stale' }] }] });
    expect(d.notIncluded).toEqual([{ caseId: 'CASE-1111', problem: 'Stale problem text', reason: 'stale' }]);
    expect(deckText(d)).not.toContain('Stale problem text');
    expect(await hashDeck(d)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('from the record', () => {
  async function setup(kind: 'teaching' | 'clinical' = 'teaching') {
    const ctx = await newSession();
    const c = await newCase(ctx.store, { kind, ageYears: 93, admissionDay0: '2026-10-10', ...(kind === 'clinical' ? { identifiers: { patientName: 'Synthetic Patient Gamma', mrn: 'MRN-4242' } } : {}) } as never);
    await ctx.store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 2.4 }, unit: 'mg/dL' } });
    return { ...ctx, c };
  }
  const CARD = { problem: 'Metformin continued while creatinine rose', evidence: 'Creatinine 2.4 mg/dL on Day 1', drugs: 'metformin', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C1.1', priority: 'important', recommendation: 'Hold metformin until renal function is stable', recStatus: 'final' };

  it('a current card enters with its final recommendation; a stale one is left out; the latest verified value is shown; age 90+ is not given', async () => {
    const { store, c } = await setup();
    const scr = (await store.listEntries(c.id))[0]!;
    const item = await store.addItem(c.id, 'drp', { ...CARD, supporting: `e:${scr.id}` });
    const first = (await deckCase(store, c.id))!;
    expect(first.age).toBe('90 or older');
    expect(first.labs).toEqual([{ name: 'Serum creatinine', value: '2.4 mg/dL', day: 1 }]);
    expect(first.cards).toHaveLength(1);
    expect(first.cards[0]).toMatchObject({ id: item.id, recommendation: 'Hold metformin until renal function is stable', implemented: false, outcome: 'not_measured', priority: 'Important' });
    expect(first.cards[0]!.pcne).toContain('P2.1');
    await store.addEntry(c.id, { type: 'lab', hospitalDay: 3, payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 3.1 }, unit: 'mg/dL' } });
    const later = (await deckCase(store, c.id))!;
    expect(later.cards).toEqual([]);
    expect(later.leftOut).toEqual([{ problem: CARD.problem, reason: 'stale' }]);
    expect(later.labs[0]).toMatchObject({ value: '3.1 mg/dL', day: 3 });
  });

  it('a Clinical Case’s deck holds no name, record number or calendar date', async () => {
    const { store, c } = await setup('clinical');
    await store.addItem(c.id, 'drp', { ...CARD });
    const d = buildDeck({ ...opts, cases: [(await deckCase(store, c.id))!] });
    const text = deckText(d);
    for (const secret of ['Synthetic Patient Gamma', 'MRN-4242', '2026-10-10']) expect(text).not.toContain(secret);
  });

  it('records a presentation by its hash alone', async () => {
    const { store } = await setup();
    await store.recordPresentation('rot-1', { cases: 1, cards: 1, slides: 7, hash: 'b'.repeat(64), as: 'pdf' });
    const a = (await store.listAudit()).filter((e) => e.entity === 'presentation');
    expect(a).toHaveLength(1);
    expect(a[0]!.diff).toEqual({ cases: 1, cards: 1, slides: 7, hash: 'b'.repeat(64), as: 'pdf' });
  });
});

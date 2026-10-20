/**
 * The Clinical Problem Card (Section 14) and the M4 acceptance criteria
 * (Section 23): every card carries its thirteen fields filled or explicitly
 * missing; there is no bulk approval; a new creatinine makes the dependent
 * card stale and keeps it out of the form; a rejected recommendation records
 * its reason. Also the ranking (owner decision D5), the stage per problem,
 * the claim checks and the staleness rule (D7, D8).
 */
import { describe, expect, it } from 'vitest';
import { makeCalculator } from '../../src/calc/engine';
import { CALCULATOR_DEFS } from '../../src/calc/registry';
import type { Calculator, CalculatorId } from '../../src/calc/types';
import { claimsValue, type CardClaim } from '../../src/domain/card-data';
import { deriveForm, type FormContext } from '../../src/domain/form/derive';
import {
  buildCard,
  cardFields,
  cardStage,
  checkClaim,
  compareCards,
  contentHash,
  evidenceStrength,
  kindKey,
  rankCards,
  reviewState,
  type CardContext,
} from '../../src/domain/problem-card';
import type { Case, CardReview, RegisterItem, TimelineEntry } from '../../src/domain/types';
import { ValidationError } from '../../src/domain/validation';
import { IntegrityError, Store } from '../../src/store/store';
import { newCase, newSession } from './helpers';

const ALL_VALID: ReadonlyMap<CalculatorId, Calculator> = new Map(CALCULATOR_DEFS.map((d) => [d.id, makeCalculator(d, { validated: true, passed: 1, at: 'test' })]));

const scr = (value: number, day: number) => ({
  type: 'lab' as const,
  hospitalDay: day,
  payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric' as const, value }, unit: 'mg/dL' },
});
const potassium = (value: number, day: number) => ({
  type: 'lab' as const,
  hospitalDay: day,
  payload: { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric' as const, value }, unit: 'mmol/L' },
});
const weight = (kg: number, day = 0) => ({ type: 'weight' as const, hospitalDay: day, payload: { value: kg, unit: 'kg' as const, method: 'measured' as const } });

/** A card as the trainee writes it: only what is required. */
const MINIMAL = { problem: 'Enoxaparin dose not adjusted for kidney function', evidence: 'SCr 2.4 mg/dL on Day 2', pcneProblem: 'P2.1', pcneType: 'potential', pcneCauses: 'C3.2', priority: 'critical' };

async function setup() {
  const ctx = await newSession({ calculators: ALL_VALID });
  const c = await newCase(ctx.store, { ageYears: 60, sex: 'M', heightCm: 175 });
  return { ...ctx, c };
}

const claims = (...cs: CardClaim[]) => claimsValue(cs);

// ---------------------------------------------------------------- criterion 1: thirteen fields, filled or explicitly missing

describe('every Problem Card carries all thirteen fields, filled or explicitly marked missing', () => {
  const empty: CardContext = { entries: [], calcResults: [], calcOutOfDate: new Set(), reviews: [] };
  const card = (fields: Record<string, string>, over: Partial<RegisterItem> = {}): RegisterItem => ({
    id: 'card-1',
    caseId: 'CASE-1',
    register: 'drp',
    fields,
    status: 'active',
    createdAt: '2026-10-20T08:00:00Z',
    version: 1,
    versionCreatedAt: '2026-10-20T08:00:00Z',
    ...over,
  });

  it('a minimal card: each field is either filled or says what is missing — none is blank', () => {
    const fields = cardFields(card(MINIMAL), empty);
    expect(fields.map((f) => f.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(fields.filter((f) => f.missing).map((f) => f.no)).toEqual([3, 4, 7, 8, 9, 11, 12, 13]);
    for (const f of fields) if (f.missing) expect(f.missing.en.length).toBeGreaterThan(10);
    // Filled, with the gaps named: supporting data in words but not linked, no reason for the priority.
    expect(fields[1]!.notes.map((x) => x.en)).toEqual(['Not linked to the timeline: link each value to its entry.']);
    expect(fields[5]!.notes.map((x) => x.en)).toEqual(['The reason for this priority is not given.']);
    // Field 10 of a card the trainee wrote is "written by you", never missing (owner decision D9).
    expect(fields[9]!.missing).toBeUndefined();
    expect(reviewState(card(MINIMAL), [])).toEqual({ kind: 'written_by_you' });
  });

  it('a complete card has no missing field; "Not measured yet" is a valid outcome', () => {
    const full = {
      ...MINIMAL,
      priorityReason: 'Bleeding risk',
      missing: 'Anti-Xa level',
      assessment: 'Accumulation with reduced clearance; alternative: bleeding from another cause',
      claims: claims({ text: 'Enoxaparin is renally cleared', source: 'none' }),
      recommendation: 'Reduce the dose as the hospital protocol says',
      monitoring: 'Platelets and signs of bleeding daily',
      response: 'not_communicated',
      goalMet: 'not_measured',
      teaching: 'Which of my patient’s drugs are renally cleared?',
    };
    expect(cardFields(card(full), empty).filter((f) => f.missing)).toEqual([]);
  });

  it('a card from the model with no decision says so in field 10; a pre-M4 row says it has no PCNE code', () => {
    const model = card(MINIMAL, { origin: { kind: 'suggestion', analysisId: 'a', suggestionId: 's' } });
    expect(cardFields(model, empty)[9]!.missing?.en).toMatch(/^Not decided/);
    const legacy = card({ problem: 'Old card', evidence: 'x', category: 'dose_high', priority: 'important' });
    expect(cardFields(legacy, empty)[4]!.missing?.en).toMatch(/department’s category only/);
  });
});

// ---------------------------------------------------------------- the PCNE codes and the two mappings on a card

describe('the card’s classification', () => {
  it('derives the form boxes and the Cipolle view from the PCNE codes, and keeps the trainee’s adjustment with its reason', () => {
    const item = { id: 'x', caseId: 'c', register: 'drp' as const, status: 'active' as const, createdAt: '', version: 1, versionCreatedAt: '' };
    const ctx: CardContext = { entries: [], calcResults: [], calcOutOfDate: new Set(), reviews: [] };
    const m = buildCard({ ...item, fields: { ...MINIMAL, pcneCauses: 'C3.2|C8.1' } }, ctx);
    expect(m.boxes).toMatchObject({ boxes: ['dose_high', 'other'], otherText: ['C8.1 Medication reconciliation problem'], source: 'pcne' });
    expect(m.cipolle.category?.label.en).toBe('Dosage too high');
    const adj = buildCard({ ...item, fields: { ...MINIMAL, boxes: 'dose_high|adr', boxesReason: 'Department counts it as an ADR as well' } }, ctx);
    expect(adj.boxes).toMatchObject({ boxes: ['dose_high', 'adr'], source: 'adjusted', derived: ['dose_high'], reason: 'Department counts it as an ADR as well' });
  });
});

// ---------------------------------------------------------------- claims: checked in code before M5

describe('claims', () => {
  const lab: TimelineEntry = { id: 'e1', caseId: 'c', hospitalDay: 3, recordedAt: '2026-10-13T08:00:00Z', author: 'user', provenance: 'user_entered', type: 'lab', payload: scr(2.4, 3).payload };
  const ctx: CardContext = { entries: [lab], calcResults: [], calcOutOfDate: new Set(), reviews: [], alertKeys: new Set(['interaction:k1']) };
  const current = new Set(['e1']);

  it('a number not found in its cited source is named; one found is not', () => {
    expect(checkClaim({ text: 'Creatinine 2.4 mg/dL on Day 3', source: 'entry', ref: 'e1' }, ctx, current)).toEqual({ kind: 'numbers_found' });
    expect(checkClaim({ text: 'Creatinine 2.6 mg/dL, CYP3A4 substrate', source: 'entry', ref: 'e1' }, ctx, current)).toEqual({ kind: 'numbers_not_found', numbers: ['2.6'] });
  });

  it('a corrected source, a missing one, a source the trainee read and no source are said as such', () => {
    expect(checkClaim({ text: 'x', source: 'entry', ref: 'e1' }, ctx, new Set())).toEqual({ kind: 'source_changed' });
    expect(checkClaim({ text: 'x', source: 'entry', ref: 'nope' }, ctx, current)).toEqual({ kind: 'source_missing' });
    expect(checkClaim({ text: 'x', source: 'dataset', ref: 'interaction:k1', title: 'DDInter: major' }, ctx, current)).toEqual({ kind: 'not_checked', why: 'dataset' });
    expect(checkClaim({ text: 'x', source: 'dataset', ref: 'interaction:gone', title: 'DDInter: major' }, ctx, current)).toEqual({ kind: 'source_missing' });
    expect(checkClaim({ text: 'x', source: 'reading', title: 'Hospital protocol' }, ctx, current)).toEqual({ kind: 'not_checked', why: 'reading' });
    expect(checkClaim({ text: 'x', source: 'none' }, ctx, current)).toEqual({ kind: 'not_checked', why: 'none' });
  });
});

// ---------------------------------------------------------------- prioritisation (D5) and stage

describe('prioritisation and stage', () => {
  const at = (n: number, f: Record<string, string>): RegisterItem => ({
    id: `c${n}`,
    caseId: 'c',
    register: 'drp',
    fields: { ...MINIMAL, ...f },
    status: 'active',
    createdAt: `2026-10-20T08:00:0${n}Z`,
    version: 1,
    versionCreatedAt: '',
  });

  it('orders by level, then urgency, significance and impact, then the derived strength of evidence', () => {
    const cards = [
      at(1, { priority: 'informational', urgency: 'high' }),
      at(2, { priority: 'critical', urgency: 'low' }),
      at(3, { priority: 'critical', urgency: 'high', significance: 'low' }),
      at(4, { priority: 'critical', urgency: 'high', significance: 'high', impact: 'medium' }),
      at(5, { priority: 'critical', urgency: 'high', significance: 'high', impact: 'medium', supporting: 'c:calc-1' }),
      at(6, { priority: 'critical' }),
    ];
    expect(rankCards(cards).map((c) => c.id)).toEqual(['c5', 'c4', 'c3', 'c2', 'c6', 'c1']);
    expect(compareCards(cards[0]!, cards[0]!)).toBe(0);
    expect(evidenceStrength({ claims: claims({ text: 'x', source: 'dataset', ref: 'k', title: 't' }) })).toBe('calc_or_dataset');
    expect(evidenceStrength({ supporting: 'e:e1' })).toBe('case_data');
    expect(evidenceStrength({ claims: claims({ text: 'x', source: 'reading', title: 'Protocol' }) })).toBe('no_source');
  });

  it('tracks the stage of each problem; proposed and implemented are different stages', () => {
    const s = (f: Record<string, string>) => {
      const i = at(1, f);
      return cardStage(i, reviewState(i, []));
    };
    expect(s({}).current).toBe('identified');
    expect(s({ recommendation: 'r' }).current).toBe('planned');
    expect(s({ recommendation: 'r', recStatus: 'final' }).current).toBe('reviewed');
    expect(s({ recommendation: 'r', recStatus: 'final', response: 'awaiting' }).current).toBe('communicated');
    expect(s({ recommendation: 'r', response: 'accepted', implemented: 'yes', implementedBy: 'Resident', implementedDay: '3' }).current).toBe('implemented');
    expect(s({ implemented: 'yes', goalMet: 'not_measured' }).current).toBe('implemented');
    expect(s({ implemented: 'yes', goalMet: 'partly' }).current).toBe('followed_up');
    expect(s({ response: 'declined', declineReason: 'Team prefers to wait' }).declined).toBe(true);
  });

  it('the content fingerprint ignores what happened after the decision', () => {
    expect(contentHash({ ...MINIMAL, implemented: 'yes', response: 'accepted' })).toBe(contentHash(MINIMAL));
    expect(contentHash({ ...MINIMAL, recommendation: 'x' })).not.toBe(contentHash(MINIMAL));
  });
});

// ---------------------------------------------------------------- criterion 3: staleness (D7, D8), through the store

describe('staleness: a new creatinine makes the card that cites a creatinine stale; an unrelated entry does not', () => {
  it('cited entry: a potassium leaves it current, a new creatinine makes it stale with "Day N", a re-review makes version n+1', async () => {
    const { store, c } = await setup();
    const s1 = await store.addEntry(c.id, scr(2.4, 2));
    const card = await store.addItem(c.id, 'drp', { ...MINIMAL, supporting: `e:${s1.id}` });
    const stale = async () => (await import('../../src/domain/problem-card')).cardStaleness((await store.listItems(c.id)).find((i) => i.id === card.id)!, await store.cardContext(c.id));
    expect((await stale()).stale).toBe(false);

    await store.addEntry(c.id, potassium(5.1, 3));
    expect((await stale()).stale).toBe(false);
    expect(kindKey({ ...s1 } as TimelineEntry)).toBe('lab:scr');

    await store.addEntry(c.id, scr(2.9, 4));
    const st = await stale();
    expect(st).toMatchObject({ stale: true, day: 4 });
    expect(st.reasons.map((r) => r.en)).toEqual(['A new Serum creatinine was recorded after this card (Day 4).']);

    // A stale card cannot be accepted; a reason is required to review it again; then it is version 2, current.
    await expect(store.reconfirmCard(c.id, card.id, '')).rejects.toBeInstanceOf(ValidationError);
    const v2 = await store.reconfirmCard(c.id, card.id, 'Still valid with the creatinine of Day 4');
    expect(v2).toMatchObject({ version: 2, changeReason: 'Still valid with the creatinine of Day 4', fields: card.fields });
    expect((await stale()).stale).toBe(false);
    await expect(store.reconfirmCard(c.id, card.id, 'again')).rejects.toThrow(/current/);
    expect((await store.itemHistory(card.id)).map((v) => v.version)).toEqual([1, 2]);
    const audit = (await store.listAudit(c.id)).find((e) => e.action === 'reconfirm');
    expect(audit).toMatchObject({ entity: 'item', entityId: card.id, diff: { reason: 'Still valid with the creatinine of Day 4' } });
  });

  it('a corrected value: stale until the card links the corrected one (re-review alone is refused)', async () => {
    const { store, c } = await setup();
    const s1 = await store.addEntry(c.id, scr(2.4, 2));
    const card = await store.addItem(c.id, 'drp', { ...MINIMAL, supporting: `e:${s1.id}` });
    const fixed = await store.correctEntry(c.id, s1.id, { kind: 'amend', reason: 'Typing error', hospitalDay: 2, payload: scr(1.4, 2).payload });
    const ctx = await store.cardContext(c.id);
    const { cardStaleness } = await import('../../src/domain/problem-card');
    const latest = async () => (await store.listItems(c.id)).find((i) => i.id === card.id)!;
    expect(cardStaleness(await latest(), ctx).reasons.map((r) => r.en)).toEqual(['The Serum creatinine of Day 2 was corrected.']);
    await expect(store.reconfirmCard(c.id, card.id, 'Still valid')).rejects.toThrow(/link the current values/);
    // The trainee edits the card: the kept link to the corrected value is allowed (it is not new); the new link is checked.
    await expect(store.updateItem(c.id, card.id, { ...MINIMAL, supporting: `e:${s1.id}|e:no-such-entry` })).rejects.toMatchObject({ errors: { supporting: 'invalidChoice' } });
    await store.updateItem(c.id, card.id, { ...MINIMAL, supporting: `e:${fixed.id}` }, 'Linked the corrected creatinine');
    expect(cardStaleness(await latest(), await store.cardContext(c.id)).stale).toBe(false);
  });

  it('a cited calculation result: a new creatinine puts the CrCl out of date, and the card with it', async () => {
    const { store, c } = await setup();
    await store.addEntry(c.id, weight(70));
    await store.addEntry(c.id, scr(1.2, 2));
    const out = await store.calculate(c.id, 'crcl_cg', { answers: { weightBasis: { kind: 'choice', value: 'tbw' } } });
    if (!out.ok) throw new Error('calculation refused');
    const crcl = out.results[0]!;
    const card = await store.addItem(c.id, 'drp', { ...MINIMAL, supporting: `c:${crcl.id}` });
    const { cardStaleness } = await import('../../src/domain/problem-card');
    const latest = async () => (await store.listItems(c.id)).find((i) => i.id === card.id)!;
    expect(cardStaleness(await latest(), await store.cardContext(c.id)).stale).toBe(false);
    await store.addEntry(c.id, potassium(4.0, 3));
    expect(cardStaleness(await latest(), await store.cardContext(c.id)).stale).toBe(false);
    await store.addEntry(c.id, scr(2.0, 3));
    const st = cardStaleness(await latest(), await store.cardContext(c.id));
    expect(st.stale).toBe(true);
    expect(st.day).toBe(3);
    expect(st.reasons.map((r) => r.en)).toEqual([
      'A new Serum creatinine was recorded after this card (Day 3) (used by Creatinine clearance (Cockcroft–Gault)).',
      'The Creatinine clearance (Cockcroft–Gault) it cites is out of date: its inputs changed.',
    ]);
    // An out-of-date result cannot be newly cited.
    await expect(store.addItem(c.id, 'drp', { ...MINIMAL, supporting: `c:${crcl.id}` })).rejects.toMatchObject({ errors: { supporting: 'invalidChoice' } });
  });
});

// ---------------------------------------------------------------- criteria 2 and 4: the review — one card at a time, reasons required

describe('the review of a Problem Card: per card, never in bulk, a reason for every refusal', () => {
  it('has no operation that decides several cards at once', () => {
    const methods = Object.getOwnPropertyNames(Store.prototype).filter((m) => !/^(raw|decode|list)/.test(m));
    // Each writes one decision on one record, named by its id.
    expect(methods.filter((m) => /review|decide|accept|approve|reconfirm/i.test(m)).sort()).toEqual([
      'decideExtractedField',
      'decideSuggestion',
      'newReview',
      'reconfirmCard',
      'reviewAudit',
      'reviewCard',
    ]);
    expect(methods.filter((m) => /bulk|all|many|batch/i.test(m) && /review|decide|accept|approve/i.test(m))).toEqual([]);
  });

  it('a card the trainee wrote: referred for senior review with a reason, then decided with the preceptor; reject needs its reason', async () => {
    const { store, c } = await setup();
    const card = await store.addItem(c.id, 'drp', { ...MINIMAL, recommendation: 'Discuss renal dosing', recStatus: 'final' });
    // Accepting one's own card alone is not a review (owner decision D9).
    await expect(store.reviewCard(c.id, card.id, { decision: 'accepted' })).rejects.toBeInstanceOf(IntegrityError);
    await expect(store.reviewCard(c.id, card.id, { decision: 'needs_senior_review' })).rejects.toMatchObject({ errors: { reason: 'required' } });
    const r1 = await store.reviewCard(c.id, card.id, { decision: 'needs_senior_review', reason: 'Unsure about the bleeding risk' });
    expect(r1).toMatchObject({ itemId: card.id, itemVersion: 1, decision: 'needs_senior_review', reason: 'Unsure about the bleeding risk' });
    await expect(store.reviewCard(c.id, card.id, { decision: 'rejected', withPreceptor: true })).rejects.toMatchObject({ errors: { reason: 'required' } });
    await expect(store.reviewCard(c.id, card.id, { decision: 'rejected', reason: '  ', withPreceptor: true })).rejects.toBeInstanceOf(ValidationError);
    const r2 = await store.reviewCard(c.id, card.id, { decision: 'rejected', reason: 'The dose was already adjusted on Day 2', withPreceptor: true });
    // A change of mind is a new decision; the earlier ones stay.
    const r3 = await store.reviewCard(c.id, card.id, { decision: 'accepted', withPreceptor: true });
    const all = await store.listCardReviews(c.id);
    expect(all.map((r) => r.decision)).toEqual(['needs_senior_review', 'rejected', 'accepted']);
    expect(all.map((r) => r.id)).toEqual([r1.id, r2.id, r3.id]);
    expect(reviewState((await store.listItems(c.id))[0]!, all)).toMatchObject({ kind: 'decided', decision: 'accepted', changedSince: false });
    // Every decision is audited, with its reason.
    const audit = (await store.listAudit(c.id)).filter((e) => e.entity === 'card_review').reverse();
    expect(audit.map((e) => e.action)).toEqual(['escalate', 'reject', 'accept']);
    expect(audit[1]!.diff).toMatchObject({ decision: 'rejected', reason: 'The dose was already adjusted on Day 2' });
    // Reviews are stored append-only.
    await expect(store.db.cardReviews.put({ ...(await store.db.cardReviews.get(r2.id))! })).rejects.toThrow(/append-only/);
  });

  it('a stale card cannot be accepted; an edit recorded as the "Edit" decision is one transaction with the new version', async () => {
    const { store, c } = await setup();
    const s1 = await store.addEntry(c.id, scr(2.4, 2));
    const card = await store.addItem(c.id, 'drp', { ...MINIMAL, supporting: `e:${s1.id}` });
    await store.reviewCard(c.id, card.id, { decision: 'needs_senior_review', reason: 'Check with the preceptor' });
    const s2 = await store.addEntry(c.id, scr(2.9, 3));
    await expect(store.reviewCard(c.id, card.id, { decision: 'accepted', withPreceptor: true })).rejects.toThrow(/changed/);
    // Nothing changed: "Edit" is refused (use Accept).
    await expect(store.updateItem(c.id, card.id, { ...card.fields }, undefined, { decision: 'edited', withPreceptor: true })).rejects.toThrow(/Nothing was changed/);
    const v2 = await store.updateItem(c.id, card.id, { ...MINIMAL, supporting: `e:${s1.id}|e:${s2.id}`, recommendation: 'Hold one dose' }, 'Reviewed with Day 3', {
      decision: 'edited',
      withPreceptor: true,
    });
    expect(v2.version).toBe(2);
    const reviews = await store.listCardReviews(c.id);
    expect(reviews.at(-1)).toMatchObject({ decision: 'edited', itemVersion: 2, withPreceptor: true, contentHash: contentHash(v2.fields) });
  });

  it('a card accepted from the model’s draft starts its history with that decision', async () => {
    const { store, c } = await setup();
    const a = await store.addAnalysis(c.id, {
      moduleId: 'plan',
      model: 'm',
      promptVersion: 'p',
      basedOn: { entryIds: [], items: [] },
      retrievedChunkIds: [],
      suggestions: [{ id: 's1', taskId: 't05', kind: 'item', register: 'drp', fields: MINIMAL, reason: '', basis: 'general_knowledge', refs: [], checks: [] }],
      dropped: 0,
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    });
    await store.decideSuggestion(c.id, a.id, 's1', { kind: 'accept' });
    const [item] = await store.listItems(c.id);
    const reviews = await store.listCardReviews(c.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ itemId: item!.id, decision: 'accepted', fromSuggestion: { analysisId: a.id, suggestionId: 's1' } });
    // A model card can be decided by the trainee alone; a later rejection needs its reason.
    await expect(store.reviewCard(c.id, item!.id, { decision: 'rejected' })).rejects.toMatchObject({ errors: { reason: 'required' } });
    await store.reviewCard(c.id, item!.id, { decision: 'needs_evidence', reason: 'Need the anti-Xa level first' });
    expect(reviewState(item!, await store.listCardReviews(c.id))).toMatchObject({ decision: 'needs_evidence' });
  });
});

// ---------------------------------------------------------------- the form: stale, undecided and disputed cards stay out

describe('the department form’s Sections 8 and 9 take only current, undisputed cards', () => {
  const base: Case = {
    id: 'CASE-3001',
    kind: 'clinical',
    rotationId: 'r',
    deidentified: true,
    demographics: { ageYears: 58, sex: 'M' },
    admissionDay0: '2026-10-10',
    status: 'active',
    createdAt: '2026-10-10T08:00:00Z',
    version: 1,
    versionCreatedAt: '2026-10-10T08:00:00Z',
  };
  const e = (id: string, recordedAt: string, value: number, day: number): TimelineEntry => ({ id, caseId: base.id, recordedAt, author: 'user', provenance: 'user_entered', ...scr(value, day) });
  const card = (id: string, fields: Record<string, string>, savedAt = '2026-10-12T09:00:00Z'): RegisterItem => ({
    id,
    caseId: base.id,
    register: 'drp',
    fields,
    status: 'active',
    createdAt: savedAt,
    version: 1,
    versionCreatedAt: savedAt,
  });
  const review = (itemId: string, decision: CardReview['decision'], reason?: string, fields: Record<string, string> = {}): CardReview => ({
    id: `r-${itemId}-${decision}`,
    caseId: base.id,
    itemId,
    itemVersion: 1,
    contentHash: contentHash(fields),
    decision,
    ...(reason ? { reason } : {}),
    ...(decision !== 'needs_senior_review' ? { withPreceptor: true as const } : {}),
    at: '2026-10-12T10:00:00Z',
  });
  const ctx = (over: Partial<FormContext>): FormContext => ({ case: base, entries: [], mode: 'teaching', items: [], tasks: [], ...over });
  const s = (v: ReturnType<typeof deriveForm>, n: number) => v.sections.find((x) => x.number === n)!;
  const final = { recommendation: 'Hold enoxaparin and discuss the renal dose', recStatus: 'final' };

  it('a new creatinine leaves the dependent card out of Sections 8 and 9, saying why; an unrelated card stays', () => {
    const day2 = e('scr-2', '2026-10-12T08:00:00Z', 2.4, 2);
    const a = card('A', { ...MINIMAL, ...final, supporting: 'e:scr-2' });
    const b = card('B', { ...MINIMAL, problem: 'No VTE prophylaxis', pcneProblem: 'P1.3', pcneCauses: 'C1.5', ...final });
    const before = deriveForm(ctx({ entries: [day2], items: [a, b] }));
    expect(s(before, 8).excluded).toBeUndefined();
    expect(s(before, 8).checkboxes!.ticked).toEqual([false, true, false, false, true, false, false, false, false, false]);
    expect(s(before, 8).fields[0]!.state).toMatchObject({ notes: ['pcne_map_draft'] });

    const day4 = e('scr-4', '2026-10-14T08:00:00Z', 2.9, 4);
    const after = deriveForm(ctx({ entries: [day2, day4], items: [a, b] }));
    expect(s(after, 8).excluded).toEqual([{ itemId: 'A', problem: MINIMAL.problem, reason: 'stale', day: 4 }]);
    expect(s(after, 9).excluded).toEqual([{ itemId: 'A', problem: MINIMAL.problem, reason: 'stale', day: 4 }]);
    // Only B's box remains ticked; only B's recommendation is in Section 9.
    expect(s(after, 8).checkboxes!.ticked).toEqual([false, true, false, false, false, false, false, false, false, false]);
    expect(s(after, 9).fields[0]!.state).toMatchObject({ kind: 'value', items: [{ text: final.recommendation }] });

    // Everything left out: Section 8 is missing, not "no problems".
    const onlyStale = deriveForm(ctx({ entries: [day2, day4], items: [a] }));
    expect(s(onlyStale, 8).checkboxes!.state).toEqual({ kind: 'missing', hint: 'drp_excluded' });
  });

  it('rejected, awaiting evidence or senior review, draft and untraced doses are left out with their reason', () => {
    const rej = card('R', { ...MINIMAL, ...final });
    const evid = card('E', { ...MINIMAL, ...final });
    const sen = card('S', { ...MINIMAL, ...final });
    const draft = card('D', { ...MINIMAL, recommendation: 'Draft idea', recStatus: 'draft' });
    const dose = card('X', { ...MINIMAL, recommendation: 'Give 40 mg once daily', recStatus: 'final' });
    const reading = card('Y', { ...MINIMAL, recommendation: 'Give 40 mg once daily', recStatus: 'final', claims: claims({ text: 'Protocol: 40 mg once daily when CrCl is low', source: 'reading', title: 'Hospital protocol' }) });
    const reviews = [review('R', 'rejected', 'Wrong patient weight used'), review('E', 'needs_evidence', 'Need the anti-Xa level'), review('S', 'needs_senior_review', 'Unsure')];
    const v = deriveForm(ctx({ items: [rej, evid, sen, draft, dose, reading], reviews }));
    expect(s(v, 8).excluded!.map((x) => [x.itemId, x.reason])).toEqual([
      ['R', 'rejected'],
      ['E', 'needs_evidence'],
      ['S', 'needs_senior_review'],
    ]);
    expect(s(v, 9).excluded!.map((x) => [x.itemId, x.reason])).toEqual([
      ['R', 'rejected'],
      ['E', 'needs_evidence'],
      ['S', 'needs_senior_review'],
      ['D', 'not_final'],
      ['X', 'untraced_dose'],
    ]);
    expect(s(v, 9).fields[0]!.state).toMatchObject({ kind: 'value', items: [{ text: 'Give 40 mg once daily' }] });
  });
});

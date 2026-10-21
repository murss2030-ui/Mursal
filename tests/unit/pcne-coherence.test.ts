/**
 * The coherence check of a Problem Card's PCNE classification (owner decision
 * of 21 October 2026): the three self-contradicting cards of the live probe
 * are questioned, the five coherent ones are not; legitimate classifications
 * pass; each rule fires on the pairing it names; the trainee's reason (never
 * the model's) answers a question, and without it the card is not saved,
 * accepted, drafted as acceptable or entered in the department form.
 */
import { describe, expect, it } from 'vitest';
import { analysisSchema } from '../../src/ai/analysis/contract';
import { draftableRegisters } from '../../src/ai/analysis/payload';
import { verifyAnalysis } from '../../src/ai/analysis/verify';
import type { CasePayload } from '../../src/ai/analysis/payload';
import { classificationUnanswered, namedDrugs, pcneCoherence, type CoherenceRule } from '../../src/domain/pcne-coherence';
import { buildCard, cardFormStatus, type CardContext } from '../../src/domain/problem-card';
import type { RegisterItem } from '../../src/domain/types';
import { ValidationError } from '../../src/domain/validation';
import { TASKS } from '../../src/domain/workflow/catalogue';
import { normalizeItemFields } from '../../src/domain/workflow/registers';
import { IntegrityError } from '../../src/store/store';
import { newCase, newSession } from './helpers';

const card = (problem: string, pcneProblem: string, pcneType: string, pcneCauses: string, drugs?: string) => ({ problem, pcneProblem, pcneType, pcneCauses, ...(drugs ? { drugs } : {}) });
const rules = (f: Record<string, string>): CoherenceRule[] => pcneCoherence(f).map((x) => x.rule);

/** The eight cards drafted by the real model in the live probe of 20 October 2026 (docs/m5/live/probe-run3.json), as drafted. */
const PROBE = [
  { f: card('Risk of metformin-associated lactic acidosis due to acute kidney injury.', 'P2.1', 'potential', 'C1.1|C3.1', 'metformin'), expect: ['low_cause_for_harm'] },
  { f: card('Potential nephrotoxicity from NSAID use in the setting of acute kidney injury.', 'P2.1', 'manifest', 'C1.1', 'ibuprofen'), expect: ['manifest_but_risk'] },
  { f: card('Metformin use in acute kidney injury with creatinine clearance of 30 mL/min.', 'P2.1', 'manifest', 'C1.1', 'metformin'), expect: [] },
  { f: card('Ibuprofen use in acute kidney injury.', 'P2.1', 'manifest', 'C1.1', 'ibuprofen'), expect: [] },
  { f: card('Supratherapeutic digoxin level with risk of toxicity.', 'P2.1', 'manifest', 'C1.3|C3.2', 'digoxin, amiodarone'), expect: [] },
  { f: card('Elevated INR due to drug interaction between warfarin and amiodarone.', 'P2.1', 'manifest', 'C1.3', 'warfarin, amiodarone'), expect: [] },
  { f: card('Supratherapeutic INR due to drug interaction between warfarin and amiodarone.', 'P2.1', 'manifest', 'C1.3', 'warfarin, amiodarone'), expect: [] },
  {
    f: card('High risk of digoxin toxicity due to elevated levels, declining renal function, and amiodarone interaction.', 'P2.1', 'potential', 'C1.3|C3.1', 'digoxin, amiodarone'),
    expect: ['low_cause_for_harm'],
  },
];

describe('the cards of the live probe', () => {
  it('questions the three that contradict their own text, and none of the five coherent ones', () => {
    for (const p of PROBE) expect(rules(p.f), p.f.problem).toEqual(p.expect);
  });

  it('names the codes and the words that disagree, in English and in Arabic', () => {
    const [metformin] = pcneCoherence(PROBE[0]!.f);
    expect(metformin).toMatchObject({ rule: 'low_cause_for_harm', codes: ['C3.1'], words: ['lactic acidosis'] });
    expect(metformin!.message.en).toContain('C3.1 Drug dose too low');
    expect(metformin!.message.en).toContain('"lactic acidosis"');
    expect(metformin!.message.ar).toContain('C3.1 Drug dose too low');
    const [nsaid] = pcneCoherence(PROBE[1]!.f);
    expect(nsaid).toMatchObject({ rule: 'manifest_but_risk', words: ['Potential'] });
    const [digoxin] = pcneCoherence(PROBE[7]!.f);
    expect(digoxin!.words).toEqual(['toxicity', 'elevated levels']);
  });
});

describe('legitimate classifications are not questioned', () => {
  const OK: [string, Record<string, string>][] = [
    ['a subtherapeutic level, dose too low', card('Subtherapeutic vancomycin trough (8 mg/L) on 1 g every 12 hours', 'P1.2', 'manifest', 'C3.1', 'vancomycin')],
    ['a dose too high, risk of bleeding', card('Enoxaparin dose not adjusted for CrCl 25 mL/min: risk of bleeding', 'P2.1', 'potential', 'C3.2', 'enoxaparin')],
    ['uncontrolled on a dose too low', card('Uncontrolled hypertension on amlodipine 5 mg daily', 'P1.2', 'manifest', 'C3.1', 'amlodipine')],
    ['a withdrawal effect after missed doses', card('Rebound hypertension after missed clonidine doses', 'P2.1', 'manifest', 'C7.1', 'clonidine')],
    ['hypoglycaemia on a dose too high', card('Hypoglycaemia on glipizide 10 mg twice daily with eGFR 25', 'P2.1', 'manifest', 'C3.2', 'glipizide')],
    ['an adverse reaction of uncertain cause, manifest', card('Possible vancomycin-induced acute kidney injury', 'P2.1', 'manifest', 'C9.1', 'vancomycin')],
    ['an untreated indication', card('No VTE prophylaxis in an immobile patient', 'P1.3', 'potential', 'C1.5')],
    ['a haemostatic that did not work', card('Bleeding despite tranexamic acid', 'P1.2', 'manifest', 'C9.2', 'tranexamic acid')],
    ['an interaction named in words', card('Warfarin and ciprofloxacin interaction', 'P2.1', 'potential', 'C1.3', 'warfarin')],
    ['a negated harm', card('No bleeding, but INR 1.4 on warfarin 2 mg: below the target range', 'P1.2', 'manifest', 'C3.1', 'warfarin')],
    ['a loading and maintenance dose of two drugs', card('Vancomycin dose too low and gentamicin dose too high', 'P1.2', 'manifest', 'C3.1|C3.2', 'vancomycin, gentamicin')],
    ['a potential risk with something that already happened', card('Risk of recurrent bleeding: the patient developed a GI bleed on Day 2', 'P2.1', 'potential', 'C1.3', 'aspirin, clopidogrel')],
  ];
  for (const [name, f] of OK) it(name, () => expect(pcneCoherence(f)).toEqual([]));

  it('says nothing without a PCNE problem code (a card recorded before M4)', () => {
    expect(pcneCoherence({ problem: 'Risk of toxicity', category: 'dose_high' })).toEqual([]);
  });
});

describe('each rule fires on the pairing it names', () => {
  it('a cause of too little drug for harm from the drug', () => {
    expect(rules(card('Digoxin toxicity with a level of 3.1', 'P2.1', 'manifest', 'C3.3', 'digoxin'))).toEqual(['low_cause_for_harm']);
    expect(rules(card('Opioid-induced respiratory depression', 'P2.1', 'manifest', 'C6.2', 'morphine'))).toEqual(['low_cause_for_harm']);
  });

  it('a cause of too much drug for a lack of effect', () => {
    expect(rules(card('Uncontrolled hypertension on amlodipine', 'P1.2', 'manifest', 'C3.2', 'amlodipine'))).toEqual(['high_cause_for_no_effect']);
    // P1.1 is "no effect" by its own wording.
    const p11 = pcneCoherence(card('Fever on day 4 of ceftriaxone', 'P1.1', 'manifest', 'C3.4', 'ceftriaxone'));
    expect(p11.map((x) => x.rule)).toEqual(['high_cause_for_no_effect']);
    expect(p11[0]!.codes).toEqual(['C3.4', 'P1.1']);
  });

  it('an effect problem for harm from the drug', () => {
    expect(rules(card('Supratherapeutic INR 4.8 on warfarin', 'P1.2', 'manifest', 'C3.2', 'warfarin'))).toEqual(['effect_problem_for_harm']);
  });

  it('an adverse drug event for a lack of effect', () => {
    expect(rules(card('Uncontrolled pain on morphine', 'P2.1', 'manifest', 'C3.1', 'morphine'))).toEqual(['safety_problem_for_no_effect']);
  });

  it('potential or manifest against the sentence', () => {
    expect(rules(card('Risk of hyperkalaemia with spironolactone and lisinopril', 'P2.1', 'manifest', 'C1.3', 'spironolactone, lisinopril'))).toEqual(['manifest_but_risk']);
    expect(rules(card('Patient at high risk of falls on zolpidem', 'P2.1', 'manifest', 'C1.1', 'zolpidem'))).toEqual(['manifest_but_risk']);
    expect(rules(card('Patient developed hyperkalaemia (K 6.1) on spironolactone', 'P2.1', 'potential', 'C3.2', 'spironolactone'))).toEqual(['potential_but_occurred']);
    // Both said: a risk that follows an event is not questioned either way.
    expect(rules(card('Risk of further toxicity: the patient experienced nausea', 'P2.1', 'manifest', 'C3.2', 'digoxin'))).toEqual([]);
  });

  it('a combination on a card that names one drug', () => {
    expect(rules(card('Metformin in acute kidney injury', 'P2.1', 'manifest', 'C1.3', 'metformin'))).toEqual(['combination_one_drug']);
    expect(rules(card('Metformin in acute kidney injury', 'P2.1', 'manifest', 'C1.3', 'metformin, contrast'))).toEqual([]);
    // With no drug named, the check cannot count them and stays silent.
    expect(rules(card('Metformin in acute kidney injury', 'P2.1', 'manifest', 'C1.3'))).toEqual([]);
  });

  it('codes that say opposite things', () => {
    expect(rules(card('Pantoprazole continued without an indication', 'P3.1', 'manifest', 'C1.2|C1.5', 'pantoprazole'))).toEqual(['codes_contradict']);
    expect(rules(card('Untreated atrial fibrillation', 'P1.3', 'manifest', 'C1.2'))).toEqual(['codes_contradict']);
    expect(rules(card('Vancomycin dosing', 'P1.2', 'manifest', 'C3.1|C3.2', 'vancomycin'))).toEqual(['codes_contradict']);
    expect(rules(card('Gentamicin dosing interval', 'P1.2', 'manifest', 'C3.3|C3.4', 'gentamicin'))).toEqual(['codes_contradict']);
    expect(rules(card('Antibiotic course length', 'P1.2', 'manifest', 'C4.1|C4.2', 'ceftriaxone'))).toEqual(['codes_contradict']);
  });

  it('counts the drugs a card names', () => {
    expect(namedDrugs('warfarin, amiodarone')).toEqual(['warfarin', 'amiodarone']);
    expect(namedDrugs('Spironolactone + lisinopril')).toHaveLength(2);
    expect(namedDrugs('digoxin and amiodarone')).toHaveLength(2);
    expect(namedDrugs('  ')).toBeUndefined();
  });
});

describe('the reason, and where an unanswered question stops a card', () => {
  const metformin = PROBE[0]!.f;

  it('a reason answers the question; it does not hide it', () => {
    expect(classificationUnanswered(metformin)).toBe(true);
    expect(classificationUnanswered({ ...metformin, classificationReason: 'Accumulation follows the kidney injury; the dose itself was not too low' })).toBe(false);
    expect(pcneCoherence({ ...metformin, classificationReason: 'x' })).toHaveLength(1);
  });

  it('the register asks for the reason only while the classification is questioned, and drops it once the codes are corrected', () => {
    const base = { ...metformin, priority: 'critical', evidence: 'SCr 2.4 mg/dL on Day 2' };
    expect(normalizeItemFields('drp', base)).toEqual({ ok: false, errors: { classificationReason: 'required' } });
    const answered = normalizeItemFields('drp', { ...base, classificationReason: 'The kidney injury, not the dose, is the cause' });
    expect(answered.ok && answered.fields.classificationReason).toBe('The kidney injury, not the dose, is the cause');
    const corrected = normalizeItemFields('drp', { ...base, pcneCauses: 'C1.1', classificationReason: 'left over' });
    expect(corrected.ok && corrected.fields.classificationReason).toBeUndefined();
  });

  it('C9.3 No obvious cause is never chosen with another cause', () => {
    const r = normalizeItemFields('drp', { problem: 'Nausea on metformin', evidence: 'Day 1', pcneProblem: 'P2.1', pcneType: 'manifest', pcneCauses: 'C9.3|C1.1', priority: 'important' });
    expect(r).toEqual({ ok: false, errors: { pcneCauses: 'exclusive' } });
  });

  it('the model never writes the reason, and its draft of a questioned card cannot be accepted as it is', () => {
    const t05 = TASKS.get('t05')!;
    const drp = draftableRegisters(t05).find((r) => r.register === 'drp')!;
    expect(drp.fields.map((f) => f.id)).not.toContain('classificationReason');
    expect(JSON.stringify(analysisSchema([t05]))).not.toContain('classificationReason');

    const payload: CasePayload = { text: '{}', context: '{"age":70}', refs: new Map(), basedOn: { entryIds: [], items: [] }, tasks: [t05] };
    const fields = Object.entries({ ...metformin, priority: 'critical', evidence: 'Creatinine rose', classificationReason: 'the model says so' }).map(([field, value]) => ({ field, value }));
    const { suggestions } = verifyAnalysis(
      { tasks: [{ taskId: 't05', summary: '', checks: [], items: [{ register: 'drp', fields, reason: '', basis: 'general_knowledge', refs: [] }], missingData: [], questions: [] }] },
      payload,
    );
    const [s] = suggestions;
    expect(s!.fields!.classificationReason).toBeUndefined();
    expect(s!.checks).toContain('trainee_only_removed');
    expect(s!.checks).toContain('classification_questioned');
    expect(s!.checks).not.toContain('incomplete');
  });

  it('a drafted "C9.3 with other causes" keeps the named causes', () => {
    const t05 = TASKS.get('t05')!;
    const payload: CasePayload = { text: '{}', context: '{}', refs: new Map(), basedOn: { entryIds: [], items: [] }, tasks: [t05] };
    const fields = Object.entries(card('Nausea on metformin', 'P2.1', 'manifest', 'C9.3|C1.1', 'metformin')).map(([field, value]) => ({ field, value }));
    const { suggestions } = verifyAnalysis({ tasks: [{ taskId: 't05', summary: '', checks: [], items: [{ register: 'drp', fields, reason: '', basis: 'general_knowledge', refs: [] }], missingData: [], questions: [] }] }, payload);
    expect(suggestions[0]!.fields!.pcneCauses).toBe('C1.1');
    expect(suggestions[0]!.checks).toContain('invalid_value_removed');
  });

  it('the store refuses a questioned card without its reason, and keeps one saved before the check out of the form until it is answered', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    const base = { ...metformin, priority: 'critical', evidence: 'SCr 2.4 mg/dL on Day 2', recommendation: 'Hold metformin', recStatus: 'final' };
    const refused = await store.addItem(c.id, 'drp', base).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ValidationError);
    expect((refused as ValidationError).errors).toEqual({ classificationReason: 'required' });

    const saved = await store.addItem(c.id, 'drp', { ...base, classificationReason: 'Accumulation follows the kidney injury' });
    const ctx: CardContext = { entries: [], calcResults: [], calcOutOfDate: new Set(), reviews: [] };
    expect(cardFormStatus(saved, ctx).section8).toBeUndefined();
    expect(buildCard(saved, ctx).coherence).toHaveLength(1);

    // A card written before M5 (no reason) is questioned on the card, kept out of the form and not accepted until edited.
    const before: RegisterItem = { ...saved, fields: { ...base } };
    expect(cardFormStatus(before, ctx).section8).toBe('classification');
    expect(cardFormStatus(before, ctx).section9).toBe('classification');
    expect(buildCard(before, ctx).fields[4]!.notes.map((n) => n.en).join(' ')).toContain('no reason is given');
  });

  it('a card saved with a question is not accepted until the reason is given', async () => {
    const { store, db } = await newSession();
    const c = await newCase(store);
    const base = { ...metformin, priority: 'critical', evidence: 'SCr 2.4 mg/dL on Day 2' };
    const saved = await store.addItem(c.id, 'drp', { ...base, classificationReason: 'Accumulation follows the kidney injury' });
    // As if saved before the check existed: a later version without the reason, written directly.
    await db.items.add(await store.sealRow('items', { id: `${saved.id}@2`, entityId: saved.id, version: 2, caseId: c.id }, { ...saved, version: 2, fields: base }));
    await expect(store.reviewCard(c.id, saved.id, { decision: 'accepted', withPreceptor: true })).rejects.toBeInstanceOf(IntegrityError);
    // Answered, it is accepted.
    await store.updateItem(c.id, saved.id, { ...base, classificationReason: 'Accumulation follows the kidney injury' });
    await expect(store.reviewCard(c.id, saved.id, { decision: 'accepted', withPreceptor: true })).resolves.toMatchObject({ decision: 'accepted' });
  });
});

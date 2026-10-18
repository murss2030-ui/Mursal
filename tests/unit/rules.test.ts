/**
 * The rules engine (Section 10) against a small synthetic vocabulary. The
 * fixture's ingredient ids follow RxNorm, its class ids follow RxClass; it is
 * test data only — the shipped vocabulary is checked in drug-vocabulary.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { CalcResult } from '../../src/calc/types';
import type { AdjustmentRule, FormularyItem, LabThreshold } from '../../src/domain/reference';
import type { RegisterItem, TaskRecord, TimelineEntry } from '../../src/domain/types';
import { buildVocabulary, type RxnormSubset } from '../../src/drugs/vocabulary';
import { evaluateRules, type RulesContext } from '../../src/rules/engine';
import type { InteractionDataset } from '../../src/rules/types';
import { lab } from '../calc/helpers';

const VOCAB = buildVocabulary({
  dataset: 'rxnorm-subset',
  rxnormVersion: 'test',
  retrievedAt: '2026-10-17',
  source: 'synthetic test fixture',
  ingredients: [
    ['723', 'amoxicillin'],
    ['733', 'ampicillin'],
    ['48203', 'clavulanate'],
    ['2193', 'ceftriaxone'],
    ['11124', 'vancomycin'],
    ['5640', 'ibuprofen'],
    ['7646', 'omeprazole'],
    ['40790', 'pantoprazole'],
    ['67108', 'enoxaparin'],
    ['161', 'acetaminophen'],
    ['6809', 'metformin'],
  ],
  precise: [['1297882', 'amoxicillin anhydrous', ['723']]],
  multi: [['1000', 'amoxicillin / clavulanate', ['723', '48203']]],
  brands: [['151392', 'Augmentin', ['723', '48203']]],
  synonyms: [['paracetamol', '161']],
  epc: [
    ['N0000175497', 'Penicillin-class Antibacterial', ['723', '733']],
    ['N0000175488', 'Cephalosporin Antibacterial', ['2193']],
    ['N-PPI', 'Proton Pump Inhibitor', ['7646', '40790']],
    ['N0000175722', 'Nonsteroidal Anti-inflammatory Drug', ['5640']],
  ],
  vaAntimicrobial: [
    ['AM111', 'PENICILLINS,AMINO DERIVATIVES', ['723', '733']],
    ['AM117', 'CEPHALOSPORIN 3RD GENERATION', ['2193']],
  ],
} satisfies RxnormSubset);

let n = 0;
const id = () => `e-${++n}`;
const base = (day: number, extra: Partial<TimelineEntry> = {}) => ({ id: id(), caseId: 'C', hospitalDay: day, recordedAt: `2026-10-17T00:00:${String(n % 60).padStart(2, '0')}Z`, author: 'user' as const, provenance: 'user_entered' as const, ...extra });
const med = (drug: string, day = 0, medId = `m-${drug}-${n}`): TimelineEntry => ({
  ...base(day),
  type: 'med_start',
  payload: { medId, drug, dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'once daily' },
});
const allergy = (substance: string, kind: 'allergy' | 'adr' | 'intolerance' = 'allergy', day = 0): TimelineEntry => ({
  ...base(day),
  type: 'note',
  payload: { category: 'allergy_adr', kind, substance, reaction: 'rash' },
});
const culture = (day: number, status: 'growth' | 'no_growth' | 'pending'): TimelineEntry => ({ ...base(day), type: 'culture', payload: { specimen: 'blood', status, ...(status === 'growth' ? { organism: 'E. coli' } : {}) } });
const row = (register: 'home_med' | 'discharge_med', drug: string): RegisterItem => ({ id: `r-${++n}`, caseId: 'C', register, fields: { drug }, status: 'active', createdAt: '2026-10-17', version: 1, versionCreatedAt: '2026-10-17' });

function ctx(current: TimelineEntry[], over: Partial<RulesContext> = {}): RulesContext {
  return {
    today: 1,
    current,
    items: [],
    tasks: [],
    calcResults: [],
    isCurrent: () => true,
    formulary: [],
    adjustments: [],
    thresholds: [],
    gather: { demographics: { ageYears: 60, sex: 'M' }, current },
    vocab: VOCAB,
    ...over,
  };
}
const alertsOf = (c: RulesContext, ruleId?: string) => evaluateRules(c).alerts.filter((a) => !ruleId || a.ruleId === ruleId);

describe('documented allergy or previous ADR', () => {
  it('penicillin allergy + a new amoxicillin order → critical alert (class named in the record)', () => {
    const a = alertsOf(ctx([allergy('Penicillin'), med('amoxicillin')]), 'allergy');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ level: 'critical', taskId: 't07' });
    expect(a[0]!.detail.en).toContain('belongs to Penicillin-class Antibacterial');
  });

  it('amoxicillin allergy + Augmentin (brand) → critical: shared ingredient', () => {
    const a = alertsOf(ctx([allergy('amoxicillin'), med('Augmentin 1 g tab')]), 'allergy');
    expect(a[0]).toMatchObject({ level: 'critical' });
    expect(a[0]!.detail.en).toContain('contains amoxicillin');
  });

  it('amoxicillin allergy + ampicillin → informational class-level note', () => {
    const a = alertsOf(ctx([allergy('amoxicillin'), med('ampicillin')]), 'allergy');
    expect(a[0]).toMatchObject({ level: 'informational' });
    expect(a[0]!.title.en).toContain('Same class');
  });

  it('a previous ADR is critical; an intolerance is important', () => {
    expect(alertsOf(ctx([allergy('ibuprofen', 'adr'), med('ibuprofen 400 mg')]), 'allergy')[0]?.level).toBe('critical');
    expect(alertsOf(ctx([allergy('ibuprofen', 'intolerance'), med('ibuprofen')]), 'allergy')[0]?.level).toBe('important');
  });

  it('matches home and discharge medications too', () => {
    const a = alertsOf(ctx([allergy('NSAIDs')], { items: [row('home_med', 'ibuprofen'), row('discharge_med', 'Ibuprofen 200 mg')] }), 'allergy');
    expect(a.map((x) => x.level)).toEqual(['critical', 'critical']);
    expect(a.map((x) => x.detail.en).join(' ')).toContain('home medication');
  });

  it('no alert for an unrelated drug, or with NKDA', () => {
    expect(alertsOf(ctx([allergy('penicillin'), med('metformin')]), 'allergy')).toEqual([]);
    const nkda: TimelineEntry = { ...base(0), type: 'note', payload: { category: 'allergy_adr', kind: 'nkda' } };
    expect(alertsOf(ctx([nkda, med('amoxicillin')]), 'allergy')).toEqual([]);
  });

  it('an unrecognised allergen or drug name is reported as not checked, never as safe', () => {
    const out = evaluateRules(ctx([allergy('Zylomex'), med('Fantasimab 10 mg')]));
    expect(out.alerts.filter((a) => a.ruleId === 'allergy')).toEqual([]);
    expect(out.notChecked.map((x) => [x.what, x.subject])).toEqual(expect.arrayContaining([['allergen', 'Zylomex'], ['drug_name', 'Fantasimab 10 mg']]));
  });

  it('a local brand from the formulary is matched through its generic name', () => {
    const item: FormularyItem = {
      id: 'f1', version: 1, versionCreatedAt: 'x', status: 'active', createdAt: 'x', verifiedBy: 'T', verifiedAt: '2026-10-17',
      genericName: 'amoxicillin / clavulanate', ingredients: ['723', '48203'], brandNames: ['Megamox'], strengths: [], dosageForms: [],
      availableInHospital: true, highAlert: false, sourceNote: 'hospital list',
    };
    expect(alertsOf(ctx([allergy('penicillin'), med('Megamox 1 g')], { formulary: [item] }), 'allergy')[0]?.level).toBe('critical');
  });

  it('the alert key is stable for the same cause, and its data hash changes when the allergy is corrected', () => {
    const al = allergy('penicillin');
    const m = med('amoxicillin');
    const first = alertsOf(ctx([al, m]), 'allergy')[0]!;
    const again = alertsOf(ctx([al, m]), 'allergy')[0]!;
    expect(again.key).toBe(first.key);
    expect(again.dataHash).toBe(first.dataHash);
    const corrected = { ...allergy('penicillins'), supersedesEntryId: al.id };
    const after = alertsOf(ctx([corrected, m]), 'allergy')[0]!;
    expect(after.key).not.toBe(first.key);
  });
});

describe('interactions', () => {
  it('without the datasets, interactions are reported as not checked', () => {
    const out = evaluateRules(ctx([med('ibuprofen'), med('enoxaparin')]));
    expect(out.notChecked.map((x) => x.what)).toContain('interactions');
    expect(out.alerts.filter((a) => a.ruleId === 'interaction')).toEqual([]);
  });

  it('with a dataset: ONC pair critical, major important, moderate informational (synthetic pairs)', () => {
    const pairs: Record<string, ReturnType<InteractionDataset['lookup']>> = {
      '5640+67108': [{ severity: 'major', onc: false, mechanism: 'additive bleeding risk', management: 'monitor' }],
      '6809+7646': [{ severity: 'moderate', onc: false }],
      '11124+2193': [{ severity: 'major', onc: true }],
    };
    const interactions: InteractionDataset = { version: 'test', citation: 'synthetic fixture', lookup: (a, b) => pairs[[a, b].sort().join('+')] ?? pairs[[b, a].sort().join('+')] ?? [] };
    const a = alertsOf(ctx([med('ibuprofen'), med('enoxaparin'), med('omeprazole'), med('metformin'), med('vancomycin'), med('ceftriaxone')], { interactions }), 'interaction');
    const level = (x: string) => a.find((y) => y.title.en.includes(x))?.level;
    expect(level('ibuprofen')).toBe('important');
    expect(level('omeprazole')).toBe('informational');
    expect(level('vancomycin')).toBe('critical');
    expect(a.find((y) => y.title.en.includes('ibuprofen'))!.detail.en).toContain('Mechanism: additive bleeding risk');
    // The dataset's own fields travel with the alert, for the automatic rows of form Section 7.
    expect(a.find((y) => y.title.en.includes('ibuprofen'))!.interaction).toEqual({ drugA: 'enoxaparin', drugB: 'ibuprofen', severity: 'major', mechanism: 'additive bleeding risk', management: 'monitor' });
    expect(a.find((y) => y.title.en.includes('vancomycin'))!.interaction).toMatchObject({ severity: 'ONC high-priority' });
  });
});

describe('duplication and high-alert flag', () => {
  it('the same ingredient twice is important; the same class is informational', () => {
    expect(alertsOf(ctx([med('omeprazole'), med('omeprazole 40 mg')]), 'duplication')[0]?.level).toBe('important');
    expect(alertsOf(ctx([med('omeprazole'), med('pantoprazole')]), 'duplication')[0]).toMatchObject({ level: 'informational' });
  });

  it('a medication flagged high-alert in the formulary gets an important badge with its source', () => {
    const item: FormularyItem = {
      id: 'f2', version: 1, versionCreatedAt: 'x', status: 'active', createdAt: 'x', verifiedBy: 'T', verifiedAt: '2026-10-17',
      genericName: 'enoxaparin', ingredients: ['67108'], brandNames: [], strengths: [], dosageForms: [], availableInHospital: true,
      highAlert: true, highAlertSource: 'Hospital high-alert list 2026, p. 2', sourceNote: 'pharmacy',
    };
    const a = alertsOf(ctx([med('enoxaparin')], { formulary: [item] }), 'high_alert');
    expect(a[0]).toMatchObject({ level: 'important', taskId: 't28' });
    expect(a[0]!.source.en).toContain('Hospital high-alert list 2026, p. 2');
  });
});

describe('laboratory rules', () => {
  const thr = (analyte: string, unit: string, low?: number, high?: number): LabThreshold => ({
    id: `t-${analyte}`, version: 1, versionCreatedAt: 'x', status: 'active', createdAt: 'x', verifiedBy: 'T', verifiedAt: '2026-10-17',
    analyte, unit, ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}), source: 'Hospital laboratory critical values list',
  });

  it('a value beyond the hospital threshold is critical; inside it, nothing', () => {
    expect(alertsOf(ctx([lab('k', 6.8, 'mmol/L', { day: 1 })], { thresholds: [thr('k', 'mmol/L', 2.5, 6.0)] }), 'lab_critical')[0]?.level).toBe('critical');
    expect(alertsOf(ctx([lab('k', 5.2, 'mmol/L', { day: 1 })], { thresholds: [thr('k', 'mmol/L', 2.5, 6.0)] }), 'lab_critical')).toEqual([]);
  });

  it('converts units before comparing (creatinine in µmol/L against a mg/dL threshold)', () => {
    // 600 µmol/L = 6.79 mg/dL > 6.0
    expect(alertsOf(ctx([lab('scr', 600, 'µmol/L', { day: 1 })], { thresholds: [thr('scr', 'mg/dL', undefined, 6.0)] }), 'lab_critical')).toHaveLength(1);
  });

  it('uses only the latest value, and never an unverified one', () => {
    const c = ctx([lab('k', 6.8, 'mmol/L', { day: 1 }), lab('k', 4.5, 'mmol/L', { day: 2 }), lab('k', 7.5, 'mmol/L', { day: 3, provenance: 'extracted_unverified' })], { thresholds: [thr('k', 'mmol/L', 2.5, 6.0)] });
    expect(alertsOf(c, 'lab_critical')).toEqual([]);
  });

  it('a creatinine rise meeting a KDIGO criterion is important, with the citation', () => {
    const a = alertsOf(ctx([lab('scr', 1.0, 'mg/dL', { day: 1, time: '06:00' }), lab('scr', 1.5, 'mg/dL', { day: 2, time: '06:00' })]), 'creatinine_rise');
    expect(a[0]).toMatchObject({ level: 'important' });
    expect(a[0]!.source.en).toContain('KDIGO');
  });
});

describe('renal adjustment from the trainee-sourced table', () => {
  const rule: AdjustmentRule = {
    id: 'adj1', version: 1, versionCreatedAt: 'x', status: 'active', createdAt: 'x', verifiedBy: 'T', verifiedAt: '2026-10-17',
    drugName: 'enoxaparin', ingredients: ['67108'], organ: 'renal', measure: 'crcl_cg', below: 30,
    sourceText: 'Reduce the dose when CrCl is below 30 mL/min', source: 'Hospital renal dosing guide, p. 14',
  };
  const crcl = (value: number): CalcResult => ({
    id: `calc-${value}`, caseId: 'C', calc: 'crcl_cg', formulaVersion: '1', inputs: { entryIds: [], values: {}, units: {}, detail: {} },
    value, unit: 'mL/min', decimals: 0, assumptions: [], warnings: [], steps: [], computedAt: '2026-10-17T10:00:00Z',
  });
  const complete = (current: TimelineEntry[]) => [
    ...current,
    { ...base(0), type: 'weight' as const, payload: { value: 70, unit: 'kg' as const, method: 'measured' as const } },
    lab('scr', 2.5, 'mg/dL', { day: 1 }),
    { ...base(0), type: 'note' as const, payload: { category: 'renal_replacement' as const, status: 'none' as const } },
  ];
  const enox = (): TimelineEntry => ({ ...base(0), type: 'med_start', payload: { medId: 'm-enox', drug: 'enoxaparin', dose: { kind: 'structured', value: 40, unit: 'mg' }, route: 'subcut', frequency: 'once daily', indication: 'VTE prophylaxis' } });

  it('CrCl below the table’s threshold → important, quoting the source; never a dose', () => {
    const current = complete([enox()]);
    const a = alertsOf(ctx(current, { adjustments: [rule], calcResults: [crcl(25)], gather: { demographics: { ageYears: 60, sex: 'M' }, current } }), 'renal_adjustment');
    expect(a[0]).toMatchObject({ level: 'important', medIds: ['m-enox'] });
    expect(a[0]!.detail.en).toContain('Reduce the dose when CrCl is below 30 mL/min');
    expect(a[0]!.detail.en).toContain('PRECEPTOR does not calculate the adjusted dose');
    expect(a[0]!.source.en).toContain('Hospital renal dosing guide, p. 14');
  });

  it('above the threshold, nothing', () => {
    const current = complete([enox()]);
    expect(alertsOf(ctx(current, { adjustments: [rule], calcResults: [crcl(45)], gather: { demographics: { ageYears: 60, sex: 'M' }, current } }), 'renal_adjustment')).toEqual([]);
  });

  it('no CrCl, an out-of-date CrCl, or missing gate data blocks the assessment — named', () => {
    const current = complete([enox()]);
    const none = alertsOf(ctx(current, { adjustments: [rule], gather: { demographics: { ageYears: 60, sex: 'M' }, current } }), 'dose_blocked');
    expect(none[0]!.detail.en).toContain('no CrCl (Cockcroft–Gault) calculated');
    const stale = alertsOf(ctx(current, { adjustments: [rule], calcResults: [crcl(25)], isCurrent: () => false, gather: { demographics: { ageYears: 60, sex: 'M' }, current } }), 'dose_blocked');
    expect(stale[0]!.detail.en).toContain('out of date');
    const bare = [enox()];
    const gate = alertsOf(ctx(bare, { adjustments: [rule], calcResults: [crcl(25)], gather: { demographics: { ageYears: 60, sex: 'M' }, current: bare } }), 'dose_blocked');
    expect(gate[0]!.detail.en).toContain('Weight');
    expect(gate[0]!.detail.en).toContain('Dialysis status');
  });
});

describe('antimicrobial stewardship prompts', () => {
  const task14 = (checks: Record<string, 'ok' | 'issue' | 'na'>, fields: Record<string, string> = {}): TaskRecord => ({
    caseId: 'C', taskId: 't14', status: 'in_progress', checks, fields, version: 1, versionCreatedAt: 'x',
  });

  it('identifies antimicrobials from the VA classes; AWaRe is reported as not checked without its dataset', () => {
    const out = evaluateRules(ctx([med('ceftriaxone', 0)], { today: 0 }));
    expect(out.notChecked.map((x) => x.what)).toContain('aware');
  });

  it('time-out prompt from 48 hours, gone once the review is documented', () => {
    const m = med('ceftriaxone', 0, 'm-cef');
    expect(alertsOf(ctx([m], { today: 1 }), 'antibiotic_timeout')).toEqual([]);
    expect(alertsOf(ctx([m], { today: 2 }), 'antibiotic_timeout')[0]).toMatchObject({ level: 'important', medIds: ['m-cef'] });
    expect(alertsOf(ctx([m], { today: 5 }), 'antibiotic_timeout')[0]!.title.en).toContain('overdue');
    expect(alertsOf(ctx([m], { today: 3, tasks: [task14({ 'timeout@m-cef': 'ok' })] }), 'antibiotic_timeout')).toEqual([]);
  });

  it('the trainee’s "not an antimicrobial" answer is respected; "yes" adds a drug the classes miss', () => {
    const m = med('ceftriaxone', 0, 'm-cef');
    expect(alertsOf(ctx([m], { today: 3, tasks: [task14({}, { 'applies@m-cef': 'no' })] }), 'antibiotic_timeout')).toEqual([]);
    const v = med('vancomycin', 0, 'm-van');
    expect(alertsOf(ctx([v], { today: 3 }), 'antibiotic_timeout')).toEqual([]);
    expect(alertsOf(ctx([v], { today: 3, tasks: [task14({}, { 'applies@m-van': 'yes' })] }), 'antibiotic_timeout')).toHaveLength(1);
  });

  it('a culture result entered after the start prompts de-escalation; a pending culture does not', () => {
    const m = med('ceftriaxone', 0, 'm-cef');
    expect(alertsOf(ctx([m, culture(2, 'pending')], { today: 2 }), 'deescalation')).toEqual([]);
    const a = alertsOf(ctx([m, culture(2, 'growth')], { today: 2 }), 'deescalation');
    expect(a[0]!.detail.en).toContain('growth of E. coli');
    expect(alertsOf(ctx([m, culture(2, 'growth')], { today: 2, tasks: [task14({ 'deescalation@m-cef': 'ok' })] }), 'deescalation')).toEqual([]);
  });

  it('no time-based prompt when the case is not active', () => {
    expect(alertsOf(ctx([med('ceftriaxone', 0)], { today: null }), 'antibiotic_timeout')).toEqual([]);
  });
});

describe('levels and de-duplication', () => {
  it('critical alerts come first, and one cause produces one alert', () => {
    const out = evaluateRules(ctx([allergy('penicillin'), allergy('Penicillins'), med('amoxicillin'), med('omeprazole'), med('pantoprazole')]));
    expect(out.alerts[0]!.level).toBe('critical');
    const keys = out.alerts.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('without the vocabulary, every drug is reported as not checked', () => {
    const out = evaluateRules(ctx([allergy('penicillin'), med('amoxicillin')], { vocab: undefined }));
    expect(out.alerts.filter((a) => a.ruleId === 'allergy')).toEqual([]);
    expect(out.notChecked.map((x) => x.what)).toEqual(expect.arrayContaining(['drug_name', 'allergen']));
  });
});

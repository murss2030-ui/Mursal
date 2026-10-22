/**
 * The clinical fixture library (plan M9; release gate: "clinical fixture library
 * run with no missed critical problem"). Each fixture is a small synthetic case
 * whose critical problems are known in advance; the runner passes it through the
 * deterministic rules engine and reports any expected problem the engine did not
 * raise (a *miss*), any alert that must not appear (a *false alarm*), and any
 * input the engine says it could not check.
 *
 * Everything here is synthetic. The fixtures were written by the developer, not by
 * a clinical expert: every fixture starts as `awaiting_review`, and the expert
 * review (docs/m9/CLINICAL-FIXTURES.md) is a separate human step. Passing this
 * library does not meet the release gate on its own.
 */
import type { RegisterItem, TimelineEntry } from '../domain/types';
import type { LabThreshold } from '../domain/reference';
import { buildInteractions, packPairs } from '../drugs/datasets';
import { buildVocabulary, type RxnormSubset } from '../drugs/vocabulary';
import { evaluateRules, type RulesContext } from '../rules/engine';
import type { AlertLevel, RuleId } from '../rules/types';

export interface Expected {
  ruleId: RuleId;
  level: AlertLevel;
  /** A word the alert's title or detail must contain, when the cause matters. */
  mentions?: string;
}

export interface ClinicalFixture {
  id: string;
  title: string;
  /** What a clinical pharmacist would see in this case. */
  scenario: string;
  today: number | null;
  entries: TimelineEntry[];
  items?: RegisterItem[];
  thresholds?: LabThreshold[];
  /** Critical problems the engine must raise (a miss is a failure). */
  expectCritical: Expected[];
  /** Other alerts that must appear (important / informational). */
  expectOther?: Expected[];
  /** Rules that must raise nothing here (a false alarm is a failure). */
  mustNotFire?: RuleId[];
  /** Names the engine must report as not checked, never as safe. */
  expectNotChecked?: string[];
  review: { status: 'awaiting_review' | 'reviewed'; reviewer?: string; date?: string };
}

// ------------------------------------------------------------ the synthetic environment

const ING = ['161', '2193', '5640', '6809', '7646', '11124', '67108', '723'];

export const FIXTURE_VOCAB = buildVocabulary({
  dataset: 'rxnorm-subset',
  rxnormVersion: 'fixture',
  retrievedAt: '2026-10-17',
  source: 'synthetic clinical fixture',
  ingredients: [
    ['723', 'amoxicillin'],
    ['733', 'ampicillin'],
    ['48203', 'clavulanate'],
    ['2193', 'ceftriaxone'],
    ['11124', 'vancomycin'],
    ['5640', 'ibuprofen'],
    ['7646', 'omeprazole'],
    ['67108', 'enoxaparin'],
    ['161', 'acetaminophen'],
    ['6809', 'metformin'],
  ],
  precise: [],
  multi: [['1000', 'amoxicillin / clavulanate', ['723', '48203']]],
  brands: [['151392', 'Augmentin', ['723', '48203']]],
  synonyms: [['paracetamol', '161']],
  epc: [
    ['N0000175497', 'Penicillin-class Antibacterial', ['723', '733']],
    ['N0000175488', 'Cephalosporin Antibacterial', ['2193']],
    ['N0000175722', 'Nonsteroidal Anti-inflammatory Drug', ['5640']],
  ],
  vaAntimicrobial: [
    ['AM111', 'PENICILLINS,AMINO DERIVATIVES', ['723', '733']],
    ['AM117', 'CEPHALOSPORIN 3RD GENERATION', ['2193']],
  ],
} satisfies RxnormSubset);

const interactions = buildInteractions(
  {
    dataset: 'interactions' as const,
    format: 2 as const,
    version: 'fixture',
    citation: 'synthetic fixture',
    ingredients: ING,
    anchored: ['5640', '7646', '2193'].map((r) => ING.indexOf(r).toString(36).padStart(3, '0')).join(''),
    packed: packPairs(ING, [
      ['5640', '67108', 'major'],
      ['6809', '7646', 'moderate'],
      ['11124', '2193', 'major'],
    ]),
  },
  { dataset: 'onc' as const, version: 'onc fixture', citation: 'synthetic ONC', pairs: [[['11124'], ['2193'], 'synthetic pair']] as [string[], string[], string][] },
);

// ------------------------------------------------------------ builders

let seq = 0;
const entry = (day: number, rest: Omit<TimelineEntry, 'id' | 'caseId' | 'hospitalDay' | 'recordedAt' | 'author' | 'provenance'> & Partial<TimelineEntry>): TimelineEntry =>
  ({ id: `fx-${++seq}`, caseId: 'FIXTURE', hospitalDay: day, recordedAt: '2026-10-17T00:00:00Z', author: 'user', provenance: 'user_entered', ...rest }) as TimelineEntry;
const med = (drug: string, day = 0) =>
  entry(day, { type: 'med_start', payload: { medId: `fm-${++seq}`, drug, dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'once daily' } });
const allergy = (substance: string, kind: 'allergy' | 'adr' | 'intolerance' | 'nkda' = 'allergy') =>
  entry(0, { type: 'note', payload: kind === 'nkda' ? { category: 'allergy_adr', kind } : { category: 'allergy_adr', kind, substance, reaction: 'rash' } });
const lab = (analyte: string, value: number, unit: string, day: number, provenance: TimelineEntry['provenance'] = 'user_entered') =>
  entry(day, { type: 'lab', provenance, unit, payload: { analyte, analyteName: analyte, result: { kind: 'numeric', value }, unit } });
const row = (register: RegisterItem['register'], fields: Record<string, string>): RegisterItem =>
  ({ id: `fr-${++seq}`, caseId: 'FIXTURE', register, fields, status: 'active', createdAt: '2026-10-17', version: 1, versionCreatedAt: '2026-10-17' });
const threshold = (analyte: string, unit: string, low?: number, high?: number): LabThreshold => ({
  id: `ft-${analyte}`, version: 1, versionCreatedAt: 'x', status: 'active', createdAt: 'x', verifiedBy: 'fixture', verifiedAt: '2026-10-17',
  analyte, unit, ...(low !== undefined ? { low } : {}), ...(high !== undefined ? { high } : {}), source: 'Synthetic laboratory critical values list',
});
const pending = { status: 'awaiting_review' } as const;

// ------------------------------------------------------------ the fixtures

export const CLINICAL_FIXTURES: ClinicalFixture[] = [
  {
    id: 'F01', title: 'Penicillin allergy, amoxicillin ordered',
    scenario: 'Documented penicillin allergy (rash); amoxicillin IV started on day 0.',
    today: 1, entries: [allergy('Penicillin'), med('amoxicillin')],
    expectCritical: [{ ruleId: 'allergy', level: 'critical', mentions: 'Penicillin' }], review: pending,
  },
  {
    id: 'F02', title: 'Amoxicillin allergy, combination brand ordered',
    scenario: 'Allergy to amoxicillin; the order is a brand that contains it (Augmentin).',
    today: 1, entries: [allergy('amoxicillin'), med('Augmentin 1 g tab')],
    expectCritical: [{ ruleId: 'allergy', level: 'critical', mentions: 'amoxicillin' }], review: pending,
  },
  {
    id: 'F03', title: 'Previous adverse drug reaction to ibuprofen',
    scenario: 'A previous ADR to ibuprofen is documented and ibuprofen is ordered.',
    today: 1, entries: [allergy('ibuprofen', 'adr'), med('ibuprofen 400 mg')],
    expectCritical: [{ ruleId: 'allergy', level: 'critical' }], review: pending,
  },
  {
    id: 'F04', title: 'NSAID allergy, ibuprofen on the home list',
    scenario: 'Class allergy to NSAIDs; the home medication list includes ibuprofen.',
    today: 1, entries: [allergy('NSAIDs')], items: [row('home_med', { drug: 'ibuprofen' })],
    expectCritical: [{ ruleId: 'allergy', level: 'critical', mentions: 'home medication' }],
    expectOther: [{ ruleId: 'reconciliation', level: 'important' }], review: pending,
  },
  {
    id: 'F05', title: 'Potassium in the critical range',
    scenario: 'Latest potassium 6.8 mmol/L; the hospital critical value is above 6.0.',
    today: 1, entries: [lab('k', 6.8, 'mmol/L', 1)], thresholds: [threshold('k', 'mmol/L', 2.5, 6.0)],
    expectCritical: [{ ruleId: 'lab_critical', level: 'critical' }], review: pending,
  },
  {
    id: 'F06', title: 'Creatinine reported in µmol/L against a mg/dL limit',
    scenario: 'Serum creatinine 600 µmol/L (6.8 mg/dL) with the hospital limit written in mg/dL.',
    today: 1, entries: [lab('scr', 600, 'µmol/L', 1)], thresholds: [threshold('scr', 'mg/dL', undefined, 6.0)],
    expectCritical: [{ ruleId: 'lab_critical', level: 'critical' }], review: pending,
  },
  {
    id: 'F07', title: 'Vancomycin with ceftriaxone (ONC high-priority pair)',
    scenario: 'Both drugs active together; the pair is on the ONC high-priority list.',
    today: 1, entries: [med('vancomycin'), med('ceftriaxone')],
    expectCritical: [{ ruleId: 'interaction', level: 'critical', mentions: 'vancomycin' }], review: pending,
  },
  {
    id: 'F08', title: 'Ibuprofen with enoxaparin',
    scenario: 'A major (not ONC) interaction: the engine shows it as important, never critical.',
    today: 1, entries: [med('ibuprofen'), med('enoxaparin')],
    expectCritical: [], expectOther: [{ ruleId: 'interaction', level: 'important' }], review: pending,
  },
  {
    id: 'F09', title: 'Penicillin allergy, unrelated drug (no false alarm)',
    scenario: 'Penicillin allergy with metformin ordered: nothing to flag.',
    today: 1, entries: [allergy('penicillin'), med('metformin')],
    expectCritical: [], mustNotFire: ['allergy'], review: pending,
  },
  {
    id: 'F10', title: 'No known drug allergies, amoxicillin ordered',
    scenario: 'NKDA is documented; the allergy rule must stay silent.',
    today: 1, entries: [allergy('', 'nkda'), med('amoxicillin')],
    expectCritical: [], mustNotFire: ['allergy'], review: pending,
  },
  {
    id: 'F11', title: 'A machine-read value is never an alarm',
    scenario: 'A potassium of 7.5 read by the model and not yet confirmed: the rule must not act on an unverified value.',
    today: 3, entries: [lab('k', 4.5, 'mmol/L', 2), lab('k', 7.5, 'mmol/L', 3, 'extracted_unverified')], thresholds: [threshold('k', 'mmol/L', 2.5, 6.0)],
    expectCritical: [], mustNotFire: ['lab_critical'], review: pending,
  },
  {
    id: 'F12', title: 'Unknown drug and unknown allergen are reported, not passed',
    scenario: 'An allergen and an order the vocabulary does not know: the engine must say it could not check them.',
    today: 1, entries: [allergy('Zylomex'), med('Fantasimab 10 mg')],
    expectCritical: [], mustNotFire: ['allergy'], expectNotChecked: ['Zylomex', 'Fantasimab 10 mg'], review: pending,
  },
  {
    id: 'F13', title: 'Duplicate therapy',
    scenario: 'Ibuprofen ordered twice under different strengths.',
    today: 1, entries: [med('ibuprofen 200 mg'), med('ibuprofen 400 mg')],
    expectCritical: [], expectOther: [{ ruleId: 'duplication', level: 'important' }], review: pending,
  },
  {
    id: 'F14', title: 'Monitoring overdue',
    scenario: 'A creatinine check planned for day 3 has not been done on day 5.',
    today: 5, entries: [], items: [row('monitoring', { parameter: 'Serum creatinine', status: 'active', nextDay: '3' })],
    expectCritical: [], expectOther: [{ ruleId: 'monitoring_due', level: 'important' }], review: pending,
  },
  {
    id: 'F15', title: 'Unresolved unintentional discrepancy at admission',
    scenario: 'A home medication was held without a reason and the discrepancy is not resolved.',
    today: 2, entries: [], items: [row('home_med', { drug: 'metformin', admissionStatus: 'held', discrepancy: 'unintentional', discrepancyType: 'omission' })],
    expectCritical: [], expectOther: [{ ruleId: 'reconciliation', level: 'important' }], review: pending,
  },
];

// ------------------------------------------------------------ the runner

export interface FixtureResult {
  id: string;
  title: string;
  missed: Expected[];
  falseAlarms: string[];
  missingNotChecked: string[];
  /** Everything raised, for the review sheet. */
  raised: { ruleId: RuleId; level: AlertLevel; title: string }[];
  passed: boolean;
}

const hits = (e: Expected, alerts: { ruleId: string; level: string; title: { en: string }; detail: { en: string } }[]) =>
  alerts.some((a) => a.ruleId === e.ruleId && a.level === e.level && (!e.mentions || `${a.title.en} ${a.detail.en}`.toLowerCase().includes(e.mentions.toLowerCase())));

export function runFixture(f: ClinicalFixture): FixtureResult {
  const ctx: RulesContext = {
    today: f.today,
    current: f.entries,
    items: f.items ?? [],
    tasks: [],
    calcResults: [],
    isCurrent: () => true,
    formulary: [],
    adjustments: [],
    thresholds: f.thresholds ?? [],
    gather: { demographics: { ageYears: 60, sex: 'M' }, current: f.entries },
    vocab: FIXTURE_VOCAB,
    interactions,
  };
  const out = evaluateRules(ctx);
  const missed = [...f.expectCritical, ...(f.expectOther ?? [])].filter((e) => !hits(e, out.alerts));
  const falseAlarms = out.alerts.filter((a) => f.mustNotFire?.includes(a.ruleId)).map((a) => `${a.ruleId}: ${a.title.en}`);
  const missingNotChecked = (f.expectNotChecked ?? []).filter((s) => !out.notChecked.some((n) => n.subject === s));
  return {
    id: f.id,
    title: f.title,
    missed,
    falseAlarms,
    missingNotChecked,
    raised: out.alerts.map((a) => ({ ruleId: a.ruleId, level: a.level, title: a.title.en })),
    passed: !missed.length && !falseAlarms.length && !missingNotChecked.length,
  };
}

export const runFixtures = (fs: ClinicalFixture[] = CLINICAL_FIXTURES): FixtureResult[] => fs.map(runFixture);

/** The gate's own wording: no critical problem missed. */
export const missedCritical = (rs: FixtureResult[], fs: ClinicalFixture[] = CLINICAL_FIXTURES): Expected[] =>
  rs.flatMap((r) => r.missed.filter((m) => fs.find((f) => f.id === r.id)?.expectCritical.includes(m)));

/** The review sheet (Markdown): each fixture, what the engine raised, and sign-off fields for the expert. */
export function reviewSheet(fs: ClinicalFixture[] = CLINICAL_FIXTURES): string {
  const rs = runFixtures(fs);
  const lines = [
    '# Clinical fixture library — expert review sheet',
    '',
    '> Generated by `npm run fixtures:doc` from `src/fixtures/clinical.ts`. **Synthetic cases written by the developer, not reviewed by a clinical expert.** The release gate (Section 23) needs this sheet signed by a qualified reviewer; until then every fixture is *awaiting review* and RELEASE_GATE_MET stays false.',
    '',
    `Engine result: ${rs.filter((r) => r.passed).length} of ${rs.length} fixtures pass the engine's own expectations; critical problems missed: ${missedCritical(rs, fs).length}.`,
    '',
    'For each fixture the reviewer confirms (a) the scenario is clinically realistic, (b) the expected problems are the right ones, (c) nothing important is missing from the expectations.',
    '',
  ];
  for (const f of fs) {
    const r = rs.find((x) => x.id === f.id)!;
    lines.push(`## ${f.id} — ${f.title}`, '', f.scenario, '');
    lines.push(`- Expected critical: ${f.expectCritical.length ? f.expectCritical.map((e) => `${e.ruleId}${e.mentions ? ` (${e.mentions})` : ''}`).join('; ') : 'none'}`);
    if (f.expectOther?.length) lines.push(`- Expected other: ${f.expectOther.map((e) => `${e.ruleId} (${e.level})`).join('; ')}`);
    if (f.mustNotFire?.length) lines.push(`- Must not fire: ${f.mustNotFire.join(', ')}`);
    if (f.expectNotChecked?.length) lines.push(`- Must be reported as not checked: ${f.expectNotChecked.join('; ')}`);
    lines.push(`- Engine raised: ${r.raised.length ? r.raised.map((a) => `${a.level} ${a.ruleId}`).join('; ') : 'nothing'}`);
    lines.push(`- Engine result: ${r.passed ? 'as expected' : 'DOES NOT MATCH'}`);
    lines.push(`- Expert review: ${f.review.status === 'reviewed' ? `reviewed by ${f.review.reviewer} on ${f.review.date}` : '☐ realistic   ☐ expectations right   ☐ nothing missing — Reviewer: ________  Date: ________'}`, '');
  }
  return lines.join('\n');
}

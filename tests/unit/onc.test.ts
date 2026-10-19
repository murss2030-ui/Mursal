/**
 * The ONC list as the administrator enters it (owner decision, 19 October
 * 2026): each name resolved exactly — one ingredient or a drug class — and
 * two medicines under a pair raised to critical, with DDInter's level when it
 * has one. The pairs below are test entries, not the ONC list.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../../src/data/datasets.json';
import type { OncPair } from '../../src/domain/reference';
import type { TimelineEntry } from '../../src/domain/types';
import { buildInteractions, type InteractionFile } from '../../src/drugs/datasets';
import { matchDrug } from '../../src/drugs/normalize';
import { buildVocabulary, type RxnormSubset } from '../../src/drugs/vocabulary';
import { evaluateRules } from '../../src/rules/engine';
import { oncIndex, oncMatches, resolveOncName, resolveOncSide } from '../../src/rules/onc';

const entries = manifest.datasets as Record<string, { file: string }>;
const read = (f: string) => readFileSync(`public/${f}`, 'utf8');
const vocab = buildVocabulary(JSON.parse(read(entries['rxnorm-subset']!.file)) as RxnormSubset);
const ddinter = buildInteractions(JSON.parse(read(entries.interactions!.file)) as InteractionFile);
const rx = (name: string) => {
  const m = matchDrug(name, vocab);
  if (m.status !== 'matched' || m.ingredients.length !== 1) throw new Error(`${name} did not match one ingredient`);
  return m.ingredients[0]!.rxcui;
};

let n = 0;
function pair(a: string, b: string, over: Partial<OncPair> = {}): OncPair {
  n++;
  return {
    id: `onc-${n}`,
    version: 1,
    versionCreatedAt: '2026-10-19T00:00:00.000Z',
    status: 'active',
    createdAt: '2026-10-19T00:00:00.000Z',
    verifiedBy: 'Test',
    verifiedAt: '2026-10-19',
    label: `Test pair ${n} (not the ONC list)`,
    sideA: resolveOncSide(a, vocab).side,
    sideB: resolveOncSide(b, vocab).side,
    source: 'Unit test source',
    ...over,
  };
}

const med = (drug: string): TimelineEntry =>
  ({
    id: `e-${drug}`,
    caseId: 'C',
    hospitalDay: 0,
    recordedAt: `2026-10-19T00:00:0${++n % 10}Z`,
    author: 'user',
    provenance: 'user_entered',
    type: 'med_start',
    payload: { medId: `m-${drug}`, drug, dose: { kind: 'structured', value: 1, unit: 'mg' }, route: 'PO', frequency: 'once daily' },
  }) as TimelineEntry;

function rulesFor(drugs: string[], onc: OncPair[]) {
  const current = drugs.map(med);
  return evaluateRules({
    today: 0,
    current,
    items: [],
    tasks: [],
    calcResults: [],
    isCurrent: () => true,
    formulary: [],
    adjustments: [],
    thresholds: [],
    gather: { demographics: { ageYears: 60, sex: 'M' }, current },
    vocab,
    interactions: ddinter,
    onc,
  });
}

describe('resolving the names the administrator enters', () => {
  it('a generic name is one ingredient; a class is matched by its exact name, singular or plural', () => {
    expect(resolveOncName('simvastatin', vocab)).toMatchObject({ kind: 'ingredient', rxcui: rx('simvastatin') });
    const ppi = resolveOncName('Proton Pump Inhibitor', vocab);
    expect(ppi).toMatchObject({ kind: 'class', className: 'Proton Pump Inhibitor' });
    expect(resolveOncName('proton pump inhibitors', vocab)).toMatchObject({ kind: 'class', id: ppi.kind === 'class' ? ppi.id : '' });
    expect(ppi.kind === 'class' && ppi.members).toBeGreaterThan(3);
  });

  it('a combination product and an unknown name are not accepted (no guessing)', () => {
    expect(resolveOncName('amoxicillin / clavulanate', vocab).kind).toBe('combination');
    expect(resolveOncName('proton pump', vocab).kind).toBe('unknown');
    expect(resolveOncName('notadrugatall', vocab).kind).toBe('unknown');
    const side = resolveOncSide('simvastatin; notadrugatall', vocab);
    expect(side.unrecognised).toEqual(['notadrugatall']);
    expect(side.side.names).toEqual(['simvastatin', 'notadrugatall']);
  });
});

describe('matching two medicines against the entered pairs', () => {
  it('in either order, a class side covering its members, and a removed pair ignored', () => {
    const statin = pair('simvastatin', 'clarithromycin');
    const ppi = pair('clopidogrel', 'Proton Pump Inhibitor');
    const removed = pair('warfarin', 'ibuprofen', { status: 'retracted' });
    const index = oncIndex([statin, ppi, removed], vocab);
    expect(oncMatches(index, [rx('simvastatin')], [rx('clarithromycin')])).toEqual([statin]);
    expect(oncMatches(index, [rx('clarithromycin')], [rx('simvastatin')])).toEqual([statin]);
    expect(oncMatches(index, [rx('simvastatin')], [rx('amoxicillin')])).toEqual([]);
    expect(oncMatches(index, [rx('omeprazole')], [rx('clopidogrel')])).toEqual([ppi]);
    expect(oncMatches(index, [rx('clopidogrel')], [rx('pantoprazole')])).toEqual([ppi]);
    expect(oncMatches(index, [rx('warfarin')], [rx('ibuprofen')])).toEqual([]);
  });
});

describe('the rules with the entered list', () => {
  it('a listed pair is one critical alert, with DDInter’s level and the entry’s source; nothing else for that pair', () => {
    const entry = pair('simvastatin', 'clarithromycin');
    const out = rulesFor(['simvastatin', 'clarithromycin'], [entry]);
    const found = out.alerts.filter((a) => a.ruleId === 'interaction');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: 'critical', taskId: 't06' });
    expect(found[0]!.title.en).toBe('Interaction (ONC high-priority): clarithromycin + simvastatin');
    expect(found[0]!.detail.en).toContain(`On the ONC high-priority list entered on this device: “${entry.label}”. DDInter level: major.`);
    expect(found[0]!.detail.en).toContain('PRECEPTOR gives the level only');
    expect(found[0]!.source.en).toBe('ONC high-priority list, as entered on this device: Unit test source');
    expect(out.notChecked.map((x) => x.key)).not.toContain('interactions:onc');
  });

  it('without an entered list, the same pair is DDInter’s important alert, and the missing list is said', () => {
    const out = rulesFor(['simvastatin', 'clarithromycin'], []);
    const found = out.alerts.filter((a) => a.ruleId === 'interaction');
    expect(found.map((a) => a.level)).toEqual(['important']);
    expect(found[0]!.detail.en).toContain('PRECEPTOR gives the level only: look up the mechanism and the management in your hospital’s approved reference and write them in Task 6.');
    expect(out.notChecked.find((x) => x.key === 'interactions:onc')?.reason.en).toContain('The ONC high-priority list has not been entered on this device');
  });

  it('a listed pair outside DDInter’s files is still critical, and is not reported as unchecked', () => {
    const out = rulesFor(['amiodarone', 'digoxin'], [pair('amiodarone', 'digoxin')]);
    const found = out.alerts.filter((a) => a.ruleId === 'interaction');
    expect(found.map((a) => a.level)).toEqual(['critical']);
    expect(found[0]!.detail.en).toContain('Not in DDInter’s download files.');
    expect(out.notChecked.map((x) => x.key)).not.toContain('interactions:outside');
    // Without the entry, the same pair is listed as not checked.
    expect(rulesFor(['amiodarone', 'digoxin'], []).notChecked.map((x) => x.key)).toContain('interactions:outside');
  });

  it('a changed entry changes the alert’s data, so an earlier acknowledgement no longer covers it', () => {
    const v1 = pair('simvastatin', 'clarithromycin');
    const v2 = { ...v1, version: 2, label: 'Test pair, reworded' };
    const h = (p: OncPair) => rulesFor(['simvastatin', 'clarithromycin'], [p]).alerts.find((a) => a.ruleId === 'interaction')!.dataHash;
    expect(h(v1)).not.toBe(h(v2));
  });
});

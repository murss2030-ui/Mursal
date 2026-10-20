/**
 * The PCNE Classification V 9.1 as the app holds it, and the two mappings
 * derived from it, across every code (Section 21: "the PCNE-to-Cipolle and
 * PCNE-to-checkbox maps across all codes").
 */
import { describe, expect, it } from 'vitest';
import {
  PCNE_ACCEPTANCE,
  PCNE_CAUSES,
  PCNE_CODE,
  PCNE_DOMAINS,
  PCNE_INTERVENTIONS,
  PCNE_PROBLEMS,
  PCNE_STATUS,
} from '../../src/domain/pcne';
import { CIPOLLE_CATEGORIES, PCNE_TO_CIPOLLE, PCNE_TO_FORM_BOX, cipolleFor, formBoxesFor } from '../../src/domain/pcne-maps';
import { DRP_CATEGORIES } from '../../src/domain/workflow/registers';

const BOXES = new Set(DRP_CATEGORIES.map((c) => c.value));

describe('the PCNE Classification V 9.1', () => {
  it('has the domains and sub-domains the document counts', () => {
    // "3 primary domains for problems, 9 … for causes, 5 … for Planned Interventions, 3 … for level of acceptance and 4 … for the Status"
    const count = (s: string) => PCNE_DOMAINS.filter((d) => d.section === s).length;
    expect([count('problem'), count('cause'), count('intervention'), count('acceptance'), count('status')]).toEqual([3, 9, 5, 3, 4]);
    // "6 grouped sub domains for problems, 38 … for causes and 17 … for interventions, and 10 subdomains for intervention acceptance"; status: "4 primary domains and 7 sub domains"
    expect([PCNE_PROBLEMS.length, PCNE_CAUSES.length, PCNE_INTERVENTIONS.length, PCNE_ACCEPTANCE.length, PCNE_STATUS.length]).toEqual([6, 38, 17, 10, 7]);
  });

  it('every code belongs to a domain of its section, and codes are unique', () => {
    const all = [...PCNE_PROBLEMS, ...PCNE_CAUSES, ...PCNE_INTERVENTIONS, ...PCNE_ACCEPTANCE, ...PCNE_STATUS];
    expect(new Set(all.map((x) => x.code)).size).toBe(all.length);
    for (const x of all) expect(PCNE_DOMAINS.some((d) => d.code === x.domain)).toBe(true);
  });

  it('keeps the document’s wording', () => {
    expect(PCNE_CODE.get('P3.2')!.label.en).toBe('Unclear problem/complaint. Further clarification necessary (please use as escape only)');
    expect(PCNE_CODE.get('C1.3')!.label.en).toBe('Inappropriate combination of drugs, or drugs and herbal medications, or drugs and dietary supplements');
    expect(PCNE_CODE.get('C8.1')!.label.en).toBe('Medication reconciliation problem');
    expect(PCNE_CODE.get('C9.1')!.label.en).toBe('No or inappropriate outcome monitoring (incl. TDM)');
  });
});

describe('PCNE → the department form’s Section 8 checkboxes', () => {
  it('maps every problem and cause code to one of the form’s boxes (or, for "no obvious cause", to the problem’s box)', () => {
    for (const x of [...PCNE_PROBLEMS, ...PCNE_CAUSES]) {
      const rule = PCNE_TO_FORM_BOX[x.code];
      expect(rule, x.code).toBeDefined();
      expect(rule!.box === 'problem' ? x.code === 'C9.3' : BOXES.has(rule!.box), x.code).toBe(true);
    }
    expect(Object.keys(PCNE_TO_FORM_BOX).sort()).toEqual([...PCNE_PROBLEMS, ...PCNE_CAUSES].map((x) => x.code).sort());
  });

  it('every problem code alone ticks one box; a code without a clean box writes its wording under "other"', () => {
    for (const p of PCNE_PROBLEMS) expect(formBoxesFor(p.code, []).boxes).toHaveLength(1);
    expect(formBoxesFor('P3.2', [])).toEqual({ boxes: ['other'], otherText: ['P3.2 Unclear problem/complaint. Further clarification necessary (please use as escape only)'] });
  });

  it.each<[string, string[], string[], string[]]>([
    // [problem, causes, boxes, "other" text]
    ['P1.2', ['C3.1'], ['dose_low'], []],
    ['P2.1', ['C3.2'], ['dose_high'], []],
    ['P2.1', ['C1.3'], ['interaction'], []],
    ['P1.3', ['C1.5'], ['additional_therapy'], []],
    ['P3.1', ['C1.2', 'C1.4'], ['unnecessary'], []],
    ['P1.2', ['C7.1'], ['nonadherence'], []],
    ['P2.1', ['C9.1'], ['monitoring'], []],
    ['P1.1', ['C9.3'], ['ineffective'], []],
    ['P2.1', ['C1.1'], ['adr', 'other'], ['C1.1 Inappropriate drug according to guidelines/formulary']],
    ['P1.2', ['C3.1', 'C8.1'], ['dose_low', 'other'], ['C8.1 Medication reconciliation problem']],
    ['P1.2', [], ['ineffective'], []],
  ])('%s with %j → %j', (problem, causes, boxes, other) => {
    expect(formBoxesFor(problem, causes)).toEqual({ boxes, otherText: other });
  });

  it('every combination of a problem and one cause gives at least one box', () => {
    for (const p of PCNE_PROBLEMS) for (const c of PCNE_CAUSES) expect(formBoxesFor(p.code, [c.code]).boxes.length, `${p.code}+${c.code}`).toBeGreaterThan(0);
  });
});

describe('PCNE → Cipolle, Strand and Morley (teaching view)', () => {
  it('maps every problem and cause code, by problem domain where the meaning depends on it', () => {
    const ids = new Set<string>([...CIPOLLE_CATEGORIES.map((x) => x.id), 'none', 'problem']);
    for (const x of [...PCNE_PROBLEMS, ...PCNE_CAUSES]) {
      const to = PCNE_TO_CIPOLLE[x.code]?.to;
      expect(to, x.code).toBeDefined();
      const targets = typeof to === 'string' ? [to] : [to!.P1, to!.P2, to!.P3];
      for (const t of targets) expect(ids.has(t), `${x.code} → ${t}`).toBe(true);
    }
    expect(Object.keys(PCNE_TO_CIPOLLE).sort()).toEqual([...PCNE_PROBLEMS, ...PCNE_CAUSES].map((x) => x.code).sort());
    expect(CIPOLLE_CATEGORIES.map((x) => x.need)).toEqual(['indication', 'indication', 'effectiveness', 'effectiveness', 'safety', 'safety', 'adherence']);
  });

  it.each<[string, string[], string | undefined, string | undefined]>([
    // [problem, causes, Cipolle category, deciding code]
    ['P1.2', ['C3.1'], 'Dosage too low', 'C3.1'],
    ['P2.1', ['C3.2'], 'Dosage too high', 'C3.2'],
    ['P2.1', ['C1.3'], 'Adverse drug reaction', 'C1.3'],
    ['P1.2', ['C1.3'], 'Dosage too low', 'C1.3'],
    ['P3.1', ['C1.2'], 'Unnecessary drug therapy', 'C1.2'],
    ['P1.3', ['C1.5'], 'Needs additional drug therapy', 'C1.5'],
    ['P1.2', ['C7.1'], 'Nonadherence', 'C7.1'],
    ['P2.1', ['C9.1'], 'Adverse drug reaction', 'P2.1'],
    ['P1.1', ['C1.1'], 'Ineffective drug', 'C1.1'],
    ['P2.1', ['C1.1'], 'Adverse drug reaction', 'C1.1'],
    // Several candidates: Cipolle's order of assessment — effectiveness before adherence.
    ['P1.2', ['C7.1', 'C3.1'], 'Dosage too low', 'C3.1'],
    ['P3.2', [], undefined, 'P3.2'],
  ])('%s with %j → %s', (problem, causes, label, from) => {
    const v = cipolleFor(problem, causes);
    expect(v.category?.label.en).toBe(label);
    expect(v.from).toBe(from);
  });

  it('every combination of a problem and one cause resolves to a category or to "no equivalent" without error', () => {
    for (const p of PCNE_PROBLEMS) for (const c of PCNE_CAUSES) expect(() => cipolleFor(p.code, [c.code])).not.toThrow();
  });
});

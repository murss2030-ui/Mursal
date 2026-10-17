import { describe, expect, it } from 'vitest';
import { findIdentifiers, REDACTION_MARK, removeIdentifiers } from '../../src/domain/workflow/deidentify';
import { readiness } from '../../src/domain/workflow/readiness';
import type { Case, PayloadMap, RegisterItem, TimelineEntry } from '../../src/domain/types';

const c: Case = {
  id: 'CASE-3001',
  kind: 'teaching',
  rotationId: 'r',
  deidentified: true,
  demographics: { ageYears: 70, sex: 'F' },
  admissionDay0: '2026-10-10',
  status: 'active',
  createdAt: '2026-10-10T08:00:00Z',
  version: 1,
  versionCreatedAt: '2026-10-10T08:00:00Z',
};

let n = 0;
function e<K extends TimelineEntry['type']>(type: K, payload: PayloadMap[K], hospitalDay = 1, timeOfDay?: string): TimelineEntry {
  n++;
  return { id: `e${n}`, caseId: c.id, hospitalDay, timeOfDay, recordedAt: `2026-10-11T08:00:${String(n).padStart(2, '0')}Z`, author: 'user', provenance: 'user_entered', type, payload } as TimelineEntry;
}
const lab = (analyte: string, analyteName: string, value: number, unit: string, day = 1, time?: string) =>
  e('lab', { analyte, analyteName, result: { kind: 'numeric', value }, unit }, day, time);

describe('data readiness', () => {
  const ctx = (current: TimelineEntry[], items: RegisterItem[] = []) => ({ case: c, current, attachments: [], items });

  it('names what is missing, with where to add it, and never estimates a value', () => {
    const r = readiness(['demographics', 'weight', 'height', 'scr', 'electrolytes', 'allergy', 'home_meds', 'dialysis', 'sources'], ctx([]));
    expect(r.map((x) => [x.id, x.state])).toEqual([
      ['demographics', 'ok'],
      ['weight', 'missing'],
      ['height', 'missing'],
      ['scr', 'missing'],
      ['electrolytes', 'missing'],
      ['allergy', 'missing'],
      ['home_meds', 'missing'],
      ['dialysis', 'missing'],
      ['sources', 'missing'],
    ]);
    expect(r[1]!.add).toEqual({ kind: 'entry', type: 'weight' });
    expect(r[2]!.add).toEqual({ kind: 'case_details' });
    expect(r[5]!.add).toEqual({ kind: 'entry', type: 'note', category: 'allergy_adr' });
    expect(r[6]!.add).toEqual({ kind: 'register', register: 'home_med' });
    // M2: dialysis status is a structured renal-replacement-therapy note (M2 plan, decision 7).
    expect(r[7]!.add).toEqual({ kind: 'entry', type: 'note', category: 'renal_replacement' });
    for (const x of r) if (x.state !== 'ok') expect(x.value).toBeUndefined();
  });

  it('reports the latest value with its unit and day, and requires every part of a group', () => {
    const current = [
      lab('scr', 'Serum creatinine', 1.1, 'mg/dL', 0),
      lab('scr', 'Serum creatinine', 2.4, 'mg/dL', 3, '06:30'),
      lab('k', 'Potassium', 5.1, 'mmol/L', 3),
      e('weight', { value: 61.5, unit: 'kg', method: 'measured' }, 1),
      e('note', { category: 'allergy_adr', kind: 'nkda' }, 0),
    ];
    const r = readiness(['scr', 'electrolytes', 'weight', 'allergy'], ctx(current));
    expect(r[0]).toMatchObject({ state: 'ok', value: 'Serum creatinine 2.4 mg/dL at 06:30', day: 3 });
    // Sodium is missing, so the electrolytes are not ready — the potassium found is still shown.
    expect(r[1]).toMatchObject({ state: 'missing', value: 'Potassium 5.1 mmol/L' });
    expect(r[2]).toMatchObject({ state: 'ok', value: '61.5 kg (measured)', day: 1 });
    expect(r[3]).toMatchObject({ state: 'ok', value: 'NKDA' });
  });
});

describe('identifier help for typed sources', () => {
  it('finds the case’s own identifiers, labelled lines, phone numbers, record numbers and doctors’ names', () => {
    const text = [
      'Patient name: Saleh Ahmed Qaid',
      'MRN: 00451287',
      'Seen with Dr. Haddad on the ward. Saleh reports fever.',
      'Contact 777 123 456 or +967 733123456.',
      'K 5.9 mmol/L, WBC 12.3, platelets 250000.',
      'اسم المريض: صالح أحمد',
      'السرير: ١٢',
    ].join('\n');
    const hits = findIdentifiers(text, { patientName: 'Saleh Ahmed Qaid', mrn: '00451287' });
    const found = hits.map((h) => h.text);
    expect(found).toContain('Saleh Ahmed Qaid');
    expect(found).toContain('00451287');
    expect(found).toContain('Dr. Haddad');
    expect(found).toContain('Saleh');
    expect(found).toContain('777 123 456');
    expect(found).toContain('+967 733123456');
    expect(found).toContain('صالح أحمد');
    expect(found).toContain('١٢');
    // Laboratory values are left alone.
    expect(found.some((f) => f.includes('5.9') || f.includes('12.3') || f.includes('250000'))).toBe(false);

    const cleaned = removeIdentifiers(text, hits);
    expect(cleaned).not.toMatch(/Saleh|00451287|Haddad|777 123 456|733123456|صالح/);
    expect(cleaned).toContain('K 5.9 mmol/L, WBC 12.3, platelets 250000.');
    expect(cleaned).toContain(`Patient name: ${REDACTION_MARK}`);
  });

  it('returns nothing for clean clinical text', () => {
    expect(findIdentifiers('64-year-old man with community-acquired pneumonia. SCr 1.4 mg/dL on Day 2. Started ceftriaxone 2 g IV once daily.')).toEqual([]);
  });
});

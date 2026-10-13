import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, hospitalDayOf, isValidISODate, localToday } from '../../src/domain/dates';
import { buildEntryMeta, buildPayload, contextForEntry, entryToValues, type Values } from '../../src/domain/entries';
import { formatNumber, parseDecimal } from '../../src/domain/numbers';
import type { EntryType, TimelineEntry } from '../../src/domain/types';

describe('number parsing', () => {
  it.each([
    ['2.1', 2.1],
    [' 7 ', 7],
    ['.5', 0.5],
    ['-3', -3],
    ['٢٫٥', 2.5], // Arabic-Indic digits with the Arabic decimal separator
    ['۱۲', 12], // Extended Arabic-Indic digits
    ['−4', -4], // Unicode minus
  ])('parses %j as %d', (input, expected) => {
    expect(parseDecimal(input)).toEqual({ ok: true, value: expected });
  });

  it('refuses commas instead of guessing whether they are decimal marks', () => {
    expect(parseDecimal('1,5')).toEqual({ ok: false, reason: 'comma' });
    expect(parseDecimal('1٬500')).toEqual({ ok: false, reason: 'comma' });
  });

  it.each(['', 'abc', '1e3', '1.2.3', '--1', '5mg'])('rejects %j', (input) => {
    expect(parseDecimal(input).ok).toBe(false);
  });

  it('formats without trailing zeros and with a leading zero (ISMP)', () => {
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(5)).toBe('5');
    expect(formatNumber(5.1)).toBe('5.1');
    expect(formatNumber(1.4)).toBe('1.4');
  });
});

describe('hospital days', () => {
  it('counts calendar days independent of daylight saving and month or year ends', () => {
    expect(hospitalDayOf('2026-03-28', '2026-03-30')).toBe(2); // EU DST change weekend
    expect(hospitalDayOf('2026-12-30', '2027-01-02')).toBe(3);
    expect(hospitalDayOf('2028-02-28', '2028-03-01')).toBe(2); // leap year
    expect(hospitalDayOf('2026-10-10', '2026-10-08')).toBe(-2);
    expect(addDays('2026-10-10', 5)).toBe('2026-10-15');
    expect(daysBetween('2026-10-10', '2026-10-10')).toBe(0);
  });

  it('rejects impossible dates', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('26-01-01')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('formats the local date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });

  it('validates the hospital day and time shared by every entry', () => {
    expect(buildEntryMeta({ hospitalDay: '3', timeOfDay: '06:15' })).toEqual({ ok: true, hospitalDay: 3, timeOfDay: '06:15' });
    expect(buildEntryMeta({ hospitalDay: '' })).toMatchObject({ ok: false, errors: { hospitalDay: 'required' } });
    expect(buildEntryMeta({ hospitalDay: '2.5' })).toMatchObject({ ok: false, errors: { hospitalDay: 'integer' } });
    expect(buildEntryMeta({ hospitalDay: '900' })).toMatchObject({ ok: false, errors: { hospitalDay: 'hospitalDay' } });
    expect(buildEntryMeta({ hospitalDay: '1', timeOfDay: '7:5' })).toMatchObject({ ok: false, errors: { timeOfDay: 'time' } });
  });
});

const errorsOf = (type: EntryType, v: Values, ctx = {}) => {
  const r = buildPayload(type, v, { newId: () => 'new-id', ...ctx });
  return r.ok ? {} : r.errors;
};

describe('lab entries', () => {
  it('requires an explicit unit allowed for the analyte; an unknown unit is rejected, never assumed', () => {
    expect(errorsOf('lab', { analyte: 'scr', value: '1.2' })).toEqual({ unit: 'required' });
    expect(errorsOf('lab', { analyte: 'scr', value: '1.2', unit: 'mmol/L' })).toEqual({ unit: 'unit' });
    expect(errorsOf('lab', { analyte: 'scr', value: '1.2', unit: 'mg/dL' })).toEqual({});
    expect(errorsOf('lab', { analyte: 'scr', value: '106', unit: 'µmol/L' })).toEqual({});
  });

  it('rejects negative values for quantities that cannot be negative, and commas', () => {
    expect(errorsOf('lab', { analyte: 'k', value: '-4', unit: 'mmol/L' })).toEqual({ value: 'nonNegative' });
    expect(errorsOf('lab', { analyte: 'k', value: '4,5', unit: 'mmol/L' })).toEqual({ value: 'comma' });
  });

  it('accepts other analytes only with a name and a typed unit', () => {
    expect(errorsOf('lab', { analyte: 'other', value: '3' })).toEqual({ analyteOther: 'required', unit: 'required' });
    expect(errorsOf('lab', { analyte: 'other', analyteOther: 'Ammonia', value: '45', unit: 'µmol/L' })).toEqual({});
  });

  it('stores qualitative results as text without a unit', () => {
    const r = buildPayload('lab', { analyte: 'trop', resultKind: 'text', resultText: 'negative' });
    expect(r).toEqual({ ok: true, payload: expect.objectContaining({ result: { kind: 'text', text: 'negative' }, unit: 'unitless' }) });
  });

  it('checks the reference range order', () => {
    expect(errorsOf('lab', { analyte: 'k', value: '4', unit: 'mmol/L', refLow: '5.1', refHigh: '3.5' })).toEqual({ refHigh: 'refOrder' });
  });
});

describe('vital signs and weight', () => {
  it('enforces definitional bounds and blood pressure order', () => {
    expect(errorsOf('vital', { vital: 'blood_pressure', systolic: '80', diastolic: '120' })).toEqual({ diastolic: 'bpOrder' });
    expect(errorsOf('vital', { vital: 'gcs', value: '16' })).toEqual({ value: 'range' });
    expect(errorsOf('vital', { vital: 'gcs', value: '7.5' })).toEqual({ value: 'integer' });
    expect(errorsOf('vital', { vital: 'spo2', value: '101' })).toEqual({ value: 'range' });
    expect(errorsOf('vital', { vital: 'temperature', value: '38.2' })).toEqual({ unit: 'required' });
    expect(errorsOf('vital', { vital: 'urine_output', value: '400' })).toEqual({ periodHours: 'required' });
    expect(errorsOf('vital', { vital: 'heart_rate', value: '96' })).toEqual({});
  });

  it('requires a positive weight and how it was obtained', () => {
    expect(errorsOf('weight', { value: '0' })).toEqual({ value: 'positive', method: 'required' });
    expect(errorsOf('weight', { value: '72.5', method: 'estimated' })).toEqual({});
  });
});

describe('medications', () => {
  it('requires drug, dose, route and frequency from ISMP-safe lists', () => {
    expect(errorsOf('med_start', {})).toEqual({
      drug: 'required',
      doseValue: 'required',
      doseUnit: 'required',
      route: 'required',
      frequency: 'required',
    });
    expect(errorsOf('med_start', { drug: 'enoxaparin', doseValue: '40', doseUnit: 'mg', route: 'SC', frequency: 'once daily' })).toEqual({
      route: 'invalidChoice', // "SC" is on the ISMP error-prone list; the list offers "subcut"
    });
    expect(errorsOf('med_start', { drug: 'enoxaparin', doseValue: '40', doseUnit: 'mg', route: 'subcut', frequency: 'once daily' })).toEqual({});
    expect(errorsOf('med_start', { drug: 'insulin', doseKind: 'text', doseText: 'per sliding scale protocol', route: 'subcut', frequency: 'other', frequencyOther: 'before meals' })).toEqual({});
    expect(errorsOf('med_start', { drug: 'x', doseValue: '0', doseUnit: 'mg', route: 'PO', frequency: 'once' })).toEqual({ doseValue: 'positive' });
  });

  it('gives each new course a fresh id and keeps the id on change and stop', () => {
    const r = buildPayload('med_start', { drug: 'x', doseValue: '1', doseUnit: 'g', route: 'IV', frequency: 'every 8 hours' }, { newId: () => 'course-1' });
    expect(r.ok && r.payload.medId).toBe('course-1');
    const ch = buildPayload('med_change', { frequency: 'every 12 hours' }, { medId: 'course-1', drug: 'x' });
    expect(ch).toEqual({ ok: true, payload: { medId: 'course-1', drug: 'x', frequency: 'every 12 hours' } });
    expect(errorsOf('med_change', {}, { medId: 'course-1', drug: 'x' })).toEqual({ changes: 'atLeastOneChange' });
  });
});

describe('history notes', () => {
  it('requires a substance unless the entry is NKDA', () => {
    expect(errorsOf('note', { category: 'allergy_adr', kind: 'allergy' })).toEqual({ substance: 'required' });
    expect(errorsOf('note', { category: 'allergy_adr', kind: 'nkda' })).toEqual({});
  });

  it('requires khat and tobacco status in social history', () => {
    expect(errorsOf('note', { category: 'social_history' })).toEqual({ khat: 'required', tobacco: 'required' });
    expect(errorsOf('note', { category: 'social_history', khat: 'current', tobacco: 'never' })).toEqual({});
  });

  it('requires name, acuity and status for a problem', () => {
    expect(errorsOf('note', { category: 'problem' })).toEqual({ name: 'required', acuity: 'required', status: 'required' });
  });

  it('refuses interventions and outcomes, which need Problem Cards (M4/M6)', () => {
    expect(errorsOf('intervention', {})).toEqual({ type: 'notInM1' });
    expect(errorsOf('outcome', {})).toEqual({ type: 'notInM1' });
  });
});

describe('correction prefill', () => {
  const base = { caseId: 'C', recordedAt: '2026-10-13T08:00:00Z', author: 'user' as const, provenance: 'user_entered' as const };
  const samples: TimelineEntry[] = [
    { ...base, id: '1', hospitalDay: 1, type: 'lab', payload: { analyte: 'scr', analyteName: 'Serum creatinine', result: { kind: 'numeric', value: 1.4 }, unit: 'mg/dL', refLow: 0.6, refHigh: 1.2, comment: 'repeat' } },
    { ...base, id: '2', hospitalDay: 1, type: 'lab', payload: { analyte: 'other', analyteName: 'Ammonia', result: { kind: 'numeric', value: 45 }, unit: 'µmol/L' } },
    { ...base, id: '3', hospitalDay: 2, timeOfDay: '08:00', type: 'vital', payload: { vital: 'blood_pressure', systolic: 130, diastolic: 80, unit: 'mmHg' } },
    { ...base, id: '4', hospitalDay: 0, type: 'weight', payload: { value: 70.5, unit: 'kg', method: 'measured' } },
    { ...base, id: '5', hospitalDay: 0, type: 'med_start', payload: { medId: 'm1', drug: 'vancomycin', dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'other-frequency-text', indication: 'MRSA' } },
    { ...base, id: '6', hospitalDay: 0, type: 'note', payload: { category: 'social_history', khat: 'current', khatDetails: 'daily', tobacco: 'never' } },
    { ...base, id: '7', hospitalDay: 0, type: 'note', payload: { category: 'problem', problemId: 'p1', name: 'CAP', acuity: 'acute', status: 'active', primaryDiagnosis: true } },
    { ...base, id: '8', hospitalDay: 3, type: 'culture', payload: { specimen: 'blood', status: 'growth', organism: 'S. aureus' } },
    { ...base, id: '9', hospitalDay: 3, type: 'med_change', payload: { medId: 'm1', drug: 'vancomycin', dose: { kind: 'text', text: 'per level' } } },
  ];
  it.each(samples.map((e) => [e.type, e] as const))('rebuilds a %s entry exactly from its form values', (_t, e) => {
    const r = buildPayload(e.type, entryToValues(e), contextForEntry(e));
    expect(r).toEqual({ ok: true, payload: e.payload });
  });
});

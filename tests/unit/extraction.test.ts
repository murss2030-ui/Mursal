import { describe, expect, it } from 'vitest';
import { checkCandidate, needsLook, toCandidate, type Candidate } from '../../src/ai/extraction/candidates';
import type { RawItem } from '../../src/ai/extraction/contract';
import { datesToHospitalDays, dateTextToHospitalDay, deidentifyForModel } from '../../src/ai/extraction/deid';
import { mergePasses, needsSecondPass } from '../../src/ai/extraction/dualpass';
import { mapDoseUnit, mapFrequency, mapRoute, matchAnalyte, normalizeLabUnit, parseBloodPressure, parsePrintedNumber } from '../../src/ai/extraction/normalize';
import { readDocument } from '../../src/ai/extraction/run';
import { readApproximateTerm, rxnormMatch } from '../../src/ai/connectors/rxnorm';
import type { ModelResponse } from '../../src/ai/protocol';
import { ValidationError } from '../../src/domain/validation';
import { IntegrityError } from '../../src/store/store';
import { locate } from '../../src/ui/screens/ExtractionReview';
import { newCase, newSession } from './helpers';

const CTX = { admissionDay0: '2026-10-13', docType: 'lab_report' as const, docDay: undefined, known: { patientName: 'Saleh Qaid', mrn: 'MRN-77120' } };
const item = (over: Partial<RawItem>): RawItem => ({ kind: 'lab', rawText: 'x', legibility: 'clear', handwritten: false, ...over });

describe('normalising what was read', () => {
  it('maps chart wording to the catalogue, and nothing it does not recognise', () => {
    expect(matchAnalyte('S.Cr')).toBe('scr');
    expect(matchAnalyte('Serum Creatinine')).toBe('scr');
    expect(matchAnalyte('K+')).toBe('k');
    expect(matchAnalyte('Hb')).toBe('hb');
    expect(matchAnalyte('SGPT')).toBe('alt');
    expect(matchAnalyte('Ferritin')).toBeUndefined();
    expect(normalizeLabUnit('mg/dl', 'scr')).toBe('mg/dL');
    expect(normalizeLabUnit('umol/l', 'scr')).toBe('µmol/L');
    expect(normalizeLabUnit('mg/dL', 'k')).toBeUndefined(); // not a unit potassium is reported in
    expect(normalizeLabUnit('', 'inr')).toBe('unitless');
    expect(normalizeLabUnit('', 'scr')).toBeUndefined();
  });

  it('expands error-prone abbreviations but flags them (ISMP)', () => {
    expect(mapFrequency('BID')).toEqual({ value: 'twice daily' });
    expect(mapFrequency('OD')).toEqual({ value: 'once daily', abbreviation: true });
    expect(mapFrequency('q8h')).toEqual({ value: 'every 8 hours' });
    expect(mapRoute('s/c')).toEqual({ value: 'subcut', abbreviation: true });
    expect(mapRoute('Oral')).toEqual({ value: 'PO' });
    expect(mapRoute('intravitreal')).toBeUndefined();
    expect(mapDoseUnit('µg')).toEqual({ value: 'mcg', abbreviation: true });
    expect(mapDoseUnit('IU')).toEqual({ value: 'units', abbreviation: true });
    expect(mapDoseUnit('mg')).toEqual({ value: 'mg' });
  });

  it('never reads a comma as a decimal point or a qualified value as a number', () => {
    expect(parsePrintedNumber('2.1')).toEqual({ ok: true, value: 2.1 });
    expect(parsePrintedNumber('2,1')).toEqual({ ok: false, reason: 'comma' });
    expect(parsePrintedNumber('<0.5')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseBloodPressure('120/80')).toEqual({ systolic: 120, diastolic: 80 });
    expect(parseBloodPressure('120')).toBeUndefined();
  });
});

describe('the last check before sending', () => {
  it('turns calendar dates into hospital days, in every common format', () => {
    const t = datesToHospitalDays('Admitted 13/10/2026. Labs 16-10-26 and 2026-10-12, review 16 Oct 2026, scan ١٦/١٠/٢٠٢٦, bad 31/02/2026.', '2026-10-13');
    expect(t.text).toBe('Admitted Day 0. Labs Day 3 and Day -1, review Day 3, scan Day 3, bad [date].');
    expect(t.replaced).toBe(6);
    expect(datesToHospitalDays('BP 120/80, 1/2 tablet', '2026-10-13').replaced).toBe(0);
  });

  it('masks what still looks like an identifier, and reads days back from images', () => {
    const d = deidentifyForModel('Patient name: Saleh Qaid\nSaleh had fever on 14/10/2026. Call 777 123 456.', '2026-10-13', CTX.known);
    expect(d.text).not.toMatch(/Saleh|777 123 456|14\/10/);
    expect(d.text).toContain('Day 1');
    expect(d.identifiersMasked).toBeGreaterThanOrEqual(3);
    expect(dateTextToHospitalDay('Day 4', '2026-10-13')).toBe(4);
    expect(dateTextToHospitalDay('15/10/2026', '2026-10-13')).toBe(2);
    expect(dateTextToHospitalDay('yesterday', '2026-10-13')).toBeUndefined();
  });
});

describe('from a reading to a draft', () => {
  it('turns a clear lab result into the same values a typed entry has', () => {
    const c = toCandidate(item({ name: 'S.Cr', valueText: '2.1', unit: 'mg/dl', dateText: 'Day 3', rawText: 'S.Cr 2.1 mg/dl' }), 0, CTX);
    expect(c.target).toEqual({ kind: 'entry', type: 'lab' });
    expect(c.values).toEqual({ analyte: 'scr', resultKind: 'numeric', value: '2.1', unit: 'mg/dL' });
    expect(c.day).toBe(3);
    expect(c.flags).toEqual([]);
    expect(checkCandidate(c)).toEqual({});
    expect(needsLook(c)).toBe(false);
  });

  it('flags implausible values, unknown units and unknown tests instead of correcting them', () => {
    const k = toCandidate(item({ name: 'K', valueText: '55', unit: 'mmol/L', dateText: 'Day 1' }), 0, CTX);
    expect(k.flags).toContain('out_of_range'); // a lost decimal point, most likely — the trainee checks
    const unit = toCandidate(item({ name: 'Creatinine', valueText: '2.1', unit: 'mg/xx', dateText: 'Day 1' }), 0, CTX);
    expect(unit.flags).toContain('unit_unknown');
    expect(checkCandidate(unit)).toHaveProperty('unit');
    const unknown = toCandidate(item({ name: 'Ferritin', valueText: '300', unit: 'ng/mL', dateText: 'Day 1' }), 0, CTX);
    expect(unknown.values).toMatchObject({ analyte: 'other', analyteOther: 'Ferritin' });
    expect(unknown.flags).toContain('name_unmatched');
  });

  it('returns an illegible dose as empty, never guessed — whatever the model sent', () => {
    const c = toCandidate(
      item({ kind: 'medication', medContext: 'inpatient', name: 'Enoxaparin', dose: '80', doseUnit: 'mg', route: 'sc', frequency: 'bid', legibility: 'illegible', handwritten: true, dateText: 'Day 1' }),
      0,
      CTX,
    );
    expect(c.values.doseValue).toBeUndefined();
    expect(c.values.doseText).toBeUndefined();
    expect(c.flags).toEqual(expect.arrayContaining(['illegible', 'handwritten_dose', 'abbreviation']));
    expect(checkCandidate(c)).toHaveProperty('doseValue'); // cannot be confirmed without entering the dose
  });

  it('sends home and discharge medicines to their lists, with the choices left to the trainee', () => {
    const home = toCandidate(item({ kind: 'medication', medContext: 'home', name: 'Amlodipine', dose: '5', doseUnit: 'mg', route: 'PO', frequency: 'once daily' }), 0, { ...CTX, docType: 'admission_note' });
    expect(home.target).toEqual({ kind: 'register', register: 'home_med' });
    expect(home.values).toEqual({ drug: 'Amlodipine', regimen: '5 mg PO once daily', sources: 'record', admissionStatus: 'not_reviewed' });
    expect(checkCandidate(home)).toEqual({});
    const dc = toCandidate(item({ kind: 'medication', medContext: 'discharge', name: 'Amoxicillin', dose: '500', doseUnit: 'mg', route: 'PO', frequency: 'tid' }), 0, CTX);
    expect(dc.flags).toContain('needs_choice');
    expect(checkCandidate(dc)).toHaveProperty('change'); // new, changed or unchanged: the trainee says
  });

  it('masks identifiers that come back in the output', () => {
    const c = toCandidate(item({ kind: 'history', category: 'hpi', detail: 'Saleh Qaid reports cough', rawText: 'Saleh Qaid reports cough', dateText: 'Day 0' }), 0, CTX);
    expect(c.values.text).not.toContain('Saleh');
    expect(c.rawText).not.toContain('Saleh');
    expect(c.flags).toContain('identifier_in_output');
  });

  it('asks rather than assumes: problem acuity, social history, culture status', () => {
    expect(toCandidate(item({ kind: 'problem', name: 'Pneumonia', dateText: 'Day 0' }), 0, CTX).flags).toContain('needs_choice');
    const social = toCandidate(item({ kind: 'social', khat: 'current', tobacco: null, dateText: 'Day 0' }), 0, CTX);
    expect(social.flags).toContain('needs_choice');
    expect(checkCandidate(social)).toHaveProperty('tobacco');
    const culture = toCandidate(item({ kind: 'culture', name: 'Blood', status: 'No growth after 48 hours', dateText: 'Day 2' }), 0, CTX);
    expect(culture.values).toMatchObject({ specimen: 'blood', status: 'no_growth' });
    expect(checkCandidate(culture)).toEqual({});
  });

  it('uses the document’s hospital day only when the item has none, and says so', () => {
    const c = toCandidate(item({ name: 'Hb', valueText: '9.8', unit: 'g/dL' }), 0, { ...CTX, docDay: 2 });
    expect(c.day).toBe(2);
    expect(c.flags).toContain('day_from_document');
    const none = toCandidate(item({ name: 'Hb', valueText: '9.8', unit: 'g/dL' }), 0, CTX);
    expect(none.flags).toContain('no_day');
    expect(checkCandidate(none)).toHaveProperty('hospitalDay');
  });
});

describe('two readings', () => {
  const med = (dose: string, i = 0): Candidate =>
    toCandidate(item({ kind: 'medication', medContext: 'inpatient', name: 'Vancomycin', dose, doseUnit: 'mg', route: 'IV', frequency: 'q12h', dateText: 'Day 1' }), i, CTX);

  it('are required for medication pages and handwriting', () => {
    expect(needsSecondPass('medication_chart', [])).toBe(true);
    expect(needsSecondPass('lab_report', [toCandidate(item({ name: 'Hb', valueText: '9', unit: 'g/dL', handwritten: true }), 0, CTX)])).toBe(true);
    expect(needsSecondPass('lab_report', [toCandidate(item({ name: 'Hb', valueText: '9', unit: 'g/dL' }), 0, CTX)])).toBe(false);
  });

  it('flag every disagreement, and anything only one reading found', () => {
    const same = mergePasses([med('1000')], [med('1000')]);
    expect(same[0]!.flags).not.toContain('dual_pass_disagreement');
    const diff = mergePasses([med('1000')], [med('100')]);
    expect(diff[0]!.flags).toContain('dual_pass_disagreement');
    expect(diff[0]!.alternative).toContain('100');
    const missing = mergePasses([med('1000')], []);
    expect(missing[0]!.flags).toContain('single_pass');
    const extra = mergePasses([], [med('1000')]);
    expect(extra).toHaveLength(1);
    expect(extra[0]!.flags).toContain('single_pass');
  });
});

describe('RxNorm matching', () => {
  const answer = { approximateGroup: { inputTerm: null, candidate: [{ rxcui: '17767', rxaui: '1', score: '100', rank: '1', name: 'amlodipine', source: 'RXNORM' }] } };

  it('reads the approximate-match answer', () => {
    expect(readApproximateTerm('Amlodipine', answer)).toEqual({ status: 'matched', rxcui: '17767', name: 'amlodipine' });
    expect(readApproximateTerm('Zzxq', { approximateGroup: { candidate: [] } })).toEqual({ status: 'unmatched' });
    expect(readApproximateTerm('Augmentin', { approximateGroup: { candidate: [{ rxcui: '1', rank: '1', source: 'MTHSPL' }] } })).toEqual({ status: 'unmatched' });
  });

  it('looks a name up once, and says "not checked" when offline or unreachable', async () => {
    const { store } = await newSession();
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response(JSON.stringify(answer), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await rxnormMatch('Amlodipine', { store, fetch: f, online: () => true })).toMatchObject({ status: 'matched' });
    expect(await rxnormMatch('amlodipine ', { store, fetch: f, online: () => true })).toMatchObject({ status: 'matched' });
    expect(calls).toBe(1);
    expect(await rxnormMatch('Metformin', { store, fetch: f, online: () => false })).toEqual({ status: 'not_checked' });
    const down = (async () => {
      throw new TypeError('blocked');
    }) as unknown as typeof fetch;
    expect(await rxnormMatch('Metformin', { store, fetch: down, online: () => true })).toEqual({ status: 'not_checked' });
  });
});

// ---------------------------------------------------------------- end to end, with recorded relay answers

function relay(answers: unknown[]) {
  const requests: { body: Record<string, any> }[] = [];
  const f = (async (_url: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(String(init.body)) });
    const output = answers[Math.min(requests.length - 1, answers.length - 1)];
    return new Response(
      JSON.stringify({ output, usage: { inputTokens: 1000, outputTokens: 400, costUsd: 0.002 }, model: 'model-x', budget: { month: '2026-10', budgetUsd: 5, spentUsd: 0.1 } } satisfies ModelResponse),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  return { f, requests };
}

const offlineRx = (async () => {
  throw new TypeError('blocked');
}) as unknown as typeof fetch;

async function caseWithText(text: string, docType: 'admission_note' | 'medication_chart' = 'admission_note', kind: 'teaching' | 'clinical' = 'clinical') {
  const ctx = await newSession();
  const c = await newCase(ctx.store, { kind, admissionDay0: '2026-10-13', ...(kind === 'clinical' ? { identifiers: { patientName: 'Saleh Qaid', mrn: 'MRN-77120' } } : {}) } as never);
  await ctx.store.updateAiSettings({ models: { extract: 'model-x', analyse: 'model-y' } });
  const a = await ctx.store.addAttachment(c.id, { kind: 'text', docType, origin: 'typed', text, redactionConfirmed: true, hospitalDay: 0 });
  return { ...ctx, c, a };
}

describe('reading a document', () => {
  it('sends only de-identified text, stores the reading, and uses nothing until confirmed', async () => {
    const { store, c, a } = await caseWithText('Saleh Qaid, MRN-77120. Creatinine 2.1 mg/dL on 16/10/2026.');
    const { f, requests } = relay([{ readable: true, items: [{ kind: 'lab', name: 'Creatinine', valueText: '2.1', unit: 'mg/dL', dateText: 'Day 3', rawText: 'Creatinine 2.1 mg/dL', legibility: 'clear', handwritten: false }] }]);
    const run = await readDocument(store, c.id, a.id, { fetch: f, rxFetch: offlineRx, online: () => true });

    const sentText = JSON.stringify(requests[0]!.body.parts);
    expect(sentText).not.toMatch(/Saleh|MRN-77120|16\/10\/2026/);
    expect(sentText).toContain('Day 3');
    expect(requests[0]!.body.caseKind).toBe('clinical');
    expect(run.sent.identifiersMasked).toBeGreaterThanOrEqual(2);
    expect(run.passes).toBe(1);
    expect(run.fields).toHaveLength(1);
    expect(run.fields[0]!.values).toMatchObject({ analyte: 'scr', value: '2.1', unit: 'mg/dL' });

    // Not confirmed yet: nothing in the timeline.
    expect(await store.listEntries(c.id)).toHaveLength(0);

    const { entry } = await store.decideExtractedField(c.id, run.id, 'f1', { kind: 'confirm' });
    expect(entry).toMatchObject({ type: 'lab', hospitalDay: 3, author: 'ai_extracted', provenance: 'confirmed', sourceAttachmentId: a.id, extraction: { runId: run.id, fieldId: 'f1' } });
    expect(await store.listEntries(c.id)).toHaveLength(1);
    await expect(store.decideExtractedField(c.id, run.id, 'f1', { kind: 'reject' })).rejects.toBeInstanceOf(IntegrityError);
    const audit = await store.listAudit(c.id);
    expect(audit.filter((e) => e.entity === 'model_call')).toHaveLength(1);
    expect(audit.some((e) => e.entity === 'extraction' && e.action === 'confirm')).toBe(true);
  });

  it('reads medication pages twice and flags what the readings disagree on', async () => {
    const { store, c, a } = await caseWithText('Vancomycin 1000 mg IV q12h. Ceftriaxone 2 g IV daily.', 'medication_chart', 'teaching');
    const med = (dose: string) => ({ kind: 'medication', medContext: 'inpatient', name: 'Vancomycin', dose, doseUnit: 'mg', route: 'IV', frequency: 'q12h', dateText: 'Day 0', rawText: `Vancomycin ${dose} mg IV q12h`, legibility: 'clear', handwritten: false });
    const cef = { kind: 'medication', medContext: 'inpatient', name: 'Ceftriaxone', dose: '2', doseUnit: 'g', route: 'IV', frequency: 'daily', dateText: 'Day 0', rawText: 'Ceftriaxone 2 g IV daily', legibility: 'clear', handwritten: false };
    const { f, requests } = relay([
      { readable: true, items: [med('1000'), cef] },
      { readable: true, items: [med('100'), cef] },
    ]);
    const run = await readDocument(store, c.id, a.id, { fetch: f, rxFetch: offlineRx, online: () => true });
    expect(requests).toHaveLength(2);
    expect(requests[1]!.body.temperature).toBeGreaterThan(0);
    expect(run.passes).toBe(2);
    const vanc = run.fields.find((x) => x.values.drug === 'Vancomycin')!;
    expect(vanc.flags).toContain('dual_pass_disagreement');
    expect(vanc.flags).toContain('drug_not_checked'); // RxNav unreachable: said so, not assumed
    const ceftriaxone = run.fields.find((x) => x.values.drug === 'Ceftriaxone')!;
    expect(ceftriaxone.flags).not.toContain('dual_pass_disagreement');
    expect(run.usage.costUsd).toBeCloseTo(0.004, 9);
  });

  it('records corrections and rejections, and refuses to confirm what fails validation', async () => {
    const { store, c, a } = await caseWithText('Problem list: pneumonia. Home: amlodipine 5 mg PO daily.');
    const { f } = relay([
      {
        readable: true,
        items: [
          { kind: 'problem', name: 'Pneumonia', dateText: 'Day 0', rawText: 'pneumonia', legibility: 'clear', handwritten: false },
          { kind: 'medication', medContext: 'home', name: 'Amlodipine', dose: '5', doseUnit: 'mg', route: 'PO', frequency: 'daily', rawText: 'amlodipine 5 mg PO daily', legibility: 'clear', handwritten: false },
          { kind: 'lab', name: 'Hb', valueText: '9.8', unit: 'g/dL', dateText: 'Day 0', rawText: 'Hb 9.8', legibility: 'clear', handwritten: false },
        ],
      },
    ]);
    const run = await readDocument(store, c.id, a.id, { fetch: f, rxFetch: offlineRx, online: () => true });
    // The problem needs acuity and status first.
    await expect(store.decideExtractedField(c.id, run.id, 'f1', { kind: 'confirm' })).rejects.toBeInstanceOf(ValidationError);
    const p = run.fields[0]!;
    const fixed = await store.decideExtractedField(c.id, run.id, 'f1', { kind: 'correct', values: { ...p.values, acuity: 'acute', status: 'active' }, day: p.day });
    expect(fixed.entry).toMatchObject({ type: 'note', provenance: 'confirmed', payload: { category: 'problem', name: 'Pneumonia', acuity: 'acute' } });
    // The home medicine becomes a row of the pre-admission list, linked to its source.
    const home = await store.decideExtractedField(c.id, run.id, 'f2', { kind: 'confirm' });
    expect(home.item).toMatchObject({ register: 'home_med', fields: { drug: 'Amlodipine', regimen: '5 mg PO once daily' }, origin: { kind: 'extraction', runId: run.id, fieldId: 'f2', attachmentId: a.id } });
    // A rejection creates nothing.
    const rejected = await store.decideExtractedField(c.id, run.id, 'f3', { kind: 'reject', reason: 'Not this admission' });
    expect(rejected.entry).toBeUndefined();
    const latest = (await store.listExtractions(c.id))[0]!;
    expect(latest.version).toBe(4);
    expect(latest.fields.map((x) => x.decision?.kind)).toEqual(['corrected', 'confirmed', 'rejected']);
    expect(latest.fields[2]!.decision?.reason).toBe('Not this admission');
    expect(await store.listEntries(c.id)).toHaveLength(1);
    expect(await store.listItems(c.id)).toHaveLength(1);
  });
});

describe('finding what was read in the stored document', () => {
  it('finds the exact text, or the longest part of it when a date was sent as a hospital day', () => {
    const body = 'Admitted 13/10/2026 with fever, productive cough and confusion for 3 days.';
    expect(locate(body, 'fever, productive cough')).toEqual([25, 48]);
    const [a, b] = locate(body, 'Admitted Day 0 with fever, productive cough and confusion for 3 days.')!;
    expect(body.slice(a, b)).toBe('with fever, productive cough and confusion for 3 days.');
    expect(locate(body, 'not in the document at all')).toBeUndefined();
  });
});

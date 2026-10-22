/**
 * M6: the export of the department form. It is built from the form's own
 * view, refused (with reasons) while anything shown is unverified, never
 * carries what the form leaves out, writes no identifier of a Clinical Case
 * until the release gate is met, and is recorded in the audit log by its hash.
 */
import { describe, expect, it } from 'vitest';
import { buildExport, documentText, exportBlockers, hashDocument, type ExportOptions } from '../../src/domain/form/export';
import { deriveForm, type FormView } from '../../src/domain/form/derive';
import type { Case, CaseIdentifiers } from '../../src/domain/types';
import { newCase, newSession } from './helpers';

const kase = (kind: 'teaching' | 'clinical'): Case => ({
  id: 'CASE-1234',
  kind,
  rotationId: 'r',
  deidentified: true,
  demographics: { ageYears: 64, sex: 'M' },
  admissionDay0: '2026-10-10',
  status: 'active',
  createdAt: '2026-10-10T08:00:00Z',
  version: 1,
  versionCreatedAt: '2026-10-10T08:00:00Z',
});
const ids: CaseIdentifiers = { caseId: 'CASE-1234', patientName: 'Synthetic Patient Gamma', mrn: 'MRN-4242', roomBed: 'Bed 12', consultantName: 'Dr Synthetic Consultant', version: 1, versionCreatedAt: '2026-10-10T08:00:00Z' };
const OPTS: ExportOptions = { pendingExtractions: 0, releaseGateMet: false, caseKind: 'teaching', caseId: 'CASE-1234', today: '2026-10-22', appVersion: '0.6.0' };

const teaching = (): FormView => deriveForm({ case: kase('teaching'), entries: [], mode: 'teaching' });

describe('what the export contains', () => {
  it('is the form: eleven sections in order, the missing items listed, a statement that it replaces no pharmacist, and a content hash', async () => {
    const r = buildExport(teaching(), OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.sections.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(r.doc.missing.length).toBeGreaterThan(0);
    expect(r.doc.statement.join(' ')).toMatch(/does not replace a clinical pharmacist/);
    expect(r.doc.statement.join(' ')).toMatch(/sent nothing to the care team/);
    const h1 = await hashDocument(r.doc);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // The hash changes with the content.
    const changed = { ...r.doc, sections: r.doc.sections.map((s, i) => (i === 0 ? { ...s, lines: [{ ...s.lines[0]!, text: 'other' }, ...s.lines.slice(1)] } : s)) };
    expect(await hashDocument(changed)).not.toBe(h1);
    // The date and the signature of the supervisor are lines to fill by hand, never typed.
    const s11 = r.doc.sections[10]!;
    expect(s11.lines.find((l) => l.label.en === 'Date')!.text).toBe('');
    expect(s11.lines.find((l) => l.label.en === 'Supervisor signature')!.text).toBe('');
    expect(documentText(r.doc)).toContain('Clinical Pharmacy Assessment and Medication Review Form');
  });

  it('the Teaching copy of a Clinical Case holds no identifier; the Ward copy is refused until the release gate is met', () => {
    const view = deriveForm({ case: kase('clinical'), identifiers: ids, entries: [], mode: 'teaching' });
    const r = buildExport(view, { ...OPTS, caseKind: 'clinical' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = documentText(r.doc);
    for (const secret of ['Synthetic Patient Gamma', 'MRN-4242', 'Bed 12', 'Dr Synthetic Consultant', '2026-10-10']) expect(text).not.toContain(secret);
    const ward = deriveForm({ case: kase('clinical'), identifiers: ids, entries: [], mode: 'ward' });
    expect(exportBlockers(ward, { ...OPTS, caseKind: 'clinical' })).toEqual([{ code: 'ward_copy_not_allowed', why: 'release_gate' }]);
    // Met, the Ward copy may carry them.
    const open = buildExport(ward, { ...OPTS, caseKind: 'clinical', releaseGateMet: true });
    expect(open.ok && documentText(open.doc)).toContain('Synthetic Patient Gamma');
    // A Teaching Case has no Ward copy at all.
    expect(exportBlockers(deriveForm({ case: kase('teaching'), entries: [], mode: 'ward' }), OPTS)).toEqual([]); // deriveForm forces the Teaching copy for a Teaching Case
  });
});

describe('refused while anything is unverified', () => {
  it('values still waiting to be confirmed, a value read by the model, a model suggestion with no decision', () => {
    const view = teaching();
    expect(exportBlockers(view, { ...OPTS, pendingExtractions: 3 })).toEqual([{ code: 'pending_extraction', n: 3 }]);
    for (const provenance of ['extracted_unverified', 'ai_suggestion'] as const) {
      const bad: FormView = {
        ...view,
        sections: view.sections.map((s) => (s.number === 2 ? { ...s, fields: s.fields.map((f, i) => (i === 0 ? { ...f, state: { kind: 'value' as const, items: [{ text: 'cough', provenance }] } } : f)) } : s)),
      };
      const b = exportBlockers(bad, OPTS);
      expect(b).toEqual([expect.objectContaining({ code: 'unverified_value', section: 2, provenance })]);
      expect(buildExport(bad, OPTS)).toMatchObject({ ok: false });
    }
  });

  it('a calculation out of date, a data conflict, and a Problem Card held back for evidence, review, verification or a stale re-analysis — but not a rejected card', () => {
    const view = teaching();
    const withNote = (note: 'calc_out_of_date' | 'nkda_conflict'): FormView => ({
      ...view,
      sections: view.sections.map((s) => (s.number === 1 ? { ...s, fields: s.fields.map((f, i) => (i === 0 ? { ...f, state: { kind: 'value' as const, items: [{ text: '60' }], notes: [note] } } : f)) } : s)),
    });
    expect(exportBlockers(withNote('calc_out_of_date'), OPTS)).toEqual([{ code: 'calc_out_of_date', section: 1 }]);
    expect(exportBlockers(withNote('nkda_conflict'), OPTS)[0]).toMatchObject({ code: 'data_conflict' });
    const held = (reason: 'stale' | 'needs_evidence' | 'needs_senior_review' | 'undecided' | 'claims_not_verified' | 'untraced_dose' | 'classification' | 'rejected' | 'not_final' | 'no_recommendation'): FormView => ({
      ...view,
      sections: view.sections.map((s) => (s.number === 9 ? { ...s, excluded: [{ itemId: 'i1', problem: 'Metformin in AKI', reason }] } : s)),
    });
    for (const r of ['stale', 'needs_evidence', 'needs_senior_review', 'undecided', 'claims_not_verified', 'untraced_dose', 'classification'] as const) {
      expect(exportBlockers(held(r), OPTS)).toEqual([{ code: 'excluded_card', section: 9, problem: 'Metformin in AKI', reason: r }]);
    }
    for (const r of ['rejected', 'not_final', 'no_recommendation'] as const) expect(exportBlockers(held(r), OPTS)).toEqual([]);
  });
});

describe('in the store', () => {
  it('counts the values read by the model that nobody has decided on, and records an export by its hash alone', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    expect(await store.pendingExtractionCount(c.id)).toBe(0);
    await store.recordFormExport(c.id, { copy: 'teaching', sections: 11, missing: 7, hash: 'a'.repeat(64), as: 'pdf' });
    const audit = (await store.listAudit()).filter((e) => e.entity === 'form_export');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.diff).toEqual({ copy: 'teaching', sections: 11, missing: 7, hash: 'a'.repeat(64), as: 'pdf' });
    expect(audit[0]!.caseId).toBe(c.id);
  });
});

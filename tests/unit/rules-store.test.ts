/**
 * Rules-engine records in the store: acknowledgements always carry a reason
 * and cover one data version; firings are recorded once per key and data;
 * causality questionnaires are versioned and scored in the store; reference
 * tables (formulary, adjustments, thresholds) are versioned and audited.
 */
import { describe, expect, it } from 'vitest';
import { AppendOnlyViolationError } from '../../src/store/db';
import { newCase, newSession } from './helpers';

async function setup() {
  const ctx = await newSession();
  const c = await newCase(ctx.store);
  return { ...ctx, c };
}

const alert = { key: 'allergy:e1|course:m1', ruleId: 'allergy' as const, level: 'critical' as const, dataHash: 'abc123' };

describe('alert acknowledgements and firings', () => {
  it('an acknowledgement requires a reason, is audited and cannot be changed', async () => {
    const { store, db, c } = await setup();
    await expect(store.acknowledgeAlert(c.id, alert, '  ')).rejects.toMatchObject({ errors: { reason: 'required' } });
    const ack = await store.acknowledgeAlert(c.id, alert, 'Tolerated amoxicillin last year; team informed');
    expect(ack).toMatchObject({ key: alert.key, dataHash: 'abc123', reason: 'Tolerated amoxicillin last year; team informed' });
    expect((await store.listAlertAcks(c.id)).map((a) => a.id)).toEqual([ack.id]);
    const audit = (await store.listAudit(c.id)).find((e) => e.entity === 'alert');
    expect(audit).toMatchObject({ action: 'acknowledge', entityId: alert.key });
    const row = (await db.alertAcks.toArray())[0]!;
    await expect(db.alertAcks.put({ ...row })).rejects.toBeInstanceOf(AppendOnlyViolationError);
  });

  it('records each firing once per key and data hash', async () => {
    const { store, c } = await setup();
    expect(await store.recordAlertFirings(c.id, [alert])).toBe(1);
    expect(await store.recordAlertFirings(c.id, [alert])).toBe(0);
    expect(await store.recordAlertFirings(c.id, [{ ...alert, dataHash: 'changed' }])).toBe(1);
    const { firings } = await store.allAlertRecords();
    expect(firings.map((f) => f.dataHash).sort()).toEqual(['abc123', 'changed']);
  });

  it('two screens recording the same alert at the same moment count it once', async () => {
    const { store, c } = await setup();
    const counts = await Promise.all([store.recordAlertFirings(c.id, [alert]), store.recordAlertFirings(c.id, [alert]), store.recordAlertFirings(c.id, [alert])]);
    expect(counts.sort()).toEqual([0, 0, 1]);
    expect((await store.allAlertRecords()).firings).toHaveLength(1);
  });
});

describe('causality questionnaires on an ADR row', () => {
  it('scores Naranjo in the store, versions a re-assessment, and refuses an incomplete one', async () => {
    const { store, c } = await setup();
    const adr = await store.addItem(c.id, 'adr', { drug: 'vancomycin', reaction: 'Rash over the chest during infusion', severity: 'mild' });
    const answers = { previous: 'yes', after: 'yes', dechallenge: 'yes', rechallenge: 'unknown', alternative: 'no', placebo: 'unknown', toxic: 'unknown', dose: 'unknown', similar: 'unknown', objective: 'unknown' };
    const v1 = await store.saveCausality(c.id, adr.id, 'naranjo', answers);
    expect(v1).toMatchObject({ version: 1, score: 6, category: 'probable' });
    const v2 = await store.saveCausality(c.id, adr.id, 'naranjo', { ...answers, objective: 'yes', rechallenge: 'yes' });
    expect(v2).toMatchObject({ version: 2, score: 9, category: 'definite' });
    await expect(store.saveCausality(c.id, adr.id, 'naranjo', { previous: 'yes' })).rejects.toMatchObject({ errors: { after: 'required' } });
    const umc = await store.saveCausality(c.id, adr.id, 'who_umc', { information: 'pending' });
    expect(umc.category).toBe('conditional');
    // The trainee's own causality field on the row is untouched.
    expect((await store.listItems(c.id)).find((i) => i.id === adr.id)?.fields.causality).toBeUndefined();
    await expect(store.saveCausality(c.id, 'no-such-row', 'naranjo', answers)).rejects.toThrow();
  });
});

describe('reference tables', () => {
  it('formulary items are versioned with a reason and retracted, never deleted', async () => {
    const { store } = await setup();
    const values = { genericName: 'amoxicillin / clavulanate', brandNames: 'Megamox, Hibiotic', availableInHospital: 'yes', highAlert: 'no', sourceNote: 'Hospital formulary 2026', verifiedBy: 'Trainee', verifiedAt: '2026-10-17' };
    const v1 = await store.saveReference('formulary', undefined, values, { rxcui: '617296', ingredients: ['723', '48203'] });
    expect(v1).toMatchObject({ version: 1, brandNames: ['Megamox', 'Hibiotic'], ingredients: ['723', '48203'], status: 'active' });
    await expect(store.saveReference('formulary', v1.id, values)).rejects.toMatchObject({ errors: { reason: 'required' } });
    const v2 = await store.saveReference('formulary', v1.id, { ...values, highAlert: 'yes', highAlertSource: 'Hospital high-alert list' }, { ingredients: ['723', '48203'] }, 'added to the high-alert list');
    expect(v2).toMatchObject({ version: 2, highAlert: true, changeReason: 'added to the high-alert list' });
    const gone = await store.retractReference('formulary', v1.id, 'duplicate entry');
    expect(gone).toMatchObject({ version: 3, status: 'retracted' });
    expect((await store.referenceHistory('formulary', v1.id)).map((x) => x.version)).toEqual([1, 2, 3]);
    const audit = (await store.listAudit()).filter((e) => e.entity === 'formulary').sort((a, b) => (a.at < b.at ? -1 : 1)).map((e) => e.action);
    expect(audit).toEqual(['create', 'update', 'retract']);
  });

  it('validates each table: a high-alert flag needs its source; a renal threshold needs a number; a lab threshold a known unit', async () => {
    const { store } = await setup();
    await expect(store.saveReference('formulary', undefined, { genericName: 'insulin', availableInHospital: 'yes', highAlert: 'yes', sourceNote: 'x', verifiedBy: 'T', verifiedAt: '2026-10-17' })).rejects.toMatchObject({ errors: { highAlertSource: 'required' } });
    await expect(store.saveReference('adjustment', undefined, { drugName: 'enoxaparin', organ: 'renal', measure: 'crcl_cg', below: 'thirty', sourceText: 'x', source: 'y', verifiedBy: 'T', verifiedAt: '2026-10-17' })).rejects.toMatchObject({ errors: { below: 'number' } });
    await expect(store.saveReference('threshold', undefined, { analyte: 'k', unit: 'mg/dL', high: '6', source: 'lab', verifiedBy: 'T', verifiedAt: '2026-10-17' })).rejects.toMatchObject({ errors: { unit: 'unit' } });
    await expect(store.saveReference('threshold', undefined, { analyte: 'k', unit: 'mmol/L', low: '6', high: '2.5', source: 'lab', verifiedBy: 'T', verifiedAt: '2026-10-17' })).rejects.toMatchObject({ errors: { high: 'order' } });
    const ok = await store.saveReference('threshold', undefined, { analyte: 'k', unit: 'mmol/L', low: '2.5', high: '6', source: 'Hospital lab critical values', verifiedBy: 'T', verifiedAt: '2026-10-17' });
    expect(ok).toMatchObject({ analyte: 'k', low: 2.5, high: 6 });
  });

  it('the department’s vancomycin interval table: each band needs a range, an interval or "levels", and its source; versioned and audited', async () => {
    const { store } = await setup();
    const meta = { verifiedBy: 'T', verifiedAt: '2026-10-18' };
    const bad = (values: Record<string, string>) => store.saveReference('vancomycin_interval', undefined, { ...meta, ...values });
    await expect(bad({ action: 'interval', intervalHours: '12', source: 's' })).rejects.toMatchObject({ errors: { crclFrom: 'required' } });
    await expect(bad({ crclFrom: '90', crclBelow: '60', action: 'interval', intervalHours: '12', source: 's' })).rejects.toMatchObject({ errors: { crclBelow: 'order' } });
    await expect(bad({ crclFrom: '60', action: 'interval', source: 's' })).rejects.toMatchObject({ errors: { intervalHours: 'required' } });
    await expect(bad({ crclFrom: '60', action: 'interval', intervalHours: '200', source: 's' })).rejects.toMatchObject({ errors: { intervalHours: 'range' } });
    await expect(bad({ crclFrom: '60', action: 'interval', intervalHours: '0', source: 's' })).rejects.toMatchObject({ errors: { intervalHours: 'range' } });
    await expect(bad({ crclFrom: '60', action: 'sometimes', source: 's' })).rejects.toMatchObject({ errors: { action: 'invalidChoice' } });
    await expect(bad({ crclFrom: '60', action: 'interval', intervalHours: '12' })).rejects.toMatchObject({ errors: { source: 'required' } });
    const open = await bad({ crclFrom: '60', action: 'interval', intervalHours: '12', source: 'Department protocol, p. 4' });
    expect(open).toMatchObject({ crclFrom: 60, action: 'interval', intervalHours: 12, source: 'Department protocol, p. 4', version: 1, status: 'active' });
    expect(open).not.toHaveProperty('crclBelow');
    const levels = await bad({ crclBelow: '20', action: 'levels', intervalHours: '48', source: 'Department protocol, p. 4' });
    expect(levels).toMatchObject({ crclBelow: 20, action: 'levels' });
    expect(levels).not.toHaveProperty('intervalHours'); // no interval is kept for a "dose by levels" band
    const v2 = await store.saveReference('vancomycin_interval', open.id, { ...meta, crclFrom: '50', action: 'interval', intervalHours: '12', source: 'Department protocol 2026, p. 4' }, undefined, 'protocol revised');
    expect(v2).toMatchObject({ version: 2, crclFrom: 50, changeReason: 'protocol revised' });
    const audit = (await store.listAudit()).filter((e) => e.entity === 'vancomycin_interval').map((e) => e.action).sort();
    expect(audit).toEqual(['create', 'create', 'update']);
  });
});

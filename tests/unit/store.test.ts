import { describe, expect, it } from 'vitest';
import { indexTimeline } from '../../src/domain/timeline';
import type { EntryOf, PayloadMap } from '../../src/domain/types';
import { ValidationError } from '../../src/domain/validation';
import { DecryptionError } from '../../src/crypto/crypto';
import { IntegrityError, LockedError } from '../../src/store/store';
import { newCase, newSession, rawDump, ROTATION } from './helpers';

const creatinine = (value: number): PayloadMap['lab'] => ({
  analyte: 'scr',
  analyteName: 'Serum creatinine',
  result: { kind: 'numeric', value },
  unit: 'mg/dL',
});

describe('rotations', () => {
  it('creates and versions a rotation, keeping every version and auditing both', async () => {
    const { store } = await newSession();
    const r1 = await store.createRotation(ROTATION);
    const r2 = await store.updateRotation(r1.id, { ...ROTATION, department: 'icu' }, 'Moved to ICU');
    expect(r2.version).toBe(2);
    expect(r2.createdAt).toBe(r1.createdAt);
    const history = await store.history('rotations', r1.id);
    expect(history.map((r) => (r as typeof r1).department)).toEqual(['internal_medicine', 'icu']);
    expect((await store.listRotations())[0]?.department).toBe('icu');
    const audit = await store.listAudit();
    expect(audit.filter((e) => e.entity === 'rotation').map((e) => e.action).sort()).toEqual(['create', 'update']);
  });

  it('rejects an end date before the start date and a version without a reason', async () => {
    const { store } = await newSession();
    await expect(store.createRotation({ ...ROTATION, endDate: '2026-09-01' })).rejects.toBeInstanceOf(ValidationError);
    const r = await store.createRotation(ROTATION);
    await expect(store.updateRotation(r.id, ROTATION, '  ')).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('cases', () => {
  it('creates a de-identified case with a random CASE id and an audit event', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    expect(c.id).toMatch(/^CASE-\d{4}$/);
    expect(c.deidentified).toBe(true);
    expect(c.status).toBe('active');
    expect(c.version).toBe(1);
    const audit = await store.listAudit(c.id);
    expect(audit.map((e) => [e.entity, e.action])).toContainEqual(['case', 'create']);
  });

  it('never reuses a case id', async () => {
    // A random source that repeats its first value forces a collision on the second case.
    const seq = [0.5, 0.5, 0.25];
    let i = 0;
    const { store } = await newSession({ random: () => seq[Math.min(i++, seq.length - 1)]! });
    const a = await newCase(store);
    const b = await newCase(store);
    expect(a.id).not.toBe(b.id);
  });

  it('refuses invalid demographics, future admission and a missing synthetic-data attestation', async () => {
    const { store } = await newSession();
    const rot = await store.createRotation(ROTATION);
    const base = { kind: 'teaching' as const, rotationId: rot.id, ageYears: 40, sex: 'F' as const, admissionDay0: '2026-10-01', syntheticDataAttested: true };
    await expect(store.createCase({ ...base, ageYears: 140 })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.createCase({ ...base, admissionDay0: '2026-12-01' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.createCase({ ...base, admissionDay0: '2026-02-30' })).rejects.toBeInstanceOf(ValidationError);
    await expect(store.createCase({ ...base, syntheticDataAttested: false })).rejects.toMatchObject({
      errors: { syntheticDataAttested: 'required' },
    });
    await expect(store.createCase({ ...base, rotationId: 'nope' })).rejects.toMatchObject({ errors: { rotationId: 'invalidChoice' } });
  });

  it('keeps identifiers out of the case record and out of the audit log', async () => {
    const { store } = await newSession();
    const c = await newCase(store, {
      kind: 'clinical',
      identifiers: { patientName: 'Synthetic Patient Alpha', mrn: 'MRN-778899', consultantName: 'Dr Synthetic' },
    });
    expect(JSON.stringify(c)).not.toMatch(/Synthetic Patient|MRN-778899|Dr Synthetic/);
    expect(Object.keys(c)).not.toContain('patientName');
    const ids = await store.getIdentifiers(c.id);
    expect(ids).toMatchObject({ patientName: 'Synthetic Patient Alpha', mrn: 'MRN-778899' });
    const audit = JSON.stringify(await store.listAudit());
    expect(audit).not.toMatch(/Synthetic Patient|MRN-778899|Dr Synthetic/);
    expect(audit).toContain('patientName'); // which fields were set is recorded, not their values
  });

  it('refuses identifiers on a Teaching Case', async () => {
    const { store } = await newSession();
    await expect(newCase(store, { kind: 'teaching', identifiers: { patientName: 'X' } })).rejects.toBeInstanceOf(ValidationError);
    const c = await newCase(store, { kind: 'teaching' });
    await expect(store.setIdentifiers(c.id, { mrn: '1' }, 'r')).rejects.toBeInstanceOf(IntegrityError);
    expect(await store.getIdentifiers(c.id)).toBeUndefined();
  });

  it('versions demographic changes and discharge, never overwriting', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    await expect(store.updateCase(c.id, { heightCm: 170 }, '')).rejects.toBeInstanceOf(ValidationError);
    await store.updateCase(c.id, { heightCm: 170 }, 'Measured on the ward');
    await expect(store.updateCase(c.id, { status: 'discharged' }, 'Discharged')).rejects.toMatchObject({
      errors: { dischargeDate: 'required' },
    });
    await expect(
      store.updateCase(c.id, { status: 'discharged', dischargeDate: '2026-10-01' }, 'Discharged'),
    ).rejects.toBeInstanceOf(ValidationError); // before admission
    const d = await store.updateCase(c.id, { status: 'discharged', dischargeDate: '2026-10-12' }, 'Discharged home');
    expect(d.version).toBe(3);
    const history = await store.history('cases', c.id);
    expect(history).toHaveLength(3);
    expect((history[0] as typeof c).demographics.heightCm).toBeUndefined();
    expect((history[2] as typeof c).status).toBe('discharged');
    const updates = (await store.listAudit(c.id)).filter((e) => e.entity === 'case' && e.action === 'update');
    expect(updates).toHaveLength(2);
  });
});

describe('append-only timeline with correction by supersession', () => {
  it('records a manual entry as user_entered with hospital day, unit and audit', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    const e = await store.addEntry(c.id, { type: 'lab', hospitalDay: 2, timeOfDay: '06:30', payload: creatinine(1.4) });
    expect(e).toMatchObject({ provenance: 'user_entered', author: 'user', hospitalDay: 2, unit: 'mg/dL', timeOfDay: '06:30' });
    const audit = await store.listAudit(c.id);
    expect(audit.find((a) => a.entityId === e.id)?.action).toBe('create');
  });

  it('keeps both versions readable after a correction and audits before/after', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    const orig = await store.addEntry(c.id, { type: 'lab', hospitalDay: 2, payload: creatinine(14) });
    const fix = await store.correctEntry(c.id, orig.id, {
      kind: 'amend',
      reason: 'Transcription error: decimal point missed',
      hospitalDay: 2,
      payload: creatinine(1.4),
    });

    const all = await store.listEntries(c.id);
    expect(all).toHaveLength(2);
    const storedOrig = all.find((x) => x.id === orig.id)!;
    expect(storedOrig).toEqual(orig); // untouched
    expect((storedOrig as EntryOf<'lab'>).payload.result).toEqual({ kind: 'numeric', value: 14 });
    expect(fix.supersedesEntryId).toBe(orig.id);
    expect(fix.correction).toEqual({ kind: 'amend', reason: 'Transcription error: decimal point missed' });

    const idx = indexTimeline(all);
    expect(idx.current.map((x) => x.id)).toEqual([fix.id]);
    expect(idx.chainOf(orig.id).map((x) => x.id)).toEqual([orig.id, fix.id]);

    const ev = (await store.listAudit(c.id)).find((a) => a.action === 'correct')!;
    expect(ev.diff).toMatchObject({
      supersedesEntryId: orig.id,
      before: { payload: { result: { value: 14 } } },
      after: { payload: { result: { value: 1.4 } } },
    });
  });

  it('allows only one correction per entry, and corrections of corrections', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    const orig = await store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: creatinine(2) });
    const fix1 = await store.correctEntry(c.id, orig.id, { kind: 'amend', reason: 'r1', hospitalDay: 1, payload: creatinine(2.1) });
    await expect(
      store.correctEntry(c.id, orig.id, { kind: 'amend', reason: 'r2', hospitalDay: 1, payload: creatinine(2.2) }),
    ).rejects.toBeInstanceOf(IntegrityError);
    const fix2 = await store.correctEntry(c.id, fix1.id, { kind: 'amend', reason: 'r2', hospitalDay: 1, payload: creatinine(2.2) });
    const idx = indexTimeline(await store.listEntries(c.id));
    expect(idx.current.map((e) => e.id)).toEqual([fix2.id]);
    expect(idx.chainOf(orig.id)).toHaveLength(3);
  });

  it('retracts an entry entered in error while keeping it readable', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    const orig = await store.addEntry(c.id, { type: 'weight', hospitalDay: 0, payload: { value: 70, unit: 'kg', method: 'stated' } });
    await expect(store.correctEntry(c.id, orig.id, { kind: 'retract', reason: '' })).rejects.toBeInstanceOf(ValidationError);
    const r = await store.correctEntry(c.id, orig.id, { kind: 'retract', reason: 'Entered on the wrong case' });
    expect(r.payload).toEqual(orig.payload);
    const all = await store.listEntries(c.id);
    expect(all).toHaveLength(2);
    expect(indexTimeline(all).current).toHaveLength(0);
    expect((await store.listAudit(c.id)).some((a) => a.action === 'retract')).toBe(true);
  });

  it('refuses to correct an entry from another case or to move it to another medication course', async () => {
    const { store } = await newSession();
    const a = await newCase(store);
    const b = await newCase(store);
    const e = await store.addEntry(a.id, { type: 'lab', hospitalDay: 1, payload: creatinine(1) });
    await expect(
      store.correctEntry(b.id, e.id, { kind: 'amend', reason: 'x', hospitalDay: 1, payload: creatinine(2) }),
    ).rejects.toBeInstanceOf(IntegrityError);

    const start = await store.addEntry(a.id, {
      type: 'med_start',
      hospitalDay: 0,
      payload: { medId: 'm1', drug: 'vancomycin', dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'every 12 hours' },
    });
    await expect(
      store.correctEntry(a.id, start.id, {
        kind: 'amend',
        reason: 'x',
        hospitalDay: 0,
        payload: { medId: 'm2', drug: 'vancomycin', dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'every 12 hours' },
      }),
    ).rejects.toBeInstanceOf(IntegrityError);
  });

  it('only changes or stops an existing, active medication course', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    await expect(
      store.addEntry(c.id, { type: 'med_stop', hospitalDay: 1, payload: { medId: 'ghost', drug: 'x' } }),
    ).rejects.toBeInstanceOf(IntegrityError);
    await store.addEntry(c.id, {
      type: 'med_start',
      hospitalDay: 0,
      payload: { medId: 'm1', drug: 'ceftriaxone', dose: { kind: 'structured', value: 2, unit: 'g' }, route: 'IV', frequency: 'once daily' },
    });
    await store.addEntry(c.id, { type: 'med_stop', hospitalDay: 3, payload: { medId: 'm1', drug: 'ceftriaxone' } });
    await expect(
      store.addEntry(c.id, { type: 'med_change', hospitalDay: 4, payload: { medId: 'm1', drug: 'ceftriaxone', frequency: 'twice daily' } }),
    ).rejects.toBeInstanceOf(IntegrityError);
  });

  it('refuses entry types that M1 does not create, invalid days, and writes to archived cases', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    await expect(
      store.addEntry(c.id, { type: 'intervention', hospitalDay: 1, payload: { description: 'x', by: 'y', at: 'z' } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(store.addEntry(c.id, { type: 'lab', hospitalDay: 1.5, payload: creatinine(1) })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      store.addEntry(c.id, { type: 'lab', hospitalDay: 1, timeOfDay: '25:00', payload: creatinine(1) }),
    ).rejects.toBeInstanceOf(ValidationError);
    await store.updateCase(c.id, { status: 'archived' }, 'Rotation finished');
    await expect(store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: creatinine(1) })).rejects.toBeInstanceOf(IntegrityError);
  });
});

describe('encryption at rest', () => {
  it('stores no clinical text, identifier or passphrase in plaintext anywhere in IndexedDB', async () => {
    const { db, store } = await newSession();
    const c = await newCase(store, {
      kind: 'clinical',
      identifiers: { patientName: 'Synthetic Patient Alpha', mrn: 'MRN-778899' },
      ward: 'Medical Ward Seven',
    });
    await store.addEntry(c.id, {
      type: 'med_start',
      hospitalDay: 0,
      payload: { medId: 'm1', drug: 'Vancomycinum', dose: { kind: 'structured', value: 1, unit: 'g' }, route: 'IV', frequency: 'every 12 hours', indication: 'Suspected MRSA bacteraemia' },
    });
    await store.addEntry(c.id, { type: 'note', hospitalDay: 0, payload: { category: 'chief_complaint', text: 'Fever and rigors for three days' } });
    await store.saveFormDraft(c.id, { 's5.interp.x': 'Rising creatinine noted' });
    await store.updateTraineeSettings({ traineeName: 'Trainee Name Zeta' });
    const dump = await rawDump(db);
    for (const secret of [
      'Synthetic Patient Alpha',
      'MRN-778899',
      'Medical Ward Seven',
      'Vancomycinum',
      'MRSA',
      'Fever and rigors',
      'Rising creatinine',
      'Trainee Name Zeta',
      'correct horse',
    ]) {
      expect(dump).not.toContain(secret);
    }
  });

  it('detects tampering with a stored row or its plain index fields', async () => {
    const { db, store } = await newSession();
    const c = await newCase(store);
    const e = await store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: creatinine(1) });
    const raw = (await db.timeline.get(e.id))!;
    const flipped = new Uint8Array(raw.ct.slice(0));
    flipped[5] = flipped[5]! ^ 0x01;
    // Bypass Dexie (and its append-only guard) to simulate someone editing the database directly.
    db.close();
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db.name);
      req.onsuccess = () => {
        const tx = req.result.transaction('timeline', 'readwrite');
        tx.objectStore('timeline').put({ ...raw, caseId: 'CASE-0000' }); // moved to another case
        tx.objectStore('timeline').put({ ...raw, id: 'copy', ct: flipped.buffer }); // altered bytes
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    await db.open();
    store.clearCache();
    await expect(store.listEntries('CASE-0000')).rejects.toBeInstanceOf(DecryptionError);
    await expect(store.listEntries(c.id)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('cannot read or write anything while locked', async () => {
    const { session, store } = await newSession();
    const c = await newCase(store);
    await session.lock();
    await expect(store.listCases()).rejects.toBeInstanceOf(LockedError);
    await expect(store.addEntry(c.id, { type: 'lab', hospitalDay: 1, payload: creatinine(1) })).rejects.toBeInstanceOf(LockedError);
  });
});

describe('department form drafts and settings', () => {
  it('versions form drafts and audits the changed fields', async () => {
    const { store } = await newSession();
    const c = await newCase(store);
    await store.saveFormDraft(c.id, { 's6.safety.m1': 'Monitor trough' });
    const v2 = await store.saveFormDraft(c.id, { 's6.safety.m1': 'Monitor AUC', 's6.target.m1': '  ' });
    expect(v2.version).toBe(2);
    expect(v2.fields).toEqual({ 's6.safety.m1': 'Monitor AUC' });
    expect(await store.history('formDrafts', c.id)).toHaveLength(2);
    const ev = (await store.listAudit(c.id)).filter((a) => a.entity === 'form_draft');
    expect(ev[0]?.diff).toEqual({ changed: { 's6.safety.m1': { before: 'Monitor trough', after: 'Monitor AUC' } } });
  });

  it('stores trainee settings encrypted and audits changes', async () => {
    const { store } = await newSession();
    await store.updateTraineeSettings({ traineeName: '  Trainee One ' });
    expect(await store.getTraineeSettings()).toEqual({ traineeName: 'Trainee One' });
    expect((await store.listAudit()).some((a) => a.entity === 'settings')).toBe(true);
  });
});

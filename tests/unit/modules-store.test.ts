import { describe, expect, it } from 'vitest';
import type { RegisterItem, TaskRecord } from '../../src/domain/types';
import { ValidationError } from '../../src/domain/validation';
import { PreceptorDB } from '../../src/store/db';
import { createBackup, restoreBackup } from '../../src/store/backup';
import { Session } from '../../src/store/session';
import { IntegrityError } from '../../src/store/store';
import { FAST_ITERATIONS, newCase, newSession, PASS, rawDump } from './helpers';

/** A minimal JPEG-shaped byte array (SOI marker, then payload) — the store checks the magic number only. */
const jpeg = (marker: string, size = 64): Uint8Array => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  b.set(new TextEncoder().encode(marker), 4);
  return b;
};

const TEXT_SOURCE = 'Admission note (synthetic): 64-year-old man, fever and cough for 3 days. Zanthoxylum-marker-7731.';

async function withCase() {
  const ctx = await newSession();
  const c = await newCase(ctx.store);
  return { ...ctx, c };
}

describe('source documents (the patient file)', () => {
  it('stores a typed source encrypted, only after identifiers were confirmed removed', async () => {
    const { store, db, c } = await withCase();
    const input = { kind: 'text' as const, docType: 'admission_note' as const, origin: 'typed' as const, text: TEXT_SOURCE, hospitalDay: 0 };
    await expect(store.addAttachment(c.id, { ...input, redactionConfirmed: false })).rejects.toMatchObject({ errors: { redactionConfirmed: 'required' } });
    await expect(store.addAttachment(c.id, { ...input, text: '   ', redactionConfirmed: true })).rejects.toMatchObject({ errors: { text: 'required' } });
    await expect(store.addAttachment(c.id, { ...input, docType: 'tea_leaves' as never, redactionConfirmed: true })).rejects.toMatchObject({
      errors: { docType: 'invalidChoice' },
    });

    const a = await store.addAttachment(c.id, { ...input, title: 'Admission note', redactionConfirmed: true });
    expect(a).toMatchObject({ kind: 'text', mime: 'text/plain', docType: 'admission_note', redacted: true, status: 'active', version: 1, hospitalDay: 0 });
    expect(await store.attachmentText(c.id, a.id)).toBe(TEXT_SOURCE);
    expect((await store.listAttachments(c.id)).map((x) => x.id)).toEqual([a.id]);
    // Nothing readable at rest, and the content never enters the audit log.
    expect(await rawDump(db)).not.toContain('Zanthoxylum-marker-7731');
    const audit = await store.listAudit(c.id);
    const ev = audit.find((e) => e.entity === 'attachment' && e.action === 'create');
    expect(ev).toBeDefined();
    expect(JSON.stringify(ev)).not.toContain('Zanthoxylum');
    // Content is bound to its case: asking for it under another case returns nothing.
    expect(await store.attachmentText('CASE-0000', a.id)).toBeUndefined();
  });

  it('stores a redacted image with its thumbnail, and refuses anything that is not a JPEG', async () => {
    const { store, db, c } = await withCase();
    const img = { bytes: jpeg('Quercus-image-4410', 4096), width: 1200, height: 900, thumb: jpeg('thumb', 256) };
    const a = await store.addAttachment(c.id, { kind: 'image', docType: 'lab_report', origin: 'camera', redactionConfirmed: true, image: img, groupId: 'g1', page: 1 });
    expect(a).toMatchObject({ kind: 'image', mime: 'image/jpeg', width: 1200, height: 900, byteLength: 4096, page: 1, groupId: 'g1' });
    expect(await store.attachmentBytes(c.id, a.id)).toEqual(img.bytes);
    expect(await store.attachmentBytes(c.id, a.id, 'thumb')).toEqual(img.thumb);
    expect(await rawDump(db)).not.toContain('Quercus-image-4410');

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await expect(
      store.addAttachment(c.id, { kind: 'image', docType: 'other', origin: 'image_file', redactionConfirmed: true, image: { ...img, bytes: png } }),
    ).rejects.toMatchObject({ errors: { image: 'invalidChoice' } });
    await expect(
      store.addAttachment(c.id, {
        kind: 'image',
        docType: 'other',
        origin: 'image_file',
        redactionConfirmed: true,
        image: { ...img, bytes: jpeg('big', 4 * 1024 * 1024 + 1) },
      }),
    ).rejects.toMatchObject({ errors: { image: 'tooLarge' } });
  });

  it('removes a document by purging its content while keeping its description and the removal on record', async () => {
    const { store, db, c } = await withCase();
    const a = await store.addAttachment(c.id, {
      kind: 'image',
      docType: 'medication_chart',
      origin: 'camera',
      redactionConfirmed: true,
      image: { bytes: jpeg('Bed-12-visible'), width: 10, height: 10, thumb: jpeg('t') },
    });
    await expect(store.removeAttachment(c.id, a.id, ' ')).rejects.toBeInstanceOf(ValidationError);
    const removed = await store.removeAttachment(c.id, a.id, 'The bed number was still readable');
    expect(removed).toMatchObject({ status: 'removed', removedReason: 'The bed number was still readable', version: 2 });
    expect(await store.attachmentBytes(c.id, a.id)).toBeUndefined();
    expect(await store.attachmentBytes(c.id, a.id, 'thumb')).toBeUndefined();
    expect(await db.blobs.where('caseId').equals(c.id).count()).toBe(0);
    // Both versions of the description stay readable; the removal is audited.
    const versions = await store.history('attachments', a.id);
    expect(versions.map((v) => (v as typeof a).status)).toEqual(['active', 'removed']);
    const audit = await store.listAudit(c.id);
    expect(audit.some((e) => e.entity === 'attachment' && e.action === 'remove')).toBe(true);
    await expect(store.removeAttachment(c.id, a.id, 'again')).rejects.toBeInstanceOf(IntegrityError);
  });

  it('links timeline entries to the source they were transcribed from, through corrections too', async () => {
    const { store, c } = await withCase();
    const a = await store.addAttachment(c.id, { kind: 'text', docType: 'lab_report', origin: 'typed', redactionConfirmed: true, text: 'K 5.9' });
    const lab = {
      type: 'lab' as const,
      hospitalDay: 1,
      payload: { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric' as const, value: 5.9 }, unit: 'mmol/L' },
    };
    const e = await store.addEntry(c.id, { ...lab, sourceAttachmentId: a.id });
    expect(e.sourceAttachmentId).toBe(a.id);
    expect(e.provenance).toBe('user_entered');
    const fixed = await store.correctEntry(c.id, e.id, { kind: 'amend', reason: 'Misread', hospitalDay: 1, payload: { ...lab.payload, result: { kind: 'numeric', value: 4.9 } } });
    expect(fixed.sourceAttachmentId).toBe(a.id);

    const other = await newCase(store);
    const b = await store.addAttachment(other.id, { kind: 'text', docType: 'other', origin: 'typed', redactionConfirmed: true, text: 'x' });
    await expect(store.addEntry(c.id, { ...lab, sourceAttachmentId: b.id })).rejects.toBeInstanceOf(IntegrityError);
    await store.removeAttachment(c.id, a.id, 'Wrong patient file');
    await expect(store.addEntry(c.id, { ...lab, sourceAttachmentId: a.id })).rejects.toThrow(/removed/);
  });
});

describe('task worksheets', () => {
  it('versions every save, writes nothing for an unchanged save, and audits what changed', async () => {
    const { store, c } = await withCase();
    const v1 = await store.saveTask(c.id, 't02', { status: 'in_progress', checks: { two_sources: 'ok' }, fields: {} });
    expect(v1).toMatchObject({ caseId: c.id, taskId: 't02', status: 'in_progress', version: 1 });
    const same = await store.saveTask(c.id, 't02', { status: 'in_progress', checks: { two_sources: 'ok' }, fields: {}, notes: '  ' });
    expect(same.version).toBe(1);
    const v2 = await store.saveTask(c.id, 't02', { status: 'done', checks: { two_sources: 'ok', otc_herbal: 'issue' }, fields: {}, notes: 'Herbal tea for diabetes' });
    expect(v2.version).toBe(2);
    expect((await store.taskHistory(c.id, 't02')).map((r) => r.status)).toEqual(['in_progress', 'done']);
    expect((await store.listTasks(c.id)).map((r: TaskRecord) => [r.taskId, r.version])).toEqual([['t02', 2]]);
    const ev = (await store.listAudit(c.id)).filter((e) => e.entity === 'task');
    expect(ev.map((e) => e.action).sort()).toEqual(['create', 'update']);
    const upd = ev.find((e) => e.action === 'update')!.diff as { status: unknown; changed: string[] };
    expect(upd.status).toEqual({ before: 'in_progress', after: 'done' });
    expect(upd.changed).toEqual(['notes', 'otc_herbal']);
  });

  it('refuses invalid worksheets and writes to archived cases', async () => {
    const { store, c } = await withCase();
    await expect(store.saveTask(c.id, 't02', { status: 'not_applicable', checks: {}, fields: {} })).rejects.toMatchObject({ errors: { naReason: 'required' } });
    await expect(store.saveTask(c.id, 't02', { status: 'in_progress', checks: { nope: 'ok' }, fields: {} })).rejects.toBeInstanceOf(ValidationError);
    await store.updateCase(c.id, { status: 'archived' }, 'Rotation finished');
    await expect(store.saveTask(c.id, 't02', { status: 'in_progress', checks: {}, fields: {} })).rejects.toThrow(/archived/);
  });
});

describe('register rows', () => {
  const drp = { problem: 'Enoxaparin dose too high for renal function', category: 'dose_high', evidence: 'SCr 2.4 mg/dL on Day 2', priority: 'critical' };

  it('creates, versions and retracts rows without ever overwriting, encrypted at rest', async () => {
    const { store, db, c } = await withCase();
    await expect(store.addItem(c.id, 'drp', { problem: 'x' })).rejects.toBeInstanceOf(ValidationError);
    const v1 = await store.addItem(c.id, 'drp', drp);
    expect(v1).toMatchObject({ caseId: c.id, register: 'drp', status: 'active', version: 1, fields: drp });
    const unchanged = await store.updateItem(c.id, v1.id, { ...drp, priorityReason: '  ' });
    expect(unchanged.version).toBe(1);
    const v2 = await store.updateItem(c.id, v1.id, { ...drp, recommendation: 'Discuss renal dosing with the team' }, 'Plan added');
    expect(v2).toMatchObject({ version: 2, changeReason: 'Plan added', createdAt: v1.createdAt });
    const hist = await store.itemHistory(v1.id);
    expect(hist.map((h: RegisterItem) => h.fields.recommendation)).toEqual([undefined, 'Discuss renal dosing with the team']);

    await expect(store.retractItem(c.id, v1.id, '')).rejects.toBeInstanceOf(ValidationError);
    const r = await store.retractItem(c.id, v1.id, 'Duplicate of another card');
    expect(r).toMatchObject({ status: 'retracted', version: 3 });
    await expect(store.updateItem(c.id, v1.id, drp)).rejects.toBeInstanceOf(IntegrityError);
    await expect(store.retractItem(c.id, v1.id, 'again')).rejects.toBeInstanceOf(IntegrityError);
    expect((await store.listItems(c.id)).map((i) => i.status)).toEqual(['retracted']);

    expect(await rawDump(db)).not.toMatch(/Enoxaparin|Duplicate of another card/);
    const actions = (await store.listAudit(c.id)).filter((e) => e.entity === 'item').map((e) => e.action).sort();
    expect(actions).toEqual(['create', 'retract', 'update']);
  });

  it('checks references to medication courses and problems against the case', async () => {
    const { store, c } = await withCase();
    const home = { drug: 'metformin', regimen: '500 mg PO twice daily', sources: 'patient|containers' };
    await expect(store.addItem(c.id, 'home_med', { ...home, linkedMedId: 'no-such-course' })).rejects.toMatchObject({ errors: { linkedMedId: 'invalidChoice' } });
    const start = await store.addEntry(c.id, {
      type: 'med_start',
      hospitalDay: 0,
      payload: { medId: 'med-a', drug: 'metformin', dose: { kind: 'structured', value: 500, unit: 'mg' }, route: 'PO', frequency: 'twice daily' },
    });
    expect(start.type).toBe('med_start');
    const row = await store.addItem(c.id, 'home_med', { ...home, linkedMedId: 'med-a', admissionStatus: 'continued', discrepancy: 'none' });
    expect(row.fields.linkedMedId).toBe('med-a');
    await expect(store.addItem(c.id, 'drp', { ...drp, linkedProblemId: 'nope' })).rejects.toMatchObject({ errors: { linkedProblemId: 'invalidChoice' } });
    await expect(store.addItem(c.id, 'telepathy' as never, {})).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('backup of the patient file and the clinical modules', () => {
  it('restores sources, worksheets and register rows exactly', async () => {
    const { session, store, c } = await withCase();
    const a = await store.addAttachment(c.id, { kind: 'text', docType: 'progress_note', origin: 'typed', redactionConfirmed: true, text: TEXT_SOURCE });
    const img = await store.addAttachment(c.id, {
      kind: 'image',
      docType: 'lab_report',
      origin: 'image_file',
      redactionConfirmed: true,
      image: { bytes: jpeg('pixels', 512), width: 4, height: 4, thumb: jpeg('thumb') },
    });
    await store.saveTask(c.id, 't05', { status: 'in_progress', checks: { prioritised: 'ok' }, fields: {} });
    const item = await store.addItem(c.id, 'drp', drpFields());
    const { json } = await createBackup(session);
    expect(json).not.toContain('Zanthoxylum');
    expect(JSON.parse(json).formatVersion).toBe(4);

    const target = new Session(new PreceptorDB(`test-${crypto.randomUUID()}`), {}, FAST_ITERATIONS);
    await target.acknowledgeIntendedUse();
    await restoreBackup(target, json, PASS);
    expect(await target.store.attachmentText(c.id, a.id)).toBe(TEXT_SOURCE);
    expect(await target.store.attachmentBytes(c.id, img.id)).toEqual(await store.attachmentBytes(c.id, img.id));
    expect(await target.store.listAttachments(c.id)).toEqual(await store.listAttachments(c.id));
    expect(await target.store.listTasks(c.id)).toEqual(await store.listTasks(c.id));
    expect(await target.store.itemHistory(item.id)).toEqual(await store.itemHistory(item.id));
  });

  it('still restores a backup made before the clinical modules existed (format 1)', async () => {
    const { session, store, c } = await withCase();
    const file = JSON.parse((await createBackup(session)).json);
    file.formatVersion = 1;
    for (const t of ['attachments', 'blobs', 'tasks', 'items']) delete file.tables[t];
    const target = new Session(new PreceptorDB(`test-${crypto.randomUUID()}`), {}, FAST_ITERATIONS);
    await target.acknowledgeIntendedUse();
    await restoreBackup(target, JSON.stringify(file), PASS);
    expect(await target.store.getCase(c.id)).toEqual(await store.getCase(c.id));
    expect(await target.store.listTasks(c.id)).toEqual([]);
  });
});

function drpFields() {
  return { problem: 'No VTE prophylaxis despite immobility', category: 'additional_therapy', evidence: 'Bed-bound since Day 0', priority: 'important' };
}

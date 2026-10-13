import { describe, expect, it } from 'vitest';
import { DecryptionError, WrongPassphraseError } from '../../src/crypto/crypto';
import { INTENDED_USE_STATEMENT } from '../../src/domain/intendedUse';
import { createBackup, restoreBackup } from '../../src/store/backup';
import { PreceptorDB } from '../../src/store/db';
import { isIdleExpired, Session } from '../../src/store/session';
import { IntegrityError } from '../../src/store/store';
import { FAST_ITERATIONS, newCase, newSession, PASS } from './helpers';

describe('first run, lock and unlock', () => {
  it('requires the intended-use acknowledgement, then a passphrase, then unlocks', async () => {
    const s = new Session(new PreceptorDB(`test-${crypto.randomUUID()}`), {}, FAST_ITERATIONS);
    expect(await s.gateState()).toBe('needs_ack');
    await s.acknowledgeIntendedUse();
    expect(await s.gateState()).toBe('needs_setup');
    await s.setup(PASS);
    expect(await s.gateState()).toBe('unlocked');
    await s.lock();
    expect(await s.gateState()).toBe('locked');
    await expect(s.unlock('not the passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(s.isUnlocked).toBe(false);
    await s.unlock(PASS);
    expect(await s.gateState()).toBe('unlocked');
  });

  it('writes the acknowledgement to the audit log once a key exists', async () => {
    const { store } = await newSession();
    const ev = (await store.listAudit()).filter((e) => e.entity === 'intended_use');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ action: 'acknowledge', entityId: 'v4.0' });
  });

  it('saves registered working drafts before dropping the key', async () => {
    const { session, store } = await newSession();
    session.registerFlusher(() => store.putUiDraft('entry:new', { drug: 'heparin' }));
    await session.lock();
    await session.unlock(PASS);
    expect(await store.getUiDraft('entry:new')).toEqual({ drug: 'heparin' });
  });

  it('decides idle lock from elapsed time', () => {
    expect(isIdleExpired(0, 4 * 60_000, 5)).toBe(false);
    expect(isIdleExpired(0, 5 * 60_000, 5)).toBe(true);
  });

  it('changes the passphrase without re-encrypting or losing data', async () => {
    const { session, store } = await newSession();
    const c = await newCase(store);
    await session.changePassphrase(PASS, 'another long passphrase');
    await session.lock();
    await expect(session.unlock(PASS)).rejects.toBeInstanceOf(WrongPassphraseError);
    await session.unlock('another long passphrase');
    expect((await store.getCase(c.id))?.id).toBe(c.id);
    expect((await store.listAudit()).some((e) => e.action === 'change_passphrase')).toBe(true);
  });

  it('erasing the installation removes everything, including the acknowledgement', async () => {
    const { session, store, db } = await newSession();
    await newCase(store);
    await session.eraseInstallation();
    expect(await session.gateState()).toBe('needs_ack');
    expect(await db.cases.count()).toBe(0);
  });
});

describe('encrypted backup', () => {
  async function populated() {
    const ctx = await newSession();
    const c = await newCase(ctx.store, { kind: 'clinical', identifiers: { patientName: 'Synthetic Patient Beta', mrn: 'MRN-5551' } });
    const e = await ctx.store.addEntry(c.id, {
      type: 'lab',
      hospitalDay: 1,
      payload: { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric', value: 5.9 }, unit: 'mmol/L' },
    });
    await ctx.store.correctEntry(c.id, e.id, {
      kind: 'amend',
      reason: 'Haemolysed sample repeated',
      hospitalDay: 1,
      payload: { analyte: 'k', analyteName: 'Potassium', result: { kind: 'numeric', value: 4.6 }, unit: 'mmol/L' },
    });
    return { ...ctx, c };
  }

  it('contains no plaintext and carries the intended-use statement', async () => {
    const { session } = await populated();
    const { json, filename } = await createBackup(session);
    expect(filename).toMatch(/^preceptor-backup-\d{12}\.json$/);
    expect(json).not.toMatch(/Synthetic Patient Beta|MRN-5551|Potassium|Haemolysed|correct horse/);
    expect(JSON.parse(json).intendedUse).toBe(INTENDED_USE_STATEMENT);
  });

  it('restores into an empty installation only with the right passphrase, including the audit log', async () => {
    const { session, store, c } = await populated();
    // The export's own audit event is written after the snapshot, so compare with the log as it was.
    const originalAudit = await store.listAudit();
    const { json } = await createBackup(session);

    const target = new Session(new PreceptorDB(`test-${crypto.randomUUID()}`), {}, FAST_ITERATIONS);
    await target.acknowledgeIntendedUse();
    await expect(restoreBackup(target, json, 'wrong passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    expect(await target.db.cases.count()).toBe(0);

    await restoreBackup(target, json, PASS);
    expect(target.isUnlocked).toBe(true);
    expect(await target.store.getCase(c.id)).toEqual(await store.getCase(c.id));
    expect(await target.store.getIdentifiers(c.id)).toEqual(await store.getIdentifiers(c.id));
    expect(await target.store.listEntries(c.id)).toEqual(await store.listEntries(c.id));
    const restoredAudit = await target.store.listAudit();
    for (const ev of originalAudit) expect(restoredAudit).toContainEqual(ev);
    expect(restoredAudit.some((e) => e.entity === 'backup' && e.action === 'restore')).toBe(true);

    // The restored installation unlocks with the backup's passphrase.
    await target.lock();
    await target.unlock(PASS);
    expect(await target.gateState()).toBe('unlocked');

    // Restoring again on a non-empty installation is refused.
    const other = await newSession();
    await expect(restoreBackup(other.session, json, PASS)).rejects.toBeInstanceOf(IntegrityError);
  });

  it('rejects a tampered backup without writing anything', async () => {
    const { session } = await populated();
    const file = JSON.parse((await createBackup(session)).json);
    const row = file.tables.timeline[0];
    const ct = row.ct as string;
    row.ct = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    const target = new Session(new PreceptorDB(`test-${crypto.randomUUID()}`), {}, FAST_ITERATIONS);
    await target.acknowledgeIntendedUse();
    await expect(restoreBackup(target, JSON.stringify(file), PASS)).rejects.toBeInstanceOf(DecryptionError);
    expect(await target.db.timeline.count()).toBe(0);
    expect(await target.getKeyMaterial()).toBeUndefined();
    expect(target.isUnlocked).toBe(false);
  });

  it('rejects files that are not PRECEPTOR backups', async () => {
    const target = new Session(new PreceptorDB(`test-${crypto.randomUUID()}`), {}, FAST_ITERATIONS);
    await expect(restoreBackup(target, '{"format":"something-else"}', PASS)).rejects.toThrow(/not a PRECEPTOR backup/);
    await expect(restoreBackup(target, 'not json', PASS)).rejects.toThrow(/not a PRECEPTOR backup/);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APPEND_ONLY_TABLES, PreceptorDB, type EncryptedRow } from '../../src/store/db';

let db: PreceptorDB;
beforeEach(async () => {
  db = new PreceptorDB(`test-${crypto.randomUUID()}`);
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

const row = (id: string, extra: Partial<EncryptedRow> = {}): EncryptedRow => ({
  id,
  iv: new Uint8Array(12),
  ct: new Uint8Array([1, 2, 3]).buffer,
  ...extra,
});

describe('append-only tables', () => {
  for (const name of APPEND_ONLY_TABLES) {
    it(`${name}: allows add, refuses every overwrite or deletion`, async () => {
      const t = db.encryptedTable(name);
      await t.add(row('a', { caseId: 'CASE-1', entityId: 'e', version: 1 }));
      const before = await t.get('a');

      await expect(t.put(row('a'))).rejects.toThrow(/append-only/);
      await expect(t.update('a', { caseId: 'CASE-2' })).rejects.toThrow();
      await expect(t.delete('a')).rejects.toThrow(/append-only/);
      await expect(t.bulkDelete(['a'])).rejects.toThrow();
      await expect(t.bulkPut([row('a')])).rejects.toThrow();
      await expect(t.clear()).rejects.toThrow(/append-only/);
      await expect(t.where('id').equals('a').modify({ caseId: 'X' })).rejects.toThrow();
      await expect(t.where('id').equals('a').delete()).rejects.toThrow();
      // Re-adding the same key cannot overwrite either.
      await expect(t.add(row('a'))).rejects.toMatchObject({ name: 'ConstraintError' });

      expect(await t.get('a')).toEqual(before);
      expect(await t.count()).toBe(1);
    });
  }

  it('lets source content be added or purged by key, but never overwritten or cleared in bulk', async () => {
    await db.blobs.add(row('att-1', { caseId: 'CASE-1' }));
    const before = await db.blobs.get('att-1');
    await expect(db.blobs.put(row('att-1'))).rejects.toThrow(/never overwritten/);
    await expect(db.blobs.update('att-1', { caseId: 'CASE-2' })).rejects.toThrow();
    await expect(db.blobs.clear()).rejects.toThrow(/never overwritten/);
    await expect(db.blobs.add(row('att-1'))).rejects.toMatchObject({ name: 'ConstraintError' });
    expect(await db.blobs.get('att-1')).toEqual(before);
    await db.blobs.delete('att-1');
    expect(await db.blobs.count()).toBe(0);
  });

  it('lets mutable tables (settings, working drafts) be replaced and deleted', async () => {
    await db.settings.add(row('trainee'));
    await db.settings.put(row('trainee', { caseId: 'x' }));
    await db.uiDrafts.put(row('d1'));
    await db.uiDrafts.delete('d1');
    expect(await db.uiDrafts.count()).toBe(0);
    expect((await db.settings.get('trainee'))?.caseId).toBe('x');
  });

  it('allows an entry to be superseded at most once (unique index)', async () => {
    await db.timeline.add(row('orig', { caseId: 'C' }));
    await db.timeline.add(row('fix1', { caseId: 'C', supersedesEntryId: 'orig' }));
    // The store always writes a correction and its audit event in one explicit transaction,
    // so that is the path tested here. (fake-indexeddb, unlike real browsers, keeps a row whose
    // bare add() failed a unique-index check; Chromium was checked to store nothing.)
    await expect(
      db.transaction('rw', db.timeline, db.audit, async () => {
        await db.timeline.add(row('fix2', { caseId: 'C', supersedesEntryId: 'orig' }));
        await db.audit.add(row('audit-for-fix2'));
      }),
    ).rejects.toMatchObject({ name: 'ConstraintError' });
    expect(await db.timeline.get('fix2')).toBeUndefined();
    expect(await db.audit.count()).toBe(0);
    // Entries without supersedesEntryId are unaffected by the unique index.
    await db.timeline.add(row('other', { caseId: 'C' }));
    expect(await db.timeline.count()).toBe(3);
  });
});

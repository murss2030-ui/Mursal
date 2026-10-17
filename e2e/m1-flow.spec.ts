import { expect, test } from '@playwright/test';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';

test('M1 core flow: case, timeline, correction by supersession, audit log and department form', async ({ page, baseURL }) => {
  const watch = watchPage(page);
  await onboard(page);
  await expect(page.getByTestId('disclaimer-footer')).toContainText('not for diagnosis, treatment or patient-care decisions');
  await expect(page.getByTestId('prerelease-banner')).toContainText('synthetic data only');

  await createRotation(page);
  const caseId = await createCase(page, { kind: 'clinical', name: 'Synthetic Patient Alpha', mrn: 'MRN-55501' });

  // The hospital day is never pre-filled: saving without it is refused with the field named.
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('lab');
  await page.getByLabel('Test').selectOption('scr');
  await page.getByLabel('Value', { exact: true }).fill('2,1');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByText('Some fields need attention.')).toBeVisible();
  await expect(page.locator('#root')).toContainText('Use a dot for decimals');
  await expect(page.locator('#root')).toContainText('Required.'); // hospital day and unit

  // A transcription error: 21 instead of 2.1 mg/dL.
  await addCreatinine(page, caseId, '21', '1');
  const entries = page.getByTestId('timeline-entry');
  await expect(entries).toHaveCount(1);
  await expect(entries.first().getByTestId('entry-main')).toHaveText('Serum creatinine: 21 mg/dL');
  await expect(entries.first().locator('[data-provenance="user_entered"]')).toBeVisible();

  // Correct it: the original stays readable and is marked superseded.
  await entries.first().getByRole('link', { name: 'Correct' }).click();
  await expect(page.getByText(/You are correcting the entry from Day 1/)).toBeVisible();
  await page.getByRole('radio', { name: /Amend the values/ }).check();
  await page.getByLabel('Reason for the correction').fill('Transcription error: decimal point missed');
  await page.getByLabel('Value', { exact: true }).fill('2.1');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));

  await expect(entries).toHaveCount(2);
  const superseded = page.locator('[data-testid="timeline-entry"][data-superseded="true"]');
  const current = page.locator('[data-testid="timeline-entry"][data-superseded="false"]');
  await expect(superseded.getByTestId('entry-main')).toHaveText('Serum creatinine: 21 mg/dL');
  await expect(superseded.getByTestId('superseded-note')).toContainText('Superseded by a correction');
  await expect(current.getByTestId('entry-main')).toHaveText('Serum creatinine: 2.1 mg/dL');
  await expect(current.getByTestId('correction-note')).toContainText('Transcription error: decimal point missed');
  await current.getByRole('button', { name: /Show all versions \(2\)/ }).click();
  await expect(current.getByTestId('version-history').locator('li')).toHaveCount(2);

  // The audit log shows the creation and the correction with before/after values.
  await page.goto(`/#/cases/${caseId}/audit`);
  const correction = page.locator('[data-testid="audit-event"][data-action="correct"]');
  await expect(correction).toHaveCount(1);
  await correction.getByText('Details').click();
  await expect(correction.locator('pre')).toContainText('"value": 21');
  await expect(correction.locator('pre')).toContainText('"value": 2.1');
  await expect(correction.locator('pre')).toContainText('Transcription error: decimal point missed');
  await expect(page.locator('[data-testid="audit-event"][data-entity="timeline_entry"][data-action="create"]')).toHaveCount(1);
  // Identifier values are never written to the audit log.
  await expect(page.locator('#root')).not.toContainText('Synthetic Patient Alpha');

  // Department form: Teaching copy is the default and contains no identifiers.
  await page.goto(`/#/cases/${caseId}/form`);
  const form = page.getByTestId('department-form');
  await expect(form.getByRole('radio', { name: /Teaching copy/ })).toHaveAttribute('aria-checked', 'true');
  await expect(form.locator('[data-field="s1.patientName"]')).toContainText(caseId);
  await expect(form).not.toContainText('Synthetic Patient Alpha');
  await expect(form).not.toContainText('MRN-55501');
  await expect(form).not.toContainText('Dr Synthetic Consultant');
  await expect(form.locator('[data-section="5"]')).toContainText('2.1 mg/dL');
  await expect(form.locator('[data-section="5"]')).not.toContainText('21 mg/dL');
  await expect(form.locator('[data-field="s1.bmi"]')).toContainText('not calculated yet');
  await expect(form.getByTestId('missing-list')).toContainText('Allergies and previous ADRs');
  await expect(form.getByTestId('missing-list')).toContainText('Chief complaint');

  // Ward copy shows the identifiers.
  await form.getByRole('radio', { name: /Ward copy/ }).click();
  await expect(form.locator('[data-field="s1.patientName"]')).toContainText('Synthetic Patient Alpha');
  await expect(form.locator('[data-field="s1.mrn"]')).toContainText('MRN-55501');

  // Encryption at rest, checked in the real browser: dump every IndexedDB record (decoding any
  // binary as text) and confirm nothing that was typed is stored in plaintext.
  const dump = await page.evaluate(async () => {
    const dec = new TextDecoder();
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('preceptor');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    let out = '';
    for (const name of Array.from(db.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((res) => {
        const q = db.transaction(name).objectStore(name).getAll();
        q.onsuccess = () => res(q.result);
      });
      for (const row of rows) {
        for (const v of Object.values(row as Record<string, unknown>)) {
          if (v instanceof ArrayBuffer) out += dec.decode(new Uint8Array(v));
          else if (v instanceof Uint8Array) out += dec.decode(v);
          else out += JSON.stringify(v);
        }
      }
    }
    db.close();
    return out;
  });
  expect(dump.length).toBeGreaterThan(1000);
  for (const secret of ['Synthetic Patient Alpha', 'MRN-55501', 'Dr Synthetic Consultant', 'Serum creatinine', 'Transcription error', 'Medical ward B']) {
    expect(dump).not.toContain(secret);
  }

  // No console errors, no CSP violations, and no request ever left this origin.
  expect(watch.errors).toEqual([]);
  const foreign = watch.requests.filter((u) => !u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(foreign).toEqual([]);
});

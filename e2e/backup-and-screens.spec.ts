import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addCreatinine, createCase, createRotation, onboard, PASSPHRASE } from './helpers';

// Set PRECEPTOR_SHOTS_DIR=docs/m1/screenshots to refresh the milestone screenshots deliberately.
const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'test-results/screenshots';

/**
 * A phone-screen capture, exactly what the trainee sees (fixed footer and navigation included).
 * Pass a locator to scroll it into view first; screens without fixed elements may be captured in full.
 */
async function shot(page: Page, name: string, opts: { at?: Locator; full?: boolean } = {}) {
  if (opts.at) await opts.at.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: opts.full ?? false });
}

async function addNote(page: Page, caseId: string, day: string, fill: (p: Page) => Promise<void>) {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('note');
  await page.getByLabel('Hospital day').fill(day);
  await fill(page);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

test('encrypted backup exported from Settings restores into a fresh installation', async ({ page, browser }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '1.2', '1');

  await page.goto('/#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export encrypted backup' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^preceptor-backup-\d{12}\.json$/);
  const path = await download.path();
  const json = readFileSync(path!, 'utf8');
  expect(json).not.toContain('Serum creatinine');
  expect(JSON.parse(json).intendedUse).toContain('It is not intended for diagnosis, treatment, or patient-care decisions.');

  // A different device: fresh browser context with no data.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await other.goto(page.url().split('#')[0]!);
  await other.getByLabel(/I have read and understood the intended use/).check();
  await other.getByRole('button', { name: 'Acknowledge and continue' }).click();
  await other.getByLabel('Backup file').setInputFiles(path!);
  await other.getByLabel('Passphrase of the backup').fill('wrong passphrase!!');
  await other.getByRole('button', { name: 'Restore backup' }).click();
  await expect(other.getByText('Incorrect passphrase.')).toBeVisible();
  await other.getByLabel('Passphrase of the backup').fill(PASSPHRASE);
  await other.getByRole('button', { name: 'Restore backup' }).click();
  await expect(other.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 30_000 });
  await other.goto(`${page.url().split('#')[0]}#/cases/${caseId}`);
  await expect(other.getByTestId('entry-main')).toHaveText('Serum creatinine: 1.2 mg/dL');
  await ctx.close();
});

test('demonstration screenshots of the M1 build (synthetic data)', async ({ page }) => {
  await page.goto('/');
  await shot(page, '01-first-run-intended-use', { full: true });
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'clinical', age: '67', name: 'Synthetic Patient Alpha', mrn: 'MRN-00000' });

  await addNote(page, caseId, '0', async (p) => {
    await p.getByLabel('Kind of note').selectOption('chief_complaint');
    await p.getByLabel('Text', { exact: true }).fill('Fever, productive cough and breathlessness for 3 days (synthetic case)');
  });
  await addNote(page, caseId, '0', async (p) => {
    await p.getByLabel('Kind of note').selectOption('allergy_adr');
    await p.getByRole('radio', { name: 'Allergy', exact: true }).check();
    await p.getByLabel('Drug or substance').fill('Penicillin');
    await p.getByLabel(/^Reaction/).fill('urticaria');
  });
  await addNote(page, caseId, '0', async (p) => {
    await p.getByLabel('Kind of note').selectOption('social_history');
    await p.getByRole('group', { name: /Khat use/ }).getByRole('radio', { name: 'Current' }).check();
    await p.getByLabel(/Khat details/).fill('daily, afternoons');
    await p.getByRole('group', { name: /Tobacco/ }).getByRole('radio', { name: 'Never' }).check();
  });
  await addNote(page, caseId, '0', async (p) => {
    await p.getByLabel('Kind of note').selectOption('problem');
    await p.getByLabel('Problem or diagnosis').fill('Community-acquired pneumonia');
    await p.getByRole('radio', { name: 'Acute', exact: true }).check();
    await p.getByLabel('Status', { exact: true }).selectOption('active');
    await p.getByLabel('This is the primary diagnosis').check();
  });

  // Medication start with a transcription error, then a correction.
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('med_start');
  await page.getByLabel('Hospital day').fill('0');
  await page.getByLabel(/Drug — generic name/).fill('ceftriaxone');
  await page.getByLabel('Amount', { exact: true }).fill('20');
  await page.getByLabel('Dose unit', { exact: true }).selectOption('g');
  await page.getByLabel('Route', { exact: true }).selectOption('IV');
  await page.getByLabel('Frequency', { exact: true }).selectOption('once daily');
  await page.getByLabel(/^Indication/).fill('Community-acquired pneumonia');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
  const medEntry = page.locator('[data-testid="timeline-entry"]', { hasText: 'ceftriaxone' }).first();
  await medEntry.getByRole('link', { name: 'Correct' }).click();
  await page.getByRole('radio', { name: /Amend the values/ }).check();
  await page.getByLabel('Reason for the correction').fill('Transcription error: 2 g, not 20 g');
  await shot(page, '05-correction-editor');
  await page.getByLabel('Amount', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));

  await addCreatinine(page, caseId, '2.1', '1');
  await page.goto(`/#/cases/${caseId}/timeline`);
  await shot(page, '03a-timeline-top');
  await shot(page, '03b-timeline-correction', { at: page.locator('[data-testid="timeline-entry"][data-superseded="true"]') });

  await page.goto('/#/');
  await shot(page, '02-home');

  await page.goto(`/#/cases/${caseId}/form`);
  await expect(page.getByTestId('department-form')).toBeVisible();
  await shot(page, '06a-form-top-missing-list', { at: page.getByTestId('missing-list') });
  await shot(page, '06b-form-section1-teaching-copy', { at: page.locator('[data-field="s1.mrn"]') });
  await page.getByRole('radio', { name: /Ward copy/ }).click();
  await shot(page, '07-form-section1-ward-copy', { at: page.locator('[data-field="s1.mrn"]') });
  await shot(page, '06c-form-section5-6', { at: page.locator('[data-section="5"]') });

  await page.goto(`/#/cases/${caseId}/audit`);
  const corr = page.locator('[data-testid="audit-event"][data-action="correct"]');
  await corr.getByText('Details').click();
  await shot(page, '08-audit-correction-event', { at: corr });

  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.goto(`/#/cases/${caseId}/timeline`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await shot(page, '09-arabic-rtl-timeline');
  await page.getByRole('button', { name: 'English' }).first().click();

  await page.getByRole('button', { name: 'Lock' }).click();
  await shot(page, '10-locked', { full: true });
});

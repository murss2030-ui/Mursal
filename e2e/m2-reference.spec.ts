/**
 * M2 reference tables and causality in the browser: an unrecognised local
 * brand is listed as not checked until the trainee adds it to the
 * formulary, after which the allergy check sees through it; per-rule counts
 * are kept; Naranjo and WHO-UMC questionnaires are scored and kept beside
 * the trainee's own category, never over it; the form and the About screen
 * say plainly which checks could not be made.
 */
import { expect, test, type Page } from '@playwright/test';
import { createCase, createRotation, onboard } from './helpers';

const SHOTS = 'docs/m2/screenshots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

/** Nothing on a phone screen may be wider than the screen (no sideways scrolling, no zoomed-out page). */
async function expectFitsWidth(page: Page) {
  const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(scroll).toBeLessThanOrEqual(client);
}

async function addEntry(page: Page, caseId: string, fill: (p: Page) => Promise<void>) {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await fill(page);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

test('a local brand is not checked until it is in the formulary; then the allergy check sees through it', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('note');
    await p.getByLabel('Hospital day').fill('0');
    await p.getByLabel('Kind of note').selectOption('allergy_adr');
    await p.getByRole('radio', { name: 'Allergy', exact: true }).check();
    await p.getByLabel('Drug or substance').fill('Penicillin');
    await p.getByLabel(/^Reaction/).fill('angioedema');
  });
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('med_start');
    await p.getByLabel('Hospital day').fill('1');
    await p.getByLabel(/Drug — generic name/).fill('Megamox');
    await p.getByLabel('Amount', { exact: true }).fill('1');
    await p.getByLabel('Dose unit', { exact: true }).selectOption('g');
    await p.getByLabel('Route', { exact: true }).selectOption('PO');
    await p.getByLabel('Frequency', { exact: true }).selectOption('twice daily');
  });

  // Not recognised: no alert, and said so on the medication itself.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const row = page.getByTestId('active-med').filter({ hasText: 'Megamox — ' });
  await expect(row.getByTestId('drug-match')).toHaveAttribute('data-status', 'not_checked');
  await expect(row.getByTestId('drug-match')).toContainText('Name not recognised — not checked.');

  // Added to the formulary from there: the brand is carried over, the generic name is the trainee's.
  await row.getByRole('link', { name: 'Add it to your formulary' }).click();
  await expect(page.getByRole('heading', { name: 'New record' })).toBeVisible();
  await expect(page.getByLabel(/^Local brand names/)).toHaveValue('Megamox');
  await page.getByLabel(/^Generic name/).fill('amoxicillin / clavulanate');
  await expect(page.getByTestId('rxnorm-match')).toContainText('Recognised in RxNorm: amoxicillin / clavulanate.');
  await expect(page.getByTestId('rxnorm-match')).toContainText('amoxicillin (RxCUI 723)');
  await page.getByLabel(/^Strengths/).fill('1 g, 625 mg');
  await page.getByLabel(/^Dosage forms/).fill('tablet');
  await page.getByLabel(/^Source note/).fill('Hospital pharmacy stock list, October 2026 (synthetic)');
  await page.getByLabel('Verified by').fill('Trainee A');
  await expectFitsWidth(page);
  await shot(page, 'm2-11-formulary-editor');
  await page.getByTestId('ref-save').click();
  await expect(page).toHaveURL(/#\/reference\/formulary$/);
  await expect(page.getByTestId('ref-row').filter({ hasText: 'amoxicillin / clavulanate' })).toContainText('Megamox');

  // Back in the case: the order now resolves through the formulary, and the documented allergy interrupts.
  await page.goto(`/#/cases/${caseId}/timeline`);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Documented allergy: Penicillin' })).toBeVisible();
  await expect(dialog).toContainText('Megamox');
  await dialog.getByLabel('Reason for continuing').fill('Synthetic test: the order is being changed with the team');
  await dialog.getByRole('button', { name: 'Acknowledge with this reason' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('active-med').filter({ hasText: 'Megamox — ' }).getByTestId('drug-match')).toContainText('From your formulary: ');

  // The per-rule counts: one allergy alert fired and one was acknowledged.
  await page.goto('/#/reference');
  const allergy = page.getByTestId('rule-activity').locator('tr[data-rule="allergy"]');
  await expect(allergy).toContainText('Allergy or previous ADR');
  await expect(allergy.locator('td').nth(1)).toHaveText('1');
  await expect(allergy.locator('td').nth(2)).toHaveText('1');
  await expectFitsWidth(page);
  await shot(page, 'm2-12-reference-hub');

  // Editing a formulary record is a new version with a reason; removing one too.
  await page.goto('/#/reference/formulary');
  await page.getByTestId('ref-row').first().click();
  await page.getByLabel(/^Strengths/).fill('1 g');
  await page.getByTestId('ref-save').click();
  await expect(page.getByLabel('Reason for this change')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Reason for this change').fill('625 mg no longer stocked');
  await page.getByTestId('ref-save').click();
  await expect(page).toHaveURL(/#\/reference\/formulary$/);
  await page.getByTestId('ref-row').first().click();
  await page.getByTestId('ref-history').locator('summary').click();
  await expect(page.getByTestId('ref-history')).toContainText('625 mg no longer stocked');
  await expect(page.getByTestId('ref-history')).toContainText('Version 2');
});

test('a suspected ADR is scored with Naranjo and WHO-UMC, beside the trainee’s own category', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });

  await page.goto(`/#/cases/${caseId}/item/new/adr?task=t07`);
  await page.getByLabel('Suspected drug').fill('vancomycin');
  await page.getByLabel(/^Reaction/).fill('Flushing and pruritus of the upper body during the infusion (synthetic)');
  await page.getByRole('group', { name: 'Severity' }).getByRole('radio', { name: 'Mild' }).check();
  await page.getByRole('group', { name: /Causality — your WHO-UMC category/ }).getByRole('radio', { name: 'Possible' }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/task/t07`));
  await page.getByTestId('item-adr').first().click();

  const panel = page.getByTestId('causality-panel');
  await expect(panel.locator('[data-method="naranjo"]')).toContainText('Not answered yet');
  await panel.locator('[data-method="naranjo"]').getByRole('link', { name: 'Answer the questionnaire' }).click();

  // Nothing is filled in; an incomplete questionnaire is not saved.
  await expect(page.getByTestId('causality-live')).toContainText('10 question(s) still to answer.');
  await page.getByTestId('causality-save').click();
  await expect(page.getByText('Some questions are not answered yet.')).toBeVisible();

  const answer = async (n: number, a: 'Yes' | 'No' | 'Do not know') =>
    page.getByRole('group', { name: new RegExp(`^${n}\\. `) }).getByRole('radio', { name: new RegExp(`^${a} \\(`) }).check();
  await answer(1, 'Yes'); // +1
  await answer(2, 'Yes'); // +2
  await answer(3, 'Yes'); // +1
  await answer(4, 'Do not know'); // 0
  await answer(5, 'No'); // +2
  await answer(6, 'Do not know');
  await answer(7, 'Do not know');
  await answer(8, 'Do not know');
  await answer(9, 'Do not know');
  await answer(10, 'No'); // 0
  await expect(page.getByTestId('causality-live')).toContainText('score 6 → Probable (5–8)');
  await page.getByTestId('causality-live').getByText('How the score was added up').click();
  await expect(page.getByTestId('causality-live')).toContainText('Total = 6 → probable');
  await expectFitsWidth(page);
  await shot(page, 'm2-13-naranjo');
  await page.getByTestId('causality-save').click();
  await expect(page.getByTestId('causality-result-naranjo')).toContainText('Probable (5–8) · score 6');

  // WHO-UMC: the category follows from the criteria; it differs from the trainee's own, and both stay.
  await panel.locator('[data-method="who_umc"]').getByRole('link', { name: 'Answer the questionnaire' }).click();
  await page.getByRole('group', { name: 'Is the information enough to judge?' }).getByRole('radio', { name: 'Yes' }).check();
  await page.getByRole('group', { name: /Time relationship/ }).getByRole('radio', { name: 'Plausible / reasonable' }).check();
  await page.getByRole('group', { name: /Could the disease or other drugs/ }).getByRole('radio', { name: /^No —/ }).check();
  await page.getByRole('group', { name: /Response to withdrawal/ }).getByRole('radio', { name: 'Plausible / clinically reasonable' }).check();
  await page.getByRole('group', { name: 'Rechallenge' }).getByRole('radio', { name: 'Not done, or not needed' }).check();
  await page.getByRole('group', { name: /Is the event definitive/ }).getByRole('radio', { name: 'No' }).check();
  await expect(page.getByTestId('causality-live')).toContainText('Probable / likely');
  await page.getByTestId('causality-save').click();
  await expect(page.getByTestId('causality-result-who_umc')).toContainText('Probable / likely');
  await expect(page.getByTestId('causality-differs')).toContainText('Your own WHO-UMC category is “Possible”; the questionnaire gives “Probable / likely”.');
  // The trainee's own answer is unchanged.
  await expect(page.getByRole('group', { name: /Causality — your WHO-UMC category/ }).getByRole('radio', { name: 'Possible' })).toBeChecked();
  await expectFitsWidth(page);
  await shot(page, 'm2-14-adr-causality');

  // In the register list, the results show on the row.
  await page.goto(`/#/cases/${caseId}/task/t07`);
  await expect(page.getByTestId('causality-chip-naranjo')).toContainText('Naranjo: Probable (5–8)');
  await expect(page.getByTestId('causality-chip-who_umc')).toContainText('WHO-UMC: Probable / likely');
  // Audited, with the answers.
  await page.goto(`/#/cases/${caseId}/audit`);
  await expect(page.locator('[data-testid="audit-event"][data-entity="causality"]')).toHaveCount(2);
});

test('the form and the About screen say which checks could not be made, with dataset attribution', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });

  await page.goto(`/#/cases/${caseId}/form`);
  const s7 = page.locator('[data-section="7"]');
  const auto = s7.getByTestId('form-automatic-interactions');
  await expect(auto).toHaveAttribute('data-checked', 'true');
  await expect(auto).toContainText('Checked automatically by PRECEPTOR (offline)');
  await expect(auto).toContainText('No interaction between the current orders was found in');
  await expect(s7).toContainText('Recorded by you (Task 6)');

  await page.goto('/#/about');
  const ds = page.getByTestId('dataset-status');
  const rx = ds.locator('[data-dataset="rxnorm-subset"]');
  await expect(rx).toContainText('installed');
  await expect(rx).toContainText('RxNorm 05-Oct-2026');
  await rx.getByText('Licence and attribution').click();
  await expect(rx).toContainText('This product uses publicly available data from the U.S. National Library of Medicine (NLM)');
  const ddinter = ds.locator('[data-dataset="interactions"]');
  await expect(ddinter).toContainText('installed');
  await expect(ddinter).toContainText('DDInter download files (DDInter 1.0, 2021; re-served by DDInter 2.0, May 2024)');
  await ddinter.getByText('Licence and attribution').click();
  await expect(ddinter).toContainText('Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International');
  const aware = ds.locator('[data-dataset="aware"]');
  await expect(aware).toContainText('WHO AWaRe classification 2025');
  await aware.getByText('Licence and attribution').click();
  await expect(aware).toContainText('Licence: CC BY-NC-SA 3.0 IGO');
  await expect(ds.locator('[data-dataset="onc"]')).toContainText('not installed');
  await expect(page.getByText('Version 0.4.0 · milestone M2')).toBeVisible();
  await expectFitsWidth(page);
  await shot(page, 'm2-15-about-datasets');

  // The same screens in Arabic, right to left.
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.goto('/#/reference');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الجداول المرجعية' })).toBeVisible();
  await expect(page.getByTestId('ref-open-formulary')).toContainText('الدليل الدوائي المحلي');
  await page.goto(`/#/cases/${caseId}`);
  await expect(page.getByRole('heading', { name: 'فحوص السلامة' })).toBeVisible();
  await expect(page.getByTestId('safety-card')).toContainText('فُحصت دون اتصال');

  await expectFitsWidth(page);
  await shot(page, 'm2-16-safety-arabic');
});

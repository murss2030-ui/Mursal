/**
 * M6 in the browser: the department form is exported (printed or saved as PDF
 * from the browser, or as text) only while nothing in it is unverified; the
 * reasons are listed when it is refused; the export is recorded in the audit
 * log by its hash; nothing leaves the device.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';

const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'docs/m6/screenshots';
const shot = async (page: Page, name: string, full = true) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
};

async function addFinalCard(page: Page, caseId: string) {
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByRole('link', { name: 'Add a drug-related problem' }).click();
  await page.getByLabel(/Clinical problem, in one sentence/).fill('Enoxaparin dose not adjusted for kidney function');
  await page.getByLabel(/Values from the timeline/).selectOption({ label: 'Serum creatinine: 2.4 mg/dL — Day 1' });
  await page.getByRole('radio', { name: 'P2.1 Adverse drug event (possibly) occurring' }).click();
  await page.getByRole('radio', { name: 'Potential problem' }).click();
  await page.locator('[data-group="C3"] summary').click();
  await page.getByRole('button', { name: 'C3.2 Drug dose of a single active ingredient too high' }).click();
  await page.getByRole('radio', { name: 'Critical' }).click();
  await page.getByLabel(/Recommendation and rationale/).fill('Discuss a renal dose of enoxaparin with the team, from the hospital protocol');
  await page.getByRole('radio', { name: 'Final — ready to discuss' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('card-summary')).toHaveCount(1);
}

test('the form is exported as a PDF and as text when nothing is unverified, and refused with its reasons when a card is stale', async ({ page }) => {
  test.setTimeout(240_000);
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '2.4', '1');
  await addFinalCard(page, caseId);

  // ---- the form tab links to the export; the export is the form, with its missing items and its statement
  await page.goto(`/#/cases/${caseId}/form`);
  await page.getByTestId('export-link').click();
  await expect(page.getByTestId('export-document')).toBeVisible();
  await expect(page.getByTestId('export-document')).toHaveAttribute('data-copy', 'teaching');
  await expect(page.locator('[data-section]')).toHaveCount(11);
  await expect(page.locator('[data-section="9"]')).toContainText('Discuss a renal dose of enoxaparin');
  await expect(page.getByTestId('export-missing')).toBeVisible();
  await expect(page.getByTestId('export-statement')).toContainText('does not replace a clinical pharmacist');
  await expect(page.getByTestId('export-statement')).toContainText(/SHA-256 [0-9a-f]{64}/);
  await shot(page, 'm6-01-export-document');

  // ---- a text file, recorded in the audit log by its hash (the print dialog is not opened in the test)
  await page.evaluate(() => {
    window.print = () => {};
  });
  const download = page.waitForEvent('download');
  await page.getByTestId('export-text').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`form-${caseId}-teaching.txt`);
  const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf8');
  expect(text).toContain('Clinical Pharmacy Assessment and Medication Review Form');
  expect(text).toContain('Discuss a renal dose of enoxaparin');
  await expect(page.getByTestId('export-audited')).toContainText('content fingerprint');
  await page.getByTestId('export-print').click();

  // ---- the PDF: the print stylesheet leaves the document alone (no navigation, no banner)
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('export-document')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  await expect(page.getByTestId('disclaimer-footer')).toBeHidden();
  const pdf = await page.pdf({ format: 'A4' });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(8000);
  await page.emulateMedia({ media: 'screen' });

  // ---- both exports are in the audit log by what they are, never by their content
  await page.goto('/#/audit');
  const events = page.locator('[data-testid="audit-event"][data-entity="form_export"]');
  await expect(events).toHaveCount(2);
  expect((await events.allInnerTexts()).join('\n')).not.toMatch(/Discuss a renal dose|Enoxaparin/);

  // ---- a new creatinine makes the card stale: the form leaves it out, and the export is refused, saying why
  await addCreatinine(page, caseId, '3.1', '3');
  await page.goto(`/#/cases/${caseId}/export`);
  await expect(page.getByTestId('export-blocked')).toContainText('Not exportable yet');
  const held = page.getByTestId('export-blockers').locator('[data-blocker="excluded_card"]');
  await expect(held).toHaveCount(2); // held back from Section 8 and from Section 9
  await expect(held.first()).toContainText('Enoxaparin dose not adjusted for kidney function');
  await expect(page.getByTestId('export-document')).toHaveCount(0);
  await expect(page.getByTestId('export-print')).toHaveCount(0);
  await shot(page, 'm6-02-export-refused');
  await page.getByTestId('export-blockers').getByRole('link', { name: 'Resolve it' }).first().click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/problems`));

  // ---- Arabic, right to left
  await page.goto(`/#/cases/${caseId}/export`);
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('export-blocked')).toContainText('لا يُصدَّر بعد');
  await shot(page, 'm6-03-export-refused-arabic');
  await page.getByRole('button', { name: 'English' }).first().click();

  // Nothing went anywhere.
  expect(watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
  expect(watch.errors).toEqual([]);
});

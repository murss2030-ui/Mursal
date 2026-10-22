/**
 * M7 in the browser: the monthly presentation is assembled from the verified
 * record only — a current Problem Card appears, a stale one is counted and
 * left out — presented slide by slide, printed one slide to a landscape page,
 * saved as text, recorded in the audit log by its hash, with no name or date.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';

const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'docs/m7/screenshots';
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
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

test('the monthly presentation: verified cards only, slide by slide, printed, saved as text, recorded by hash', async ({ page }) => {
  test.setTimeout(240_000);
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '2.4', '1');
  await addFinalCard(page, caseId);

  await page.goto('/#/reports');
  await page.getByRole('link', { name: 'Monthly presentation' }).click();
  await expect(page.getByTestId('presentation-screen')).toBeVisible();
  await page.getByLabel('Rotation').selectOption({ index: 1 });
  await expect(page.getByTestId('deck')).toBeVisible();
  await expect(page.getByTestId('pres-not-included')).toHaveCount(0);

  // one slide at a time, with the arrow keys
  await expect(page.locator('[data-testid="slide"][data-current="true"]')).toHaveAttribute('data-kind', 'title');
  await expect(page.getByTestId('pres-position')).toContainText('Slide 1 of');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-testid="slide"][data-current="true"]')).toHaveAttribute('data-kind', 'case');
  await expect(page.locator('[data-testid="slide"][data-current="true"]')).toContainText('Serum creatinine 2.4 mg/dL (Day 1)');
  await page.keyboard.press('ArrowRight');
  const cardSlide = page.locator('[data-testid="slide"][data-current="true"]');
  await expect(cardSlide).toHaveAttribute('data-kind', 'card');
  await expect(cardSlide).toContainText('Recommendation (proposed): Discuss a renal dose of enoxaparin');
  await expect(cardSlide).toContainText('Outcome: Not measured yet');
  await expect(cardSlide).not.toContainText('(implemented)');
  await shot(page, 'm7-01-card-slide');

  // print: every slide, one per landscape page; the app's own chrome is hidden
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('[data-testid="slide"]:visible').count()).toBeGreaterThanOrEqual(5);
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4', landscape: true });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  await page.emulateMedia({ media: 'screen' });

  const download = page.waitForEvent('download');
  await page.getByTestId('pres-text').click();
  const text = await (await import('node:fs/promises')).readFile((await (await download).path())!, 'utf8');
  expect(text).toContain('Enoxaparin dose not adjusted for kidney function');
  expect(text).toContain('does not replace a clinical pharmacist');
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}.*Day|CASE-\d+.*(name|MRN)/);
  await page.getByTestId('pres-print').click();
  await expect(page.getByTestId('pres-audited')).toContainText('content fingerprint');

  await page.goto('/#/audit');
  const events = page.locator('[data-testid="audit-event"][data-entity="presentation"]');
  await expect(events).toHaveCount(2);
  expect((await events.allInnerTexts()).join('\n')).not.toMatch(/Enoxaparin|Discuss a renal/);

  // a new creatinine makes the card stale: it is left out of the deck and counted, never shown
  await addCreatinine(page, caseId, '3.1', '3');
  await page.goto('/#/presentation');
  await page.getByLabel('Rotation').selectOption({ index: 1 });
  await expect(page.getByTestId('pres-not-included')).toContainText('1 Problem Card(s) are left out');
  await expect(page.locator('[data-testid="slide"][data-kind="card"]')).toHaveCount(0);
  await expect(page.getByTestId('deck')).not.toContainText('Discuss a renal dose');
  await shot(page, 'm7-02-stale-card-left-out');

  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('pres-position')).toContainText('الشريحة');
  await shot(page, 'm7-03-arabic');
  expect(watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
  expect(watch.errors).toEqual([]);
});

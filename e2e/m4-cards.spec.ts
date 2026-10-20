/**
 * M4 in the browser (Section 23, M4 acceptance), on a card the trainee
 * writes: every field of the Problem Card is filled or explicitly missing;
 * no control decides more than one card; a new creatinine makes the card
 * that cites a creatinine stale on the next screen and keeps it out of the
 * form, while a potassium does not; a rejection needs its reason.
 */
import { expect, test, type Page } from '@playwright/test';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';

const SHOTS = 'docs/m4/screenshots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function addPotassium(page: Page, caseId: string, value: string, day: string) {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('lab');
  await page.getByLabel('Hospital day').fill(day);
  await page.getByLabel('Test').selectOption('k');
  await page.getByLabel('Value', { exact: true }).fill(value);
  await page.getByLabel('Unit', { exact: true }).selectOption('mmol/L');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

const PROBLEM = 'Enoxaparin dose not adjusted for kidney function';
const RECOMMENDATION = 'Discuss a renal dose of enoxaparin with the team, from the hospital protocol';

test('a Problem Card written by the trainee: thirteen fields, ranking, staleness on a new creatinine, form exclusion, re-review and reasons', async ({ page }) => {
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '2.4', '1');

  // ---------------------------------------------------------------- write the card from the Problems list
  await page.goto(`/#/cases/${caseId}/problems`);
  await expect(page.getByTestId('problems-tab')).toContainText('No drug-related problem recorded yet.');
  await page.getByRole('link', { name: 'Add a drug-related problem' }).click();
  await expect(page.getByTestId('item-editor')).toBeVisible();
  // The thirteen fields of the card are the editor's sections (field 10, the review, is decided on the card).
  await expect(page.getByTestId('card-section-heading')).toHaveText([
    '1 · Clinical problem',
    '2 · Supporting data',
    '3 · Missing information',
    '4 · Clinical assessment',
    '5 · Drug-related problem (PCNE V9.1)',
    '6 · Priority and urgency',
    '7 · Evidence and references',
    '8 · Recommendation',
    '9 · Monitoring plan',
    '10 · Human review',
    '11 · Implementation status',
    '12 · Follow-up outcome',
    '13 · Teaching explanation',
  ]);
  await page.getByLabel(/Clinical problem, in one sentence/).fill(PROBLEM);
  await page.getByLabel(/Values from the timeline/).selectOption({ label: 'Serum creatinine: 2.4 mg/dL — Day 1' });
  await expect(page.getByTestId('links-picker')).toContainText('Serum creatinine: 2.4 mg/dL — Day 1');
  await page.getByRole('radio', { name: 'P2.1 Adverse drug event (possibly) occurring' }).click();
  await page.getByRole('radio', { name: 'Potential problem' }).click();
  await page.locator('[data-group="C3"] summary').click();
  await page.getByRole('button', { name: 'C3.2 Drug dose of a single active ingredient too high' }).click();
  // The form's boxes follow from the codes, through the mapping the owner approved (20 October 2026): no "draft" note.
  await expect(page.getByTestId('boxes-derived').locator('[data-box="dose_high"]')).toHaveAttribute('data-checked', 'true');
  await expect(page.getByTestId('pcne-map-draft')).toHaveCount(0);
  await page.getByRole('radio', { name: 'Critical' }).click();
  await page.getByLabel(/Recommendation and rationale/).fill(RECOMMENDATION);
  await page.getByRole('radio', { name: 'Final — ready to discuss' }).click();
  await shot(page, 'm4-01-card-editor');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // ---------------------------------------------------------------- the ranked list, and the card with its thirteen fields
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/problems`));
  const summary = page.getByTestId('card-summary');
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText('#1');
  await expect(summary.getByTestId('card-pcne-code')).toHaveText('P2.1 · C3.2');
  await expect(summary).toHaveAttribute('data-review', 'written_by_you');
  await expect(summary).toHaveAttribute('data-stale', 'false');
  await shot(page, 'm4-02-problems-list');
  await summary.click();
  const card = page.getByTestId('problem-card');
  await expect(card).toBeVisible();
  const fields = card.locator('[data-card-field]');
  await expect(fields).toHaveCount(13);
  for (let n = 1; n <= 13; n++) {
    const f = card.locator(`[data-card-field="${n}"]`);
    // Each field: content, or "Missing — what is missing". Never blank.
    if ((await f.getAttribute('data-missing')) === 'true') await expect(f.getByTestId('card-missing')).toContainText(/Missing — .{10,}/);
    else expect((await f.innerText()).split('\n').filter((l) => l.trim()).length).toBeGreaterThan(1);
  }
  await expect(card.locator('[data-card-field="3"]')).toHaveAttribute('data-missing', 'true');
  await expect(card.locator('[data-card-field="13"]')).toHaveAttribute('data-missing', 'true');
  await expect(card.locator('[data-card-field="10"]')).toContainText('Written by you');
  await expect(card.getByTestId('card-pcne')).toContainText('P2.1');
  await expect(card.getByTestId('card-boxes').locator('[data-box="dose_high"]')).toHaveAttribute('data-checked', 'true');
  await shot(page, 'm4-03-card-thirteen-fields');

  // ---------------------------------------------------------------- the form takes the current card
  await page.goto(`/#/cases/${caseId}/form`);
  const s8 = page.locator('[data-section="8"]');
  await expect(s8.getByTestId('drp-checkboxes').locator('[data-checked="true"]')).toHaveCount(1);
  await expect(s8).toContainText('PCNE P2.1; causes C3.2');
  await expect(page.locator('[data-section="9"]')).toContainText(RECOMMENDATION);

  // ---------------------------------------------------------------- an unrelated entry does not make it stale; a new creatinine does
  await addPotassium(page, caseId, '5.1', '2');
  await page.getByRole('tab', { name: 'Problems' }).click();
  await expect(page.getByTestId('card-summary')).toHaveAttribute('data-stale', 'false');
  await addCreatinine(page, caseId, '2.9', '2');
  // The next screen, no reload.
  await page.getByRole('tab', { name: 'Problems' }).click();
  await expect(page.getByTestId('card-summary')).toHaveAttribute('data-stale', 'true');
  await expect(page.getByTestId('card-stale-badge')).toHaveText('Re-analyse — Day 2');
  await shot(page, 'm4-04-stale-after-new-creatinine');
  await page.getByRole('tab', { name: 'Form' }).click();
  await expect(page.getByTestId('form-excluded-8')).toContainText(`${PROBLEM} — Re-analyse — Day 2`);
  await expect(page.getByTestId('form-excluded-9')).toContainText(`${PROBLEM} — Re-analyse — Day 2`);
  await expect(page.locator('[data-section="9"]')).not.toContainText(RECOMMENDATION);
  await expect(page.locator('[data-section="8"]').getByTestId('drp-checkboxes').locator('[data-checked="true"]')).toHaveCount(0);
  await shot(page, 'm4-05-form-leaves-stale-card-out');

  // ---------------------------------------------------------------- review again on the current data: version 2, current
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByTestId('card-summary').click();
  await expect(page.getByTestId('card-stale')).toContainText('A new Serum creatinine was recorded after this card (Day 2).');
  // A stale card cannot be accepted until it is reviewed again on the current data.
  await expect(page.locator('button[data-decision="accepted"]')).toBeDisabled();
  await expect(page.getByTestId('card-review')).toContainText('Accept is unavailable while the card is stale');
  await page.getByRole('button', { name: 'Still valid — review again' }).click();
  const save = page.getByRole('button', { name: 'Save as a new version' });
  await expect(save).toBeDisabled();
  await page.getByLabel(/Why it is still valid/).fill('Still valid with the creatinine of Day 2 (2.9 mg/dL)');
  await save.click();
  await expect(page.getByTestId('card-stale')).toHaveCount(0);
  await expect(page.getByTestId('card-screen')).toContainText('Version 2');

  // ---------------------------------------------------------------- the review: one card, a reason for every refusal
  const review = page.getByTestId('card-review');
  await review.getByRole('button', { name: 'Needs senior review' }).click();
  const confirm = page.getByTestId('review-confirm').getByRole('button', { name: /^Record:/ });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/Why a senior should review it/).fill('Unsure whether to hold or reduce the dose');
  await confirm.click();
  await expect(review.getByTestId('review-history')).toContainText('Needs senior review');
  await review.getByRole('button', { name: 'Reject' }).click();
  const reject = page.getByTestId('review-confirm').getByRole('button', { name: 'Record: Rejected' });
  await expect(reject).toBeDisabled();
  await page.getByLabel(/Why you reject it/).fill('The team had already reduced the dose on Day 2');
  // A card the trainee wrote is decided with the preceptor, which the trainee states: never ticked in advance.
  await expect(page.getByLabel('Decided with my preceptor')).not.toBeChecked();
  await expect(reject).toBeDisabled();
  await page.getByLabel('Decided with my preceptor').check();
  await reject.click();
  await expect(review.locator('[data-review="rejected"]')).toBeVisible();
  await expect(review.getByTestId('review-history').locator('li')).toHaveCount(2);
  await expect(review.getByTestId('review-history')).toContainText('The team had already reduced the dose on Day 2');
  await expect(review.getByTestId('review-history').locator('[data-decision="rejected"]')).toContainText('with the preceptor');
  await shot(page, 'm4-06-review-history');

  // No control anywhere decides several cards at once.
  for (const where of [`/#/cases/${caseId}/problems`, `/#/cases/${caseId}/task/t05`, `/#/cases/${caseId}/task/t13`]) {
    await page.goto(where);
    await expect(page.getByRole('button', { name: /all|bulk|every/i })).toHaveCount(0);
  }
  await page.goto(`/#/cases/${caseId}/form`);
  await expect(page.getByTestId('form-excluded-9')).toContainText(`${PROBLEM} — Rejected`);

  // The audit log holds each decision with its reason.
  await page.goto(`/#/cases/${caseId}/audit`);
  await expect(page.locator('[data-entity="card_review"][data-action="reject"]')).toHaveCount(1);
  await expect(page.locator('[data-entity="card_review"][data-action="escalate"]')).toHaveCount(1);
  await expect(page.locator('[data-entity="item"][data-action="reconfirm"]')).toHaveCount(1);

  // In Arabic, right to left: the official PCNE wording stays in English, with PRECEPTOR's Arabic explanation.
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByTestId('card-summary').click();
  await expect(page.getByTestId('card-pcne')).toContainText('Adverse drug event (possibly) occurring');
  await expect(page.getByTestId('card-pcne')).toContainText('حدث دوائي ضار');
  await expect(page.locator('[data-card-field="13"]')).toContainText('ناقص');
  await shot(page, 'm4-07-card-arabic');
  expect(watch.errors).toEqual([]);
});

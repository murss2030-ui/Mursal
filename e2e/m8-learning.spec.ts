/**
 * M8 in the browser: the three learning modes work from the trainee's own
 * case with no model (the test relay is never called), what the trainee does
 * is kept and appears in the portfolio under competency areas, and the
 * portfolio is printed or saved as text, recorded by hash.
 */
import { expect, test, type Page } from '@playwright/test';
import { installTestRelay } from './ai-relay';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';

const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'docs/m8/screenshots';
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test('Teach me, Assessment mode, Argue with me, and the portfolio', async ({ page }) => {
  test.setTimeout(240_000);
  const watch = watchPage(page);
  const relay = await installTestRelay(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addCreatinine(page, caseId, '2.4', '1');
  // a weight and a Cockcroft–Gault result to practise on
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('weight');
  await page.getByLabel('Hospital day').fill('0');
  await page.getByLabel('Weight (kg)').fill('70');
  await page.getByRole('radio', { name: 'Measured' }).check();
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
  await page.goto(`/#/cases/${caseId}/task/t08`);
  await page.getByTestId('task-calc-crcl_cg').locator('summary').click();
  const panel = page.getByTestId('calc-panel-crcl_cg');
  await panel.getByTestId('answer-weightBasis').getByRole('radio', { name: 'Total body weight (TBW)' }).click();
  await panel.getByTestId('calc-run').click();
  await expect(panel.getByTestId('calc-result-crcl_cg')).toBeVisible();

  // a Problem Card to learn from
  await page.goto(`/#/cases/${caseId}/problems`);
  await page.getByRole('link', { name: 'Add a drug-related problem' }).click();
  await page.getByLabel(/Clinical problem, in one sentence/).fill('Enoxaparin dose not adjusted for kidney function');
  await page.getByLabel(/Medication\(s\) involved/).fill('enoxaparin');
  await page.getByLabel(/Values from the timeline/).selectOption({ label: 'Serum creatinine: 2.4 mg/dL — Day 1' });
  await page.getByRole('radio', { name: 'P2.1 Adverse drug event (possibly) occurring' }).click();
  await page.getByRole('radio', { name: 'Potential problem' }).click();
  await page.locator('[data-group="C3"] summary').click();
  await page.getByRole('button', { name: 'C3.2 Drug dose of a single active ingredient too high' }).click();
  await page.getByRole('radio', { name: 'Critical' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('card-summary')).toHaveCount(1);

  // ---- the hub, from More
  await page.goto('/#/more');
  await page.getByRole('link', { name: 'Learning' }).click();
  await expect(page.getByTestId('learning-hub')).toBeVisible();
  await page.getByRole('link', { name: new RegExp(caseId) }).click();
  await expect(page.getByTestId('case-learning')).toBeVisible();

  // ---- Teach me: PCNE's own wording, then "I studied this"
  await expect(page.getByTestId('teach')).toContainText('P2.1');
  await expect(page.getByTestId('teach')).toContainText('C3.2');
  await page.getByTestId('teach-search').click();
  await expect(page.getByText('Nothing in your library matches')).toBeVisible();
  await page.getByTestId('teach-done').click();
  await expect(page.getByTestId('teach-done')).toBeDisabled();
  await shot(page, 'm8-01-teach');

  // ---- Assessment mode: wrong, then right; marked against the calculator
  await page.getByTestId('learn-tab-assess').click();
  const q = page.getByTestId('assess-question').first();
  await expect(q).toContainText('Serum creatinine 2.4 mg/dL');
  await q.getByRole('textbox').fill('999');
  await q.getByTestId('assess-check').click();
  const result = q.getByTestId('assess-result');
  await expect(result).toHaveAttribute('data-correct', 'false');
  const expected = /the calculator gives ([\d.]+)/.exec(await result.innerText())![1]!;
  await expect(q).toContainText('Formula:');
  await shot(page, 'm8-02-assess-wrong');
  // a second attempt is a new question card on reload
  await page.goto('/#/learning');
  await page.getByRole('link', { name: new RegExp(caseId) }).click();
  await page.getByTestId('learn-tab-assess').click();
  await expect(page.getByTestId('assess-question').first()).toContainText('Last time: Not quite');
  const q2 = page.getByTestId('assess-question').first();
  await q2.getByRole('textbox').fill(expected);
  await q2.getByTestId('assess-check').click();
  await expect(q2.getByTestId('assess-result')).toHaveAttribute('data-correct', 'true');

  // ---- Argue with me: challenges from the card; the answer is kept in the trainee's words
  await page.getByTestId('learn-tab-argue').click();
  await expect(page.locator('[data-testid="challenge"][data-from="cause"]')).toContainText(/dose/i);
  await expect(page.locator('[data-testid="challenge"][data-from="always"]')).toHaveCount(2);
  const first = page.getByTestId('challenge').filter({ hasText: 'strongest argument against' });
  await first.getByRole('textbox').fill('The creatinine may be falling; holding the dose could leave the patient unprotected.');
  await first.getByTestId('challenge-save').click();
  await expect(first.getByTestId('challenge-saved')).toContainText('may be falling');
  await shot(page, 'm8-03-argue');

  // ---- the portfolio: the card, the learning, by competency
  await page.goto('/#/portfolio');
  await expect(page.getByTestId('portfolio')).toBeVisible();
  const area = (a: string) => page.locator(`[data-testid="competency"][data-area="${a}"]`);
  await expect(area('direct_patient_care')).toContainText('Enoxaparin dose not adjusted for kidney function');
  await expect(area('direct_patient_care')).toContainText('proposed; outcome not measured');
  await expect(area('pharmacotherapy_knowledge')).toContainText('Assessment');
  await expect(area('pharmacotherapy_knowledge')).toContainText('Argued');
  await expect(area('continuing_development')).toContainText('Studied');
  await expect(area('communication')).toContainText('Argued');
  expect((await page.getByTestId('competency').allInnerTexts()).join('\n')).not.toMatch(/grade|score/i);
  await shot(page, 'm8-04-portfolio');

  await page.evaluate(() => {
    window.print = () => {};
  });
  const download = page.waitForEvent('download');
  await page.getByTestId('portfolio-text').click();
  const text = await (await import('node:fs/promises')).readFile((await (await download).path())!, 'utf8');
  expect(text).toContain('Direct patient care');
  expect(text).toContain('may be falling');
  await expect(page.getByTestId('portfolio-audited')).toContainText('content fingerprint');

  // ---- audit: modes and lengths, never the words; no model was ever asked
  await page.goto('/#/audit');
  const learning = page.locator('[data-testid="audit-event"][data-entity="learning"]');
  expect(await learning.count()).toBeGreaterThanOrEqual(3);
  expect((await page.locator('[data-testid="audit-event"]').allInnerTexts()).join('\n')).not.toContain('may be falling');
  expect(relay.provider).toEqual([]);

  await page.goto(`/#/cases/${caseId}/learn`);
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('learn-tab-argue')).toContainText('جادلني');
  await shot(page, 'm8-05-arabic');
  expect(watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:') && !u.startsWith('https://rxnav.nlm.nih.gov/'))).toEqual([]);
  expect(watch.errors).toEqual([]);
});

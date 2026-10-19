/**
 * M2 calculation engine in the browser: a calculator inside its task, with
 * the weight basis chosen by the trainee, the formula and values shown, the
 * result stored and marked out of date when the creatinine changes; a
 * missing input refused by name; the renal dose review locked by the Verify
 * gate; and a calculator whose tests failed hidden from the interface.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addCreatinine, createCase, createRotation, onboard, watchPage } from './helpers';

const SHOTS = 'docs/m2/screenshots';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function addEntry(page: Page, caseId: string, fill: (p: Page) => Promise<void>) {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await fill(page);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

async function addWeight(page: Page, caseId: string, kg: string, day: string) {
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('weight');
    await p.getByLabel('Hospital day').fill(day);
    await p.getByLabel('Weight (kg)').fill(kg);
    await p.getByRole('radio', { name: 'Measured' }).check();
  });
}

async function addMedication(page: Page, caseId: string, opts: { drug: string; indication?: string }) {
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('med_start');
    await p.getByLabel('Hospital day').fill('0');
    await p.getByLabel(/Drug — generic name/).fill(opts.drug);
    await p.getByLabel('Amount', { exact: true }).fill('40');
    await p.getByLabel('Dose unit', { exact: true }).selectOption('mg');
    await p.getByLabel('Route', { exact: true }).selectOption('subcut');
    await p.getByLabel('Frequency', { exact: true }).selectOption('once daily');
    if (opts.indication) await p.getByLabel(/^Indication/).fill(opts.indication);
  });
}

async function addDialysisStatus(page: Page, caseId: string) {
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('note');
    await p.getByLabel('Hospital day').fill('0');
    await p.getByLabel('Kind of note').selectOption('renal_replacement');
    await p.getByRole('radio', { name: 'None (not on dialysis)' }).check();
  });
}

async function newCaseWithData(page: Page): Promise<string> {
  await onboard(page);
  await createRotation(page);
  // Female, 67 years, 158 cm (helpers.createCase)
  return createCase(page, { kind: 'teaching' });
}

test('CrCl inside Task 8: weight basis chosen, formula and values shown, result stored, out of date after a new creatinine', async ({ page }) => {
  const w = watchPage(page);
  const caseId = await newCaseWithData(page);
  await addWeight(page, caseId, '60', '0');
  await addCreatinine(page, caseId, '1.1', '1');

  await page.goto(`/#/cases/${caseId}/task/t08`);
  const card = page.getByTestId('task-calculators');
  await expect(card).toBeVisible();
  await card.getByTestId('task-calc-crcl_cg').locator('summary').click();
  const panel = page.getByTestId('calc-panel-crcl_cg');
  await expect(panel.getByTestId('calc-problems')).toContainText('Weight used in the formula: missing');
  await expect(panel.getByTestId('calc-run')).toBeDisabled();
  await panel.getByTestId('answer-weightBasis').getByRole('radio', { name: 'Total body weight (TBW)' }).click();
  await expect(panel.getByTestId('calc-problems')).toHaveCount(0);
  await shot(page, 'm2-01-crcl-inputs');
  await panel.getByTestId('calc-run').click();

  // (140 − 67) × 60 ÷ (72 × 1.1) × 0.85 = 47.0 mL/min
  const result = panel.getByTestId('calc-result-crcl_cg');
  await expect(result.getByTestId('calc-value')).toHaveText('47 mL/min');
  await expect(result.locator('[data-provenance="calculated"]')).toBeVisible();
  await result.getByTestId('calc-basis').locator('summary').click();
  await expect(result.getByTestId('calc-steps')).toContainText('CrCl = (140 − 67) × 60 ÷ (72 × 1.1) × 0.85 = 47 mL/min');
  await expect(result.getByTestId('calc-basis')).toContainText('Total body weight used, as chosen by the trainee.');
  await expect(result.getByTestId('calc-basis')).toContainText('Cockcroft DW, Gault MH');
  await shot(page, 'm2-02-crcl-result');

  // A newer creatinine makes the stored result out of date; it is never changed.
  await addCreatinine(page, caseId, '1.5', '2');
  await page.goto(`/#/cases/${caseId}/calc/crcl_cg`);
  await expect(page.getByTestId('calc-result-crcl_cg')).toHaveAttribute('data-current', 'no');
  await expect(page.getByTestId('calc-out-of-date')).toContainText('A newer serum creatinine was recorded (Day 2)');
  await expect(page.getByTestId('calc-result-crcl_cg').getByTestId('calc-value')).toHaveText('47 mL/min');
  await page.getByTestId('answer-weightBasis').getByRole('radio', { name: 'Total body weight (TBW)' }).click();
  await page.getByTestId('calc-run').click();
  await expect(page.getByTestId('calc-result-crcl_cg').getByTestId('calc-value')).toHaveText('34 mL/min'); // (140 − 67) × 60 ÷ (72 × 1.5) × 0.85 = 34.5
  await expect(page.getByText('Earlier results (1)')).toBeVisible();
  // The creatinine rose by 0.4 mg/dL within 2 days: the KDIGO warning is shown.
  await expect(page.getByTestId('calc-warnings')).toContainText('KDIGO');
  await shot(page, 'm2-03-crcl-recalculated');

  // Audit: two calculations recorded.
  await page.goto(`/#/cases/${caseId}/audit`);
  await expect(page.getByText(/calc_result/).first()).toBeVisible();
  expect(w.errors).toEqual([]);
});

test('a calculation with a missing input is refused and names the missing field', async ({ page }) => {
  const caseId = await newCaseWithData(page);
  await addWeight(page, caseId, '60', '0');
  await page.goto(`/#/cases/${caseId}/calc/egfr_ckdepi2021`);
  const panel = page.getByTestId('calc-panel-egfr_ckdepi2021');
  await expect(panel.getByTestId('calc-problems')).toContainText('Serum creatinine: missing');
  await expect(panel.getByTestId('calc-run')).toBeDisabled();
  await expect(panel.locator('[data-input="scr"]')).toContainText('Not recorded');
  await shot(page, 'm2-04-missing-input');
});

test('vancomycin AUC refuses without two picked levels, then computes from levels with draw times', async ({ page }) => {
  const caseId = await newCaseWithData(page);
  const level = async (value: string, day: string, time: string) =>
    addEntry(page, caseId, async (p) => {
      await p.getByLabel('Entry type').selectOption('lab');
      await p.getByLabel('Hospital day').fill(day);
      await p.getByLabel('Clock time').fill(time);
      await p.getByLabel('Test').selectOption('vanco');
      await p.getByLabel('Value', { exact: true }).fill(value);
      await p.getByLabel('Unit', { exact: true }).selectOption('mg/L');
    });
  // Simulated steady state: CL 5 L/h, V 60 L, 1250 mg over 1 h every 12 h → AUC₂₄ 500 mg·h/L
  await level('29.1', '2', '08:00');
  await level('13.2', '2', '17:30');
  await page.goto(`/#/cases/${caseId}/task/t10`);
  await page.getByTestId('task-calc-vancomycin_auc').locator('summary').click();
  const panel = page.getByTestId('calc-panel-vancomycin_auc');
  await expect(panel.getByTestId('calc-problems')).toContainText('First level (after the end of the infusion): missing');
  await expect(panel).toContainText('High-risk calculation');
  await panel.locator('[data-input="dose"]').getByLabel('Value').fill('1250');
  await panel.locator('[data-input="dose"]').getByLabel('Unit').selectOption('mg');
  await panel.locator('[data-input="tinf"]').getByLabel('Value').fill('1');
  await panel.locator('[data-input="tinf"]').getByLabel('Unit').selectOption('h');
  await panel.locator('[data-input="tau"]').getByLabel('Value').fill('12');
  await panel.locator('[data-input="tau"]').getByLabel('Unit').selectOption('h');
  await panel.locator('[data-input="doseStart"]').getByLabel('Hospital day').fill('2');
  await panel.locator('[data-input="doseStart"]').getByLabel(/Clock time/).fill('06:00');
  const options = await panel.locator('[data-input="level1"] select option').allTextContents();
  await panel.locator('[data-input="level1"] select').selectOption({ label: options.find((o) => o.startsWith('29.1'))! });
  await panel.locator('[data-input="level2"] select').selectOption({ label: options.find((o) => o.startsWith('13.2'))! });
  await panel.getByTestId('answer-steadyState').getByRole('radio', { name: 'Yes' }).click();
  await panel.getByTestId('answer-noRrt').getByRole('radio', { name: 'Yes' }).click();
  await expect(panel.getByTestId('calc-problems')).toHaveCount(0);
  await panel.getByTestId('calc-run').click();
  const result = panel.getByTestId('calc-result-vancomycin_auc');
  await expect(result.getByTestId('calc-value')).toHaveText(/^(49\d|50\d) mg·h\/L$/);
  await expect(result.getByTestId('calc-category')).toHaveText('Within the 400–600 target range');
  await expect(result.getByTestId('calc-warnings')).toContainText('Evidence is insufficient to recommend AUC targeting in non-invasive infection');
  await shot(page, 'm2-05-vancomycin');
});

test('vancomycin without levels: refused until the department’s table has its bands; then the dose from actual weight and the interval from the band', async ({ page }) => {
  const w = watchPage(page);
  const caseId = await newCaseWithData(page); // female, 67 years
  await addWeight(page, caseId, '60', '0');
  await addCreatinine(page, caseId, '1.1', '1');
  const answer = async () => {
    await page.goto(`/#/cases/${caseId}/task/t10`);
    await page.getByTestId('task-calc-vancomycin_empiric').locator('summary').click();
    const panel = page.getByTestId('calc-panel-vancomycin_empiric');
    await panel.getByTestId('answer-weightBasis').getByRole('radio', { name: 'Total body weight (TBW)' }).click();
    await panel.locator('[data-input="mgPerKg"]').getByLabel('Value').fill('15');
    await panel.getByTestId('answer-noRrt').getByRole('radio', { name: 'Yes' }).click();
    return panel;
  };
  let panel = await answer();
  await expect(panel).toContainText('High-risk calculation');
  await expect(panel.getByTestId('calc-problems')).toContainText('your department’s vancomycin interval table is empty');
  await expect(panel.getByTestId('calc-run')).toBeDisabled();

  // The department's bands — here a synthetic test table, not a clinical recommendation — each with its source.
  const addBand = async (fields: { from?: string; below?: string; hours?: string }) => {
    await page.goto('/#/reference/vancomycin_interval/new');
    if (fields.from) await page.getByLabel(/Creatinine clearance from/).fill(fields.from);
    if (fields.below) await page.getByLabel(/Creatinine clearance below/).fill(fields.below);
    if (fields.hours) {
      await page.getByRole('radio', { name: 'One dose at a fixed interval' }).check();
      await page.getByLabel('Dosing interval (hours)').fill(fields.hours);
    } else await page.getByRole('radio', { name: 'No fixed interval: dose by levels' }).check();
    await page.getByLabel('Reference, with page or URL').fill('Synthetic test table (browser test, not a clinical recommendation)');
    await page.getByLabel('Verified by').fill('Test');
    await page.getByTestId('ref-save').click();
    await expect(page).toHaveURL(/#\/reference\/vancomycin_interval$/);
  };
  await addBand({ from: '60', hours: '12' });
  await addBand({ from: '30', below: '60', hours: '24' });
  await addBand({ below: '30' });
  await expect(page.getByTestId('ref-row')).toHaveCount(3);
  await expect(page.getByTestId('ref-row').first()).toContainText('Creatinine clearance below 30 mL/min');
  await shot(page, 'm2-17-vancomycin-interval-table');

  // CrCl (TBW) = (140 − 67) × 60 ÷ (72 × 1.1) × 0.85 = 47.0 → band "30 to below 60" → every 24 h; dose = 15 × 60 = 900 mg.
  panel = await answer();
  await expect(panel.getByTestId('reference-interval')).toContainText('creatinine clearance 30 to below 60 mL/min → every 24 h');
  await expect(panel.getByTestId('calc-problems')).toHaveCount(0);
  await panel.getByTestId('calc-run').click();
  const result = panel.getByTestId('calc-result-vancomycin_empiric');
  await expect(result.getByTestId('calc-value')).toHaveText('900 mg');
  await expect(result.getByTestId('calc-category')).toHaveText('Every 24 h (your department’s table)');
  await expect(result.getByTestId('calc-warnings')).toContainText('A population-based starting regimen for a setting where levels cannot be measured');
  await result.getByTestId('calc-basis').locator('summary').click();
  await expect(result.getByTestId('calc-steps')).toContainText('CrCl compared with the table as a whole number: 47 mL/min');
  await expect(result.getByTestId('calc-steps')).toContainText('Dose = 15 mg/kg × 60 kg = 900 mg');
  await expect(result.getByTestId('calc-basis')).toContainText('department’s table, version 1: creatinine clearance 30 to below 60 mL/min → every 24 h');
  await expect(result.getByTestId('calc-basis')).toContainText('owner decision 6');
  await shot(page, 'm2-18-vancomycin-no-level');

  // A higher creatinine moves the patient into the "dose by levels" band: the old result is out of date, a new one is refused.
  // CrCl = (140 − 67) × 60 ÷ (72 × 2.0) × 0.85 = 25.9 → 26 mL/min.
  await addCreatinine(page, caseId, '2.0', '2');
  await page.goto(`/#/cases/${caseId}/calc/vancomycin_empiric`);
  await expect(page.getByTestId('calc-result-vancomycin_empiric')).toHaveAttribute('data-current', 'no');
  await page.getByTestId('answer-weightBasis').getByRole('radio', { name: 'Total body weight (TBW)' }).click();
  await page.locator('[data-input="mgPerKg"]').getByLabel('Value').fill('15');
  await page.getByTestId('answer-noRrt').getByRole('radio', { name: 'Yes' }).click();
  await expect(page.getByTestId('calc-problems')).toContainText(
    'Your department’s table gives no fixed interval for a creatinine clearance of 26 mL/min (band below 30 mL/min): dose by levels.',
  );
  await expect(page.getByTestId('calc-run')).toBeDisabled();
  expect(w.errors).toEqual([]);
});

test('infusion rates inside Task 9: weight-based with an explicit unit conversion, and a volume over a time', async ({ page }) => {
  const w = watchPage(page);
  const caseId = await newCaseWithData(page); // female, 67 years
  await addWeight(page, caseId, '70', '0');
  await page.goto(`/#/cases/${caseId}/task/t09`);

  await page.getByTestId('task-calc-infusion_rate_weight').locator('summary').click();
  const panel = page.getByTestId('calc-panel-infusion_rate_weight');
  await expect(panel).toContainText('High-risk calculation');
  const dose = panel.locator('[data-input="doseRate"]');
  await dose.getByLabel('Value').fill('5');
  await dose.getByLabel('Unit').selectOption('mcg/kg/min');
  const conc = panel.locator('[data-input="concentration"]');
  await conc.getByLabel('Value').fill('1.6');
  await conc.getByLabel('Unit').selectOption('mg/mL');
  await panel.getByTestId('calc-run').click();
  // 5 mcg/kg/min × 70 kg × 60 ÷ 1600 mcg/mL (1.6 mg/mL × 1000) = 13.125 → 13.1 mL/h
  const result = panel.getByTestId('calc-result-infusion_rate_weight');
  await expect(result.getByTestId('calc-value')).toHaveText('13.1 mL/h');
  await expect(result).toContainText('350 mcg/min');
  await expect(result).toContainText('21 mg/h');
  await result.getByTestId('calc-basis').locator('summary').click();
  await expect(result.getByTestId('calc-basis')).toContainText('Rate (mL/h) = dose rate (mcg/kg/min) × weight (kg) × 60 ÷ concentration (mcg/mL)');
  await expect(result.getByTestId('calc-basis')).toContainText('owner decision 9');
  await expect(result.getByTestId('calc-steps')).toContainText('1600 mcg/mL (recorded 1.6 mg/mL, × 1000)');
  await expect(result.getByTestId('calc-steps')).toContainText('Rate = 5 × 70 × 60 ÷ 1600 = 13.1 mL/h');

  await page.getByTestId('task-calc-infusion_rate_volume').locator('summary').click();
  const fluid = page.getByTestId('calc-panel-infusion_rate_volume');
  const volume = fluid.locator('[data-input="volume"]');
  await volume.getByLabel('Value').fill('1000');
  await volume.getByLabel('Unit').selectOption('mL');
  const time = fluid.locator('[data-input="time"]');
  await time.getByLabel('Value').fill('8');
  await time.getByLabel('Unit').selectOption('h');
  await fluid.getByTestId('calc-run').click();
  // 1000 mL ÷ 8 h = 125 mL/h
  await expect(fluid.getByTestId('calc-result-infusion_rate_volume').getByTestId('calc-value')).toHaveText('125 mL/h');
  await shot(page, 'm2-19-infusion-rates');
  expect(w.errors).toEqual([]);
});

test('the renal dose review is locked by the Verify gate until its data is recorded', async ({ page }) => {
  const caseId = await newCaseWithData(page);
  await addMedication(page, caseId, { drug: 'enoxaparin' });
  await page.goto(`/#/cases/${caseId}/task/t08`);
  const med = page.locator('[data-testid^="scope-"]').first();
  const gate = med.getByTestId('renal-gate');
  await expect(gate).toHaveAttribute('data-ok', 'no');
  for (const item of ['weight', 'scr', 'dialysis', 'indication']) await expect(gate.locator(`[data-gate-item="${item}"]`)).toBeVisible();
  const renal = med.locator('[data-testid^="field-renal-"]');
  await expect(renal.getByRole('radio', { name: 'Adjustment needed', exact: true })).toBeDisabled();
  await expect(renal.getByRole('radio', { name: 'No adjustment needed', exact: true })).toBeDisabled();
  await expect(renal.getByRole('radio', { name: 'Unsure — needs checking' })).toBeEnabled();
  await shot(page, 'm2-06-renal-gate-locked');

  await addWeight(page, caseId, '60', '0');
  await addCreatinine(page, caseId, '1.1', '1');
  await addDialysisStatus(page, caseId);
  await addMedication(page, caseId, { drug: 'apixaban', indication: 'Atrial fibrillation' });
  await page.goto(`/#/cases/${caseId}/task/t08`);
  const apixaban = page.locator('[data-testid^="scope-"]').filter({ hasText: 'apixaban' });
  await expect(apixaban.getByTestId('renal-gate')).toHaveAttribute('data-ok', 'yes');
  await expect(apixaban.locator('[data-testid^="field-renal-"]').getByRole('radio', { name: 'Adjustment needed', exact: true })).toBeEnabled();
});

test('a calculator whose tests failed is hidden, with the reason', async ({ page, browser }) => {
  test.setTimeout(300_000);
  // Build a copy of the app that reads a manifest in which one calculator failed.
  const manifest = JSON.parse(readFileSync('src/calc/validation-manifest.json', 'utf8')) as { calculators: Record<string, { failed: number }> };
  manifest.calculators.child_pugh!.failed = 1;
  const dir = mkdtempSync(join(tmpdir(), 'preceptor-failing-'));
  const path = join(dir, 'manifest.json');
  writeFileSync(path, JSON.stringify(manifest));
  const outDir = join(dir, 'dist');
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { env: { ...process.env, PRECEPTOR_CALC_MANIFEST: path }, stdio: 'pipe' });
  const { spawn } = await import('node:child_process');
  const server = spawn('npx', ['vite', 'preview', '--outDir', outDir, '--port', '4180', '--strictPort'], { stdio: 'pipe', detached: true });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch('http://localhost:4180/')).ok) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const ctx = await browser.newContext({ baseURL: 'http://localhost:4180', serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.setDefaultTimeout(30_000);
    const original = page;
    void original;
    await onboard(p);
    await createRotation(p);
    const caseId = await createCase(p, { kind: 'teaching' });
    await p.goto(`/#/cases/${caseId}/calc`);
    await expect(p.getByTestId('calc-row-crcl_cg')).toBeVisible();
    await expect(p.getByTestId('calc-row-child_pugh')).toHaveCount(0);
    await expect(p.getByTestId('calc-hidden').locator('[data-hidden="child_pugh"]')).toContainText('A test of this calculator failed.');
    await p.screenshot({ path: `${SHOTS}/m2-07-hidden-calculator.png`, fullPage: true });
    // Not reachable directly either, and not offered in its task.
    await p.goto(`/#/cases/${caseId}/calc/child_pugh`);
    await expect(p.getByText('A test of this calculator failed.')).toBeVisible();
    await p.goto(`/#/cases/${caseId}/task/t08`);
    await expect(p.getByTestId('task-calc-crcl_cg')).toBeVisible();
    await expect(p.getByTestId('task-calc-child_pugh')).toHaveCount(0);
    await ctx.close();
  } finally {
    if (server.pid) process.kill(-server.pid, 'SIGTERM');
  }
});

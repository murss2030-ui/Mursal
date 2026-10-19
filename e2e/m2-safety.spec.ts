/**
 * M2 safety checks in the browser (Section 10), on the real offline data: a
 * documented allergy interrupts with a dialog that closes only with a recorded
 * reason; the acknowledgement holds until the data behind it changes; what
 * could not be checked is listed; a DDInter Moderate pair stays in the
 * collapsed informational group while a Major pair is an inline badge; WHO
 * AWaRe categories are shown; and a dataset that fails its checksum is refused.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCase, createRotation, onboard, unlock, watchPage } from './helpers';

const SHOTS = 'docs/m2/screenshots';
/** The owner's text, 19 October 2026. */
const WARNING =
  'Warning: the database is not connected to the internet and does not include all drug groups, such as cardiac drugs. The trainee must check interactions in the hospital’s approved references, such as Lexicomp or Micromedex.';
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

async function addEntry(page: Page, caseId: string, fill: (p: Page) => Promise<void>) {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await fill(page);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

async function addAllergy(page: Page, caseId: string, substance: string, reaction: string) {
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('note');
    await p.getByLabel('Hospital day').fill('0');
    await p.getByLabel('Kind of note').selectOption('allergy_adr');
    await p.getByRole('radio', { name: 'Allergy', exact: true }).check();
    await p.getByLabel('Drug or substance').fill(substance);
    await p.getByLabel(/^Reaction/).fill(reaction);
  });
}

async function addOrder(page: Page, caseId: string, o: { drug: string; amount: string; unit: string; route: string; frequency: string }) {
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('med_start');
    await p.getByLabel('Hospital day').fill('1');
    await p.getByLabel(/Drug — generic name/).fill(o.drug);
    await p.getByLabel('Amount', { exact: true }).fill(o.amount);
    await p.getByLabel('Dose unit', { exact: true }).selectOption(o.unit);
    await p.getByLabel('Route', { exact: true }).selectOption(o.route);
    await p.getByLabel('Frequency', { exact: true }).selectOption(o.frequency);
  });
}

test('a documented penicillin allergy interrupts a new amoxicillin order until acknowledged with a reason', async ({ page }) => {
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addAllergy(page, caseId, 'Penicillin', 'urticaria');

  // Nothing to interrupt yet; what could not be checked is listed, not presented as safe.
  await page.goto(`/#/cases/${caseId}`);
  const card = page.getByTestId('safety-card');
  await expect(card).toContainText('No alerts from the checks that could be made.');
  await expect(card.getByTestId('not-checked')).toHaveCount(0);
  await expect(page.getByTestId('critical-alert')).toHaveCount(0);

  // A new amoxicillin order: amoxicillin is in the FDA class "Penicillin-class Antibacterial".
  await addOrder(page, caseId, { drug: 'amoxicillin', amount: '500', unit: 'mg', route: 'PO', frequency: 'three times daily' });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-rule', 'allergy');
  await expect(dialog.getByRole('heading', { name: 'Documented allergy: Penicillin' })).toBeVisible();
  await expect(dialog).toContainText('Penicillin-class Antibacterial');
  await expect(dialog).toContainText('amoxicillin');
  await expect(dialog).toContainText('allergy recorded on Day 0 (urticaria)');
  await shot(page, 'm2-08-critical-allergy-alert');

  // The page behind it cannot be used, and the dialog does not close without a reason.
  await expect(page.getByRole('link', { name: 'Add entry' }).click({ timeout: 1500 })).rejects.toThrow(/intercepts pointer events|Timeout/);
  await dialog.getByRole('button', { name: 'Acknowledge with this reason' }).click();
  await expect(dialog).toContainText('Write the reason (at least 3 characters).');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  const reason = 'Discussed with the team: documented reaction was a mild rash; teaching case only';
  await dialog.getByLabel('Reason for continuing').fill(reason);
  await dialog.getByRole('button', { name: 'Acknowledge with this reason' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // The medication carries the alert as a badge, marked acknowledged.
  const med = page.getByTestId('active-med').filter({ hasText: 'amoxicillin — ' });
  await expect(med.getByTestId('alert-badges')).toContainText('Documented allergy: Penicillin');
  await expect(med.getByTestId('alert-badges')).toContainText('acknowledged');

  // The safety card shows it with the recorded reason.
  await page.goto(`/#/cases/${caseId}`);
  const row = page.getByTestId('safety-card').getByTestId('alert-row').filter({ hasText: 'Documented allergy: Penicillin' });
  await expect(row).toHaveAttribute('data-level', 'critical');
  await expect(row).toContainText(reason);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await shot(page, 'm2-09-safety-card');

  // In the stewardship task, the time-out prompt sits on the antimicrobial's own row (started Day 1, today Day 3).
  await page.goto(`/#/cases/${caseId}/task/t14`);
  const amoxRow = page.locator('[data-testid^="scope-"]').filter({ hasText: 'amoxicillin' });
  await expect(amoxRow.getByTestId('row-alerts')).toContainText('Antibiotic time-out due: amoxicillin');
  await expect(page.getByTestId('task-alerts')).toContainText('Antibiotic time-out due: amoxicillin');

  // The acknowledgement is in the audit log, with its reason.
  await page.goto(`/#/cases/${caseId}/audit`);
  const ackEvent = page.locator('[data-testid="audit-event"][data-entity="alert"][data-action="acknowledge"]');
  await expect(ackEvent).toHaveCount(1);
  await ackEvent.getByText('Details').click();
  await expect(ackEvent.locator('pre')).toContainText(reason);

  // It persists: after a reload and unlock, the same alert does not interrupt again.
  await page.reload();
  await unlock(page);
  await page.goto(`/#/cases/${caseId}/timeline`);
  await expect(page.getByTestId('active-med').filter({ hasText: 'amoxicillin — ' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // New data — a second penicillin-class order — interrupts again, for that order.
  await addOrder(page, caseId, { drug: 'piperacillin / tazobactam', amount: '4.5', unit: 'g', route: 'IV', frequency: 'every 8 hours' });
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toContainText('piperacillin');
  await page.getByRole('alertdialog').getByLabel('Reason for continuing').fill('Test of a second alert');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Acknowledge with this reason' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Only the app's own origin was contacted (the vocabulary is served and checked locally).
  const outside = watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(outside).toEqual([]);
  expect(watch.errors.filter((e) => /CSP violation/.test(e))).toEqual([]);
});

test('an unrecognised drug name is listed as not checked', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addAllergy(page, caseId, 'Penicillin', 'rash');
  await addOrder(page, caseId, { drug: 'Zyntrax', amount: '10', unit: 'mg', route: 'PO', frequency: 'once daily' });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.goto(`/#/cases/${caseId}`);
  const notChecked = page.getByTestId('safety-card').getByTestId('not-checked');
  await expect(notChecked).toContainText('"Zyntrax" was not checked for allergies, duplications or interactions: the name is not recognised.');
});

// ---------------------------------------------------------------- interaction levels and AWaRe, on the real data

test('a DDInter Moderate pair stays in the collapsed group; a Major pair is a badge; AWaRe is shown (real data)', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addOrder(page, caseId, { drug: 'enoxaparin', amount: '40', unit: 'mg', route: 'subcut', frequency: 'once daily' });
  await addOrder(page, caseId, { drug: 'ibuprofen', amount: '400', unit: 'mg', route: 'PO', frequency: 'three times daily' });
  await addOrder(page, caseId, { drug: 'furosemide', amount: '40', unit: 'mg', route: 'IV', frequency: 'once daily' });
  await addOrder(page, caseId, { drug: 'ceftriaxone', amount: '1', unit: 'g', route: 'IV', frequency: 'once daily' });

  // Nothing interrupts: no ONC list has been entered on this device.
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  // DDInter Major (enoxaparin + ibuprofen): an inline badge on both medicines.
  for (const drug of ['enoxaparin', 'ibuprofen']) {
    await expect(page.getByTestId('active-med').filter({ hasText: `${drug} — ` }).getByTestId('alert-badges')).toContainText('Interaction (major): enoxaparin + ibuprofen');
  }
  // DDInter Moderate (furosemide + ibuprofen): no badge on furosemide.
  await expect(page.getByTestId('active-med').filter({ hasText: 'furosemide — ' }).getByTestId('alert-badges')).toHaveCount(0);

  await page.goto(`/#/cases/${caseId}`);
  const card = page.getByTestId('safety-card');
  const major = card.getByTestId('alert-row').filter({ hasText: 'Interaction (major): enoxaparin + ibuprofen' });
  await expect(major).toHaveAttribute('data-level', 'important');
  await expect(major).toContainText('DDInter level: major — highly clinically significant');
  await expect(major).toContainText('Xiong G, et al. DDInter');
  const group = card.getByTestId('informational-group');
  await expect(group).not.toHaveAttribute('open', '');
  const moderate = group.getByTestId('alert-row').filter({ hasText: 'Interaction (moderate): furosemide + ibuprofen' });
  await expect(moderate).toBeHidden();
  await expect(card.getByTestId('alert-row').filter({ hasText: 'Interaction (moderate)' })).toHaveCount(1);
  await group.locator('summary').click();
  await expect(moderate).toBeVisible();
  await expect(moderate).toHaveAttribute('data-level', 'informational');
  // WHO AWaRe 2025: ceftriaxone is Watch.
  await expect(group.getByTestId('alert-row').filter({ hasText: 'AWaRe: Watch — ceftriaxone' })).toBeVisible();
  // What was not checked is said: no ONC list, so nothing is raised to critical.
  await expect(card.getByTestId('not-checked')).toContainText('The ONC high-priority list has not been entered on this device');
  // The owner's fixed warning on the limits of the interaction data.
  await expect(card.getByTestId('interaction-coverage-warning')).toHaveText(WARNING);
  await shot(page, 'm2-10-interaction-levels');

  // Task 6 (interactions) carries the same warning, and says the trainee writes the mechanism and the management.
  await page.goto(`/#/cases/${caseId}/task/t06`);
  await expect(page.getByTestId('task-alerts').getByTestId('interaction-coverage-warning')).toHaveText(WARNING);
  await expect(page.getByTestId('task-alerts').getByTestId('alert-row').filter({ hasText: 'Interaction (major): enoxaparin + ibuprofen' })).toContainText(
    'PRECEPTOR gives the level only: look up the mechanism and the management in your hospital’s approved reference and write them in Task 6.',
  );

  // In the stewardship task, the AWaRe tag sits on the antibiotic's own row.
  await page.goto(`/#/cases/${caseId}/task/t14`);
  await expect(page.locator('[data-testid^="scope-"]').filter({ hasText: 'ceftriaxone' }).getByTestId('row-alerts')).toContainText('AWaRe: Watch — ceftriaxone');
  // The department form's Section 7 lists the automatic rows, apart from the trainee's own.
  await page.goto(`/#/cases/${caseId}/form`);
  const auto = page.locator('[data-section="7"]').getByTestId('form-automatic-interactions');
  await expect(auto).toHaveAttribute('data-checked', 'true');
  await expect(auto).toContainText('enoxaparin');
  await expect(auto).toContainText('Source: DDInter download files');
  await expect(auto.getByTestId('form-automatic-gap').filter({ hasText: 'The ONC high-priority list has not been entered on this device' })).toHaveCount(1);
  await expect(auto.getByTestId('interaction-coverage-warning')).toHaveText(WARNING);
  // Ceftriaxone (J) + furosemide (C): a pair outside DDInter's download files, said so.
  await expect(auto.getByTestId('form-automatic-gap').filter({ hasText: 'Not checked for interactions: ceftriaxone + furosemide' })).toHaveCount(1);
});

test('two drugs outside the DDInter download files are listed as not checked, never as safe (real data)', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  // Both cardiovascular (ATC C): DDInter's download files do not hold this pair.
  await addOrder(page, caseId, { drug: 'amiodarone', amount: '200', unit: 'mg', route: 'PO', frequency: 'once daily' });
  await addOrder(page, caseId, { drug: 'digoxin', amount: '0.125', unit: 'mg', route: 'PO', frequency: 'once daily' });
  await page.goto(`/#/cases/${caseId}`);
  const notChecked = page.getByTestId('safety-card').getByTestId('not-checked');
  await expect(notChecked).toContainText('Not checked for interactions: amiodarone + digoxin');
  await expect(page.getByTestId('safety-card').getByTestId('alert-row').filter({ hasText: 'Interaction' })).toHaveCount(0);
});

// ---------------------------------------------------------------- the ONC list, entered by the administrator

test('an ONC pair entered by the administrator makes two medicines a critical alert (test entry, not the ONC list)', async ({ page }) => {
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  await page.goto('/#/reference');
  await expect(page.getByTestId('dataset-status').locator('[data-dataset="onc"]')).toHaveAttribute('data-installed', 'false');
  await page.getByTestId('ref-open-onc').click();
  await expect(page.getByText('The ONC high-priority drug–drug interaction list (Phansalkar et al., J Am Med Inform Assoc 2012)')).toBeVisible();
  await page.getByRole('link', { name: 'Add', exact: true }).click();
  await expect(page).toHaveURL(/#\/reference\/onc\/new$/);

  await page.getByLabel('The pair, as the source names it').fill('Test pair (browser test, not the ONC list)');
  await page.getByLabel('First side: drugs or drug classes').fill('simvastatin');
  await page.getByLabel('Second side: drugs or drug classes').fill('clarithromycn, Proton Pump Inhibitors');
  await expect(page.getByTestId('onc-side-a')).toContainText('simvastatin → simvastatin (RxCUI');
  const sideB = page.getByTestId('onc-side-b');
  await expect(sideB.locator('[data-kind="unknown"]')).toHaveText('clarithromycn → not recognised: use a generic name or the exact name of a drug class');
  await expect(sideB.locator('[data-kind="class"]')).toContainText('Proton Pump Inhibitors → drug class Proton Pump Inhibitor (FDA EPC):');
  await page.getByLabel('Reference, with page or table').fill('Browser test source');
  await page.getByLabel('Verified by').fill('Test');
  await page.getByTestId('ref-save').click();
  await expect(page.getByText('Some names are not recognised: correct them as shown below.')).toBeVisible();
  await page.getByLabel('Second side: drugs or drug classes').fill('clarithromycin, Proton Pump Inhibitors');
  await expect(sideB.locator('[data-kind="unknown"]')).toHaveCount(0);
  await page.getByTestId('ref-save').click();
  await expect(page).toHaveURL(/#\/reference\/onc$/);
  await expect(page.getByTestId('ref-row')).toHaveCount(1);
  await expect(page.getByTestId('ref-row')).toContainText('Test pair (browser test, not the ONC list)');
  await expect(page.getByTestId('ref-row')).toContainText('simvastatin + clarithromycin, Proton Pump Inhibitors · Browser test source');
  await shot(page, 'm2-17-onc-entry');

  // Two medicines under the pair: a critical alert, whatever DDInter says.
  const caseId = await createCase(page, { kind: 'teaching' });
  await addOrder(page, caseId, { drug: 'simvastatin', amount: '40', unit: 'mg', route: 'PO', frequency: 'once daily' });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await addOrder(page, caseId, { drug: 'clarithromycin', amount: '500', unit: 'mg', route: 'PO', frequency: 'twice daily' });
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-rule', 'interaction');
  await expect(dialog.getByRole('heading', { name: 'Interaction (ONC high-priority): clarithromycin + simvastatin' })).toBeVisible();
  await expect(dialog).toContainText('On the ONC high-priority list entered on this device: “Test pair (browser test, not the ONC list)”. DDInter level: major.');
  await expect(dialog).toContainText('ONC high-priority list, as entered on this device: Browser test source');
  await dialog.getByLabel('Reason for continuing').fill('Browser test: the pair is a test entry');
  await dialog.getByRole('button', { name: 'Acknowledge with this reason' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // The list now counts as entered: the "not entered" note is gone, and Reference tables shows it.
  await page.goto(`/#/cases/${caseId}`);
  const card = page.getByTestId('safety-card');
  await expect(card.getByTestId('alert-row').filter({ hasText: 'Interaction (ONC high-priority): clarithromycin + simvastatin' })).toHaveAttribute('data-level', 'critical');
  await expect(card).not.toContainText('has not been entered');
  await page.goto('/#/reference');
  const onc = page.getByTestId('dataset-status').locator('[data-dataset="onc"]');
  await expect(onc).toHaveAttribute('data-installed', 'entered');
  await expect(onc).toContainText('pairs entered on this device: 1');
  expect(watch.errors).toEqual([]);
});

// ---------------------------------------------------------------- a dataset that fails its checksum is refused

function corruptedManifestBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preceptor-ds-'));
  const manifest = JSON.parse(readFileSync(resolve('src/data/datasets.json'), 'utf8')) as { datasets: Record<string, { sha256: string }> };
  // The file is the real one; the recorded checksum is not: the app must refuse the file.
  manifest.datasets.interactions!.sha256 = createHash('sha256').update('not the interaction file').digest('hex');
  const manifestPath = join(dir, 'datasets.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const outDir = join(dir, 'dist');
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { env: { ...process.env, PRECEPTOR_TEST_DATASETS: manifestPath }, stdio: 'pipe' });
  return outDir;
}

test('an interaction file whose checksum does not match is refused, and the check is reported as not made', async ({ browser }) => {
  const outDir = corruptedManifestBuild();
  const server = spawn('npx', ['vite', 'preview', '--outDir', outDir, '--port', '4181', '--strictPort'], { stdio: 'pipe', detached: true });
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch('http://localhost:4181/')).ok) break;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    const ctx = await browser.newContext({ baseURL: 'http://localhost:4181', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await onboard(page);
    await createRotation(page);
    const caseId = await createCase(page, { kind: 'teaching' });
    await addOrder(page, caseId, { drug: 'enoxaparin', amount: '40', unit: 'mg', route: 'subcut', frequency: 'once daily' });
    await addOrder(page, caseId, { drug: 'ibuprofen', amount: '400', unit: 'mg', route: 'PO', frequency: 'three times daily' });
    await page.goto(`/#/cases/${caseId}`);
    const card = page.getByTestId('safety-card');
    await expect(card.getByTestId('not-checked')).toContainText('Drug–drug interactions were not checked: the dataset could not be loaded or failed its integrity check.');
    await expect(card.getByTestId('alert-row').filter({ hasText: 'Interaction' })).toHaveCount(0);
    await ctx.close();
  } finally {
    if (server.pid) process.kill(-server.pid, 'SIGTERM');
  }
});

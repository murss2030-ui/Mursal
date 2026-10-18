/**
 * M2 safety checks in the browser (Section 10): a documented allergy
 * interrupts with a dialog that closes only with a recorded reason; the
 * acknowledgement holds until the data behind it changes; what could not be
 * checked is listed; and a moderate interaction stays in the collapsed
 * informational group while a major one is an inline badge.
 *
 * No interaction dataset is installed (the DDInter hosts are not reachable
 * from the build environment), so the interaction test runs on a separate
 * build that carries a small file marked as a test fixture — never clinical
 * data, and never part of the production build.
 */
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createCase, createRotation, onboard, unlock, watchPage } from './helpers';

const SHOTS = 'docs/m2/screenshots';
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
  await expect(card.getByTestId('not-checked')).toContainText('Drug–drug interactions were not checked: the DDInter and ONC datasets are not installed yet.');
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

// ---------------------------------------------------------------- interaction levels, on a build with a test fixture

const FIXTURE = {
  dataset: 'interactions',
  version: 'test fixture 1',
  citation: 'TEST FIXTURE for an end-to-end test — not clinical data, not DDInter',
  pairs: [
    ['67108', '7646', 'moderate', false, 'Test fixture record (not a real interaction).', 'Test fixture record.'],
    ['67108', '5640', 'major', false, 'Test fixture record (not a real interaction).', 'Test fixture record.'],
  ],
};

function fixtureBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preceptor-ds-'));
  const file = join(dir, 'interactions-test.json');
  const text = JSON.stringify(FIXTURE);
  writeFileSync(file, text);
  const manifest = JSON.parse(readFileSync(resolve('src/data/datasets.json'), 'utf8')) as { datasets: Record<string, unknown> };
  manifest.datasets.interactions = {
    file: 'data/interactions-test.json',
    fixture: file,
    title: 'Interaction test fixture',
    version: FIXTURE.version,
    retrievedAt: '2026-10-18',
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    source: FIXTURE.citation,
    licence: 'Test data written for this test.',
    testFixture: true,
  };
  const manifestPath = join(dir, 'datasets.json');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const outDir = join(dir, 'dist');
  execFileSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir'], { env: { ...process.env, PRECEPTOR_TEST_DATASETS: manifestPath }, stdio: 'pipe' });
  return outDir;
}

test('a moderate interaction stays in the collapsed informational group; a major one is a badge (test fixture)', async ({ browser }) => {
  const outDir = fixtureBuild();
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
    await addOrder(page, caseId, { drug: 'omeprazole', amount: '20', unit: 'mg', route: 'PO', frequency: 'once daily' });
    await addOrder(page, caseId, { drug: 'ibuprofen', amount: '400', unit: 'mg', route: 'PO', frequency: 'three times daily' });

    // Neither interrupts.
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // The major one is an inline badge on both medications.
    for (const drug of ['enoxaparin', 'ibuprofen']) {
      await expect(page.getByTestId('active-med').filter({ hasText: `${drug} — ` }).getByTestId('alert-badges')).toContainText('Interaction (major): enoxaparin + ibuprofen');
    }
    // The moderate one is not a badge…
    await expect(page.getByTestId('active-med').filter({ hasText: 'omeprazole — ' }).getByTestId('alert-badges')).toHaveCount(0);

    // …and on the safety card it is inside the collapsed informational group only.
    await page.goto(`/#/cases/${caseId}`);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    const card = page.getByTestId('safety-card');
    const major = card.getByTestId('alert-row').filter({ hasText: 'Interaction (major)' });
    await expect(major).toHaveAttribute('data-level', 'important');
    await expect(major).toBeVisible();
    const group = card.getByTestId('informational-group');
    await expect(group).not.toHaveAttribute('open', '');
    const moderate = group.getByTestId('alert-row').filter({ hasText: 'Interaction (moderate): enoxaparin + omeprazole' });
    await expect(moderate).toBeHidden();
    await expect(card.getByTestId('alert-row').filter({ hasText: 'Interaction (moderate)' })).toHaveCount(1);
    await group.locator('summary').click();
    await expect(moderate).toBeVisible();
    await expect(moderate).toHaveAttribute('data-level', 'informational');
    await expect(moderate).toContainText('TEST FIXTURE for an end-to-end test — not clinical data, not DDInter');
    // With a dataset present, interactions are no longer listed as not checked.
    await expect(card).not.toContainText('Drug–drug interactions were not checked');
    await shot(page, 'm2-10-interaction-levels-test-fixture');
    await ctx.close();
  } finally {
    if (server.pid) process.kill(-server.pid, 'SIGTERM');
  }
});

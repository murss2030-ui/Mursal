import { expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

export const PASSPHRASE = 'synthetic test passphrase';

/** Collects console errors and CSP violations so tests can assert there were none. */
export function watchPage(page: Page): { errors: string[]; requests: string[] } {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('request', (r) => requests.push(r.url()));
  void page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { errors, requests };
}

export async function onboard(page: Page, passphrase = PASSPHRASE): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Before you start' })).toBeVisible();
  await expect(page.getByTestId('intended-use-statement')).toContainText('It is not intended for diagnosis, treatment, or patient-care decisions.');
  const cont = page.getByRole('button', { name: 'Acknowledge and continue' });
  await expect(cont).toBeDisabled();
  await page.getByLabel(/I have read and understood the intended use/).check();
  await cont.click();
  await expect(page.getByRole('heading', { name: 'Protect the records on this device' })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByLabel('Repeat the passphrase').fill(passphrase);
  await page.getByLabel(/I understand that if I forget my passphrase/).check();
  await page.getByRole('button', { name: 'Encrypt and continue' }).click();
  await expect(page.getByRole('heading', { name: 'Current rotation' })).toBeVisible({ timeout: 30_000 });
}

export async function unlock(page: Page, passphrase = PASSPHRASE): Promise<void> {
  await expect(page.getByRole('heading', { name: 'PRECEPTOR is locked' })).toBeVisible();
  await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 30_000 });
}

export function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function createRotation(page: Page): Promise<void> {
  await page.goto('/#/rotations/new');
  await page.getByLabel('Department').selectOption('internal_medicine');
  await page.getByLabel('Start date').fill(isoDate(-10));
  await page.getByLabel('End date').fill(isoDate(20));
  await page.getByLabel('Direct patient care').check();
  await page.getByRole('button', { name: 'Save rotation' }).click();
  await expect(page.getByRole('heading', { name: 'Rotations' })).toBeVisible();
}

export async function createCase(
  page: Page,
  opts: { kind: 'teaching' | 'clinical'; age?: string; admissionOffset?: number; name?: string; mrn?: string; consultant?: string },
): Promise<string> {
  await page.goto('/#/cases/new');
  await page.getByRole('radio', { name: opts.kind === 'clinical' ? /Clinical Case/ : /Teaching Case/ }).check();
  await page.getByLabel('Age (years)').fill(opts.age ?? '67');
  await page.getByRole('radio', { name: 'Female' }).check();
  await page.getByLabel(/Height \(cm\)/).fill('158');
  await page.getByLabel(/Admission date/).fill(isoDate(opts.admissionOffset ?? -3));
  await page.getByLabel(/Ward \/ unit/).fill('Medical ward B');
  if (opts.kind === 'clinical') {
    if (opts.name) await page.getByLabel(/Patient name/).fill(opts.name);
    if (opts.mrn) await page.getByLabel(/MRN \/ ID/).fill(opts.mrn);
    await page.getByLabel(/Room \/ bed/).fill('Bed 14');
    await page.getByLabel(/Consultant/).fill(opts.consultant ?? 'Dr Synthetic Consultant');
  }
  await page.getByLabel(/I confirm this case contains synthetic/).check();
  await page.getByRole('button', { name: 'Create case' }).click();
  // Step 2 of the new-case flow: the patient file.
  await expect(page).toHaveURL(/#\/cases\/CASE-\d+\/intake/);
  const id = /CASE-\d+/.exec(page.url())![0];
  await expect(page.getByRole('heading', { name: 'Add the patient file' })).toBeVisible();
  return id;
}

export async function addCreatinine(page: Page, caseId: string, value: string, day: string): Promise<void> {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('lab');
  await page.getByLabel('Hospital day').fill(day);
  await page.getByLabel('Test').selectOption('scr');
  await page.getByLabel('Value', { exact: true }).fill(value);
  await page.getByLabel('Unit', { exact: true }).selectOption('mg/dL');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

/** Starts its own `vite preview` so a test can stop the server (true offline). */
export async function startPreview(port: number): Promise<ChildProcess> {
  const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return proc;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

export async function stopPreview(proc: ChildProcess, port: number): Promise<void> {
  if (proc.pid) {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      proc.kill('SIGTERM');
    }
  }
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://localhost:${port}/`);
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      return; // connection refused: the server is down
    }
  }
  throw new Error('preview server did not stop');
}

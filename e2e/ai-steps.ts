/**
 * Steps shared by the simulated (m3-ai.spec.ts) and the live (m3-live.spec.ts)
 * walkthroughs of M3, so both run exactly the same path through the app.
 */
import { expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LAB_PAGE_LINES } from './ai-fixtures';

const TMP = 'test-results/fixtures';

export async function shot(page: Page, name: string, full = false, dir = process.env.PRECEPTOR_SHOTS_DIR ?? 'test-results/screenshots') {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: full });
}

export const dmy = (iso: string) => iso.split('-').reverse().join('/');

/** The photographed laboratory page: identifiers on the top line, results below, one handwritten line. */
export async function labPagePng(page: Page): Promise<string> {
  const dataUrl = await page.evaluate((lines) => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1e293b';
    g.font = 'bold 44px sans-serif';
    g.fillText(lines.identifiers, 60, 110);
    g.font = '36px sans-serif';
    g.fillText(lines.title, 60, 260);
    g.fillText(lines.creatinine, 60, 365);
    g.fillText(lines.potassium, 60, 445);
    g.fillText(lines.crp, 60, 526);
    g.font = 'italic 38px serif';
    g.fillText(lines.insulin, 60, 605);
    return c.toDataURL('image/png');
  }, LAB_PAGE_LINES);
  mkdirSync(TMP, { recursive: true });
  const path = `${TMP}/synthetic-lab-page.png`;
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  return path;
}

export async function addTypedNote(page: Page, text: string, removeIdentifiers: boolean, day?: number) {
  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('text-source-editor')).toBeVisible();
  await page.getByLabel('Document type').selectOption('admission_note');
  if (day !== undefined) await page.getByLabel(/Hospital day of the document/).fill(String(day));
  await page.getByLabel('Text', { exact: true }).fill(text);
  if (removeIdentifiers) {
    await expect(page.getByTestId('identifier-check')).toContainText('Possible identifiers found');
    await page.getByRole('button', { name: 'Remove all' }).click();
  }
  await page.getByLabel(/I have removed every identifier/).check();
  await page.getByRole('button', { name: 'Save to the patient file' }).click();
  await expect(page.getByTestId('intake')).toBeVisible();
}

export async function addLabPage(page: Page) {
  await page.getByTestId('camera-input').setInputFiles(await labPagePng(page));
  const editor = page.getByTestId('redaction-editor');
  await expect(editor).toBeVisible();
  const box = (await page.getByTestId('redaction-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.12, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.98, box.y + box.height * 0.18, { steps: 5 });
  await page.mouse.up();
  await expect(editor.getByText('Covers drawn: 1')).toBeVisible();
  await editor.getByLabel('Document type').selectOption('lab_report');
  await editor.getByLabel(/Hospital day of the document/).fill('1');
  await editor.getByLabel(/I have redacted all identifiers/).check();
  await editor.getByRole('button', { name: 'Save this page' }).click();
  await expect(editor).toBeHidden();
}

/**
 * Settings → AI service: the relay's suggested models are offered; nothing is used until saved.
 * `offered` is what the relay suggests (checked the first time); `models` what the trainee chooses.
 */
export async function saveModels(page: Page, models: { extract?: string; analyse?: string } = {}, offered: { extract: string; analyse: string } | null = { extract: 'reader-test-1', analyse: 'drafter-test-1' }) {
  await page.goto('/#/settings/ai');
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'ready');
  const extract = page.getByLabel('Model for reading documents');
  const analyse = page.getByLabel('Model for case analysis');
  if (offered) {
    await expect(extract).toHaveValue(offered.extract);
    await expect(analyse).toHaveValue(offered.analyse);
  }
  if (models.extract) await extract.selectOption(models.extract);
  if (models.analyse) await analyse.selectOption(models.analyse);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

export const field = (page: Page, id: string) => page.locator(`[data-testid="review-field"][data-field="${id}"]`);
export const suggestion = (page: Page, text: string | RegExp) => page.locator('[data-testid="suggestion"][data-decision="pending"]').filter({ hasText: text });

/** Asserts the page image the model received is the redacted one: black over the identifiers, untouched below. */
export async function expectRedactedImage(page: Page, base64: string) {
  const px = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const at = (fx: number, fy: number) => Array.from(g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3));
    return { covered: [at(0.1, 0.08), at(0.3, 0.12), at(0.5, 0.1)], clear: at(0.9, 0.95) };
  }, base64);
  for (const p of px.covered) expect(Math.max(...p)).toBeLessThan(40);
  expect(Math.min(...px.clear)).toBeGreaterThan(215);
}

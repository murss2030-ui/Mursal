/**
 * M1 revision (owner's change request of 15 October 2026): the patient file
 * (typed text, uploaded files, photographs, PDF) with identifiers removed
 * before storage, then "Next" into the Clinical Modules and the task
 * worksheets, with progress tracking and the department form fed from them.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createCase, createRotation, onboard, watchPage } from './helpers';

const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'test-results/screenshots';
const TMP = 'test-results/fixtures';

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
}

/** A synthetic chart page drawn in the browser: identifiers on the top line, clinical values below. */
async function syntheticChartPng(page: Page): Promise<string> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1e293b';
    g.font = 'bold 44px sans-serif';
    g.fillText('Name: SYNTHETIC ALPHA   MRN 00451287', 60, 110);
    g.font = '36px sans-serif';
    g.fillText('Laboratory report (synthetic)', 60, 260);
    g.fillText('Serum creatinine 2.1 mg/dL', 60, 360);
    g.fillText('Potassium 5.4 mmol/L', 60, 440);
    g.fillText('WBC 14.2 x10^9/L', 60, 520);
    return c.toDataURL('image/png');
  });
  mkdirSync(TMP, { recursive: true });
  const path = `${TMP}/synthetic-chart.png`;
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  return path;
}

/** A minimal, valid one-page PDF with a text layer (offsets computed, so no repair is needed). */
function syntheticPdf(): string {
  const text = 'Synthetic discharge letter. Amlodipine 5 mg once daily. Metformin 500 mg twice daily.';
  const stream = `BT /F1 14 Tf 40 760 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  mkdirSync(TMP, { recursive: true });
  const path = `${TMP}/synthetic-letter.pdf`;
  writeFileSync(path, body, 'latin1');
  return path;
}

test('new case → patient file (typed, photographed, PDF) → Next → Clinical Modules → worksheet → form', async ({ page }) => {
  test.setTimeout(180_000);
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  await page.goto('/#/');
  await shot(page, 'r01-home');

  const caseId = await createCase(page, { kind: 'clinical', age: '64', name: 'Saleh Qaid', mrn: 'MRN-77120', consultant: 'Dr Hamdan Saif' });
  await expect(page.getByTestId('intake')).toBeVisible();
  await shot(page, 'r02-intake');

  // 1. Typed text: the case's own identifiers and labelled lines are found and removed before saving.
  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('text-source-editor')).toBeVisible();
  await page.getByLabel('Document type').selectOption('admission_note');
  await page
    .getByLabel('Text', { exact: true })
    .fill('Patient name: Saleh Qaid\nMRN: MRN-77120\nPhone 777 123 456\n64-year-old man, fever and productive cough for 3 days (synthetic).\nSaleh chews khat daily. Seen by Dr Hamdan on the ward round.\nCreatinine 2.1 mg/dL on admission.');
  await expect(page.getByTestId('identifier-check')).toContainText('Possible identifiers found');
  await shot(page, 'r03-text-identifiers', true);
  // Nothing is stored before the trainee confirms.
  await page.getByRole('button', { name: 'Save to the patient file' }).click();
  await expect(page.getByText('Please confirm this statement.')).toBeVisible();
  await page.getByRole('button', { name: 'Remove all' }).click();
  await expect(page.getByLabel('Text', { exact: true })).not.toHaveValue(/Saleh|MRN-77120|777 123 456|Hamdan/);
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(/fever and productive cough/);
  await page.getByLabel(/I have removed every identifier/).check();
  await page.getByRole('button', { name: 'Save to the patient file' }).click();
  await expect(page.getByTestId('intake')).toBeVisible();
  await expect(page.getByTestId('source-row')).toHaveCount(1);

  // 2. A photographed page: covered with a box, burned into the saved pixels.
  const png = await syntheticChartPng(page);
  await page.getByTestId('camera-input').setInputFiles(png);
  const editor = page.getByTestId('redaction-editor');
  await expect(editor).toBeVisible();
  const canvas = page.getByTestId('redaction-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  // The identifiers are on the top line (y ≈ 110 of 900): cover the band from 5% to 18% of the height.
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.05);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.12, { steps: 5 });
  await page.mouse.move(box.x + box.width * 0.98, box.y + box.height * 0.18, { steps: 5 });
  await page.mouse.up();
  await expect(editor.getByText('Covers drawn: 1')).toBeVisible();
  await editor.getByLabel('Document type').selectOption('lab_report');
  const saveBtn = editor.getByRole('button', { name: 'Save this page' });
  await expect(saveBtn).toBeDisabled(); // not before the confirmation
  await shot(page, 'r04-redaction');
  await editor.getByLabel(/I have redacted all identifiers/).check();
  await saveBtn.click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId('source-row')).toHaveCount(2);

  // The stored image really is black where the identifiers were, and untouched elsewhere.
  await page.locator('[data-testid="source-row"][data-kind="image"]').click();
  const img = page.getByTestId('source-image');
  await expect(img).toBeVisible();
  const px = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    const c = document.createElement('canvas');
    c.width = el.naturalWidth;
    c.height = el.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(el, 0, 0);
    const at = (fx: number, fy: number) => Array.from(g.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3));
    return { covered: [at(0.3, 0.12), at(0.5, 0.1), at(0.1, 0.08)], clear: at(0.9, 0.95) };
  });
  for (const p of px.covered) expect(Math.max(...p)).toBeLessThan(40);
  expect(Math.min(...px.clear)).toBeGreaterThan(215);
  await shot(page, 'r05-source-viewer');

  // Transcribe a value from the source: the entry keeps its link to the document.
  await page.getByRole('link', { name: 'Add an entry from this document' }).click();
  await expect(page.getByTestId('source-peek')).toBeVisible();
  await page.getByLabel('Entry type').selectOption('lab');
  await page.getByLabel('Hospital day').fill('0');
  await page.getByLabel('Test').selectOption('scr');
  await page.getByLabel('Value', { exact: true }).fill('2.1');
  await page.getByLabel('Unit', { exact: true }).selectOption('mg/dL');
  await shot(page, 'r06-transcribe');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page.getByTestId('source-viewer')).toBeVisible();
  await expect(page.getByText('Entries transcribed from this document (1)')).toBeVisible();

  // 3. A PDF, read on the device and imported as text.
  await page.goto(`/#/cases/${caseId}/intake`);
  await page.getByTestId('file-input').setInputFiles(syntheticPdf());
  await page.getByRole('button', { name: /As text/ }).click();
  await expect(page.getByTestId('text-source-editor')).toBeVisible();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(/Amlodipine 5 mg once daily/);
  await page.getByLabel('Document type').selectOption('discharge_summary');
  await page.getByLabel(/I have removed every identifier/).check();
  await page.getByRole('button', { name: 'Save to the patient file' }).click();
  await expect(page.getByTestId('source-row')).toHaveCount(3);

  // Next → the Clinical Modules.
  await page.getByRole('link', { name: 'Next: Clinical modules' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/modules$`));
  await expect(page.getByTestId('modules-hub')).toBeVisible();
  for (const m of ['collect', 'review', 'dosing', 'safety', 'plan', 'followup', 'discharge', 'document']) {
    await expect(page.getByTestId(`module-${m}`)).toBeVisible();
  }
  await expect(page.getByTestId('next-task')).toContainText('Patient Data Collection');
  await shot(page, 'r07-modules-hub');
  await shot(page, 'r07b-modules-hub-full', true);

  // Module 1 lists tasks 1, 2 and 22.
  await page.getByTestId('module-collect').click();
  await expect(page.getByTestId('task-row-1')).toBeVisible();
  await expect(page.getByTestId('task-row-2')).toBeVisible();
  await expect(page.getByTestId('task-row-22')).toBeVisible();
  await shot(page, 'r08-module-collect');

  // Task 1: readiness names what is missing; the transcribed creatinine is found.
  await page.getByTestId('task-row-1').click();
  await expect(page.getByTestId('task-page')).toBeVisible();
  await expect(page.locator('[data-need="scr"]')).toHaveAttribute('data-state', 'ok');
  await expect(page.locator('[data-need="weight"]')).toHaveAttribute('data-state', 'missing');
  await expect(page.locator('[data-need="sources"]')).toHaveAttribute('data-state', 'ok');
  await shot(page, 'r09-task1', true);

  // Task 2: build the pre-admission list in the shared register, answer the checklist, save.
  await page.goto(`/#/cases/${caseId}/task/t02`);
  await page.getByRole('link', { name: 'Add medication' }).click();
  await expect(page.getByTestId('item-editor')).toBeVisible();
  await page.getByLabel('Medication (generic name)').fill('amlodipine');
  await page.getByLabel('Dose, route and frequency as actually taken').fill('5 mg PO once daily');
  await page.getByRole('button', { name: 'Patient interview' }).click();
  await page.getByRole('button', { name: 'Medication containers' }).click();
  await page.getByTestId('field-admissionStatus').getByRole('radio', { name: 'Not ordered' }).click();
  await page.getByTestId('field-discrepancy').getByRole('radio', { name: 'Unintentional' }).click();
  await page.getByLabel('Type of unintentional discrepancy').selectOption('omission');
  await shot(page, 'r10-item-editor', true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('task-page')).toBeVisible();
  await expect(page.getByTestId('item-home_med')).toContainText('amlodipine');

  await page.getByTestId('check-two_sources').getByRole('radio', { name: 'OK' }).click();
  await page.getByTestId('check-all_compared').getByRole('radio', { name: 'Problem' }).click();
  await expect(page.getByTestId('check-all_compared').getByRole('link', { name: 'Record as a DRP' })).toBeVisible();

  // "Done" is refused while items are unanswered…
  await page.getByTestId('task-status').getByRole('radio', { name: 'Done' }).click();
  await expect(page.getByTestId('done-blocked')).toContainText('4 item(s) still unanswered');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('4 item(s) still unanswered');
  await expect(page.getByText('Saved · version 1')).toHaveCount(0);

  // …and accepted once every item is answered (N/A counts as an answer).
  await page.getByTestId('check-otc_herbal').getByRole('radio', { name: 'OK' }).click();
  await page.getByTestId('check-allergies_confirmed').getByRole('radio', { name: 'OK' }).click();
  await page.getByTestId('check-new_orders').getByRole('radio', { name: 'N/A' }).click();
  await page.getByTestId('check-discrepancies_resolved').getByRole('radio', { name: 'OK' }).click();
  await expect(page.getByTestId('done-blocked')).toHaveCount(0);
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved · version 1')).toBeVisible();
  await expect(page.getByText('6 of 6 answered')).toBeVisible();
  await shot(page, 'r11-task2', true);

  // Progress: the hub and the case header count the task as complete.
  await page.goto(`/#/cases/${caseId}/modules`);
  await expect(page.getByTestId('case-hero')).toContainText('1/30');
  await expect(page.getByTestId('module-collect')).toContainText('1/3');

  // The department form's Section 4 now shows the home medication and the discrepancy.
  await page.goto(`/#/cases/${caseId}/form`);
  const s4 = page.locator('[data-section="4"]');
  await expect(s4).toContainText('amlodipine');
  await expect(s4).toContainText('5 mg PO once daily');
  await expect(s4).toContainText('Unintentional; Omission');

  // Workflow lists the case with its next task.
  await page.goto('/#/workflow');
  await expect(page.getByTestId('workflow-case')).toContainText(caseId);
  await shot(page, 'r12-workflow');

  // Documents added later from the Patient file tab also lead on to the Clinical Modules.
  await page.goto(`/#/cases/${caseId}/sources`);
  await expect(page.getByTestId('source-row')).toHaveCount(3);
  await page.getByTestId('next-to-modules').getByRole('link', { name: 'Next: Clinical modules' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/modules$`));
  await expect(page.getByTestId('modules-hub')).toBeVisible();

  expect(watch.errors).toEqual([]);
  expect(watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:'))).toEqual([]);
});

test('the Clinical Modules work in Arabic, right to left', async ({ page }) => {
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await page.goto(`/#/cases/${caseId}/modules`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('modules-hub')).toContainText('مسار الرعاية');
  await expect(page.getByTestId('module-collect')).toContainText('جمع البيانات');
  await shot(page, 'r13-modules-arabic');
  await page.goto(`/#/cases/${caseId}/task/t14`);
  await expect(page.getByTestId('task-page')).toContainText('تحسين استخدام المضادات الحيوية');
  await shot(page, 'r14-task-arabic', true);
});

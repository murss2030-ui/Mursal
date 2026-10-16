/**
 * M3 — reading the patient file and drafting the 30 tasks with the model
 * (owner decisions D2, D3), end to end in the browser: the app → the relay
 * code → the Gemini adapter, with only Google's servers replaced by the
 * stand-in of ai-fixtures.ts (see ai-relay.ts). Everything is synthetic.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { admissionNote, LAB_PAGE_LINES } from './ai-fixtures';
import { installTestRelay, TEST_KEY, type TestRelay } from './ai-relay';
import { createCase, createRotation, isoDate, onboard, watchPage } from './helpers';

const SHOTS = process.env.PRECEPTOR_SHOTS_DIR ?? 'test-results/screenshots';
const TMP = 'test-results/fixtures';

// page.route must see every call to /api; a service worker would answer from outside it.
test.use({ serviceWorkers: 'block' });

async function shot(page: Page, name: string, full = false) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
}

const dmy = (iso: string) => iso.split('-').reverse().join('/');

/** The photographed laboratory page: identifiers on the top line, results below, one handwritten line. */
async function labPagePng(page: Page): Promise<string> {
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

async function addTypedNote(page: Page, text: string, removeIdentifiers: boolean) {
  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('text-source-editor')).toBeVisible();
  await page.getByLabel('Document type').selectOption('admission_note');
  await page.getByLabel('Text', { exact: true }).fill(text);
  if (removeIdentifiers) {
    await expect(page.getByTestId('identifier-check')).toContainText('Possible identifiers found');
    await page.getByRole('button', { name: 'Remove all' }).click();
  }
  await page.getByLabel(/I have removed every identifier/).check();
  await page.getByRole('button', { name: 'Save to the patient file' }).click();
  await expect(page.getByTestId('intake')).toBeVisible();
}

async function addLabPage(page: Page) {
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

/** Settings → AI service: the relay's suggested models are offered; nothing is used until saved. */
async function saveModels(page: Page, models: { extract?: string; analyse?: string } = {}, firstTime = true) {
  await page.goto('/#/settings/ai');
  await expect(page.getByTestId('ai-status')).toHaveAttribute('data-state', 'ready');
  const extract = page.getByLabel('Model for reading documents');
  const analyse = page.getByLabel('Model for case analysis');
  if (firstTime) {
    await expect(extract).toHaveValue('reader-test-1');
    await expect(analyse).toHaveValue('drafter-test-1');
  }
  if (models.extract) await extract.selectOption(models.extract);
  if (models.analyse) await analyse.selectOption(models.analyse);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
}

const field = (page: Page, id: string) => page.locator(`[data-testid="review-field"][data-field="${id}"]`);
const suggestion = (page: Page, text: string | RegExp) => page.locator('[data-testid="suggestion"][data-decision="pending"]').filter({ hasText: text });

/** Asserts the page image the model received is the redacted one: black over the identifiers, untouched below. */
async function expectRedactedImage(page: Page, base64: string) {
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

test('Teaching Case: Next → the model reads the file → each value checked → the 30 tasks drafted → each suggestion decided', async ({ page }) => {
  test.setTimeout(300_000);
  const watch = watchPage(page);
  const relay = await installTestRelay(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching', admissionOffset: -3 });
  const admitted = dmy(isoDate(-3));

  // 1. The patient file: a typed note (identifiers removed before saving) and a photographed page (covered before saving).
  await addTypedNote(page, admissionNote(admitted), true);
  await addLabPage(page);
  await expect(page.getByTestId('source-row')).toHaveCount(2);

  // 2. The AI service: the relay's own allow-list, a free-tier key, this month's budget.
  await saveModels(page);
  await expect(page.getByTestId('ai-key-class')).toContainText('Free-tier key');
  await expect(page.getByTestId('ai-budget')).toContainText('US$0.000 / US$5.00');
  await shot(page, 'm3-01-ai-settings', true);

  // 3. Next: Analyse the file.
  await page.goto(`/#/cases/${caseId}/intake`);
  await page.getByTestId('next-to-modules').getByRole('link', { name: 'Next: Analyse the file' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/analyse$`));
  await expect(page.locator('[data-testid="analyse-doc"][data-read="no"]')).toHaveCount(2);
  await shot(page, 'm3-02-analyse-start');
  await page.getByRole('button', { name: 'Read 2 document(s)' }).click();
  await expect(page.locator('[data-testid="analyse-doc"][data-read="yes"]')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId('analyse-doc').first()).toContainText('19 values read');
  await shot(page, 'm3-03-read');

  // What left the relay: two readings of each document (medicines and handwriting are read twice), de-identified.
  const reads = relay.provider.filter((c) => c.task === 'extract');
  expect(reads.map((c) => c.pass)).toEqual([1, 2, 1, 2]);
  for (const c of reads) {
    expect(c.apiKey).toBe(TEST_KEY); // added by the relay; the browser never has it
    expect(c.model).toBe('reader-test-1');
    expect(c.text).not.toMatch(/Synthetic Gamma|55501234|CASE-\d/);
    expect(c.text).not.toContain(admitted);
  }
  expect(reads[0]!.text).toContain('Admitted Day 0 with fever');
  expect(reads[0]!.text).toContain('[REMOVED]');
  expect(reads[2]!.images).toHaveLength(1);
  await expectRedactedImage(page, reads[2]!.images[0]!);
  // The browser's request carried no key, and the relay forwarded no installation id.
  const sent = relay.relay.filter((r) => r.path === '/api/model');
  expect(JSON.stringify(sent.map((r) => r.body))).not.toMatch(/AIza|x-goog-api-key|test-key/);
  const installId = String(sent[0]!.body!.installId);
  expect(relay.provider.some((c) => c.text.includes(installId))).toBe(false);

  // 4. Check what was read — one value at a time.
  await page.getByRole('link', { name: 'Check the values' }).click();
  await expect(page.getByTestId('extraction-review')).toBeVisible();
  await expect(page.getByTestId('review-counts')).toHaveText('19 of 19 to check');
  // Nothing confirms in bulk, and Confirm is never the focused action.
  await expect(page.getByRole('button', { name: /all/i })).toHaveCount(0);
  expect(await page.evaluate(() => (document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : ''))).not.toMatch(/Confirm/);
  // Not yet used anywhere: the timeline is still empty.
  await shot(page, 'm3-04-review');

  // A doctor's name the model "saw" was masked, and it was found by one reading only: rejected.
  const ghost = field(page, 'f19');
  await expect(ghost).toContainText('[REMOVED]');
  await expect(ghost.locator('[data-flag="identifier_in_output"]')).toBeVisible();
  await expect(ghost.locator('[data-flag="single_pass"]')).toBeVisible();
  await ghost.getByRole('button', { name: 'Reject' }).click();
  await ghost.getByLabel('Why (optional)').fill('Not in the document');
  await ghost.getByRole('button', { name: 'Reject' }).click();
  await expect(field(page, 'f19')).toHaveAttribute('data-decision', 'rejected');

  // The second reading disagrees on a dose: shown, flagged, and checked against the source before confirming.
  const amlo = field(page, 'f4');
  await expect(amlo.locator('[data-flag="dual_pass_disagreement"]')).toBeVisible();
  await expect(amlo).toContainText('Second reading: 5 mg PO once daily');
  await expect(amlo.getByTestId('review-rxnorm')).toHaveText('RxNorm: amlodipine (RxCUI 17767)');
  await amlo.click();
  await expect(page.getByTestId('review-source').locator('mark')).toHaveText('amlodipine 10 mg PO daily');
  await shot(page, 'm3-05-review-disagreement');
  await amlo.getByRole('button', { name: 'Confirm' }).click();
  await expect(field(page, 'f4')).toHaveAttribute('data-decision', 'confirmed');

  // A value read without its day cannot be confirmed: it is corrected instead.
  const hr = field(page, 'f7');
  await expect(hr.locator('[data-flag="no_day"]')).toBeVisible();
  await expect(hr.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await hr.getByRole('button', { name: 'Correct' }).click();
  await expect(page.getByRole('heading', { name: 'Correct what was read' })).toBeVisible();
  await page.getByLabel('Hospital day').fill('0');
  await shot(page, 'm3-06-correct');
  await page.getByRole('button', { name: 'Save the corrected value' }).click();
  await expect(page.getByTestId('extraction-review')).toBeVisible();
  await expect(field(page, 'f7')).toHaveAttribute('data-decision', 'corrected');

  // Every other value, confirmed one by one — except the potassium, left unchecked on purpose.
  for (const id of ['f1', 'f2', 'f3', 'f5', 'f6', 'f8', 'f9', 'f10', 'f11', 'f12', 'f14', 'f15', 'f16', 'f17', 'f18']) {
    await field(page, id).getByRole('button', { name: 'Confirm' }).click();
    await expect(field(page, id)).not.toHaveAttribute('data-decision', 'pending');
  }
  await expect(page.getByTestId('review-counts')).toHaveText('1 of 19 to check');
  await expect(field(page, 'f13')).toContainText('Potassium');

  // The photographed page: every value with its box on the page; the illegible dose is never guessed.
  await page.goto(`/#/cases/${caseId}/analyse`);
  await page.getByRole('link', { name: 'Laboratory report' }).click();
  await expect(page.getByTestId('review-source').locator('img')).toBeVisible();
  await expect(page.locator('[data-box]')).toHaveCount(4);
  await field(page, 'f1').click();
  await expect(page.locator('[data-box="f1"]')).toHaveClass(/border-saffron-500/);
  const insulin = field(page, 'f4');
  await expect(insulin.locator('[data-flag="illegible"]')).toBeVisible();
  await expect(insulin.getByTestId('review-value')).not.toContainText('20');
  await expect(insulin.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await shot(page, 'm3-07-review-page');
  await insulin.getByRole('button', { name: 'Reject' }).click();
  await insulin.getByLabel('Why (optional)').fill('Illegible: to clarify with the team');
  await insulin.getByRole('button', { name: 'Reject' }).click();
  for (const id of ['f1', 'f2', 'f3']) await field(page, id).getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('review-counts')).toHaveText('0 of 4 to check');

  // Confirmed values are in the record, with provenance and a link to their source.
  await page.goto(`/#/cases/${caseId}/timeline`);
  await expect(page.getByText('Serum creatinine').first()).toBeVisible();

  // 5. Draft the 30 tasks, module by module, from the confirmed record only.
  await page.goto(`/#/cases/${caseId}/analyse`);
  await expect(page.getByTestId('analyse-pending')).toHaveText('1 value(s) still to check. Nothing is used until you confirm it.');
  await page.getByRole('button', { name: 'Draft the 30 tasks' }).click();
  for (const m of ['collect', 'review', 'dosing', 'safety', 'plan', 'followup', 'discharge', 'document']) {
    await expect(page.getByTestId(`analyse-module-${m}`)).toHaveAttribute('data-state', 'drafted', { timeout: 30_000 });
  }
  await expect(page.getByTestId('analyse-spent')).toBeVisible();
  await shot(page, 'm3-08-drafted', true);
  const drafts = relay.provider.filter((c) => c.task === 'analyse');
  expect(drafts.map((c) => c.module)).toEqual(['collect', 'review', 'dosing', 'safety', 'plan', 'followup', 'discharge', 'document']);
  for (const c of drafts) {
    expect(c.model).toBe('drafter-test-1');
    expect(c.text).not.toMatch(/Synthetic Gamma|55501234|CASE-\d|5\.4 mmol/); // the unchecked potassium is not used
    expect(c.text).not.toContain(admitted);
    expect(c.text).not.toContain('t25'); // the reflection is never drafted
  }

  // 6. The Clinical Modules, with a draft in each task.
  await page.getByRole('link', { name: 'Next: Clinical modules' }).click();
  await expect(page.getByTestId('modules-hub')).toBeVisible();
  await page.goto(`/#/cases/${caseId}/task/t08`);
  const draft = page.getByTestId('ai-draft');
  await expect(draft).toHaveAttribute('data-state', 'current');
  await expect(draft.getByRole('button', { name: /all/i })).toHaveCount(0);
  expect(await page.evaluate(() => (document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : ''))).not.toMatch(/Accept|Add to my notes/);
  // From the case data, with its references…
  const inputs = suggestion(page, 'Inputs confirmed');
  await expect(inputs.locator('[data-basis="case_data"]')).toContainText('From the case data:');
  // …and from general knowledge: labelled, its citation removed.
  const stability = suggestion(page, 'Stability of renal function assessed');
  await expect(stability.locator('[data-basis="general_knowledge"]')).toHaveText('General knowledge — no source, unverified');
  await expect(stability.locator('[data-check="citation_removed"]')).toBeVisible();
  await expect(stability).not.toContainText('Smith');
  await shot(page, 'm3-09-task-draft', true);

  // Accepting applies one answer to the worksheet.
  await inputs.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('check-inputs').getByRole('radio', { name: 'Problem' })).toBeChecked();
  // A rejection needs its reason.
  await stability.getByRole('button', { name: 'Reject' }).click();
  const confirmReject = stability.getByRole('button', { name: 'Reject' });
  await expect(confirmReject).toBeDisabled();
  await stability.getByLabel('Why are you rejecting it?').fill('No source; I will check my reference');
  await confirmReject.click();
  await page.getByText(/^Decided \(2\)$/).click();
  await expect(page.locator('[data-testid="suggestion"][data-decision="rejected"]')).toContainText('No source; I will check my reference');

  // A dose that is not in the data is withheld — calculators come in M2.
  await page.goto(`/#/cases/${caseId}/task/t09`);
  const enox = suggestion(page, 'enoxaparin');
  await expect(enox.locator('[data-check="dose_withheld"]')).toBeVisible();
  await expect(enox).toContainText('[dose withheld — to be calculated]');
  await expect(enox).not.toContainText('30 mg');

  // A drug-related problem row: what only the trainee can record (implementation) was removed; accepted as a proposal.
  await page.goto(`/#/cases/${caseId}/task/t05`);
  const drp = page.locator('[data-testid="suggestion"][data-kind="item"][data-decision="pending"]');
  await expect(drp).toContainText('Enoxaparin dose not adjusted for reduced kidney function');
  await expect(drp.locator('[data-check="trainee_only_removed"]')).toBeVisible();
  await expect(drp).not.toContainText('Implemented');
  await shot(page, 'm3-10-drp-suggestion', true);
  await drp.getByRole('button', { name: 'Accept' }).click();
  await expect(page.getByTestId('item-drp')).toContainText('Enoxaparin dose not adjusted for reduced kidney function');

  // Tasks that are the trainee's alone are never drafted.
  await page.goto(`/#/cases/${caseId}/task/t25`);
  await expect(page.getByTestId('ai-draft')).toHaveAttribute('data-state', 'trainee-only');

  // 7. Confirming the last value changes the record: every draft made before becomes stale.
  await page.goto(`/#/cases/${caseId}/analyse`);
  await page.getByRole('link', { name: 'Check the values' }).click();
  await field(page, 'f13').getByRole('button', { name: 'Confirm' }).click();
  await page.goto(`/#/cases/${caseId}/task/t08`);
  await expect(page.getByTestId('draft-stale')).toBeVisible();
  for (const b of await page.locator('[data-testid="suggestion"][data-decision="pending"]').getByRole('button', { name: /Accept|Add to my notes/ }).all()) await expect(b).toBeDisabled();
  await shot(page, 'm3-11-stale');

  // 8. The audit log: every call (model, prompt version, tokens, cost — never the content) and every decision.
  await page.goto('/#/audit');
  await expect(page.locator('[data-testid="audit-event"][data-entity="model_call"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="audit-event"][data-entity="suggestion"][data-action="reject"]')).toContainText('No source; I will check my reference');
  await expect(page.locator('[data-testid="audit-event"][data-entity="extraction"][data-action="reject"]').first()).toBeVisible();
  const auditText = await page.locator('[data-testid="audit-event"][data-entity="model_call"]').allInnerTexts();
  expect(auditText.join('\n')).not.toMatch(/creatinine|enoxaparin|ADMISSION NOTE/i);

  // 9. Usage: this device's calls and the month's spend.
  await page.goto('/#/settings/ai');
  await expect(page.getByTestId('ai-device-usage')).toContainText('Reading documents');
  await expect(page.getByTestId('ai-device-usage')).toContainText('Case analysis');
  await shot(page, 'm3-12-usage', true);

  // In Arabic, right to left; clinical values stay as written.
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto(`/#/cases/${caseId}/analyse`);
  await expect(page.getByRole('heading', { name: 'تحليل ملف المريض' })).toBeVisible();
  await shot(page, 'm3-15-analyse-arabic');
  await page.goto(`/#/cases/${caseId}/task/t09`);
  await expect(page.getByTestId('ai-draft')).toContainText('مسودة الذكاء الاصطناعي لهذه المهمة');
  await shot(page, 'm3-16-draft-arabic', true);
  await page.getByRole('button', { name: 'English' }).first().click();

  // Nothing went anywhere but the app's own relay — and RxNav, with a drug name only.
  const external = watch.requests.filter((u) => !u.startsWith('http://localhost:4173/') && !u.startsWith('blob:') && !u.startsWith('data:'));
  expect(external.length).toBeGreaterThan(0);
  const terms = external.map((u) => {
    expect(u).toMatch(/^https:\/\/rxnav\.nlm\.nih\.gov\/REST\/approximateTerm\.json\?term=[^&]+&maxEntries=3$/);
    return new URL(u).searchParams.get('term');
  });
  // Each drug name once (answers are cached on the device), and nothing else.
  expect(terms.sort()).toEqual(['amlodipine', 'ceftriaxone', 'enoxaparin', 'ibuprofen', 'insulin glargine', 'metformin']);
  expect(watch.errors).toEqual([]);
});

test('a Clinical Case is refused on a free-tier key, by the app and by the relay; on a paid key its identifiers never reach the model', async ({ page }) => {
  test.setTimeout(180_000);
  const relay = await installTestRelay(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'clinical', age: '58', name: 'Saleh Qaid', mrn: 'MRN-77120', consultant: 'Dr Hamdan Saif' });
  await addTypedNote(page, 'Patient name: Saleh Qaid\nMRN: MRN-77120\nAdmitted with chest pain (synthetic).', true);
  // Free text typed later can still hold a name: masked before anything is sent.
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('note');
  await page.getByLabel('Hospital day').fill('0');
  await page.getByLabel('Kind of note').selectOption('hpi');
  await page.getByLabel('Text', { exact: true }).fill('Saleh reports chest pain since this morning; seen by Dr Hamdan Saif.');
  await page.getByRole('button', { name: 'Save entry' }).click();
  await saveModels(page);

  // The app refuses on a free-tier key and offers Teaching Cases.
  await page.goto(`/#/cases/${caseId}/analyse`);
  await expect(page.getByTestId('analyse-free-key')).toHaveText('This server uses a free-tier key: Clinical Cases are never sent with it. Use a Teaching Case.');
  await expect(page.getByRole('button', { name: 'Read 1 document(s)' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Draft the 30 tasks' })).toBeDisabled();
  await shot(page, 'm3-13-free-key-refused');

  // The relay refuses too, whatever the browser sends.
  const direct = await page.evaluate(async () => {
    const r = await fetch('/api/model', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        task: 'extract',
        model: 'reader-test-1',
        promptVersion: 'extract-v1',
        caseKind: 'clinical',
        installId: 'abcdef12-3456',
        system: 'x',
        parts: [{ text: 'x' }],
        schema: { type: 'object', properties: {} },
        maxOutputTokens: 64,
        temperature: 0,
      }),
    });
    return { status: r.status, body: (await r.json()) as { error: { code: string } } };
  });
  expect(direct.status).toBe(403);
  expect(direct.body.error.code).toBe('free_key_clinical');
  expect(relay.provider).toHaveLength(0);

  // With a paid key declared on the server, the same case is analysed — and no identifier is sent.
  relay.env.PRECEPTOR_KEY_CLASS = 'paid';
  await page.goto(`/#/cases/${caseId}/modules`);
  await page.goto(`/#/cases/${caseId}/analyse`);
  await expect(page.getByTestId('analyse-free-key')).toHaveCount(0);
  await page.getByRole('button', { name: 'Read 1 document(s)' }).click();
  await expect(page.locator('[data-testid="analyse-doc"][data-read="yes"]')).toHaveCount(1, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Draft the 30 tasks' }).click();
  await expect(page.getByTestId('analyse-module-document')).toHaveAttribute('data-state', 'drafted', { timeout: 60_000 });
  expect(relay.provider.length).toBeGreaterThan(8);
  for (const c of relay.provider) expect(c.text).not.toMatch(/Saleh|Qaid|MRN-77120|Hamdan|Bed 14/);
  expect(relay.provider.some((c) => c.text.includes('reports chest pain since this morning'))).toBe(true);
});

test('the monthly spending cap refuses a call at the boundary, with a clear message, and the work stops', async ({ page }) => {
  test.setTimeout(120_000);
  const relay = await installTestRelay(page, { PRECEPTOR_MONTHLY_BUDGET_USD: '1' });
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addTypedNote(page, admissionNote(dmy(isoDate(-3))), true);
  await addLabPage(page);
  await saveModels(page);
  // Earlier calls this month used all but half a cent: less than one reading may cost.
  await relay.spend(0.995);
  await page.goto(`/#/cases/${caseId}/analyse`);
  await page.getByRole('button', { name: 'Read 2 document(s)' }).click();
  await expect(page.getByTestId('analyse-stopped')).toHaveText('The monthly AI budget is reached. It resets at the start of next month. Used this month: US$0.995 of US$1.00.');
  // The first refusal stopped the run: the second document was not even tried, and nothing reached the model.
  expect(relay.relay.filter((r) => r.path === '/api/model').map((r) => r.status)).toEqual([402]);
  expect(relay.provider).toHaveLength(0);
  await shot(page, 'm3-14-budget-reached');
  await page.goto('/#/settings/ai');
  await expect(page.getByTestId('ai-budget')).toContainText('US$0.995 / US$1.00');
});

test('a retired model is replaced in Settings without rebuilding; offline, the app says so and the manual path stays open', async ({ page, context }) => {
  test.setTimeout(120_000);
  const relay = await installTestRelay(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await addTypedNote(page, admissionNote(dmy(isoDate(-3))), true);
  await saveModels(page, { extract: 'reader-test-0' });
  await page.goto(`/#/cases/${caseId}/analyse`);
  await page.getByRole('button', { name: 'Read 1 document(s)' }).click();
  await expect(page.getByTestId('analyse-doc')).toContainText('This model is not available any more (it may have been retired). Choose another in Settings → AI service.');
  expect(relay.provider.map((c) => c.model)).toEqual(['reader-test-0']);

  // The operator's allow-list offers another; choosing it is enough.
  await saveModels(page, { extract: 'reader-test-1' }, false);
  await page.goto(`/#/cases/${caseId}/analyse`);
  await page.getByRole('button', { name: 'Read 1 document(s)' }).click();
  await expect(page.locator('[data-testid="analyse-doc"][data-read="yes"]')).toHaveCount(1, { timeout: 30_000 });

  // Offline: said plainly, nothing is attempted, and the Clinical Modules stay one tap away.
  await context.setOffline(true);
  await expect(page.getByText('You are offline.').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Draft the 30 tasks' })).toBeDisabled();
  await page.getByRole('link', { name: 'Next: Clinical modules' }).click();
  await expect(page.getByTestId('modules-hub')).toBeVisible();
  await context.setOffline(false);
});

test('the built app holds no API key, provider address or model name', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|mjs|html|css|json|webmanifest|txt|map)$/.test(name)) files.push(p);
    }
  };
  walk('dist');
  expect(files.length).toBeGreaterThan(5);
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    expect(s, f).not.toMatch(/AIza[0-9A-Za-z_-]{20,}/);
    expect(s, f).not.toMatch(/GEMINI_API_KEY|PRECEPTOR_MODELS|x-goog-api-key|generativelanguage/);
    expect(s, f).not.toMatch(/gemini/i);
    expect(s, f).not.toContain(TEST_KEY);
  }
});

test.describe('relay helpers', () => {
  test('the test relay itself rejects a wrong access code, like the deployed one', async ({ page }) => {
    const relay: TestRelay = await installTestRelay(page, { PRECEPTOR_ACCESS_CODE: 'synthetic-code' });
    await page.goto('/');
    const status = await page.evaluate(async () => (await fetch('/api/status')).status);
    expect(status).toBe(401);
    const ok = await page.evaluate(async () => (await fetch('/api/status', { headers: { 'x-preceptor-access': 'synthetic-code' } })).status);
    expect(ok).toBe(200);
    expect(relay.provider).toHaveLength(0);
  });
});

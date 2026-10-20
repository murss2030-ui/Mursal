/**
 * Every one of the thirty task worksheets opens and renders in English and in
 * Arabic, and every shared register accepts a row through its editor.
 * The walkthrough in m1r-intake-modules.spec.ts covers the flow in depth; this
 * file makes sure nothing in the catalogue is left unreachable or broken.
 */
import { expect, test, type Page } from '@playwright/test';
import { TASK_ORDER } from '../src/domain/workflow/catalogue';
import { isFieldRequired, isFieldVisible, REGISTERS, type FieldDef } from '../src/domain/workflow/registers';
import { createCase, createRotation, onboard, watchPage } from './helpers';

/** An untranslated message key on screen, such as "task.save". */
const RAW_KEY = /\b(?:task|modules|item|source|check|form|intake|panel|reg|err|workflow)\.[a-z][A-Za-z]+(?:\.[A-Za-z_]+)*\b/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A field label as the editor renders it: the label, with "(optional)" when the field is optional. */
const labelled = (page: Page, label: string) => page.getByLabel(new RegExp(`^${escape(label)}(?: \\(optional\\))?$`));

async function addEntry(page: Page, caseId: string, fill: (p: Page) => Promise<void>) {
  await page.goto(`/#/cases/${caseId}/entry/new`);
  await fill(page);
  await page.getByRole('button', { name: 'Save entry' }).click();
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/timeline`));
}

/** One medication and one problem, so the per-medication and per-problem sections have rows. */
async function seedTimeline(page: Page, caseId: string) {
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('note');
    await p.getByLabel('Hospital day').fill('0');
    await p.getByLabel('Kind of note').selectOption('problem');
    await p.getByLabel('Problem or diagnosis').fill('Community-acquired pneumonia');
    await p.getByRole('radio', { name: 'Acute', exact: true }).check();
    await p.getByLabel('Status', { exact: true }).selectOption('active');
  });
  await addEntry(page, caseId, async (p) => {
    await p.getByLabel('Entry type').selectOption('med_start');
    await p.getByLabel('Hospital day').fill('0');
    await p.getByLabel(/Drug — generic name/).fill('ceftriaxone');
    await p.getByLabel('Amount', { exact: true }).fill('2');
    await p.getByLabel('Dose unit', { exact: true }).selectOption('g');
    await p.getByLabel('Route', { exact: true }).selectOption('IV');
    await p.getByLabel('Frequency', { exact: true }).selectOption('once daily');
    await p.getByLabel(/^Indication/).fill('Community-acquired pneumonia');
  });
}

/** Fills the required fields of a register row, following the same visibility rules as the editor. */
async function fillRequired(page: Page, fields: readonly FieldDef[]) {
  const values: Record<string, string> = {};
  for (const f of fields) {
    if (!isFieldVisible(f, values)) continue;
    if (!isFieldRequired(f, values)) continue;
    const label = f.label.en;
    switch (f.kind) {
      case 'text':
      case 'longtext':
        await labelled(page, label).fill('synthetic test value');
        values[f.id] = 'synthetic test value';
        break;
      case 'day':
        await labelled(page, label).fill('1');
        values[f.id] = '1';
        break;
      case 'choice': {
        const o = f.options![0];
        if (f.options!.length <= 6) await page.getByTestId(`field-${f.id}`).getByRole('radio', { name: o.label.en, exact: true }).click();
        else await labelled(page, label).selectOption(o.value);
        values[f.id] = o.value;
        break;
      }
      case 'multi': {
        const o = f.options![0];
        // Long lists fold by group (the PCNE causes): open the option's group first.
        if (o.group) await page.locator(`[data-group="${o.group}"] summary`).click();
        await page.getByRole('group', { name: label }).getByRole('button', { name: o.label.en, exact: true }).click();
        values[f.id] = o.value;
        break;
      }
      case 'confirm':
        await page.getByLabel(label).check();
        values[f.id] = 'yes';
        break;
      default:
        throw new Error(`No filler for required ${f.kind} field ${f.id}`);
    }
  }
}

test('all thirty task worksheets open in English and in Arabic', async ({ page }) => {
  test.setTimeout(240_000);
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await seedTimeline(page, caseId);

  expect(TASK_ORDER).toHaveLength(30);
  for (const d of TASK_ORDER) {
    await page.goto(`/#/cases/${caseId}/task/${d.id}`);
    const sheet = page.locator(`[data-testid="task-page"][data-task="${d.id}"]`);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('h1')).toContainText(d.title.en);
    await expect(sheet.locator('h1')).toContainText(d.title.ar);
    await expect(sheet.getByText('How to do it')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    if (d.perMedication) await expect(sheet).toContainText('ceftriaxone');
    if (d.perProblem) await expect(sheet).toContainText('Community-acquired pneumonia');
    expect(await sheet.innerText(), `untranslated text on task ${d.number}`).not.toMatch(RAW_KEY);
  }

  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  for (const d of TASK_ORDER) {
    await page.goto(`/#/cases/${caseId}/task/${d.id}`);
    const sheet = page.locator(`[data-testid="task-page"][data-task="${d.id}"]`);
    await expect(sheet.locator('h1')).toContainText(d.title.ar);
    await expect(sheet.getByText('كيف تؤدي هذه المهمة')).toBeVisible();
    expect(await sheet.innerText(), `untranslated text on task ${d.number} (Arabic)`).not.toMatch(RAW_KEY);
  }

  expect(watch.errors).toEqual([]);
});

test('every shared register accepts a row through its editor', async ({ page }) => {
  test.setTimeout(240_000);
  const watch = watchPage(page);
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });
  await seedTimeline(page, caseId);

  const registers = Object.values(REGISTERS);
  expect(registers).toHaveLength(12);
  for (const r of registers) {
    const task = TASK_ORDER.find((d) => d.registers?.includes(r.id));
    expect(task, `a task shows the ${r.id} register`).toBeDefined();
    await page.goto(`/#/cases/${caseId}/item/new/${r.id}?task=${task!.id}`);
    await expect(page.getByTestId('item-editor')).toBeVisible();
    await fillRequired(page, r.fields);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page, `saving a ${r.id} row returns to task ${task!.number}`).toHaveURL(new RegExp(`#/cases/${caseId}/task/${task!.id}$`));
    // A drug-related problem is shown as its Problem Card (M4).
    await expect(page.getByTestId(r.id === 'drp' ? 'card-summary' : `item-${r.id}`).first()).toBeVisible();
  }

  // Each row was written once, with an audit record.
  await page.goto(`/#/cases/${caseId}/audit`);
  await expect(page.locator('[data-testid="audit-event"][data-entity="item"][data-action="create"]')).toHaveCount(12);
  expect(watch.errors).toEqual([]);
});

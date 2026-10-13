import { expect, test } from '@playwright/test';
import { createCase, createRotation, onboard, unlock, watchPage } from './helpers';

test('the eight provenance states render distinctly — icon, label, border and fill', async ({ page }) => {
  await onboard(page);
  await page.goto('/#/about');
  const badges = page.getByTestId('provenance-legend').locator('[data-provenance]');
  await expect(badges).toHaveCount(8);
  const looks = await badges.evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        text: el.textContent ?? '',
        icon: el.querySelector('path')?.getAttribute('d') ?? '',
        colour: `${cs.backgroundColor}|${cs.borderTopColor}|${cs.color}`,
        shape: `${cs.borderTopStyle}|${cs.borderTopWidth}|${cs.fontStyle}`,
      };
    }),
  );
  expect(new Set(looks.map((l) => l.text)).size).toBe(8);
  expect(new Set(looks.map((l) => l.icon)).size).toBe(8);
  expect(new Set(looks.map((l) => l.colour)).size).toBe(8);
  // Distinct even without colour: every badge differs from every other in shape, icon or label.
  expect(new Set(looks.map((l) => `${l.shape}|${l.icon}`)).size).toBe(8);
  await page.getByTestId('provenance-legend').screenshot({ path: 'docs/m1/screenshots/provenance-legend.png' });

  // Material for the human blind review: the eight badges in a shuffled order, without their explanations.
  await page.getByTestId('provenance-legend').evaluate((ul) => {
    const items = [...ul.children] as HTMLElement[];
    for (const li of items) (li.children[1] as HTMLElement).style.display = 'none';
    for (const i of [5, 2, 7, 0, 3, 6, 1, 4]) ul.appendChild(items[i]!);
  });
  await page.getByTestId('provenance-legend').screenshot({ path: 'docs/m1/screenshots/provenance-blind-review.png' });
});

test('Arabic interface is right-to-left, keeps clinical terms in English, and persists', async ({ page }) => {
  const watch = watchPage(page);
  await onboard(page);
  await page.getByRole('button', { name: 'العربية' }).first().click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'الدورة الحالية' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'التنقل الرئيسي' })).toContainText('الحالات');
  await expect(page.getByTestId('disclaimer-footer')).toContainText('ليست للتشخيص أو العلاج');

  await page.goto('/#/about');
  const legend = page.getByTestId('provenance-legend');
  await expect(legend).toContainText('Entered by trainee'); // clinical vocabulary stays English…
  await expect(legend).toContainText('أدخله المتدرب'); // …with the Arabic explanation beside it
  await expect(page.getByTestId('intended-use-statement')).toContainText('PRECEPTOR is an educational tool'); // verbatim English

  // The language choice survives a reload (the reload also drops the key, so the app locks).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PRECEPTOR مقفل' })).toBeVisible();
  expect(watch.errors).toEqual([]);
});

test('locks after the idle period and restores unsaved work after unlocking', async ({ page }) => {
  await page.clock.install();
  await onboard(page);
  await page.goto('/#/settings');
  await page.getByLabel('Lock after inactivity').selectOption('1');
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching' });

  await page.goto(`/#/cases/${caseId}/entry/new`);
  await page.getByLabel('Entry type').selectOption('note');
  await page.getByLabel('Kind of note').selectOption('chief_complaint');
  await page.getByLabel('Text', { exact: true }).fill('Fever and cough for three days (synthetic)');
  await page.clock.runFor(1_000); // let the encrypted draft save

  await page.clock.fastForward('02:00');
  await unlock(page);
  await expect(page).toHaveURL(new RegExp(`#/cases/${caseId}/entry/new`));
  await expect(page.getByText('Unsaved work from earlier was restored.')).toBeVisible();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue('Fever and cough for three days (synthetic)');
});

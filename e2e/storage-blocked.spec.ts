import { expect, test } from '@playwright/test';

test('explains the problem instead of loading forever when the browser blocks storage', async ({ page }) => {
  // As in a private window or a locked-down frame: any access to IndexedDB is refused.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('This browser is blocking local storage');
  await expect(page.getByRole('alert')).toContainText('Leave private or incognito mode');
});

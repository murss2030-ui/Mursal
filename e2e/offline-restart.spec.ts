import { chromium, devices, expect, test } from '@playwright/test';
import { addCreatinine, createCase, createRotation, onboard, startPreview, stopPreview, unlock } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];

test('a case survives a full browser restart with the device offline and the server gone', async ({}, testInfo) => {
  const port = 4180;
  const base = `http://localhost:${port}`;
  const profile = testInfo.outputPath('profile');
  const server = await startPreview(port);

  // Session 1: online. Create a case and an entry, and let the service worker take control.
  let ctx = await chromium.launchPersistentContext(profile, { ...pixel, baseURL: base });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await onboard(page);
  await createRotation(page);
  const caseId = await createCase(page, { kind: 'teaching', age: '58' });
  await addCreatinine(page, caseId, '1.4', '2');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await ctx.close();

  // The device goes offline: the server is stopped and the browser has no network at all.
  await stopPreview(server, port);
  await expect(fetch(base)).rejects.toBeTruthy();

  // Session 2: a fresh browser process on the same profile, offline.
  ctx = await chromium.launchPersistentContext(profile, { ...pixel, baseURL: base, offline: true });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  const nav = await page.goto(`${base}/`);
  expect(nav?.fromServiceWorker()).toBe(true); // served from the precached shell, not the network
  await unlock(page); // the key never persisted: the passphrase is required again
  await page.goto(`${base}/#/cases/${caseId}`);
  await expect(page.getByRole('heading', { name: caseId })).toBeVisible();
  await expect(page.getByTestId('entry-main')).toHaveText('Serum creatinine: 1.4 mg/dL');
  await expect(page.getByTestId('connection-status')).toHaveText(/Offline/);

  // Still fully usable offline: record another entry.
  await addCreatinine(page, caseId, '1.6', '3');
  await expect(page.getByTestId('timeline-entry')).toHaveCount(2);
  await ctx.close();
});

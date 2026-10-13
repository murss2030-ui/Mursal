// Renders public/icons/icon.svg to the PNG sizes the web app manifest needs.
// Uses the locally installed Chromium through Playwright; no network access.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icons/icon.svg'), 'utf8');

const targets = [
  { file: 'icon-192.png', size: 192, padding: 0 },
  { file: 'icon-512.png', size: 512, padding: 0 },
  // Maskable icons need their content inside the central 80% safe zone.
  { file: 'icon-maskable-512.png', size: 512, padding: 52 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, padding } of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  await page.setContent(
    `<html><body style="margin:0;background:#134e4a;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: join(root, 'public/icons', file), omitBackground: false });
  console.log('wrote', file);
}
await browser.close();

/**
 * Design review captures. Run with `npm run screenshots` (needs a packaged test build).
 * Writes PNGs to docs/screenshots/<size>/. Skipped during normal e2e runs.
 */
import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test.skip(process.env.SCREENSHOTS !== '1', 'set SCREENSHOTS=1 (npm run screenshots)');

// Windows display scaling is emulated by shrinking the window to its effective size in
// device-independent pixels (screen size / scale). A 1366x768 screen at 125% is 1093x614.
const SIZES = [
  { name: '1280x800-100', w: 1280, h: 800, zoom: 1 },
  { name: '1366x768-125', w: Math.round(1366 / 1.25), h: Math.round(768 / 1.25), zoom: 1.25 },
  { name: '1920x1080-100', w: 1920, h: 1080, zoom: 1 },
  { name: '1366x768-150', w: Math.round(1366 / 1.5), h: Math.round(768 / 1.5), zoom: 1.5 },
  { name: '1280x800-150', w: Math.round(1280 / 1.5), h: Math.round(800 / 1.5), zoom: 1.5 },
];

function exe(): string {
  const dir = fs.readdirSync('out').find((d) => d.startsWith('Gable-'))!;
  const base = path.join('out', dir);
  return path.resolve(process.platform === 'darwin' ? path.join(base, 'Gable.app', 'Contents', 'MacOS', 'Gable') : path.join(base, 'Gable.exe'));
}

for (const size of SIZES) {
  test(`captures ${size.name}`, async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-shots-'));
    const app = await electron.launch({ executablePath: exe(), env: { ...process.env, GABLE_DATA_DIR: dataDir } });
    const page = await app.firstWindow();
    await app.evaluate(async ({ BrowserWindow }, s) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setMinimumSize(300, 300);
      win.setContentSize(s.w, s.h);
    }, size);
    const out = path.resolve('docs', 'screenshots', size.name);
    fs.mkdirSync(out, { recursive: true });
    const shot = async (name: string) => {
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    };
    const go = async (hash: string) => {
      await page.evaluate((h) => { window.location.hash = h; }, hash);
      await page.waitForTimeout(150);
    };

    await go('/expenses');
    await shot('expenses-list');
    await go('/properties');
    await shot('property-list');
    await go('/expenses/new');
    await shot('expense-entry-empty');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await shot('expense-entry-errors');
    await page.getByRole('combobox', { name: 'Vendor' }).fill('Harbor Lumber');
    await page.getByRole('textbox', { name: /^Amount/ }).first().fill('100');
    await page.getByLabel('Split across several categories').check();
    await page.getByRole('combobox', { name: /^Category/ }).first().fill('Mat');
    await page.getByRole('option', { name: 'Materials' }).click();
    await page.getByRole('textbox', { name: /^Amount/ }).nth(1).fill('60');
    await shot('expense-entry-split');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await go('/receipts/review');
    await shot('receipt-review');
    const details = page.getByRole('tab', { name: 'Details' });
    if (await details.isVisible()) { await page.getByRole('tab', { name: 'Receipt', exact: true }).click(); await shot('receipt-review-preview-tab'); }
    await page.getByRole('button', { name: /IMG_4471/ }).click();
    if (await details.isVisible()) await details.click();
    await shot('receipt-review-failed');
    await page.getByRole('button', { name: /redwood-hardware/ }).click();
    if (await details.isVisible()) await details.click();
    await shot('receipt-review-duplicate');
    await go('/showcase');
    await shot('showcase-top');
    await page.locator('.main').evaluate((el) => { el.scrollTop = 1100; });
    await shot('showcase-middle');
    await page.locator('.main').evaluate((el) => { el.scrollTop = 99999; });
    await shot('showcase-bottom');
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    expect(fs.readdirSync(out).length).toBeGreaterThan(5);
  });
}


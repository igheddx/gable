/** Design captures for the receipt screens. Run via `npm run screenshots`. */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildReceiptFixtures } from '../fixtures/receipts';
import { demoDir, go, launch, switchCompany, tempDir } from './helpers';

test.skip(process.env.SCREENSHOTS !== '1', 'set SCREENSHOTS=1 (npm run screenshots)');
test.describe.configure({ timeout: 240_000 });

for (const size of [{ name: '1280x800-100', w: 1280, h: 800 }, { name: '1920x1080-100', w: 1920, h: 1080 }, { name: '1366x768-150', w: 911, h: 512 }]) {
  test(`stage 5 captures ${size.name}`, async () => {
    const out = path.resolve('docs', 'screenshots', size.name);
    fs.mkdirSync(out, { recursive: true });
    const fxDir = tempDir('fx');
    const fx = await buildReceiptFixtures(fxDir);
    const dir = demoDir();
    const app = await launch(dir);
    const page = await app.firstWindow();
    await app.evaluate(async ({ BrowserWindow }, s) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setMinimumSize(300, 300);
      win.setContentSize(s.w, s.h);
    }, size);
    const shot = async (name: string) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, `${name}.png`) }); };
    await switchCompany(page, /Oak House/);
    await go(page, '/receipts/review');
    await expect(page.getByText('No receipts to review')).toBeVisible();
    await shot('s5-review-empty');
    await page.getByRole('button', { name: 'Add receipts' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add receipts' });
    await dialog.locator('input[type=file]').setInputFiles([fx.clean, fx.rotated, fx.digitalPdf, fx.ambiguous, fx.corrupt]);
    await shot('s5-import-dialog');
    await dialog.getByRole('button', { name: /Add 5 receipts/ }).click();
    await expect(dialog.getByText('Some files were not added:')).toBeVisible({ timeout: 120_000 });
    await shot('s5-import-rejections');
    await dialog.getByRole('button', { name: 'Close' }).click();
    const queue = page.getByRole('navigation', { name: 'Receipt queue' });
    await expect(queue.getByText('Needs review')).toHaveCount(4, { timeout: 120_000 });
    await queue.getByRole('button', { name: /clean-receipt/ }).click();
    await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue('Harbor Lumber & Supply');
    await shot('s5-review-clean');
    await queue.getByRole('button', { name: /ambiguous-total/ }).click();
    await expect(page.getByText('More than one amount looks like the total')).toBeVisible();
    await shot('s5-review-ambiguous');
    await queue.getByRole('button', { name: /digital-invoice/ }).click();
    await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('4,200.00');
    await shot('s5-review-digital-pdf-duplicate');
    await page.getByText('Recognized text', { exact: true }).click();
    await shot('s5-review-recognized-text');
    await go(page, '/settings/categories');
    await shot('s5-vendor-rules');
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    fs.rmSync(fxDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
}

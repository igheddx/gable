/** Extra design captures for company/property screens. Run via `npm run screenshots`. */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { demoDir, go, launch, switchCompany, tempDir } from './helpers';

test.skip(process.env.SCREENSHOTS !== '1', 'set SCREENSHOTS=1 (npm run screenshots)');

for (const size of [{ name: '1280x800-100', w: 1280, h: 800 }, { name: '1366x768-150', w: 911, h: 512 }]) {
  test(`stage 3 captures ${size.name}`, async () => {
    const out = path.resolve('docs', 'screenshots', size.name);
    fs.mkdirSync(out, { recursive: true });
    const open = async (dir: string) => {
      const app = await launch(dir);
      const page = await app.firstWindow();
      await app.evaluate(async ({ BrowserWindow }, s) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        win.setMinimumSize(300, 300);
        win.setContentSize(s.w, s.h);
      }, size);
      return { app, page };
    };
    const shot = async (page: import('@playwright/test').Page, name: string) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    };

    const first = tempDir('setup');
    let { app, page } = await open(first);
    await expect(page.getByRole('heading', { name: 'Welcome to Gable' })).toBeVisible();
    await shot(page, 's3-setup-company');
    await app.close();
    fs.rmSync(first, { recursive: true, force: true });

    const dir = demoDir();
    ({ app, page } = await open(dir));
    await switchCompany(page, /Oak House/);
    await go(page, '/properties');
    await expect(page.getByRole('link', { name: '125 Oak Drive' })).toBeVisible();
    await shot(page, 's3-property-list');
    await switchCompany(page, /All Companies/);
    await shot(page, 's3-property-list-all');
    await switchCompany(page, /Oak House/);
    await page.getByRole('link', { name: '125 Oak Drive' }).click();
    await shot(page, 's3-property-detail-sold');
    await page.getByRole('tab', { name: 'By year' }).click();
    await shot(page, 's3-property-by-year');
    await page.getByRole('button', { name: 'Edit' }).click();
    await shot(page, 's3-property-edit-sold');
    await go(page, '/expenses');
    await shot(page, 's4-expense-list');
    await page.getByRole('link', { name: 'Brightline Electric' }).first().click();
    await shot(page, 's4-expense-edit');
    await go(page, '/properties');
    await page.getByRole('link', { name: '125 Oak Drive' }).click();
    await shot(page, 's4-property-detail-costs');
    await page.getByRole('tab', { name: 'By year' }).click();
    await page.getByRole('button', { name: '2026' }).click();
    await shot(page, 's4-property-by-year-expanded');
    await switchCompany(page, /North Property/);
    await go(page, '/properties');
    await page.getByRole('link', { name: '71 Northgate Terrace' }).click();
    await shot(page, 's4-historical-property');
    await go(page, '/settings/categories');
    await shot(page, 's4-categories');
    await go(page, '/settings');
    await shot(page, 's3-settings-companies');
    await page.getByRole('button', { name: 'Archive Cedar Homes LLC' }).click();
    await shot(page, 's3-archive-default-dialog');
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

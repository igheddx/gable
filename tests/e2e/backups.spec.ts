import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { demoDir, go, packagedExecutable, switchCompany, tempDir } from './helpers';

test.describe.configure({ timeout: 180_000 });

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const cleanup = (...dirs: string[]) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

async function launch(dir: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: packagedExecutable(),
    env: { ...process.env, GABLE_DATA_DIR: dir, GABLE_TEST_NO_RELAUNCH: '1', GABLE_TEST_AUTO_BACKUP_DELAY_MS: '3600000', ...extra },
  });
  const page = await app.firstWindow();
  await expect(page.locator('#company-switcher')).toBeVisible();
  return { app, page };
}

const companyNames = async (page: Page) => (await page.locator('#company-switcher option').allTextContents()).map((t) => t.replace(' (default)', ''));

test('back up, change things, restore: everything returns, a safety copy is kept, and the result is shown after restart', async () => {
  const dir = demoDir();
  let { app, page } = await launch(dir);
  await go(page, '/settings/backups');
  await expect(page.getByRole('heading', { name: 'Backups', exact: true })).toBeVisible();
  await expect(page.getByText('No backup has been made yet.')).toBeVisible();
  await expect(page.getByText(/same drive as your Gable data/)).toBeVisible();
  await expect(page.getByText(/Backups are not encrypted/)).toBeVisible();
  await expect(page.getByText(/Nothing runs while Gable is closed/)).toBeVisible();

  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backup saved: Gable-backup-\d{8}-\d{6}-manual\.zip/)).toBeVisible({ timeout: 60_000 });
  const status = page.getByRole('region', { name: 'Backup status' });
  await expect(status.getByText('manual', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved backups' }).getByRole('row')).toHaveCount(2); // header + 1

  // Change things after the backup: add a company and archive another.
  await go(page, '/settings/company?new=1');
  await page.getByRole('textbox', { name: /Company name/ }).fill('Added After Backup LLC');
  await page.getByRole('button', { name: 'Add company' }).click();
  await expect(page.getByText('Added After Backup LLC added.')).toBeVisible();
  expect(await companyNames(page)).toContain('Added After Backup LLC');

  await go(page, '/settings/backups');
  await page.getByRole('button', { name: /Restore the backup from/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Replace everything with this backup?' });
  await expect(dialog).toContainText('3 companies');
  await expect(dialog).toContainText('8 properties');
  await expect(dialog).toContainText('replaces all of your current data');
  await expect(dialog).toContainText('not a merge');
  await expect(dialog).toContainText('saves a backup of your current data');
  const go1 = dialog.getByRole('button', { name: 'Replace and restart' });
  await expect(go1).toBeDisabled(); // an explicit acknowledgement is required
  await dialog.getByRole('checkbox', { name: /I understand/ }).check();
  const closed = app.waitForEvent('close');
  await go1.click();
  await closed;

  ({ app, page } = await launch(dir));
  expect(await companyNames(page)).toEqual(['Cedar Homes LLC', 'North Property LLC', 'Oak House LLC', 'All Companies (view only)']);
  await go(page, '/settings/backups');
  await expect(page.getByText('Last restore succeeded')).toBeVisible();
  await expect(page.getByText(/Your previous data was saved first as Gable-backup-.*-pre-restore\.zip/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved backups' }).getByText('Before a restore')).toBeVisible();
  // Totals came back with it.
  await switchCompany(page, /Oak House/);
  await go(page, '/properties');
  await page.getByRole('link', { name: '125 Oak Drive' }).click();
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$268,000.00');
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$42,000.00');
  await app.close();
  cleanup(dir);
});

test('a damaged or unsuitable backup is refused with a clear message and nothing changes', async () => {
  const dir = demoDir();
  const scratch = tempDir('bad-backups');
  const notZip = path.join(scratch, 'not-a-backup.zip');
  fs.writeFileSync(notZip, 'this is not a zip file at all');
  let { app, page } = await launch(dir, { GABLE_TEST_RESTORE_FILE: notZip });
  await go(page, '/settings/backups');
  await page.getByRole('button', { name: 'Restore from a file…' }).click();
  await expect(page.getByText('That backup was not used.')).toBeVisible();
  await expect(page.getByText(/not a Gable backup/)).toBeVisible();
  await expect(page.getByText('Nothing in Gable was changed.')).toBeVisible();
  expect(await companyNames(page)).toEqual(['Cedar Homes LLC', 'North Property LLC', 'Oak House LLC', 'All Companies (view only)']);
  await app.close();

  // Truncate a real backup and try again.
  ({ app, page } = await launch(dir));
  await go(page, '/settings/backups');
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backup saved/)).toBeVisible({ timeout: 60_000 });
  await app.close();
  const backups = path.join(dir, 'data', 'backups');
  const real = fs.readdirSync(backups).find((f) => f.endsWith('.zip'))!;
  const cut = path.join(scratch, 'cut.zip');
  fs.writeFileSync(cut, fs.readFileSync(path.join(backups, real)).subarray(0, 3000));
  ({ app, page } = await launch(dir, { GABLE_TEST_RESTORE_FILE: cut }));
  await go(page, '/settings/backups');
  await page.getByRole('button', { name: 'Restore from a file…' }).click();
  await expect(page.getByText('That backup was not used.')).toBeVisible();
  expect(await companyNames(page)).toContain('Oak House LLC');
  await app.close();
  cleanup(dir, scratch);
});

test('a daily automatic backup is made when Gable is open, and is shown as the last successful backup', async () => {
  const dir = demoDir();
  const { app, page } = await launch(dir, { GABLE_TEST_AUTO_BACKUP_DELAY_MS: '500' });
  await expect.poll(() => fs.existsSync(path.join(dir, 'data', 'backups')) && fs.readdirSync(path.join(dir, 'data', 'backups')).some((f) => f.endsWith('-auto.zip')), { timeout: 30_000 }).toBe(true);
  await go(page, '/settings/backups');
  await expect(page.getByRole('region', { name: 'Backup status' }).getByText('auto', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Saved backups' }).getByText('Automatic')).toBeVisible();
  // Turning it off is remembered.
  await page.getByRole('checkbox', { name: 'Back up automatically once a day' }).click(); // controlled by saved settings, so it changes once saved
  await expect(page.getByRole('checkbox', { name: 'Back up automatically once a day' })).not.toBeChecked();
  await app.close();
  cleanup(dir);
});

test('missing receipt files are found and reported with what to do; a backup warns about them', async () => {
  const dir = demoDir();
  const { app, page } = await launch(dir);
  await switchCompany(page, /Oak House/);
  await go(page, '/expenses/new');
  await page.getByRole('combobox', { name: 'Vendor' }).fill('Receipt Holder');
  await page.getByRole('textbox', { name: /^Amount/ }).first().fill('25');
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: 'Utilities' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'keep-me.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  // Someone deletes the stored file by hand.
  const receipts = path.join(dir, 'data', 'receipts');
  fs.rmSync(path.join(receipts, fs.readdirSync(receipts)[0]!));

  await go(page, '/settings/backups');
  await page.getByRole('button', { name: 'Check now' }).click();
  await expect(page.getByText(/1 receipt file is missing/)).toBeVisible();
  await expect(page.getByText(/keep-me\.png \(expense for Receipt Holder\)/)).toBeVisible();
  await expect(page.getByText(/open the expense and remove the receipt/)).toBeVisible();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText(/Backup saved: .*\(with a warning\)/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/1 receipt file was already missing/)).toBeVisible();
  await app.close();
  cleanup(dir);
});

import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildReceiptFixtures, type ReceiptFixtures } from '../fixtures/receipts';
import { demoDir, go, launch, switchCompany, tempDir } from './helpers';

test.describe.configure({ timeout: 240_000 });

let fx: ReceiptFixtures;
let fxDir: string;
test.beforeAll(async () => {
  fxDir = tempDir('fixtures');
  fx = await buildReceiptFixtures(fxDir);
});
test.afterAll(() => fs.rmSync(fxDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

const queue = (page: Page) => page.getByRole('navigation', { name: 'Receipt queue' });
const READ = { timeout: 120_000 };

async function open(dir = demoDir()) {
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/receipts/review');
  return { app, page, dir };
}

async function addFiles(page: Page, files: string[]) {
  await page.getByRole('button', { name: 'Add receipts' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add receipts' });
  await dialog.locator('input[type=file]').setInputFiles(files);
  await expect(dialog.getByRole('group', { name: 'Receipts to add' })).toBeVisible();
  return dialog;
}

test('reads a clean receipt offline in the packaged app and suggests vendor, date and the labeled total', async () => {
  const { app, page, dir } = await open();
  const started = Date.now();
  const dialog = await addFiles(page, [fx.clean]);
  await dialog.getByRole('button', { name: /Add 1 receipt to review queue/ }).click();
  await expect(queue(page).getByText('Needs review')).toBeVisible(READ);
  console.log(`packaged-app timing: clean PNG added to Needs review in ${Date.now() - started} ms`);

  await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue('Harbor Lumber & Supply');
  await expect(page.getByRole('textbox', { name: /Expense date/ })).toHaveValue('09/18/2026');
  await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('165.25'); // the labeled total, not cash tendered (184.25)
  await expect(page.getByRole('combobox', { name: /^Category/ })).toHaveValue('Materials');
  await expect(page.getByText('Suggested from the word')).toBeVisible();
  await expect(page.getByText('Needs review').first()).toBeVisible();
  // Not an expense yet.
  await go(page, '/expenses');
  await expect(page.getByRole('link', { name: 'Harbor Lumber & Supply' })).toHaveCount(2); // only the two seeded Oak expenses
  await go(page, '/receipts/review');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Saved: Harbor Lumber & Supply \$165\.25/)).toBeVisible();
  await go(page, '/expenses');
  await expect(page.getByRole('link', { name: 'Harbor Lumber & Supply' })).toHaveCount(3);
  // The stored copy is opaque and survives deleting the original (the fixtures dir is separate from the data dir).
  const stored = fs.readdirSync(path.join(dir, 'data', 'receipts'));
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatch(/^[0-9a-f]{32}\.png$/);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('a mixed batch: good files are read, bad files are reported one by one, and the rest are not stopped', async () => {
  const { app, page, dir } = await open();
  const dialog = await addFiles(page, [fx.clean, fx.rotated, fx.digitalPdf, fx.scannedPdf, fx.ambiguous, fx.corrupt, fx.encryptedPdf, fx.longPdf]);
  await dialog.getByRole('button', { name: /Add 8 receipts to review queue/ }).click();
  await expect(dialog.getByText('Some files were not added:')).toBeVisible(READ);
  await expect(dialog.getByText(/corrupt\.png: This image could not be read/)).toBeVisible();
  await expect(dialog.getByText(/encrypted\.pdf: This PDF is password protected/)).toBeVisible();
  await expect(dialog.getByText(/thirty-one-pages\.pdf: This PDF has 31 pages/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(queue(page).getByRole('button')).toHaveCount(5);
  // Wait until every receipt has been read.
  await expect(queue(page).getByText('Needs review')).toHaveCount(5, READ);

  // Digital PDF: text layer, one document across both pages.
  await queue(page).getByRole('button', { name: /digital-invoice\.pdf/ }).click();
  await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue('Brightline Electric');
  await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('4,200.00');
  await expect(queue(page).getByRole('button', { name: /digital-invoice\.pdf/ })).toContainText('2 pages');
  // Scanned PDF and the sideways photo both read through OCR.
  await queue(page).getByRole('button', { name: /scanned-receipt\.pdf/ }).click();
  await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('165.25');
  await queue(page).getByRole('button', { name: /rotated-receipt\.png/ }).click();
  await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('165.25');
  // Ambiguous total: both candidates offered, nothing treated as confirmed.
  await queue(page).getByRole('button', { name: /ambiguous-total\.png/ }).click();
  await expect(page.getByText('More than one amount looks like the total')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use $120.00' })).toBeVisible();
  await page.getByRole('button', { name: 'Use $120.00' }).click();
  await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('120.00');
  await expect(page.getByText('Edited by you').first()).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('Save All Reviewed saves only reviewed receipts; unreviewed ones stay; a retry creates no duplicates', async () => {
  const { app, page, dir } = await open();
  const dialog = await addFiles(page, [fx.clean, fx.digitalPdf, fx.ambiguous]);
  await dialog.getByRole('button', { name: /Add 3 receipts/ }).click();
  await expect(queue(page).getByText('Needs review')).toHaveCount(3, READ);

  await queue(page).getByRole('button', { name: /clean-receipt\.png/ }).click();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await queue(page).getByRole('button', { name: /ambiguous-total\.png/ }).click();
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(queue(page).getByText('Reviewed')).toHaveCount(2);
  await page.getByRole('button', { name: /Save all reviewed \(2\)/ }).click();
  const result = page.getByRole('dialog', { name: 'Saved reviewed receipts' });
  await expect(result).toContainText('2 saved as expenses');
  await expect(result).toContainText('1 not yet reviewed was left in the queue');
  await result.getByRole('button', { name: 'Done' }).click();
  await expect(queue(page).getByRole('button')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Save all reviewed/ })).toBeDisabled(); // nothing reviewed remains: a retry cannot duplicate
  await go(page, '/expenses');
  await expect(page.getByRole('link', { name: 'Brightline Electric' })).toHaveCount(3); // two seeded, one saved
  await expect(page.getByRole('link', { name: 'Harbor Lumber & Supply' })).toHaveCount(3);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('a second copy of a saved receipt is flagged and cannot be saved until confirmed', async () => {
  const { app, page, dir } = await open();
  let dialog = await addFiles(page, [fx.clean]);
  await dialog.getByRole('button', { name: /Add 1 receipt/ }).click();
  await expect(queue(page).getByText('Needs review')).toBeVisible(READ);
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Saved: /)).toBeVisible();

  dialog = await addFiles(page, [fx.duplicateOfClean]);
  await dialog.getByRole('button', { name: /Add 1 receipt/ }).click();
  await expect(queue(page).getByText('Needs review')).toBeVisible(READ);
  await expect(page.getByText('Possible duplicate.')).toBeVisible();
  await expect(page.getByText(/This exact file is already saved with the expense for Harbor Lumber & Supply/)).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Confirm that this is a different purchase/).first()).toBeVisible();
  await go(page, '/expenses');
  await expect(page.getByRole('link', { name: 'Harbor Lumber & Supply' })).toHaveCount(3); // still only one new expense
  await go(page, '/receipts/review');
  await page.getByRole('checkbox', { name: 'This is a different purchase' }).check();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Saved: Harbor Lumber/)).toBeVisible();
  await go(page, '/expenses');
  await expect(page.getByRole('link', { name: 'Harbor Lumber & Supply' })).toHaveCount(4);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('drafts and corrections survive closing and reopening the app', async () => {
  const opened = await open();
  let { app, page } = opened;
  const { dir } = opened;
  const dialog = await addFiles(page, [fx.clean]);
  await dialog.getByRole('button', { name: /Add 1 receipt/ }).click();
  await expect(queue(page).getByText('Needs review')).toBeVisible(READ);
  const vendor = page.getByRole('combobox', { name: 'Vendor' });
  await vendor.fill('Harbor Lumber (corrected)');
  await page.getByRole('textbox', { name: /^Total/ }).fill('165.30');
  await page.getByRole('textbox', { name: /Expense date/ }).click(); // leaving the field saves it
  await page.waitForTimeout(500);
  await app.close();

  app = await launch(dir);
  page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/receipts/review');
  await expect(queue(page).getByRole('button', { name: /clean-receipt\.png/ })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue('Harbor Lumber (corrected)');
  await expect(page.getByRole('textbox', { name: /^Total/ })).toHaveValue('165.30');
  // Trying again keeps the person's edits unless they ask to replace them.
  await page.getByRole('button', { name: 'Try reading again' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Keep my edits' }).click();
  await expect(queue(page).getByText('Needs review')).toBeVisible(READ);
  await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue('Harbor Lumber (corrected)');
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('a split receipt saves exactly and a vendor rule is created only when the box is ticked', async () => {
  const { app, page, dir } = await open();
  const dialog = await addFiles(page, [fx.clean]);
  await dialog.getByRole('button', { name: /Add 1 receipt/ }).click();
  await expect(queue(page).getByText('Needs review')).toBeVisible(READ);
  await expect(page.getByRole('checkbox', { name: /Remember this vendor/ })).not.toBeChecked();
  await page.getByRole('textbox', { name: /^Total/ }).fill('100');
  await page.getByLabel('Split across several categories').check();
  await page.getByRole('textbox', { name: /^Amount/ }).first().fill('60');
  await page.getByRole('combobox', { name: 'Category 2' }).click();
  await page.getByRole('option', { name: 'Electrical' }).click();
  await page.getByRole('textbox', { name: /^Amount/ }).nth(1).fill('40');
  await expect(page.getByText(/Fully assigned/)).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Saved: Harbor Lumber & Supply \$100\.00/)).toBeVisible();
  await go(page, '/settings/categories');
  await expect(page.getByText('No vendor rules')).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

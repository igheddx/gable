import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function exe(): string {
  const dir = fs.readdirSync('out').find((d) => d.startsWith('Gable-'))!;
  const base = path.join('out', dir);
  return path.resolve(process.platform === 'darwin' ? path.join(base, 'Gable.app', 'Contents', 'MacOS', 'Gable') : path.join(base, 'Gable.exe'));
}

let app: ElectronApplication;
let page: Page;
let dataDir: string;

test.beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-form-'));
  app = await electron.launch({ executablePath: exe(), env: { ...process.env, GABLE_DATA_DIR: dataDir } });
  page = await app.firstWindow();
  await page.evaluate(() => { window.location.hash = '/expenses/new'; });
});
test.afterEach(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const vendor = () => page.getByRole('combobox', { name: 'Vendor' });
const amount = () => page.getByRole('textbox', { name: /^Amount/ }).first();
const category = () => page.getByRole('combobox', { name: /^Category/ }).first();

test('validation errors keep everything the user typed and move focus to the problem', async () => {
  await vendor().fill('Harbor Lumber');
  await amount().fill('12.345');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Use at most two decimal places.')).toBeVisible();
  await expect(page.getByText('Choose a category.')).toBeVisible();
  await expect(vendor()).toHaveValue('Harbor Lumber');
  await expect(amount()).toHaveValue('12.345');
  await expect(amount()).toBeFocused(); // first invalid field in reading order
});

test('negative amounts are rejected with guidance', async () => {
  await amount().fill('-5');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Amounts must be positive/)).toBeVisible();
});

test('Save & add another keeps company, property and date, clears the rest, and focuses vendor', async () => {
  await page.getByRole('combobox', { name: /^Property/ }).click();
  await page.getByRole('option', { name: /48 Willow Court/ }).click();
  await page.getByRole('textbox', { name: /^Expense date/ }).fill('3/5/2021');
  await vendor().fill('Keystone Plumbing Co.');
  await amount().fill('250');
  await category().click();
  await page.getByRole('option', { name: 'Plumbing' }).click();
  await page.getByRole('button', { name: 'Save & add another' }).click();
  await expect(page.getByText(/Expense added: Keystone Plumbing Co\. \$250\.00/)).toBeVisible();
  await expect(vendor()).toHaveValue('');
  await expect(vendor()).toBeFocused();
  await expect(amount()).toHaveValue('');
  await expect(page.getByRole('combobox', { name: /^Property/ })).toHaveValue('48 Willow Court');
  await expect(page.getByRole('textbox', { name: /^Expense date/ })).toHaveValue('03/05/2021');
});

test('split allocation must add up exactly to the total', async () => {
  await vendor().fill('Harbor Lumber');
  await amount().fill('100');
  await page.getByLabel('Split across several categories').check();
  // The first line starts with the whole amount; the user lowers it to split.
  await expect(page.getByText(/Fully assigned/)).toBeVisible();
  await category().click();
  await page.getByRole('option', { name: 'Materials' }).click();
  await page.getByRole('textbox', { name: /^Amount/ }).nth(1).fill('60');
  await expect(page.getByText('Remaining to assign: $40.00')).toBeVisible();
  await page.getByRole('combobox', { name: 'Category 2' }).click();
  await page.getByRole('option', { name: 'Electrical' }).click();
  await page.getByRole('textbox', { name: /^Amount/ }).nth(2).fill('30');
  await expect(page.getByText('Remaining to assign: $10.00')).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('$10.00 is still unassigned.')).toBeVisible();
  await page.getByRole('textbox', { name: /^Amount/ }).nth(2).fill('40');
  await expect(page.getByText(/Fully assigned/)).toBeVisible();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Split: Materials + Electrical' })).toBeVisible();
});

test('leaving with unsaved work asks first, and Keep editing preserves the entry', async () => {
  await vendor().fill('Redwood Hardware');
  await page.getByRole('link', { name: 'Properties' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(vendor()).toHaveValue('Redwood Hardware');
  await page.getByRole('link', { name: 'Properties' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
});

test('switching company with unsaved work asks first and never moves the form', async () => {
  await vendor().fill('Redwood Hardware');
  await page.getByLabel('Company', { exact: true }).selectOption('cedar');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('oak');
  await expect(page.getByText('For Oak House LLC')).toBeVisible();
});

test('unsupported receipt types are explained, not silently ignored', async () => {
  await page.locator('input[type=file]').setInputFiles([
    { name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('x') },
    { name: 'ok.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') },
  ]);
  await expect(page.getByText(/HEIC photos are not supported yet/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Attached receipts' })).toContainText('ok.pdf');
});

test('All Companies requires choosing a company before an expense can be saved', async () => {
  await page.evaluate(() => { window.location.hash = '/expenses'; });
  await page.getByLabel('Company', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await vendorOrWait();
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText('Choose which company this expense belongs to.')).toBeVisible();
});

async function vendorOrWait() {
  await expect(vendor()).toBeVisible();
}

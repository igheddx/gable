import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { demoDir, go, launch, switchCompany } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

const openProperty = async (page: Page, company: RegExp, address: string) => {
  await switchCompany(page, company);
  await go(page, '/properties');
  await page.getByRole('link', { name: address }).click();
  await expect(page.getByRole('heading', { name: address })).toBeVisible();
};

test('standard project: cost $268,000, profit $42,000, ROI 15.67%; general overhead stays out', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await openProperty(page, /Oak House/, '125 Oak Drive');
  const summary = page.getByRole('region', { name: 'Lifetime summary' });
  await expect(summary).toContainText('Total project cost');
  await expect(summary).toContainText('$268,000.00');
  await expect(summary).toContainText('$42,000.00');
  await expect(summary).toContainText('15.67%');
  await expect(summary).toContainText('Not annualized');
  const bridge = page.getByRole('table', { name: 'From purchase price to profit' });
  await expect(bridge.getByRole('row', { name: /Purchase closing costs \$5,000\.00/ })).toBeVisible();
  await expect(bridge.getByRole('row', { name: /Renovation and repairs \$35,000\.00/ })).toBeVisible();
  await expect(bridge.getByRole('row', { name: /Holding costs \$10,000\.00/ })).toBeVisible();
  await expect(bridge.getByRole('row', { name: /^Selling costs \$18,000\.00/ })).toBeVisible();
  await expect(bridge.getByRole('row', { name: /Realtor commissions \$15,000\.00/ })).toBeVisible();
  await expect(bridge.getByRole('row', { name: /Seller closing costs \$3,000\.00/ })).toBeVisible();
  await expect(bridge.getByRole('row', { name: /Profit before taxes \$42,000\.00/ })).toBeVisible();
  // The Oak company's $1,000 overhead appears in expenses as general company spending, separate from this property.
  await go(page, '/expenses');
  await expect(page.getByRole('row', { name: /Northfield Insurance.*General company.*\$1,000\.00/ })).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('historical project: 2021 to 2026 annual breakdown, commissions listed separately, duration', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await openProperty(page, /North Property/, '71 Northgate Terrace');
  const summary = page.getByRole('region', { name: 'Lifetime summary' });
  await expect(summary).toContainText('$280,000.00');
  await expect(summary).toContainText('$70,000.00');
  await expect(summary).toContainText('25.00%');
  await expect(page.getByText('1,885 days')).toBeVisible();
  await expect(page.getByText('5 years 2 months')).toBeVisible();

  await page.getByRole('tab', { name: 'By year' }).click();
  const years = page.getByRole('table', { name: 'Recorded activity for each calendar year' });
  await expect(years.locator('tbody tr:not(.year-row)')).toHaveCount(6);
  await expect(years.getByRole('row', { name: /^2021 \$200,000\.00 \$5,000\.00 \$205,000\.00/ })).toBeVisible();
  await expect(years.getByRole('row', { name: /^2026 .*\$20,000\.00 \$20,000\.00 \$350,000\.00/ })).toBeVisible();
  await expect(years.getByRole('row', { name: /All years \$200,000\.00 \$80,000\.00 \$280,000\.00 \$350,000\.00/ })).toBeVisible();
  await expect(page.getByText(/Reconciles: the yearly expenses add up to the lifetime expenses of \$80,000\.00/)).toBeVisible();
  await page.getByRole('button', { name: '2026' }).click();
  const detail = page.locator('#year-2026');
  await expect(detail.getByRole('row', { name: /Realtor commissions \$15,000\.00/ })).toBeVisible();
  await expect(detail.getByRole('row', { name: /Seller closing costs \$5,000\.00/ })).toBeVisible();
  await expect(detail.getByText('Summit Title & Closing').first()).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('unsold property shows investment to date, with no profit or ROI', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await openProperty(page, /Oak House/, '48 Willow Court');
  const summary = page.getByRole('region', { name: 'Lifetime summary' });
  await expect(summary).toContainText('Recorded investment to date');
  await expect(summary).toContainText('$191,042.50');
  await expect(summary).toContainText('Not available');
  await expect(summary).not.toContainText('%');
  await expect(page.getByText('Held to date')).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('add an expense with a receipt from a property; it counts in the right year, survives restart, edits and voids recalculate', async () => {
  const dir = demoDir();
  let app = await launch(dir);
  let page = await app.firstWindow();
  await openProperty(page, /Oak House/, '48 Willow Court');
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('heading', { name: 'Add expense' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Vendor' }).fill('Redwood Hardware');
  await page.getByRole('textbox', { name: /Expense date/ }).fill('11/30/2022'); // an old cost entered now
  await page.getByRole('textbox', { name: /^Amount/ }).first().fill('1,000');
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: 'Materials' }).click();
  await page.locator('input[type=file]').setInputFiles([
    { name: 'invoice page 1.png', mimeType: 'image/png', buffer: PNG },
    { name: 'invoice page 2.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByRole('heading', { name: '48 Willow Court' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$192,042.50');
  await app.close();

  app = await launch(dir); // everything is stored: restart and look again
  page = await app.firstWindow();
  await openProperty(page, /Oak House/, '48 Willow Court');
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$192,042.50');
  await page.getByRole('tab', { name: 'By year' }).click();
  await page.getByRole('button', { name: '2022' }).click();
  const y2022 = page.locator('#year-2022');
  await expect(y2022.getByText('Redwood Hardware')).toBeVisible();
  await expect(y2022.getByText('2 receipts')).toBeVisible();
  // 2022 is before the 2026 purchase: it is still its own year, and the purchase price is still counted once.
  await expect(page.getByRole('row', { name: /^2022 .*\$1,000\.00 \$1,000\.00/ })).toBeVisible();

  // Edit: move the date to 2024. Annual totals move; lifetime does not.
  await y2022.getByRole('link', { name: 'Redwood Hardware' }).click();
  await expect(page.getByRole('heading', { name: 'Edit expense' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved receipts' })).toContainText('invoice page 1.png');
  await expect(page.getByRole('list', { name: 'Saved receipts' })).toContainText('invoice page 2.png');
  await page.getByRole('textbox', { name: /Expense date/ }).fill('02/02/2024');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('tab', { name: 'By year' }).click();
  await expect(page.getByRole('row', { name: /^2024 .*\$1,000\.00 \$1,000\.00/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '2022' })).toHaveCount(0); // no activity left in 2022, and it is before the purchase year range now needed
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$192,042.50');

  // Void: removed from every total, stays on record with history; restore brings it back.
  await go(page, '/expenses');
  await page.getByRole('link', { name: 'Redwood Hardware' }).click();
  await page.getByRole('button', { name: 'Void expense' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Void expense' }).click();
  await expect(page.getByText('Expense voided. It no longer counts in any total.')).toBeVisible();
  await go(page, '/properties');
  await page.getByRole('link', { name: '48 Willow Court' }).click();
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$191,042.50');
  await go(page, '/expenses');
  await expect(page.getByRole('link', { name: 'Redwood Hardware' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Include voided' }).check();
  await expect(page.getByRole('row', { name: /Redwood Hardware.*Voided/ })).toBeVisible();
  await page.getByRole('link', { name: 'Redwood Hardware' }).click();
  await expect(page.getByRole('region', { name: 'History' })).toContainText('Voided');
  await page.getByRole('button', { name: 'Restore expense' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore expense' }).click();
  await go(page, '/properties');
  await page.getByRole('link', { name: '48 Willow Court' }).click();
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$192,042.50');
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a double click on Save creates exactly one expense', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/expenses');
  const before = await page.getByRole('status').filter({ hasText: /expenses?$/ }).first().innerText();
  await page.getByRole('button', { name: 'Add expense' }).click();
  await page.getByRole('combobox', { name: 'Vendor' }).fill('Double Click Co');
  await page.getByRole('textbox', { name: /^Amount/ }).first().fill('12.34');
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: 'Utilities' }).click();
  await page.getByRole('button', { name: 'Save expense' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Double Click Co' })).toHaveCount(1);
  const after = await page.getByRole('status').filter({ hasText: /expenses?$/ }).first().innerText();
  expect(Number(after.split(' ')[0])).toBe(Number(before.split(' ')[0]) + 1);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('categories: add, rename, remap needs confirmation, archive; archived are not offered on new expenses', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/settings/categories');
  await page.getByRole('textbox', { name: 'New category' }).fill('Dumpster Rental');
  await page.getByLabel('Reporting group').first().selectOption({ label: 'Holding costs' });
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('row', { name: /Dumpster Rental Holding costs/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'New category' }).fill('dumpster rental');
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();
  await page.getByRole('button', { name: 'Change group for Dumpster Rental' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Change group' })).toBeDisabled(); // nothing chosen yet
  await dialog.getByLabel('Reporting group').selectOption({ label: 'Renovation and repairs' });
  await dialog.getByRole('button', { name: 'Change group' }).click();
  await expect(page.getByRole('row', { name: /Dumpster Rental Renovation and repairs/ })).toBeVisible();
  await page.getByRole('button', { name: 'Rename Dumpster Rental' }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Category name' }).fill('Dumpster & Hauling');
  await page.getByRole('dialog').getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('row', { name: /Dumpster & Hauling Renovation and repairs/ })).toBeVisible();
  await page.getByRole('button', { name: 'Archive Dumpster & Hauling' }).click();
  await expect(page.getByRole('row', { name: /Dumpster & Hauling/ })).toHaveCount(0);
  await go(page, '/expenses/new');
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await expect(page.getByRole('option', { name: 'Materials' })).toBeVisible();
  await expect(page.getByRole('option', { name: /Dumpster/ })).toHaveCount(0);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('expense list filters work together and are scoped to the company', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/expenses');
  await expect(page.getByRole('row', { name: /Brightline Electric/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Keystone Plumbing Co.' })).toHaveCount(0); // that is a Cedar expense
  await page.getByRole('searchbox', { name: /Search vendor/ }).fill('harbor');
  await expect(page.getByRole('link', { name: 'Harbor Lumber & Supply' })).toHaveCount(2); // Materials 2025 and Willow 2026
  await page.getByRole('combobox', { name: 'Category' }).selectOption({ label: 'Labor' });
  await expect(page.getByText('No matching expenses')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await switchCompany(page, /All Companies/);
  await expect(page.getByRole('link', { name: 'Keystone Plumbing Co.' }).first()).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Company' })).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('receipts are stored by Gable: the originals can be deleted afterwards', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/expenses/new');
  await page.getByRole('combobox', { name: 'Vendor' }).fill('Attachment Test');
  await page.getByRole('textbox', { name: /^Amount/ }).first().fill('5');
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: 'Utilities' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'original.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByRole('heading', { name: 'Expenses' })).toBeVisible();
  const receipts = path.join(dir, 'data', 'receipts');
  const files = fs.readdirSync(receipts);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[0-9a-f]{32}\.png$/); // opaque name, not "original.png"
  expect(fs.readFileSync(path.join(receipts, files[0]!)).equals(PNG)).toBe(true);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

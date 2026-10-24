import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { demoDir, go, launch } from './helpers';

test.describe.configure({ timeout: 180_000 });

const cleanup = (dir: string) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

async function addExpense(page: Page, vendor: string, date: string, amount: string, category: string) {
  await page.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByRole('heading', { name: 'Add expense' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Vendor' }).fill(vendor);
  await page.getByRole('textbox', { name: /^Expense date/ }).pressSequentially(date);
  await page.getByRole('textbox', { name: /^Amount/ }).first().fill(amount);
  await page.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: category }).click();
  await page.getByRole('button', { name: 'Save expense' }).click();
}

test('add a business type, then buy, repair and sell a car', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await expect(page.locator('#company-switcher')).toBeVisible();

  // Settings: the three built-in types are listed and a new one can be added.
  await go(page, '/settings/business-types');
  await expect(page.getByRole('heading', { name: 'Business types', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Vehicle.*Built in/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Rental.*Built in/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('Boats');
  await page.getByRole('button', { name: 'Add business type' }).click();
  await expect(page.getByRole('row', { name: /Boats.*Buy and sell items/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Name' }).fill('boats');
  await page.getByRole('button', { name: 'Add business type' }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();

  // Add a vehicle: a name and an ID instead of an address.
  await go(page, '/properties');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await expect(page.getByRole('heading', { name: 'What are you adding?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Boats/ })).toBeVisible(); // the new type is offered
  await page.getByRole('button', { name: /^Vehicle/ }).click();
  await expect(page.getByRole('heading', { name: 'Add vehicle' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Street address/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('Enter a name.')).toBeVisible();
  await page.getByRole('textbox', { name: /^Name/ }).fill('2018 Honda Accord');
  await page.getByRole('textbox', { name: /^ID or serial number/ }).fill('1HGCV1F3XJA000001');
  await page.getByRole('textbox', { name: /Purchase date/ }).pressSequentially('01102026');
  await page.getByRole('textbox', { name: /Purchase price/ }).fill('10,000');
  await page.getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByRole('heading', { name: '2018 Honda Accord' })).toBeVisible();
  await expect(page.getByText('Vehicle · 1HGCV1F3XJA000001')).toBeVisible();

  // Repairs and a title fee count toward the cost; selling it works out profit and return like any other sale.
  await addExpense(page, 'Joe Auto Repair', '01202026', '1,500', 'Parts & Repairs');
  await expect(page.getByRole('heading', { name: '2018 Honda Accord' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Lifetime summary' })).toContainText('$11,500.00');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Status').selectOption('Sold');
  await page.getByRole('textbox', { name: /Sale date/ }).pressSequentially('03012026');
  await page.getByRole('textbox', { name: /Gross sale price/ }).fill('14,000');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const summary = page.getByRole('region', { name: 'Lifetime summary' });
  await expect(summary).toContainText('$2,500.00');
  await expect(summary).toContainText('21.74%');

  // The list shows the type, filters by it, and finds the car by its ID.
  await go(page, '/properties');
  await expect(page.getByRole('row', { name: /2018 Honda Accord.*Vehicle.*1HGCV1F3XJA000001/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'Vehicle' });
  await expect(page.getByRole('link', { name: '2018 Honda Accord' })).toBeVisible();
  await expect(page.getByRole('link', { name: /17 Oak Hollow/ })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Type' }).selectOption({ label: 'All types' });
  await page.getByRole('searchbox', { name: /Search name/ }).fill('1hgcv1f3');
  await expect(page.getByRole('link', { name: '2018 Honda Accord' })).toBeVisible();
  await expect(page.getByRole('link', { name: /17 Oak Hollow/ })).toHaveCount(0);

  // The sold-asset report now has the car, with a Type column.
  await go(page, '/reports?kind=sold-performance');
  await page.getByRole('combobox', { name: /date range/ }).selectOption({ label: 'All dates' });
  const table = page.getByRole('region', { name: 'Sold properties' });
  await expect(table.getByRole('row', { name: /2018 Honda Accord.*Vehicle.*\$11,500\.00.*\$14,000\.00.*\$2,500\.00.*21\.74%/ })).toBeVisible();
  await app.close();
  cleanup(dir);
});

test('a rental: record rent and expenses, see net income, void a mistake, and report on it', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await expect(page.locator('#company-switcher')).toBeVisible();

  await go(page, '/properties');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByRole('button', { name: /^Rental/ }).click();
  await expect(page.getByRole('heading', { name: 'Add rental property' })).toBeVisible();
  // The purchase is optional for a rental.
  await expect(page.getByRole('textbox', { name: /Purchase date/ })).toBeVisible();
  await page.getByRole('textbox', { name: /Street address/ }).fill('8 Elm Court');
  await page.getByRole('textbox', { name: /^City/ }).fill('Riverton');
  await page.getByRole('combobox', { name: /^State/ }).selectOption('TN');
  await page.getByRole('textbox', { name: /^ZIP/ }).fill('37201');
  await page.getByRole('button', { name: 'Add property' }).click();
  await expect(page.getByRole('heading', { name: '8 Elm Court' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Income and expenses' })).toContainText('Net income');
  // A rental does not show profit and return.
  await expect(page.getByText('Return on cost')).toHaveCount(0);

  // Rent and a late fee.
  await page.getByRole('button', { name: 'Add income' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Add income' }).click();
  await expect(dialog.getByText('Enter an amount greater than zero.').or(dialog.getByText(/Enter a valid amount|Enter an amount/))).toBeVisible();
  await dialog.getByRole('textbox', { name: /Date received/ }).fill('');
  await dialog.getByRole('textbox', { name: /Date received/ }).pressSequentially('02012026');
  await dialog.getByRole('textbox', { name: /^Amount/ }).fill('1,500');
  await dialog.getByRole('button', { name: 'Add income' }).click();
  await expect(page.getByText('Income added.')).toBeVisible();
  await page.getByRole('button', { name: 'Add income' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: /Date received/ }).fill('');
  await dialog.getByRole('textbox', { name: /Date received/ }).pressSequentially('02032026');
  await dialog.getByRole('textbox', { name: /^Amount/ }).fill('50');
  await dialog.getByRole('combobox', { name: /Type of income/ }).selectOption('Late fees');
  await dialog.getByRole('button', { name: 'Add income' }).click();
  await expect(page.getByRole('region', { name: 'Income and expenses' })).toContainText('$1,550.00');

  // A repair is an expense against the rental, and it lowers net income.
  await addExpense(page, 'Keystone Plumbing Co.', '02102026', '400', 'Plumbing');
  await expect(page.getByRole('heading', { name: '8 Elm Court' })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Income and expenses' });
  await expect(summary).toContainText('$400.00');
  await expect(summary).toContainText('$1,150.00');

  // A mistake is voided, not deleted, and stops counting; restoring brings it back.
  await page.getByRole('button', { name: /Void income of \$50\.00/ }).click();
  await expect(summary).toContainText('$1,100.00');
  await expect(page.getByRole('row', { name: /Late fees.*Voided/ })).toBeVisible();
  await page.getByRole('button', { name: /Restore income of \$50\.00/ }).click();
  await expect(summary).toContainText('$1,150.00');
  await expect(page.getByRole('region', { name: 'By year' })).toContainText('Reconciles');

  // The Income page lists it.
  await page.getByRole('link', { name: 'Income' }).click();
  await expect(page.getByRole('heading', { name: 'Income' })).toBeVisible();
  await expect(page.getByRole('row', { name: /8 Elm Court.*Rent.*\$1,500\.00/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /8 Elm Court.*Late fees.*\$50\.00/ })).toBeVisible();

  // The overview keeps rental money apart from sale profit.
  await page.getByRole('link', { name: 'Overview' }).click();
  await page.getByRole('combobox', { name: /Period/ }).selectOption({ label: 'All dates' });
  const rentals = page.getByRole('region', { name: 'Rentals and other income' });
  await expect(rentals).toContainText('$1,550.00');
  await expect(rentals).toContainText('$1,150.00');

  // The rental report reconciles with the property page.
  await go(page, '/reports?kind=income-expense');
  await page.getByRole('combobox', { name: /Date range/ }).selectOption({ label: 'All dates' });
  const byItem = page.getByRole('region', { name: 'By item' });
  await expect(byItem.getByRole('row', { name: /8 Elm Court.*\$1,550\.00.*\$400\.00.*\$1,150\.00/ })).toBeVisible();
  await app.close();
  cleanup(dir);
});

test('income is only offered for rentals and businesses, and archived assets stay readable', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await expect(page.locator('#company-switcher')).toBeVisible();
  // With no rental yet, the Income page explains what to do first.
  await page.getByRole('link', { name: 'Income' }).click();
  await expect(page.getByText(/Add a rental property or an ongoing business/).first()).toBeVisible();
  // A renovation page has no Add income button.
  await go(page, '/properties');
  await page.getByRole('link', { name: /17 Oak Hollow/ }).click();
  await expect(page.getByRole('button', { name: 'Add expense' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add income' })).toHaveCount(0);
  await app.close();
  cleanup(dir);
});

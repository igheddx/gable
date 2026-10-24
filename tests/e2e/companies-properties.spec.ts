import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { demoDir, go, launch, switchCompany, tempDir } from './helpers';

test('first run: create the first company, then the first property', async () => {
  const dir = tempDir('first');
  let app = await launch(dir);
  let page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Welcome to Gable' })).toBeVisible();
  // Only the name is required; no logo or tax id is asked for.
  await page.getByRole('textbox', { name: /Company name/ }).fill('Maple Row LLC');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Add your first property' })).toBeVisible();
  await page.getByRole('textbox', { name: /Street address/ }).fill('12 Maple Row');
  await page.getByRole('textbox', { name: /^City/ }).fill('Riverton');
  await page.getByRole('combobox', { name: /^State/ }).selectOption('TN');
  await page.getByRole('textbox', { name: /^ZIP/ }).fill('37201');
  // Only digits are typed; the slashes appear on their own.
  const purchaseDate = page.getByRole('textbox', { name: /Purchase date/ });
  await purchaseDate.pressSequentially('01152021');
  await expect(purchaseDate).toHaveValue('01/15/2021');
  await expect(page.getByRole('combobox', { name: /^State/ }).locator('option')).toHaveCount(52); // Select + 50 states + DC
  await page.getByRole('textbox', { name: /Purchase price/ }).fill('200,000');
  await page.getByRole('button', { name: 'Save property' }).click();
  await expect(page.getByRole('heading', { name: '12 Maple Row' })).toBeVisible();
  await expect(page.getByText('Held to date')).toBeVisible();
  await expect(page.getByText('$200,000.00').first()).toBeVisible();
  await app.close();

  // Restart: the company is the default and opens directly (no setup).
  app = await launch(dir);
  page = await app.firstWindow();
  await expect(page.locator('#company-switcher option:checked')).toHaveText('Maple Row LLC (default)');
  await go(page, '/properties');
  await expect(page.getByRole('link', { name: '12 Maple Row' })).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('default company opens on launch, and switching never changes the default', async () => {
  const dir = demoDir();
  let app = await launch(dir);
  let page = await app.firstWindow();
  await expect(page.locator('#company-switcher option:checked')).toHaveText('Cedar Homes LLC (default)');
  await switchCompany(page, /Oak House/);
  await expect(page.locator('#company-switcher option:checked')).toHaveText('Oak House LLC');
  await app.close();
  app = await launch(dir);
  page = await app.firstWindow();
  await expect(page.locator('#company-switcher option:checked')).toHaveText('Cedar Homes LLC (default)');
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('search is scoped per company and labeled in All Companies', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await go(page, '/properties');
  await switchCompany(page, /Oak House/);
  const search = page.getByRole('searchbox', { name: /Search address/ });
  await search.fill('oak');
  await expect(page.getByRole('link', { name: '125 Oak Drive' })).toBeVisible();
  await expect(page.getByRole('link', { name: /17 Oak Hollow/ })).toHaveCount(0);
  await switchCompany(page, /Cedar Homes/);
  await expect(page.getByRole('link', { name: /17 Oak Hollow/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '125 Oak Drive' })).toHaveCount(0);
  await switchCompany(page, /All Companies/);
  await expect(page.getByRole('link', { name: '125 Oak Drive' })).toBeVisible();
  await expect(page.getByRole('link', { name: /17 Oak Hollow/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Company' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Oak House LLC' }).first()).toBeVisible();
  // Apostrophes and punctuation do not break search.
  await search.fill("st. mary's");
  await expect(page.getByRole('link', { name: /St\. Mary's Lane/ })).toBeVisible();
  await search.fill('zzz');
  await expect(page.getByText('No matching properties')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.getByRole('link', { name: '125 Oak Drive' })).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('property validation: sale before purchase is rejected; reopening a sale is confirmed', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/properties');
  await page.getByRole('link', { name: '125 Oak Drive' }).click();
  await expect(page.getByText('424 days')).toBeVisible(); // sold 2026-03-15, bought 2025-01-15
  await expect(page.getByText('1 year 2 months')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: /Sale date/ }).fill('12/31/2024');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('The sale date cannot be before the purchase date.')).toBeVisible();
  await page.getByRole('textbox', { name: /Sale date/ }).fill('03/15/2026');
  await page.getByLabel('Status').selectOption('Listed');
  await page.getByRole('button', { name: 'Save changes' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Reopen this sale?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep it sold' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove sale and save' }).click();
  await expect(page.getByText('Not sold')).toBeVisible();
  await expect(page.getByText('Held to date')).toBeVisible();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('archiving the default company requires choosing a replacement', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Archive Cedar Homes LLC' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Archive company' }).click();
  await expect(dialog.getByText('Choose which company becomes the default.')).toBeVisible();
  await dialog.getByLabel(/New default company/).selectOption({ label: 'North Property LLC' });
  await dialog.getByRole('button', { name: 'Archive company' }).click();
  await expect(page.getByText(/Cedar Homes LLC archived/)).toBeVisible();
  await expect(page.locator('#company-switcher option:checked')).toHaveText('North Property LLC (default)');
  await expect(page.locator('#company-switcher option', { hasText: 'Cedar Homes LLC' })).toHaveCount(0);
  // Archived company's properties remain visible in All Companies history only when included.
  await page.getByRole('checkbox', { name: 'Show archived companies' }).check();
  await page.getByRole('button', { name: 'Restore Cedar Homes LLC' }).click();
  await expect(page.locator('#company-switcher option', { hasText: 'Cedar Homes LLC' })).toHaveCount(1);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test('adding a property from All Companies requires choosing the company first', async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await go(page, '/properties');
  await switchCompany(page, /All Companies/);
  await page.getByRole('button', { name: 'Add property' }).click();
  await expect(page.getByRole('heading', { name: 'Add property' })).toBeVisible();
  await expect(page.getByText(/read only/)).toBeVisible();
  await page.locator('main').getByRole('combobox', { name: /^Company/ }).selectOption({ label: 'North Property LLC' });
  await expect(page.locator('.static-value')).toHaveText('North Property LLC');
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

test("a company's expense form only offers that company's properties", async () => {
  const dir = demoDir();
  const app = await launch(dir);
  const page = await app.firstWindow();
  await switchCompany(page, /Oak House/);
  await go(page, '/expenses/new');
  await page.getByRole('combobox', { name: /^Property/ }).click();
  await expect(page.getByRole('option', { name: /48 Willow Court/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /17 Oak Hollow/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /310 Cedar Ridge/ })).toHaveCount(0);
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
});

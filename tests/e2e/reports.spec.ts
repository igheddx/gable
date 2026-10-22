import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { demoDir, go, packagedExecutable, switchCompany, tempDir } from './helpers';

test.describe.configure({ timeout: 180_000 });

async function open() {
  const dir = demoDir();
  const exportDir = tempDir('exports');
  const app = await electron.launch({ executablePath: packagedExecutable(), env: { ...process.env, GABLE_DATA_DIR: dir, GABLE_TEST_EXPORT_DIR: exportDir } });
  const page = await app.firstWindow();
  await expect(page.locator('#company-switcher')).toBeVisible();
  return { app, page, dir, exportDir };
}
const cleanup = (...dirs: string[]) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }));

/** Fixed dates so the tests give the same answer in any year. */
async function chooseRange(page: Page, from: string, to: string) {
  await page.getByRole('combobox', { name: /date range|Period/ }).selectOption({ label: 'Choose dates…' });
  await page.getByRole('textbox', { name: 'From' }).fill(from);
  await page.getByRole('textbox', { name: 'To' }).fill(to);
  await page.getByRole('textbox', { name: 'To' }).blur();
}

async function pdfText(file: string): Promise<{ pages: string[]; text: string }> {
  const pdfjs = (await import(pathToFileURL(path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href)) as {
    getDocument(o: object): { promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: { str?: string }[] }> }> }> };
  };
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0, standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts') + '/' }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str ?? '').join(' '));
  return { pages, text: pages.join('\n') };
}

test('sold-property performance: screen, Excel and PDF all show the same totals (selected by sale date, lifetime costs)', async () => {
  const { app, page, dir, exportDir } = await open();
  await go(page, '/reports');
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await switchCompany(page, /All Companies/);
  await chooseRange(page, '01/01/2026', '12/31/2026');
  const props = page.getByRole('region', { name: 'Sold properties' });
  await expect(props.getByRole('row', { name: /125 Oak Drive.*\$268,000\.00.*\$42,000\.00.*15\.67%/ })).toBeVisible();
  await expect(props.getByRole('row', { name: /71 Northgate Terrace.*\$280,000\.00.*\$70,000\.00.*25\.00%/ })).toBeVisible();
  await expect(props.getByRole('row', { name: /Total.*\$548,000\.00.*\$112,000\.00.*20\.44%/ })).toBeVisible();
  await expect(page.getByText('Properties selected by SALE date')).toBeVisible();
  // 125 Oak Drive's 2025 costs are in its 2026 sale figures: the lifetime-cost basis.
  const summary = page.getByRole('region', { name: 'Report summary' });
  await expect(summary).toContainText('$548,000.00');
  await expect(summary).toContainText('$112,000.00');

  await page.getByRole('button', { name: 'Export Excel' }).click();
  await expect(page.getByText(/Saved .*Sold-property performance .*\.xlsx\./)).toBeVisible();
  const xlsx = fs.readdirSync(exportDir).find((f) => f.endsWith('.xlsx'))!;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(exportDir, xlsx));
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Properties', 'Expenses', 'Allocations']);
  const ws = wb.getWorksheet('Properties')!;
  let total: number | undefined;
  ws.eachRow((row) => { if (row.getCell(1).value === 'Total') { row.eachCell((c) => { if (c.value === 548_000) total = 548_000; }); } });
  expect(total).toBe(548_000);

  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByText(/Saved .*\.pdf\./)).toBeVisible({ timeout: 60_000 });
  const pdf = fs.readdirSync(exportDir).find((f) => f.endsWith('.pdf'))!;
  const { text, pages } = await pdfText(path.join(exportDir, pdf));
  expect(text).toContain('Sold-property performance');
  expect(text).toContain('$548,000.00');
  expect(text).toContain('$112,000.00');
  expect(text).toContain('20.44%');
  expect(text).toContain('SALE date');
  expect(pages[0]).toMatch(/Page 1 of \d+/);
  expect(fs.statSync(path.join(exportDir, pdf)).size).toBeGreaterThan(5_000);
  await app.close();
  cleanup(dir, exportDir);
});

test('expense activity: only expenses dated in the period, general company expenses separate, exports reconcile', async () => {
  const { app, page, dir, exportDir } = await open();
  await switchCompany(page, /Oak House/);
  await go(page, '/reports');
  await page.getByRole('radio', { name: /Expense activity/ }).check();
  await chooseRange(page, '01/01/2026', '12/31/2026');
  await expect(page.getByText('Expenses selected by EXPENSE date')).toBeVisible();
  const general = page.getByRole('region', { name: /General company expenses/ });
  await expect(general.getByRole('row', { name: /Northfield Insurance.*\$1,000\.00/ })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Report summary' });
  // Oak 2026: labor 15,000 + selling 18,000 + willow 1,842.50 + 4,200 = 39,042.50 property; 1,000 general.
  await expect(summary).toContainText('$39,042.50');
  await expect(summary).toContainText('$40,042.50');
  // The 2025 closing costs and interest are NOT in a 2026 expense report.
  await expect(page.getByRole('region', { name: 'Property expenses' })).not.toContainText('First Lender');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  await expect(page.getByText(/Saved .*Expense activity.*\.xlsx\./)).toBeVisible();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(exportDir, fs.readdirSync(exportDir).find((f) => f.endsWith('.xlsx'))!));
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'By Category', 'By Property', 'General Company', 'Expenses', 'Allocations']);
  let all: number | undefined;
  wb.getWorksheet('Summary')!.eachRow((row) => { if (row.getCell(1).value === 'All expenses in period') all = row.getCell(2).value as number; });
  expect(all).toBe(40_042.5);
  await app.close();
  cleanup(dir, exportDir);
});

test('overview shows the four figures separately and company subtotals in All Companies', async () => {
  const { app, page, dir, exportDir } = await open();
  await go(page, '/overview');
  await switchCompany(page, /All Companies/);
  await page.getByRole('combobox', { name: /Period/ }).selectOption({ label: 'Choose dates…' });
  await page.getByRole('textbox', { name: 'From' }).fill('01/01/2026');
  await page.getByRole('textbox', { name: 'To' }).fill('12/31/2026');
  const figures = page.getByRole('region', { name: 'Key figures' });
  await expect(figures).toContainText('Active properties');
  await expect(figures).toContainText('$112,000.00'); // realized profit on properties sold in 2026
  await expect(figures).toContainText('$1,000.00'); // general company expenses, kept separate
  await expect(figures).toContainText('Not a market value');
  const byCompany = page.getByRole('region', { name: 'By company' });
  await expect(byCompany.getByRole('row', { name: /Oak House LLC.*\$42,000\.00.*\$1,000\.00/ })).toBeVisible();
  await expect(byCompany.getByRole('row', { name: /North Property LLC.*\$70,000\.00/ })).toBeVisible();
  await expect(byCompany.getByRole('row', { name: /All companies.*\$112,000\.00/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recent activity' })).toBeVisible();
  await app.close();
  cleanup(dir, exportDir);
});

test('individual property report (historical 2021 to 2026) exports a by-year sheet and a PDF', async () => {
  const { app, page, dir, exportDir } = await open();
  await switchCompany(page, /North Property/);
  await go(page, '/properties');
  await page.getByRole('link', { name: '71 Northgate Terrace' }).click();
  await page.getByRole('button', { name: 'Report' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Report summary' });
  await expect(summary).toContainText('$280,000.00');
  await expect(summary).toContainText('$70,000.00');
  await expect(summary).toContainText('25.00%');
  await expect(summary).toContainText('1,885');
  const byYear = page.getByRole('region', { name: 'Property by year' });
  await expect(byYear.locator('tbody tr')).toHaveCount(6);
  await expect(byYear.getByRole('row', { name: /^2021 \$200,000\.00.*\$5,000\.00.*\$205,000\.00/ })).toBeVisible();
  await page.getByRole('button', { name: 'Export Excel' }).click();
  await expect(page.getByText(/Saved .*\.xlsx\./)).toBeVisible();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(exportDir, fs.readdirSync(exportDir).find((f) => f.endsWith('.xlsx'))!));
  expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Costs', 'Property By Year', 'Expenses', 'Allocations']);
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect(page.getByText(/Saved .*\.pdf\./)).toBeVisible({ timeout: 60_000 });
  const { text } = await pdfText(path.join(exportDir, fs.readdirSync(exportDir).find((f) => f.endsWith('.pdf'))!));
  expect(text).toContain('71 Northgate Terrace');
  expect(text).toContain('$280,000.00');
  expect(text).toContain('Realtor commissions');
  await app.close();
  cleanup(dir, exportDir);
});

test('an empty report says so, and exporting to an unwritable place gives a clear message', async () => {
  const dir = demoDir();
  const exportDir = tempDir('exports');
  const missing = path.join(exportDir, 'does-not-exist');
  const app = await electron.launch({ executablePath: packagedExecutable(), env: { ...process.env, GABLE_DATA_DIR: dir, GABLE_TEST_EXPORT_DIR: missing } });
  const page = await app.firstWindow();
  await go(page, '/reports');
  await expect(page.locator('#company-switcher')).toBeVisible();
  await chooseRange(page, '01/01/2031', '12/31/2031');
  await expect(page.getByText('No properties were sold in this period.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Report summary' })).toContainText('Unavailable'); // no return on cost when nothing sold
  await page.getByRole('button', { name: 'Export Excel' }).click();
  await expect(page.getByText(/That folder no longer exists/)).toBeVisible();
  await app.close();
  cleanup(dir, exportDir);
});

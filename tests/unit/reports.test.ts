import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { ReportService } from '../../src/services/reportService';
import { buildWorkbook, colName, excelDate } from '../../src/services/reports/xlsx';
import { buildReportHtml, formatCell, pdfFooterTemplate, wantsLandscape } from '../../src/services/reports/html';
import type { ReportDoc } from '../../src/shared/reportTypes';
import { company, exp, makeStack, prop, TODAY, type Stack } from './helpers';

let s: Stack;
let r: ReportService;
let a: number, b: number, c: number;
let propA: number, propB: number, propC: number, unsoldA: number;
beforeEach(() => {
  s = makeStack();
  r = new ReportService(s.db, s.companies, s.properties, () => '2026-10-22T12:00:00.000Z', () => TODAY);
  a = s.companies.create(company('Alpha Homes LLC')).id;
  b = s.companies.create(company('Bravo Property LLC')).id;
  c = s.companies.create(company('Charlie Holdings LLC')).id;

  // A: guide fixture A, sold 2026-03-15. Costs span 2025 and 2026.
  propA = s.properties.create(a, prop({ address1: '125 Oak Drive', purchaseDate: '2025-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 })).id;
  s.expenses.create(exp(s, a, propA, '2025-01-15', 'Summit Title', { 'Purchase Closing Costs': 500_000 }));
  s.expenses.create(exp(s, a, propA, '2025-03-10', 'Harbor Lumber', { Materials: 1_200_000, Labor: 800_000 }));
  s.expenses.create(exp(s, a, propA, '2026-01-20', 'Brightline Electric', { Electrical: 1_500_000 }));
  s.expenses.create(exp(s, a, propA, '2025-09-30', 'First Lender', { 'Financing Interest & Fees': 1_000_000 }));
  s.expenses.create(exp(s, a, propA, '2026-03-15', 'Closing Agent', { 'Realtor Commissions': 1_500_000, 'Seller Closing Costs': 300_000 }));
  s.expenses.create(exp(s, a, null, '2026-02-01', 'Northfield Insurance', { Insurance: 100_000 })); // overhead
  unsoldA = s.properties.create(a, prop({ address1: '48 Willow Court', purchaseDate: '2026-02-03', purchasePriceCents: 18_500_000, status: 'Renovating' })).id;
  s.expenses.create(exp(s, a, unsoldA, '2026-09-18', 'Harbor Lumber', { Materials: 184_250 }));

  // B: guide fixture B, 2021 to 2026.
  propB = s.properties.create(b, prop({ address1: '71 Northgate Terrace', purchaseDate: '2021-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 35_000_000 })).id;
  const addB = (date: string, cats: Record<string, number>) => s.expenses.create(exp(s, b, propB, date, 'Vendor B', cats));
  addB('2021-01-15', { 'Purchase Closing Costs': 500_000 });
  addB('2022-06-01', { Labor: 1_500_000, Materials: 1_000_000 });
  addB('2023-05-01', { 'Property Taxes': 500_000, Insurance: 300_000 });
  addB('2024-07-01', { Maintenance: 1_200_000 });
  addB('2025-08-01', { 'Financing Interest & Fees': 1_000_000 });
  addB('2026-03-15', { 'Realtor Commissions': 1_500_000, 'Seller Closing Costs': 500_000 });

  // C: a loss in 2025, with a voided expense and a very long address.
  propC = s.properties.create(c, prop({ address1: '9999 Extraordinarily Long Boulevard Name That Keeps Going And Going, Building Seven, Suite 12-B', purchaseDate: '2024-04-01', purchasePriceCents: 10_000_000, status: 'Sold', saleDate: '2025-06-01', salePriceCents: 9_000_000 })).id;
  s.expenses.create(exp(s, c, propC, '2024-08-01', 'Vendor C', { Materials: 1_000_000 }));
  const gone = s.expenses.create(exp(s, c, propC, '2024-09-01', 'Voided Vendor', { Labor: 777_700 }));
  s.expenses.void(gone.id);
});
afterEach(() => s.cleanup());

const table = (d: ReportDoc, id: string) => d.tables.find((t) => t.id === id)!;
const col = (d: ReportDoc, tid: string, key: string) => { const t = table(d, tid); const i = t.columns.findIndex((x) => x.key === key); return t.rows.map((row) => row[i]); };
const sum = (xs: (string | number | null | undefined)[]) => xs.reduce<number>((acc, x) => acc + (typeof x === 'number' ? x : 0), 0);
const summaryVal = (d: ReportDoc, label: RegExp) => d.summary.find((l) => label.test(l.label))?.value;

describe('sold-property performance (selected by SALE date)', () => {
  it('2026 includes both 2026 sales with their full lifetime costs, and not the 2025 sale', () => {
    const d = r.build({ kind: 'sold-performance', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    expect(col(d, 'properties', 'address')).toEqual(['125 Oak Drive', '71 Northgate Terrace']);
    expect(col(d, 'properties', 'cost')).toEqual([26_800_000, 28_000_000]); // includes 2025 and 2021 costs
    expect(col(d, 'properties', 'profit')).toEqual([4_200_000, 7_000_000]);
    expect(col(d, 'properties', 'roi')).toEqual([1567, 2500]);
    expect(summaryVal(d, /Total project cost/)).toBe(54_800_000);
    expect(summaryVal(d, /Total profit/)).toBe(11_200_000);
    expect(summaryVal(d, /Overall return/)).toBe(2044); // 11,200,000 / 54,800,000
    expect(d.basis).toMatch(/SALE date/);
    expect(table(d, 'properties').totals?.at(-1)).toBe(2044);
  });

  it('lists the 2025 loss with a negative profit and excludes the voided expense', () => {
    const d = r.build({ kind: 'sold-performance', scope: c, from: '2025-01-01', to: '2025-12-31', propertyId: null });
    expect(col(d, 'properties', 'cost')).toEqual([11_000_000]);
    expect(col(d, 'properties', 'profit')).toEqual([-2_000_000]);
    expect(col(d, 'properties', 'roi')).toEqual([-1818]);
    expect(sum(col(d, 'expenses', 'amount'))).toBe(1_000_000);
    expect(table(d, 'allocations').rows).toHaveLength(1);
  });

  it('every total reconciles: allocations, expenses and the property table agree', () => {
    const d = r.build({ kind: 'sold-performance', scope: 'all', from: null, to: null, propertyId: null });
    const expenses = sum(col(d, 'expenses', 'amount'));
    expect(sum(col(d, 'allocations', 'amount'))).toBe(expenses);
    const cost = sum(col(d, 'properties', 'cost'));
    const purchases = sum(col(d, 'properties', 'purchase'));
    expect(cost).toBe(purchases + expenses);
    expect(summaryVal(d, /Total project cost/)).toBe(cost);
  });

  it('an empty period gives an empty table, zero totals and no ROI', () => {
    const d = r.build({ kind: 'sold-performance', scope: 'all', from: '2030-01-01', to: '2030-12-31', propertyId: null });
    expect(table(d, 'properties').rows).toEqual([]);
    expect(table(d, 'properties').totals).toBeUndefined();
    expect(summaryVal(d, /Properties sold/)).toBe(0);
    expect(summaryVal(d, /Overall return/)).toBeNull();
  });

  it('rejects an end date before the start date', () => {
    expect(() => r.build({ kind: 'sold-performance', scope: 'all', from: '2026-12-31', to: '2026-01-01', propertyId: null })).toThrow(/cannot be before/);
  });
});

describe('expense activity (selected by EXPENSE date)', () => {
  it('2026 contains only 2026-dated expenses, with general company expenses separate', () => {
    const d = r.build({ kind: 'expense-activity', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    // A: 2026 labor 15,000 + selling 18,000 + willow 1,842.50 ; B: 20,000 ; overhead 1,000 is general
    expect(summaryVal(d, /^Property expenses/)).toBe(1_500_000 + 1_800_000 + 184_250 + 2_000_000);
    expect(summaryVal(d, /General company expenses/)).toBe(100_000);
    expect(summaryVal(d, /All expenses/)).toBe(5_484_250 + 100_000);
    expect(col(d, 'general', 'vendor')).toEqual(['Northfield Insurance']);
    expect(col(d, 'expenses', 'date').every((x) => String(x).startsWith('2026'))).toBe(true);
    expect(d.basis).toMatch(/EXPENSE date/);
  });

  it('by-category, by-property, expense list and allocations all reconcile to the same total', () => {
    const d = r.build({ kind: 'expense-activity', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    const all = summaryVal(d, /All expenses/) as number;
    expect(sum(col(d, 'by-category', 'total'))).toBe(all);
    expect(sum(col(d, 'allocations', 'amount'))).toBe(all);
    expect(sum(col(d, 'expenses', 'amount')) + sum(col(d, 'general', 'amount'))).toBe(all);
    expect(sum(col(d, 'by-property', 'amount'))).toBe(summaryVal(d, /^Property expenses/));
  });

  it('splits one expense across categories without double counting', () => {
    const d = r.build({ kind: 'expense-activity', scope: a, from: '2026-03-15', to: '2026-03-15', propertyId: null });
    expect(summaryVal(d, /All expenses/)).toBe(1_800_000);
    const cats = Object.fromEntries(table(d, 'by-category').rows.map((row) => [row[0], row[4]]));
    expect(cats).toEqual({ 'Realtor Commissions': 1_500_000, 'Seller Closing Costs': 300_000 });
  });

  it('crosses periods correctly: an expense dated 2024 never appears in a 2025-only report', () => {
    const d = r.build({ kind: 'expense-activity', scope: 'all', from: '2025-01-01', to: '2025-12-31', propertyId: null });
    expect(col(d, 'expenses', 'date').every((x) => String(x).startsWith('2025'))).toBe(true);
    expect(col(d, 'expenses', 'vendor')).not.toContain('Vendor C'); // 2024
  });

  it('is scoped to a single company', () => {
    const d = r.build({ kind: 'expense-activity', scope: b, from: null, to: null, propertyId: null });
    expect(d.company).toBe('Bravo Property LLC');
    expect(summaryVal(d, /All expenses/)).toBe(8_000_000);
  });
});

describe('portfolio snapshot and property report', () => {
  it('keeps unsold investment apart from sold results', () => {
    const d = r.build({ kind: 'portfolio-snapshot', scope: 'all', from: null, to: null, propertyId: null });
    expect(col(d, 'unsold', 'address')).toEqual(['48 Willow Court']);
    expect(col(d, 'unsold', 'inv')).toEqual([18_500_000 + 184_250]);
    expect(summaryVal(d, /Recorded investment/)).toBe(18_684_250);
    expect(col(d, 'sold', 'address')).toHaveLength(3);
    expect(summaryVal(d, /Realized profit/)).toBe(4_200_000 + 7_000_000 - 2_000_000);
    expect(d.notes.join(' ')).toMatch(/not a market value/);
  });

  it('the property report matches the property screen (bridge, by-year, reconciliation)', () => {
    const d = r.build({ kind: 'property', scope: b, from: null, to: null, propertyId: propB });
    const fin = s.financials.propertyFinancials(propB);
    expect(summaryVal(d, /Total project cost/)).toBe(fin.bridge.projectCostCents);
    expect(summaryVal(d, /Profit before taxes/)).toBe(fin.bridge.profitCents);
    expect(summaryVal(d, /Return on cost/)).toBe(fin.bridge.roiBasisPoints);
    expect(summaryVal(d, /^Days held/)).toBe(1885);
    const by = table(d, 'by-year');
    expect(by.rows.map((row) => row[0])).toEqual(fin.byYear.map((y) => y.year));
    const expIdx = by.columns.findIndex((x) => x.key === 'exp');
    expect(by.rows.map((row) => row[expIdx])).toEqual(fin.byYear.map((y) => y.expensesCents));
    expect(by.totals![expIdx]).toBe(8_000_000);
    expect(sum(col(d, 'expenses', 'amount'))).toBe(8_000_000);
    expect(sum(col(d, 'allocations', 'amount'))).toBe(8_000_000);
    const bridge = table(d, 'costs');
    expect(bridge.rows.find((row) => String(row[0]).includes('Realtor commissions'))?.[1]).toBe(1_500_000);
    expect(bridge.rows.find((row) => row[0] === 'Profit before taxes')?.[1]).toBe(7_000_000);
  });

  it('an unsold property report has investment to date and no profit or ROI', () => {
    const d = r.build({ kind: 'property', scope: a, from: null, to: null, propertyId: unsoldA });
    expect(summaryVal(d, /Recorded investment to date/)).toBe(18_684_250);
    expect(d.summary.some((l) => /Profit|Return/.test(l.label))).toBe(false);
  });
});

describe('overview', () => {
  it('matches the report totals, with company overhead and sold profit as separate figures', () => {
    const o = r.overview('all', '2026-01-01', '2026-12-31', 'This year');
    const sold = r.build({ kind: 'sold-performance', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    const act = r.build({ kind: 'expense-activity', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    const snap = r.build({ kind: 'portfolio-snapshot', scope: 'all', from: null, to: null, propertyId: null });
    expect(o.realizedProfitCents).toBe(summaryVal(sold, /Total profit/));
    expect(o.generalExpensesCents).toBe(summaryVal(act, /General company expenses/));
    expect(o.unsoldInvestmentCents).toBe(summaryVal(snap, /Recorded investment/));
    expect(o.activeProperties).toBe(1);
    expect(o.soldInPeriod).toBe(2);
    expect(o.companies.map((x) => [x.name, x.realizedProfitCents])).toEqual([['Alpha Homes LLC', 4_200_000], ['Bravo Property LLC', 7_000_000], ['Charlie Holdings LLC', 0]]);
    expect(o.recent).toHaveLength(8);
    const one = r.overview(a, '2026-01-01', '2026-12-31', 'This year');
    expect(one.companies).toHaveLength(1);
    expect(one.generalExpensesCents).toBe(100_000);
  });
});

describe('Excel export', () => {
  const read = async (doc: ReportDoc) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buildWorkbook(doc) as unknown as ArrayBuffer);
    return wb;
  };

  it('is a real workbook with Summary and one sheet per table, numeric money and real dates', async () => {
    const d = r.build({ kind: 'sold-performance', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    const wb = await read(d);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Properties', 'Expenses', 'Allocations']);
    const ws = wb.getWorksheet('Properties')!;
    let headerRow = 0;
    ws.eachRow((row, n) => { if (row.getCell(1).value === 'Company' && row.getCell(2).value === 'Property') headerRow = n; });
    expect(headerRow).toBeGreaterThan(0);
    const first = ws.getRow(headerRow + 1);
    const idx = (label: string) => { let k = 0; ws.getRow(headerRow).eachCell((cell, i) => { if (cell.value === label) k = i; }); return k; };
    const cost = first.getCell(idx('Total project cost'));
    expect(typeof cost.value).toBe('number');
    expect(cost.value).toBe(268_000);
    expect(cost.numFmt).toContain('$');
    const profit = first.getCell(idx('Profit before taxes'));
    expect(profit.value).toBe(42_000);
    const roi = first.getCell(idx('Return on cost'));
    expect(roi.value).toBeCloseTo(0.1567, 4);
    expect(roi.numFmt).toBe('0.00%');
    const sold = first.getCell(idx('Sold'));
    expect(sold.value).toBeInstanceOf(Date);
    expect((sold.value as Date).toISOString().slice(0, 10)).toBe('2026-03-15');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: headerRow });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getColumn(2).width).toBeGreaterThan(20);
  });

  it('writes basis, company, filters and as-of on every sheet and the summary figures as numbers', async () => {
    const d = r.build({ kind: 'expense-activity', scope: a, from: '2026-01-01', to: '2026-12-31', propertyId: null });
    const wb = await read(d);
    for (const ws of wb.worksheets) {
      const texts: string[] = [];
      ws.eachRow((row) => row.eachCell((cell) => { if (typeof cell.value === 'string') texts.push(cell.value); }));
      expect(texts).toContain('Alpha Homes LLC');
      expect(texts.some((t) => /EXPENSE date/.test(t))).toBe(true);
      expect(texts).toContain('01/01/2026 to 12/31/2026');
    }
    const sum1 = wb.getWorksheet('Summary')!;
    let value: unknown;
    sum1.eachRow((row) => { if (row.getCell(1).value === 'General company expenses') value = row.getCell(2).value; });
    expect(value).toBe(1_000);
  });

  it('never lets user text become a formula, and keeps numeric totals equal to the report', async () => {
    const evil = s.companies.create(company('Evil LLC')).id;
    const pe = s.properties.create(evil, prop({ address1: '=HYPERLINK("http://x","click")', status: 'Sold', saleDate: '2026-02-01', salePriceCents: 200_000, purchasePriceCents: 100_000, purchaseDate: '2026-01-01' })).id;
    s.expenses.create(exp(s, evil, pe, '2026-01-15', '+cmd|calc', { Materials: 5_000 }));
    s.expenses.create(exp(s, evil, pe, '2026-01-16', '@SUM(1+1)', { Labor: 6_000 }));
    s.expenses.create(exp(s, evil, pe, '2026-01-17', '-2+3', { Labor: 7_000 }));
    const d = r.build({ kind: 'sold-performance', scope: evil, from: null, to: null, propertyId: null });
    const bytes = buildWorkbook(d);
    const wb = await read(d);
    const exps = wb.getWorksheet('Expenses')!;
    const seen: unknown[] = [];
    exps.eachRow((row) => row.eachCell((cell) => seen.push(cell.value)));
    for (const bad of ['+cmd|calc', '@SUM(1+1)', '-2+3', '=HYPERLINK("http://x","click")']) {
      expect(seen).toContain(bad); // stored as plain text
      expect(seen.some((v) => typeof v === 'object' && v !== null && 'formula' in (v as object))).toBe(false);
    }
    const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet2.xml']!);
    expect(xml).not.toMatch(/<f>/);
    expect(strFromU8(unzipSync(bytes)['xl/styles.xml']!)).toContain('quotePrefix="1"');
    expect(xml).toMatch(/s="8"[^>]*t="inlineStr"><is><t[^>]*>=HYPERLINK/); // marked as quoted text
  });

  it('handles many rows, long text and special characters; contains no file paths', async () => {
    const big = s.companies.create(company('Big & "Bold" <LLC>')).id;
    const pb = s.properties.create(big, prop({ address1: 'Long Address '.repeat(12), purchaseDate: '2025-01-01', purchasePriceCents: 100, status: 'Sold', saleDate: '2025-12-31', salePriceCents: 100_000 })).id;
    for (let i = 0; i < 400; i++) s.expenses.create(exp(s, big, pb, `2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`, `Vendor ${i} & Sons <b>`, { Materials: 100 + i }));
    const d = r.build({ kind: 'sold-performance', scope: big, from: null, to: null, propertyId: null });
    const bytes = buildWorkbook(d);
    const wb = await read(d);
    expect(wb.getWorksheet('Expenses')!.rowCount).toBeGreaterThan(400);
    expect(wb.getWorksheet('Properties')!.getColumn(1).width).toBeLessThanOrEqual(60);
    for (const [name, data] of Object.entries(unzipSync(bytes))) {
      const text = strFromU8(data);
      expect(text, name).not.toMatch(/\/Users\/|[A-Z]:\\|receipts[\\/]/);
    }
    const money = sumColumn(wb.getWorksheet('Expenses')!, 'Amount');
    expect(money * 100).toBeCloseTo(sum(col(d, 'expenses', 'amount')), 0);
  });

  it('names sheets safely and column letters correctly', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(excelDate('2026-03-15')).toBe(46_096);
    expect(excelDate('1900-03-01')).toBe(61);
  });
});

/** Sum of the numeric cells under a header, excluding the totals row. */
function sumColumn(ws: ExcelJS.Worksheet, label: string): number {
  let idx = 0;
  let header = 0;
  ws.eachRow((row, n) => row.eachCell((cell, i) => { if (cell.value === label && !idx) { idx = i; header = n; } }));
  let total = 0;
  ws.eachRow((row, n) => { const v = row.getCell(idx).value; if (n > header && typeof v === 'number' && row.getCell(1).value !== 'Total') total += v; });
  return Math.round(total * 100) / 100;
}

describe('PDF print layout', () => {
  it('is self-contained, repeats table headers, shows the basis and as-of, and matches the data', () => {
    const d = r.build({ kind: 'sold-performance', scope: 'all', from: '2026-01-01', to: '2026-12-31', propertyId: null });
    const html = buildReportHtml(d, { logoDataUrl: null, fonts: { sans: 'AAAA', serif: 'BBBB' } });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('thead{display:table-header-group}');
    expect(html).toContain("font-family:'Inter Variable'");
    expect(html).toContain('Properties selected by SALE date');
    expect(html).toContain('$268,000.00');
    expect(html).toContain('$112,000.00');
    expect(html).toContain('15.67%');
    expect(html).toContain('As of');
    expect(wantsLandscape(d)).toBe(true);
    expect(pdfFooterTemplate(d)).toContain('class="pageNumber"');
  });

  it('escapes user text and formats cells consistently with the screen', () => {
    const d = r.build({ kind: 'expense-activity', scope: 'all', from: null, to: null, propertyId: null });
    d.company = '<img src=x onerror=alert(1)>';
    const html = buildReportHtml(d, { logoDataUrl: null, fonts: { sans: null, serif: null } });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(formatCell(1999, 'money')).toBe('$19.99');
    expect(formatCell('2026-03-15', 'date')).toBe('03/15/2026');
    expect(formatCell(1567, 'percent')).toBe('15.67%');
    expect(formatCell(null, 'money')).toBe('');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection';
import { migrations } from '../../src/db/migrations';
import { AppError } from '../../src/shared/errors';
import { ReportService } from '../../src/services/reportService';
import { company, exp, inc, makeStack, prop, rental, RENTAL_TYPE, TODAY, vehicle, type Stack } from './helpers';

let s: Stack;
let co: number;
beforeEach(() => {
  s = makeStack();
  co = s.companies.create(company('Cedar Homes LLC')).id;
});
afterEach(() => s.cleanup());

const fail = (fn: () => unknown): AppError => {
  try { fn(); } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected an error');
};

describe('upgrading an existing database (migration 5)', () => {
  it('keeps every property, expense and receipt draft, makes them Renovations, and adds the new categories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-mig5-'));
    const file = path.join(dir, 'old.db');
    try {
      const now = '2026-01-01T00:00:00.000Z';
      let db = openDatabase(file, { migrations: migrations.slice(0, 4) });
      db.prepare("INSERT INTO company (display_name, name_key, created_at, updated_at) VALUES ('Old Co', 'old co', ?, ?)").run(now, now);
      db.prepare("INSERT INTO property (company_id, address1, city, state, zip, search_text, purchase_date, purchase_price_cents, status, created_at, updated_at) VALUES (1, '1 Main', 'X', 'TN', '37201', '1 main', '2021-01-15', 20000000, 'Held', ?, ?)").run(now, now);
      db.prepare("INSERT INTO vendor (company_id, name, name_key, created_at) VALUES (1, 'V', 'v', ?)").run(now);
      db.prepare("INSERT INTO category (company_id, name, name_key, reporting_group, created_at, updated_at) VALUES (1, 'Materials', 'materials', 'renovation', ?, ?)").run(now, now);
      db.prepare("INSERT INTO expense (company_id, property_id, vendor_id, expense_date, total_cents, idempotency_key, created_at, updated_at) VALUES (1, 1, 1, '2021-02-01', 5000, 'k', ?, ?)").run(now, now);
      db.prepare("INSERT INTO receipt_draft (company_id, property_id, status, posting_token, created_at, updated_at) VALUES (1, 1, 'queued', 't1', ?, ?)").run(now, now);
      db.close();

      db = openDatabase(file);
      expect(db.prepare('SELECT id, business_type_id AS t, address1, purchase_price_cents AS p FROM property').all()).toEqual([{ id: 1, t: 1, address1: '1 Main', p: 20000000 }]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.prepare('SELECT COUNT(*) AS n FROM expense WHERE property_id = 1').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM receipt_draft WHERE property_id = 1').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT name FROM business_type ORDER BY id').all()).toEqual([{ name: 'Renovation' }, { name: 'Rental' }, { name: 'Vehicle' }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM category WHERE company_id = 1 AND name IN ('Parts & Repairs', 'Title & Registration', 'Property Management Fees')").get()).toEqual({ n: 3 });
      // The ownership rules written for the old table still hold on the new one.
      expect(() => db.prepare("UPDATE property SET company_id = 2 WHERE id = 1").run()).toThrow();
      expect(() => db.prepare('UPDATE property SET business_type_id = 2 WHERE id = 1').run()).toThrow(/cannot be changed/);
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('business types', () => {
  it('starts with Renovation, Rental and Vehicle, which cannot be changed', () => {
    expect(s.businessTypes.list().map((t) => [t.name, t.template, t.isBuiltin])).toEqual([
      ['Renovation', 'renovation', true], ['Rental', 'rental', true], ['Vehicle', 'buy_sell', true],
    ]);
    expect(fail(() => s.businessTypes.archive(1)).code).toBe('CONFLICT');
    expect(fail(() => s.businessTypes.rename(3, 'Cars')).code).toBe('CONFLICT');
  });

  it('adds, renames, archives and restores a custom type', () => {
    const t = s.businessTypes.create({ name: ' Equipment Resale ', template: 'buy_sell' });
    expect(t).toMatchObject({ name: 'Equipment Resale', template: 'buy_sell', isBuiltin: false, isArchived: false });
    expect(s.businessTypes.rename(t.id, 'Heavy Equipment').name).toBe('Heavy Equipment');
    expect(s.businessTypes.archive(t.id).isArchived).toBe(true);
    expect(s.businessTypes.list().map((x) => x.name)).not.toContain('Heavy Equipment');
    expect(s.businessTypes.list(true).map((x) => x.name)).toContain('Heavy Equipment');
    expect(s.businessTypes.restore(t.id).isArchived).toBe(false);
  });

  it('rejects a blank or duplicate name, ignoring case and spacing', () => {
    expect(fail(() => s.businessTypes.create({ name: '  ', template: 'buy_sell' })).fields?.name).toBeTruthy();
    expect(fail(() => s.businessTypes.create({ name: 'vehicle', template: 'buy_sell' })).fields?.name).toMatch(/already exists/);
    s.businessTypes.create({ name: 'Boats', template: 'buy_sell' });
    expect(fail(() => s.businessTypes.create({ name: ' BOATS ', template: 'income_expense' })).fields?.name).toMatch(/already exists/);
  });

  it('no new items can be added under an archived type, but existing items stay', () => {
    const t = s.businessTypes.create({ name: 'Boats', template: 'buy_sell' });
    const boat = s.properties.create(co, vehicle({ address1: 'Bass boat', businessTypeId: t.id }));
    s.businessTypes.archive(t.id);
    expect(fail(() => s.properties.create(co, vehicle({ businessTypeId: t.id }))).code).toBe('ARCHIVED');
    expect(s.properties.get(boat.id).businessTypeName).toBe('Boats');
  });
});

describe('items by business type', () => {
  it('a vehicle has a name and an ID instead of an address', () => {
    const v = s.properties.create(co, vehicle({ address2: 'ignored', city: 'ignored', state: 'TN', zip: '12345' }));
    expect(v).toMatchObject({ address1: '2018 Honda Accord', identifier: '1HGCV1F3XJA000001', city: '', state: '', zip: '', address2: '', template: 'buy_sell', businessTypeName: 'Vehicle' });
    expect(fail(() => s.properties.create(co, vehicle({ address1: ' ' }))).fields?.address1).toBe('Enter a name.');
  });

  it('a vehicle needs a purchase date and price, and a sale when Sold', () => {
    expect(Object.keys(fail(() => s.properties.create(co, vehicle({ purchaseDate: null, purchasePriceCents: null }))).fields!).sort()).toEqual(['purchaseDate', 'purchasePriceCents']);
    expect(fail(() => s.properties.create(co, vehicle({ status: 'Sold' }))).fields).toMatchObject({ saleDate: expect.any(String), salePriceCents: expect.any(String) });
    expect(s.properties.create(co, vehicle({ status: 'Sold', saleDate: '2026-03-01', salePriceCents: 1_400_000 })).status).toBe('Sold');
  });

  it('a rental needs an address but the purchase is optional, and both or neither', () => {
    expect(s.properties.create(co, rental()).purchaseDate).toBeNull();
    expect(s.properties.create(co, rental({ address1: '9 Elm Court', purchaseDate: '2019-05-01', purchasePriceCents: 15_000_000 })).purchasePriceCents).toBe(15_000_000);
    expect(fail(() => s.properties.create(co, rental({ purchaseDate: '2019-05-01' }))).fields?.purchasePriceCents).toBeTruthy();
    expect(fail(() => s.properties.create(co, rental({ purchasePriceCents: 100 }))).fields?.purchaseDate).toBeTruthy();
    expect(fail(() => s.properties.create(co, rental({ address1: '' }))).fields?.address1).toBeTruthy();
  });

  it('an ongoing business has just a name, no purchase and no sale', () => {
    const t = s.businessTypes.create({ name: 'Car Wash', template: 'income_expense' });
    const w = s.properties.create(co, { ...vehicle({ businessTypeId: t.id, address1: 'Main St Car Wash' }), purchaseDate: '2026-01-01', purchasePriceCents: 5000 });
    expect(w).toMatchObject({ purchaseDate: null, purchasePriceCents: null, status: 'Held', identifier: '' });
    expect(fail(() => s.properties.create(co, vehicle({ businessTypeId: t.id, status: 'Sold', saleDate: '2026-02-01', salePriceCents: 1 }))).fields?.status).toBeTruthy();
  });

  it('statuses are limited to what each kind of item uses', () => {
    expect(fail(() => s.properties.create(co, rental({ status: 'Renovating' }))).fields?.status).toBeTruthy();
    expect(s.properties.create(co, vehicle({ status: 'Listed' })).status).toBe('Listed');
  });

  it('the business type of an existing item cannot change', () => {
    const p = s.properties.create(co, prop());
    expect(fail(() => s.properties.update(p.id, { ...prop(), businessTypeId: RENTAL_TYPE })).message).toMatch(/cannot be changed/);
    expect(s.properties.update(p.id, { ...prop({ notes: 'ok' }), businessTypeId: 1 }).notes).toBe('ok');
  });

  it('a search finds a vehicle by name, ID or type, and the list filters by type', () => {
    s.properties.create(co, prop());
    s.properties.create(co, vehicle());
    s.properties.create(co, rental());
    const names = (q: object) => s.properties.list({ scope: co, ...q }).rows.map((r) => r.address1);
    expect(names({ q: 'accord' })).toEqual(['2018 Honda Accord']);
    expect(names({ q: '1hgcv1' })).toEqual(['2018 Honda Accord']);
    expect(names({ q: 'vehicle' })).toEqual(['2018 Honda Accord']);
    expect(names({ businessTypeId: 2 })).toEqual(['8 Elm Court']);
    expect(names({}).sort()).toEqual(['125 Oak Drive', '2018 Honda Accord', '8 Elm Court']);
  });
});

describe('income', () => {
  it('records rent against a rental and rejects it on a renovation or a vehicle', () => {
    const r = s.properties.create(co, rental());
    const i = s.income.create(inc(co, r.id, '2026-02-01', 150_000));
    expect(i).toMatchObject({ propertyId: r.id, propertyName: '8 Elm Court', amountCents: 150_000, category: 'Rent', status: 'posted' });
    const reno = s.properties.create(co, prop());
    expect(fail(() => s.income.create(inc(co, reno.id, '2026-02-01', 100))).fields?.propertyId).toMatch(/do not take income/);
    const car = s.properties.create(co, vehicle());
    expect(fail(() => s.income.create(inc(co, car.id, '2026-02-01', 100))).fields?.propertyId).toMatch(/do not take income/);
  });

  it('saving twice with the same key creates one entry', () => {
    const r = s.properties.create(co, rental());
    const input = inc(co, r.id, '2026-02-01', 150_000);
    const a = s.income.create(input);
    const b = s.income.create(input);
    expect(b.id).toBe(a.id);
    expect(s.income.list({ scope: co }).total).toBe(1);
  });

  it('checks the date and the type of income for the item', () => {
    const r = s.properties.create(co, rental());
    expect(fail(() => s.income.create(inc(co, r.id, '2026-02-30', 100))).fields?.incomeDate).toBeTruthy();
    expect(fail(() => s.income.create(inc(co, r.id, '2026-02-01', 100, 'Sales'))).fields?.category).toBeTruthy();
    const t = s.businessTypes.create({ name: 'Car Wash', template: 'income_expense' });
    const w = s.properties.create(co, vehicle({ businessTypeId: t.id }));
    expect(s.income.create(inc(co, w.id, '2026-02-01', 100, 'Sales')).category).toBe('Sales');
    expect(fail(() => s.income.create(inc(co, w.id, '2026-02-01', 100, 'Rent'))).fields?.category).toBeTruthy();
  });

  it('only the owning company, and only active items, take income', () => {
    const other = s.companies.create(company('Other LLC')).id;
    const r = s.properties.create(co, rental());
    expect(fail(() => s.income.create(inc(other, r.id, '2026-02-01', 100))).fields?.propertyId).toMatch(/different company/);
    s.properties.archive(r.id);
    expect(fail(() => s.income.create(inc(co, r.id, '2026-02-01', 100))).fields?.propertyId).toMatch(/archived/);
  });

  it('edits, voids and restores; a voided entry does not count', () => {
    const r = s.properties.create(co, rental());
    const i = s.income.create(inc(co, r.id, '2026-02-01', 150_000));
    expect(s.income.update(i.id, { incomeDate: '2026-02-05', amountCents: 160_000, category: 'Late fees', notes: ' late ' })).toMatchObject({ incomeDate: '2026-02-05', amountCents: 160_000, category: 'Late fees', notes: 'late' });
    expect(s.financials.cashFlow(r.id).incomeCents).toBe(160_000);
    s.income.void(i.id);
    expect(s.financials.cashFlow(r.id).incomeCents).toBe(0);
    expect(fail(() => s.income.update(i.id, { incomeDate: '2026-02-05', amountCents: 1, category: 'Rent', notes: '' })).code).toBe('CONFLICT');
    s.income.unvoid(i.id);
    expect(s.financials.cashFlow(r.id).incomeCents).toBe(160_000);
    expect(() => s.db.prepare('DELETE FROM income WHERE id = ?').run(i.id)).toThrow(/never deleted/);
  });

  it('lists with filters and hides voided entries by default', () => {
    const r = s.properties.create(co, rental());
    const a = s.income.create(inc(co, r.id, '2026-01-01', 100));
    s.income.create(inc(co, r.id, '2026-02-01', 200));
    s.income.void(a.id);
    expect(s.income.list({ scope: co }).rows.map((x) => x.amountCents)).toEqual([200]);
    expect(s.income.list({ scope: co, includeVoided: true }).total).toBe(2);
    expect(s.income.list({ scope: co, from: '2026-02-01' }).total).toBe(1);
    expect(s.income.list({ scope: co, propertyId: r.id + 99 }).total).toBe(0);
  });
});

describe('money for the new kinds of item', () => {
  it('a vehicle has the same cost, profit and return math as a renovation', () => {
    const v = s.properties.create(co, vehicle({ purchasePriceCents: 1_000_000 }));
    s.expenses.create(exp(s, co, v.id, '2026-01-20', 'Joe Auto', { 'Parts & Repairs': 120_000, 'Detailing & Cleaning': 30_000 }));
    s.expenses.create(exp(s, co, v.id, '2026-01-12', 'DMV', { 'Title & Registration': 20_000 }));
    s.properties.update(v.id, vehicle({ status: 'Sold', saleDate: '2026-03-01', salePriceCents: 1_400_000 }));
    const f = s.financials.propertyFinancials(v.id);
    expect(f.bridge).toMatchObject({ expensesCents: 170_000, projectCostCents: 1_170_000, profitCents: 230_000, roiBasisPoints: 1966 });
    expect(f.bridge.groups).toMatchObject({ renovation: 150_000, purchase_closing: 20_000 });
    expect(f.reconciliation.matches).toBe(true);
  });

  it('cash flow adds income, subtracts expenses, and reconciles across years', () => {
    const r = s.properties.create(co, rental({ purchaseDate: '2019-05-01', purchasePriceCents: 15_000_000 }));
    s.income.create(inc(co, r.id, '2025-12-01', 140_000));
    s.income.create(inc(co, r.id, '2026-01-01', 150_000));
    s.income.create(inc(co, r.id, '2026-02-01', 150_000));
    s.income.create(inc(co, r.id, '2026-02-03', 5_000, 'Late fees'));
    s.expenses.create(exp(s, co, r.id, '2026-01-15', 'Plumber', { Plumbing: 40_000 }));
    s.expenses.create(exp(s, co, r.id, '2025-12-15', 'Insurer', { Insurance: 30_000, 'Property Taxes': 10_000 }));
    const voided = s.expenses.create(exp(s, co, r.id, '2026-01-16', 'Mistake', { Materials: 99_999 }));
    s.expenses.void(voided.id);
    const f = s.financials.cashFlow(r.id);
    expect(f).toMatchObject({ incomeCents: 445_000, expensesCents: 80_000, netCents: 365_000 });
    expect(f.byYear.map((y) => [y.year, y.incomeCents, y.expensesCents, y.netCents])).toEqual([[2025, 140_000, 40_000, 100_000], [2026, 305_000, 40_000, 265_000]]);
    expect(f.byYear[1]!.incomeByCategory).toEqual([{ category: 'Rent', cents: 300_000 }, { category: 'Late fees', cents: 5_000 }]);
    expect(f.reconciliation.matches).toBe(true);
    // The purchase price is not an expense of the rental.
    expect(f.expensesCents).toBe(80_000);
  });
});

describe('reports for the new kinds of item', () => {
  const build = (r: ReportService, kind: Parameters<ReportService['build']>[0]['kind'], over: object = {}) => r.build({ kind, scope: co, from: null, to: null, propertyId: null, ...over });
  const mk = () => new ReportService(s.db, s.companies, s.properties, () => `${TODAY}T12:00:00.000Z`, () => TODAY);
  const cell = (doc: ReturnType<ReportService['build']>, table: string, row: number, key: string) => {
    const t = doc.tables.find((x) => x.id === table)!;
    return t.rows[row]![t.columns.findIndex((c) => c.key === key)];
  };

  it('income and expense report: rentals only, by item, month and category, and it reconciles', () => {
    const r = s.properties.create(co, rental());
    const reno = s.properties.create(co, prop());
    s.income.create(inc(co, r.id, '2026-01-05', 150_000));
    s.income.create(inc(co, r.id, '2026-02-05', 150_000));
    s.expenses.create(exp(s, co, r.id, '2026-01-20', 'Plumber', { Plumbing: 40_000 }));
    s.expenses.create(exp(s, co, reno.id, '2026-01-20', 'Lumber', { Materials: 999_900 })); // a renovation cost: not in this report
    const doc = build(mk(), 'income-expense', { from: '2026-01-01', to: '2026-12-31' });
    expect(doc.summary.map((x) => x.value)).toEqual([1, 300_000, 40_000, 260_000]);
    expect(cell(doc, 'by-item', 0, 'net')).toBe(260_000);
    expect(doc.tables.find((t) => t.id === 'by-month')!.rows).toEqual([['2026-01', 150_000, 40_000, 110_000], ['2026-02', 150_000, 0, 150_000]]);
    expect(doc.tables.find((t) => t.id === 'income-by-category')!.totals).toEqual(['Total', 300_000]);
    expect(doc.tables.find((t) => t.id === 'expenses-by-category')!.totals).toEqual(['Total', 40_000]);
    // Outside the period nothing counts.
    expect(build(mk(), 'income-expense', { from: '2027-01-01', to: '2027-12-31' }).summary.map((x) => x.value)).toEqual([0, 0, 0, 0]);
  });

  it('the report for one rental is a cash-flow report, not a purchase-and-sale one', () => {
    const r = s.properties.create(co, rental());
    s.income.create(inc(co, r.id, '2026-01-05', 150_000));
    s.expenses.create(exp(s, co, r.id, '2026-01-20', 'Plumber', { Plumbing: 40_000 }));
    const doc = build(mk(), 'property', { propertyId: r.id });
    expect(doc.summary.at(-1)).toMatchObject({ label: 'Net income (income minus expenses)', value: 110_000 });
    expect(doc.tables.map((t) => t.id)).toEqual(['by-year', 'income', 'expenses', 'allocations']);
    expect(doc.tables[0]!.totals).toEqual(['All years', 150_000, 40_000, 110_000]);
  });

  it('sold performance includes a sold vehicle with a Type column, and leaves rentals out', () => {
    const reno = s.properties.create(co, prop({ purchasePriceCents: 20_000_000 }));
    s.properties.update(reno.id, prop({ status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000, purchasePriceCents: 20_000_000 }));
    const doc0 = build(mk(), 'sold-performance');
    expect(doc0.tables[0]!.columns.map((c) => c.key)).not.toContain('type'); // renovations only: unchanged shape
    const v = s.properties.create(co, vehicle({ purchasePriceCents: 1_000_000 }));
    s.properties.update(v.id, vehicle({ status: 'Sold', saleDate: '2026-03-01', salePriceCents: 1_400_000 }));
    const r = s.properties.create(co, rental({ purchaseDate: '2019-05-01', purchasePriceCents: 15_000_000 }));
    s.properties.update(r.id, rental({ status: 'Sold', purchaseDate: '2019-05-01', purchasePriceCents: 15_000_000, saleDate: '2026-04-01', salePriceCents: 20_000_000 }));
    const doc = build(mk(), 'sold-performance');
    const t = doc.tables[0]!;
    expect(t.columns.map((c) => c.key)).toContain('type');
    expect(t.rows.map((row) => [row[0], row[1]])).toEqual([['125 Oak Drive', 'Renovation'], ['2018 Honda Accord', 'Vehicle']]);
    expect(doc.summary.find((x) => x.label === 'Properties sold in this period')!.value).toBe(2);
  });

  it('the overview reports rental income and expenses apart from renovation figures', () => {
    const r = s.properties.create(co, rental());
    s.properties.create(co, prop());
    s.income.create(inc(co, r.id, '2026-02-05', 150_000));
    s.expenses.create(exp(s, co, r.id, '2026-02-20', 'Plumber', { Plumbing: 40_000 }));
    const o = mk().overview(co, '2026-01-01', '2026-12-31', 'This year');
    expect(o).toMatchObject({ incomeAssets: 1, incomeCents: 150_000, incomeExpensesCents: 40_000, activeProperties: 1 });
    expect(o.companies[0]).toMatchObject({ incomeAssets: 1, incomeCents: 150_000, incomeExpensesCents: 40_000 });
    expect(o.unsoldInvestmentCents).toBe(20_000_000); // only the renovation; the rental's costs are not "investment"
  });
});

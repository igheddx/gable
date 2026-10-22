import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/shared/errors';
import { company, makeStack, prop, type Stack } from './helpers';

let s: Stack;
let oak: number;
let cedar: number;
beforeEach(() => {
  s = makeStack();
  oak = s.companies.create(company('Oak House LLC')).id;
  cedar = s.companies.create(company('Cedar Homes LLC')).id;
});
afterEach(() => s.cleanup());

const code = (fn: () => unknown): { code: string; fields?: Record<string, string> } => {
  try { fn(); } catch (e) {
    if (e instanceof AppError) return { code: e.code, fields: e.fields };
    throw e;
  }
  throw new Error('expected an error');
};
const addrs = (r: { rows: { address1: string }[] }) => r.rows.map((p) => p.address1);

describe('property create and validation', () => {
  it('creates, stores the owning company, and returns it', () => {
    const p = s.properties.create(oak, prop());
    expect(p).toMatchObject({ companyId: oak, companyName: 'Oak House LLC', status: 'Held', purchasePriceCents: 20_000_000, saleDate: null });
  });

  it('accepts historical purchase dates (2021 and earlier)', () => {
    expect(s.properties.create(oak, prop({ purchaseDate: '2021-01-15' })).purchaseDate).toBe('2021-01-15');
    expect(s.properties.create(oak, prop({ address1: '9 Old Rd', purchaseDate: '1998-06-01' })).purchaseDate).toBe('1998-06-01');
  });

  it('requires address, city, state, ZIP and a real purchase date', () => {
    const r = code(() => s.properties.create(oak, prop({ address1: ' ', city: '', state: 'Tennessee', zip: '12', purchaseDate: '2025-02-30' })));
    expect(r.code).toBe('VALIDATION');
    expect(Object.keys(r.fields!).sort()).toEqual(['address1', 'city', 'purchaseDate', 'state', 'zip']);
  });

  it('Sold needs sale date and price; sale cannot precede purchase; non-Sold cannot carry a sale', () => {
    expect(code(() => s.properties.create(oak, prop({ status: 'Sold' }))).fields).toMatchObject({ saleDate: expect.any(String), salePriceCents: expect.any(String) });
    expect(code(() => s.properties.create(oak, prop({ status: 'Sold', saleDate: '2024-12-31', salePriceCents: 1 }))).fields?.saleDate).toMatch(/before the purchase date/);
    expect(code(() => s.properties.create(oak, prop({ status: 'Listed', saleDate: '2026-03-15', salePriceCents: 100 }))).fields?.status).toMatch(/Only a Sold/);
    const ok = s.properties.create(oak, prop({ status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 }));
    expect(ok).toMatchObject({ status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 });
    expect(s.properties.create(oak, prop({ address1: '1 Same Day', status: 'Sold', saleDate: '2025-01-15', salePriceCents: 0 })).saleDate).toBe('2025-01-15');
  });

  it('database constraints still hold if a service rule were bypassed', () => {
    const insert = (status: string, sd: string | null, sp: number | null, pd = '2025-01-15') =>
      s.db.prepare(`INSERT INTO property (company_id, address1, city, state, zip, search_text, purchase_date, purchase_price_cents, status, sale_date, sale_price_cents, created_at, updated_at)
        VALUES (?, 'x', 'c', 'TN', '1', 'x', ?, 1, ?, ?, ?, 'n', 'n')`).run(oak, pd, status, sd, sp);
    expect(() => insert('Sold', null, null)).toThrow();
    expect(() => insert('Held', '2026-01-01', 5)).toThrow();
    expect(() => insert('Sold', '2024-01-01', 5)).toThrow();
    expect(() => insert('Bogus', null, null)).toThrow();
    expect(() => insert('Held', null, null, 'January')).toThrow();
  });
});

describe('ownership and archiving', () => {
  it('rejects creating under an archived company in the service and in storage', () => {
    s.companies.archive(cedar);
    expect(code(() => s.properties.create(cedar, prop())).code).toBe('ARCHIVED');
    expect(() => s.db.prepare(`INSERT INTO property (company_id, address1, city, state, zip, search_text, purchase_date, purchase_price_cents, status, created_at, updated_at)
      VALUES (?, 'x', 'c', 'TN', '1', 'x', '2025-01-01', 1, 'Held', 'n', 'n')`).run(cedar)).toThrow(/archived/);
    expect(code(() => s.properties.create(9999, prop())).code).toBe('NOT_FOUND');
  });

  it('never lets a property change company, even directly in the database', () => {
    const p = s.properties.create(oak, prop());
    expect(() => s.db.prepare('UPDATE property SET company_id = ? WHERE id = ?').run(cedar, p.id)).toThrow(/cannot be changed/);
    s.properties.update(p.id, prop({ city: 'Eastbrook' }));
    expect(s.properties.get(p.id)).toMatchObject({ companyId: oak, city: 'Eastbrook' });
  });

  it('archives and restores while preserving data; archived properties are read only', () => {
    const p = s.properties.create(oak, prop());
    s.properties.archive(p.id);
    expect(s.properties.list({ scope: oak }).total).toBe(0);
    expect(s.properties.list({ scope: oak, includeArchived: true }).total).toBe(1);
    expect(code(() => s.properties.update(p.id, prop())).code).toBe('ARCHIVED');
    expect(s.properties.restore(p.id).isArchived).toBe(false);
  });

  it('cannot restore a property while its company is archived', () => {
    const p = s.properties.create(cedar, prop());
    s.properties.archive(p.id);
    s.companies.archive(cedar);
    expect(code(() => s.properties.restore(p.id)).code).toBe('ARCHIVED');
  });

  it('reopening a sale needs confirmation, then clears the sale', () => {
    const p = s.properties.create(oak, prop({ status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 }));
    expect(code(() => s.properties.update(p.id, prop({ status: 'Listed' }))).code).toBe('CONFLICT');
    expect(s.properties.get(p.id).status).toBe('Sold');
    expect(code(() => s.properties.update(p.id, prop({ status: 'Listed', saleDate: '2026-03-15', salePriceCents: 1 }), { confirmReopenSale: true })).code).toBe('VALIDATION');
    const reopened = s.properties.update(p.id, prop({ status: 'Listed' }), { confirmReopenSale: true });
    expect(reopened).toMatchObject({ status: 'Listed', saleDate: null, salePriceCents: null });
  });
});

describe('search and filters', () => {
  beforeEach(() => {
    s.properties.create(oak, prop({ address1: '125 Oak Drive', zip: '37201' }));
    s.properties.create(oak, prop({ address1: "902 St. Mary's Lane", city: 'Eastbrook', zip: '37214', status: 'Held', purchaseDate: '2021-06-22' }));
    s.properties.create(oak, prop({ address1: '48 Willow Court', zip: '37205', status: 'Renovating', purchaseDate: '2026-02-03' }));
    s.properties.create(cedar, prop({ address1: '17 Oak Hollow Road', city: 'Eastbrook', zip: '37214', status: 'Listed' }));
    s.properties.create(cedar, prop({ address1: '310 Cedar Ridge Way', zip: '37380', status: 'Sold', purchaseDate: '2025-04-18', saleDate: '2026-03-15', salePriceCents: 1 }));
  });

  it('is scoped to a company and never leaks another company', () => {
    expect(addrs(s.properties.list({ scope: oak, q: 'oak' }))).toEqual(['125 Oak Drive']);
    expect(addrs(s.properties.list({ scope: cedar, q: 'oak' }))).toEqual(['17 Oak Hollow Road']);
    expect(s.properties.list({ scope: oak }).rows.every((r) => r.companyId === oak)).toBe(true);
  });

  it('All Companies returns both, labeled by company', () => {
    const all = s.properties.list({ scope: 'all', q: 'oak' });
    expect(addrs(all).sort()).toEqual(['125 Oak Drive', '17 Oak Hollow Road']);
    expect(all.rows.map((r) => r.companyName).sort()).toEqual(['Cedar Homes LLC', 'Oak House LLC']);
  });

  it('matches partial address, city and ZIP, ignoring case and punctuation', () => {
    expect(addrs(s.properties.list({ scope: 'all', q: '372' })).length).toBe(4);
    expect(addrs(s.properties.list({ scope: 'all', q: '37214' })).sort()).toEqual(["902 St. Mary's Lane", '17 Oak Hollow Road'].sort());
    expect(addrs(s.properties.list({ scope: 'all', q: 'EASTBROOK' })).length).toBe(2);
    expect(addrs(s.properties.list({ scope: 'all', q: "mary's" }))).toEqual(["902 St. Mary's Lane"]);
    expect(addrs(s.properties.list({ scope: 'all', q: 'st marys' }))).toEqual(["902 St. Mary's Lane"]);
    expect(addrs(s.properties.list({ scope: 'all', q: 'oak hol' }))).toEqual(['17 Oak Hollow Road']);
    expect(s.properties.list({ scope: 'all', q: '' }).total).toBe(5);
  });

  it('treats SQL wildcards and quotes as plain text', () => {
    for (const q of ['%', '_', "'; DROP TABLE property; --", '\\']) {
      expect(() => s.properties.list({ scope: 'all', q })).not.toThrow();
    }
    expect(s.properties.list({ scope: 'all', q: '%' }).total).toBe(5);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'property'").get()).toEqual({ n: 1 });
  });

  it('combines status and date-range filters with search', () => {
    expect(addrs(s.properties.list({ scope: 'all', status: 'Sold' }))).toEqual(['310 Cedar Ridge Way']);
    expect(addrs(s.properties.list({ scope: oak, purchaseFrom: '2021-01-01', purchaseTo: '2021-12-31' }))).toEqual(["902 St. Mary's Lane"]);
    expect(addrs(s.properties.list({ scope: 'all', saleFrom: '2026-01-01', saleTo: '2026-12-31' }))).toEqual(['310 Cedar Ridge Way']);
    expect(s.properties.list({ scope: oak, q: 'oak', status: 'Sold' }).total).toBe(0);
  });

  it('sorts and paginates deterministically', () => {
    const page1 = s.properties.list({ scope: 'all', sort: 'purchaseDate', dir: 'asc', pageSize: 2, page: 1 });
    const page3 = s.properties.list({ scope: 'all', sort: 'purchaseDate', dir: 'asc', pageSize: 2, page: 3 });
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(page3.rows).toHaveLength(1);
    expect(page1.rows[0]!.purchaseDate <= page1.rows[1]!.purchaseDate).toBe(true);
    expect(addrs(s.properties.list({ scope: 'all', sort: 'address' }))[0]).toBe('125 Oak Drive');
  });

  it('keeps search text in sync when an address is edited', () => {
    const p = s.properties.list({ scope: oak, q: 'willow' }).rows[0]!;
    s.properties.update(p.id, prop({ address1: '48 Birchwood Court', zip: '37205', status: 'Renovating', purchaseDate: '2026-02-03' }));
    expect(s.properties.list({ scope: oak, q: 'willow' }).total).toBe(0);
    expect(s.properties.list({ scope: oak, q: 'birch' }).total).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../src/shared/errors';
import { expenseInputSchema } from '../../src/shared/schemas';
import { PDF, PNG, company, exp, makeStack, prop, type Stack } from './helpers';

let s: Stack;
beforeEach(() => { s = makeStack(); });
afterEach(() => s.cleanup());

const err = (fn: () => unknown): AppError => {
  try { fn(); } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected an AppError');
};

/** Fixture A (guide): purchase $200,000; closing $5,000; renovation $35,000; holding $10,000; selling $18,000; sale $310,000. */
function fixtureA() {
  const co = s.companies.create(company('Fixture A LLC')).id;
  const p = s.properties.create(co, prop({ purchaseDate: '2025-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 }));
  s.expenses.create(exp(s, co, p.id, '2025-01-15', 'Summit Title', { 'Purchase Closing Costs': 500_000 }));
  s.expenses.create(exp(s, co, p.id, '2025-03-10', 'Harbor Lumber', { Materials: 1_200_000, Labor: 800_000 }));
  s.expenses.create(exp(s, co, p.id, '2026-01-20', 'Brightline Electric', { Electrical: 1_500_000 }));
  s.expenses.create(exp(s, co, p.id, '2025-09-30', 'First Lender', { 'Financing Interest & Fees': 1_000_000 }));
  s.expenses.create(exp(s, co, p.id, '2026-03-15', 'Closing Agent', { 'Realtor Commissions': 1_500_000, 'Seller Closing Costs': 300_000 }));
  return { co, p };
}

describe('fixture A: standard project', () => {
  it('project cost $268,000, profit $42,000, ROI 15.67%', () => {
    const { p } = fixtureA();
    const f = s.financials.propertyFinancials(p.id);
    expect(f.bridge.expensesCents).toBe(6_800_000);
    expect(f.bridge.projectCostCents).toBe(26_800_000);
    expect(f.bridge.profitCents).toBe(4_200_000);
    expect(f.bridge.roiBasisPoints).toBe(1567);
    expect(f.bridge.groups).toMatchObject({ purchase_closing: 500_000, renovation: 3_500_000, holding: 1_000_000, selling_realtor: 1_500_000, selling_closing: 300_000, selling_other: 0, other: 0 });
  });

  it('a $1,000 general company expense does not change the property or its profit', () => {
    const { co, p } = fixtureA();
    const before = s.financials.propertyFinancials(p.id).bridge;
    s.expenses.create(exp(s, co, null, '2026-02-01', 'Northfield Insurance', { Insurance: 100_000 }));
    expect(s.financials.propertyFinancials(p.id).bridge).toEqual(before);
    expect(s.financials.companyOverhead(co, null, null)).toBe(100_000);
    expect(s.financials.companyOverhead(co, '2027-01-01', null)).toBe(0);
  });

  it('a $100 expense split $60 Materials + $40 Electrical counts exactly $100', () => {
    const co = s.companies.create(company('Split LLC')).id;
    const p = s.properties.create(co, prop());
    const e = s.expenses.create(exp(s, co, p.id, '2025-02-02', 'Redwood Hardware', { Materials: 6_000, Electrical: 4_000 }));
    expect(e.totalCents).toBe(10_000);
    expect(e.allocations.map((a) => a.amountCents).sort()).toEqual([4_000, 6_000]);
    const f = s.financials.propertyFinancials(p.id);
    expect(f.bridge.expensesCents).toBe(10_000);
    expect(f.bridge.groups.renovation).toBe(10_000);
    expect(f.byYear.find((y) => y.year === 2025)!.expensesCents).toBe(10_000);
  });

  it('several receipt pages on one expense never repeat the cost', () => {
    const co = s.companies.create(company('Pages LLC')).id;
    const p = s.properties.create(co, prop());
    const pages = [s.expenses.stageFile('invoice-p1.png', PNG), s.expenses.stageFile('invoice-p2.png', PNG), s.expenses.stageFile('invoice-p3.pdf', PDF)];
    const e = s.expenses.create(exp(s, co, p.id, '2025-04-01', 'Keystone Plumbing', { Plumbing: 31_257 }, { stagedFileIds: pages.map((x) => x.stagedId) }));
    expect(e.attachments).toHaveLength(3);
    expect(s.financials.propertyFinancials(p.id).bridge.expensesCents).toBe(31_257);
  });
});

describe('fixture B: historical 2021 to 2026', () => {
  function fixtureB() {
    const co = s.companies.create(company('Fixture B LLC')).id;
    const p = s.properties.create(co, prop({ address1: '71 Northgate Terrace', purchaseDate: '2021-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 35_000_000 }));
    const add = (date: string, cats: Record<string, number>) => s.expenses.create(exp(s, co, p.id, date, 'Vendor', cats));
    add('2021-01-15', { 'Purchase Closing Costs': 500_000 });
    add('2022-06-01', { Labor: 1_500_000, Materials: 1_000_000 });
    add('2023-05-01', { 'Property Taxes': 500_000, Insurance: 300_000 });
    add('2024-07-01', { Maintenance: 1_200_000 });
    add('2025-08-01', { 'Financing Interest & Fees': 1_000_000 });
    add('2026-03-15', { 'Realtor Commissions': 1_500_000, 'Seller Closing Costs': 500_000 });
    return { co, p };
  }

  it('lifetime expenses $80,000, cost $280,000, profit $70,000, ROI 25%', () => {
    const { p } = fixtureB();
    const f = s.financials.propertyFinancials(p.id);
    expect(f.bridge.expensesCents).toBe(8_000_000);
    expect(f.bridge.projectCostCents).toBe(28_000_000);
    expect(f.bridge.profitCents).toBe(7_000_000);
    expect(f.bridge.roiBasisPoints).toBe(2500);
  });

  it('lists every year 2021 to 2026 with the purchase price once and correct annual totals', () => {
    const { p } = fixtureB();
    const f = s.financials.propertyFinancials(p.id);
    expect(f.byYear.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
    const y = (n: number) => f.byYear.find((r) => r.year === n)!;
    expect(y(2021)).toMatchObject({ purchaseCents: 20_000_000, expensesCents: 500_000, investmentCents: 20_500_000, saleProceedsCents: 0 });
    expect(f.byYear.filter((r) => r.purchaseCents > 0)).toHaveLength(1);
    expect(y(2022).expensesCents).toBe(2_500_000);
    expect(y(2023).expensesCents).toBe(800_000);
    expect(y(2024).expensesCents).toBe(1_200_000);
    expect(y(2025).expensesCents).toBe(1_000_000);
    expect(y(2026)).toMatchObject({ expensesCents: 2_000_000, saleProceedsCents: 35_000_000, investmentCents: 2_000_000 });
    expect(y(2026).groups).toMatchObject({ selling_realtor: 1_500_000, selling_closing: 500_000 });
    expect(f.reconciliation).toEqual({ lifetimeExpensesCents: 8_000_000, yearsExpensesCents: 8_000_000, matches: true });
  });

  it('a 2022-dated cost entered in 2026 belongs to 2022; editing its date moves annual totals but not lifetime cost', () => {
    const { co, p } = fixtureB();
    const before = s.financials.propertyFinancials(p.id);
    const late = s.expenses.create(exp(s, co, p.id, '2022-11-30', 'Late Invoice', { Materials: 100_000 }));
    let f = s.financials.propertyFinancials(p.id);
    expect(f.byYear.find((y) => y.year === 2022)!.expensesCents).toBe(2_600_000);
    expect(f.byYear.find((y) => y.year === 2026)!.expensesCents).toBe(2_000_000);
    expect(f.bridge.expensesCents).toBe(before.bridge.expensesCents + 100_000);
    const lifetime = f.bridge.expensesCents;

    s.expenses.update(late.id, { propertyId: p.id, vendorName: 'Late Invoice', expenseDate: '2024-02-02', totalCents: 100_000, allocations: [{ categoryId: s.cat(co, 'Materials'), amountCents: 100_000 }], notes: '', stagedFileIds: [], removeAttachmentIds: [] });
    f = s.financials.propertyFinancials(p.id);
    expect(f.byYear.find((y) => y.year === 2022)!.expensesCents).toBe(2_500_000);
    expect(f.byYear.find((y) => y.year === 2024)!.expensesCents).toBe(1_300_000);
    expect(f.bridge.expensesCents).toBe(lifetime);
    expect(f.reconciliation.matches).toBe(true);
  });

  it('shows quiet years with zero activity and extends the range for later activity', () => {
    const co = s.companies.create(company('Quiet LLC')).id;
    const p = s.properties.create(co, prop({ purchaseDate: '2021-06-22', purchasePriceCents: 14_250_000 }));
    s.expenses.create(exp(s, co, p.id, '2023-01-05', 'V', { Utilities: 10_000 }));
    s.expenses.create(exp(s, co, p.id, '2027-02-01', 'V', { Utilities: 20_000 }));
    const f = s.financials.propertyFinancials(p.id);
    expect(f.byYear.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026, 2027]);
    expect(f.byYear.find((y) => y.year === 2022)).toMatchObject({ expensesCents: 0, investmentCents: 0, purchaseCents: 0 });
    expect(f.reconciliation.matches).toBe(true);
  });

  it('includes expense dates before the purchase year', () => {
    const co = s.companies.create(company('Early LLC')).id;
    const p = s.properties.create(co, prop({ purchaseDate: '2025-01-15' }));
    s.expenses.create(exp(s, co, p.id, '2024-12-20', 'Inspector', { Other: 45_000 }));
    const f = s.financials.propertyFinancials(p.id);
    expect(f.byYear[0]).toMatchObject({ year: 2024, expensesCents: 45_000, purchaseCents: 0 });
    expect(f.byYear.find((y) => y.year === 2025)!.purchaseCents).toBe(20_000_000);
  });
});

describe('unsold, zero cost and negative results', () => {
  it('an unsold property shows investment to date and no profit or ROI', () => {
    const co = s.companies.create(company('Unsold LLC')).id;
    const p = s.properties.create(co, prop({ status: 'Renovating' }));
    s.expenses.create(exp(s, co, p.id, '2026-02-02', 'V', { Materials: 250_000 }));
    const f = s.financials.propertyFinancials(p.id);
    expect(f.bridge).toMatchObject({ projectCostCents: 20_250_000, profitCents: null, roiBasisPoints: null });
    expect(f.salePriceCents).toBeNull();
    expect(f.byYear.at(-1)!.year).toBe(2026); // through today (2026-10-22)
  });

  it('zero project cost gives no ROI instead of dividing by zero', () => {
    const co = s.companies.create(company('Zero LLC')).id;
    const p = s.properties.create(co, prop({ purchasePriceCents: 0, status: 'Sold', saleDate: '2025-06-01', salePriceCents: 100_00 }));
    const f = s.financials.propertyFinancials(p.id);
    expect(f.bridge).toMatchObject({ projectCostCents: 0, profitCents: 10_000, roiBasisPoints: null });
  });

  it('a loss gives negative profit and a negative ROI', () => {
    const co = s.companies.create(company('Loss LLC')).id;
    const p = s.properties.create(co, prop({ purchasePriceCents: 10_000_000, status: 'Sold', saleDate: '2025-06-01', salePriceCents: 9_000_000 }));
    s.expenses.create(exp(s, co, p.id, '2025-02-01', 'V', { Materials: 1_000_000 }));
    const f = s.financials.propertyFinancials(p.id);
    expect(f.bridge).toMatchObject({ projectCostCents: 11_000_000, profitCents: -2_000_000, roiBasisPoints: -1818 });
  });
});

describe('posting rules', () => {
  it('is idempotent: saving the same form twice creates one expense with one set of lines and files', () => {
    const co = s.companies.create(company('Idem LLC')).id;
    const staged = s.expenses.stageFile('r.png', PNG);
    const input = exp(s, co, null, '2026-01-02', 'Metro Utilities', { Utilities: 14_377, Maintenance: 100 }, { stagedFileIds: [staged.stagedId] });
    const a = s.expenses.create(input);
    const b = s.expenses.create(input);
    expect(b.id).toBe(a.id);
    expect(s.expenses.list({ scope: co }).total).toBe(1);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM expense_allocation').get()).toEqual({ n: 2 });
    expect(fs.readdirSync(s.receiptsDir)).toHaveLength(1);
  });

  it('rejects allocations that do not add up and saves nothing (no expense, vendor or file)', () => {
    const co = s.companies.create(company('Sum LLC')).id;
    const staged = s.expenses.stageFile('r.png', PNG);
    const bad = exp(s, co, null, '2026-01-02', 'New Vendor', { Materials: 6_000, Electrical: 3_000 }, { totalCents: 10_000, stagedFileIds: [staged.stagedId] });
    const e = err(() => s.expenses.create(bad));
    expect(e.code).toBe('VALIDATION');
    expect(e.fields?.allocations).toMatch(/\$90\.00, not \$100\.00/);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM expense').get()).toEqual({ n: 0 });
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM vendor').get()).toEqual({ n: 0 });
    expect(fs.existsSync(s.receiptsDir) ? fs.readdirSync(s.receiptsDir) : []).toHaveLength(0);
  });

  it('rejects duplicate categories, zero or negative lines, bad dates and blank vendors', () => {
    const co = s.companies.create(company('Rules LLC')).id;
    const m = s.cat(co, 'Materials');
    const base = exp(s, co, null, '2026-01-02', 'V', { Materials: 100 });
    expect(err(() => s.expenses.create({ ...base, idempotencyKey: 'dup-key-000000001', allocations: [{ categoryId: m, amountCents: 50 }, { categoryId: m, amountCents: 50 }], totalCents: 100 })).fields?.allocations).toMatch(/once/);
    expect(err(() => s.expenses.create({ ...base, idempotencyKey: 'dup-key-000000002', expenseDate: '2026-02-30' })).fields?.expenseDate).toBeTruthy();
    expect(err(() => s.expenses.create({ ...base, idempotencyKey: 'dup-key-000000003', vendorName: '  ' })).fields?.vendorName).toBeTruthy();
    for (const bad of [{ totalCents: 0 }, { totalCents: -5 }, { totalCents: 1.5 }, { allocations: [{ categoryId: m, amountCents: -100 }] }, { allocations: [] }]) {
      expect(expenseInputSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });

  it('rejects a property or category from another company, in the service and in storage', () => {
    const a = s.companies.create(company('A Co')).id;
    const b = s.companies.create(company('B Co')).id;
    const pb = s.properties.create(b, prop());
    expect(err(() => s.expenses.create(exp(s, a, pb.id, '2026-01-02', 'V', { Materials: 100 }))).fields?.propertyId).toMatch(/different company/);
    const foreignCat = s.cat(b, 'Materials');
    const mixed = exp(s, a, null, '2026-01-02', 'V', { Materials: 100 });
    mixed.allocations = [{ categoryId: foreignCat, amountCents: 100 }];
    expect(err(() => s.expenses.create(mixed)).fields?.allocations).toMatch(/different company/);

    // Storage enforces the same rules even if a service check were bypassed.
    const vendorA = Number(s.db.prepare("INSERT INTO vendor (company_id, name, name_key, created_at) VALUES (?, 'V', 'v', 'n')").run(a).lastInsertRowid);
    const insert = (company: number, property: number | null, vendor: number) =>
      s.db.prepare("INSERT INTO expense (company_id, property_id, vendor_id, expense_date, total_cents, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, '2026-01-01', 100, ?, 'n', 'n')")
        .run(company, property, vendor, `raw-${Math.random()}`);
    expect(() => insert(a, pb.id, vendorA)).toThrow(/different company/);
    expect(() => insert(b, null, vendorA)).toThrow(/different company/);
    const ok = Number(insert(a, null, vendorA).lastInsertRowid);
    expect(() => s.db.prepare('INSERT INTO expense_allocation (expense_id, category_id, amount_cents) VALUES (?, ?, 100)').run(ok, foreignCat)).toThrow(/different company/);
    expect(() => s.db.prepare('UPDATE expense SET company_id = ? WHERE id = ?').run(b, ok)).toThrow(/cannot be changed/);
    expect(() => s.db.prepare('DELETE FROM expense WHERE id = ?').run(ok)).toThrow(/voided, never deleted/);
  });

  it('refuses new expenses under an archived company, archived property, or archived category', () => {
    const co = s.companies.create(company('Arch LLC')).id;
    const keep = s.companies.create(company('Keep LLC')).id;
    const p = s.properties.create(co, prop());
    s.properties.archive(p.id);
    expect(err(() => s.expenses.create(exp(s, co, p.id, '2026-01-02', 'V', { Materials: 100 }))).fields?.propertyId).toMatch(/archived/);
    s.categories.archive(s.cat(co, 'Materials'));
    expect(err(() => s.expenses.create(exp(s, co, null, '2026-01-02', 'V', { Materials: 100 }))).fields?.allocations).toMatch(/archived/);
    s.companies.archive(co, keep);
    expect(err(() => s.expenses.create(exp(s, co, null, '2026-01-02', 'V', { Labor: 100 }))).code).toBe('ARCHIVED');
  });

  it('keeps history readable after a category is archived and an edit may keep it', () => {
    const co = s.companies.create(company('Hist LLC')).id;
    const e = s.expenses.create(exp(s, co, null, '2026-01-02', 'V', { Materials: 500 }));
    s.categories.archive(s.cat(co, 'Materials'));
    expect(s.expenses.get(e.id).allocations[0]).toMatchObject({ categoryName: 'Materials', amountCents: 500 });
    const u = s.expenses.update(e.id, { propertyId: null, vendorName: 'V', expenseDate: '2026-01-03', totalCents: 700, allocations: [{ categoryId: s.cat(co, 'Materials'), amountCents: 700 }], notes: 'n', stagedFileIds: [], removeAttachmentIds: [] });
    expect(u.totalCents).toBe(700);
  });
});

describe('edit, void and history', () => {
  it('void removes an expense from every total and unvoid restores it, with a history', () => {
    const { co, p } = (() => {
      const co = s.companies.create(company('Void LLC')).id;
      return { co, p: s.properties.create(co, prop({ status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 })) };
    })();
    const keep = s.expenses.create(exp(s, co, p.id, '2025-05-05', 'A', { Materials: 1_000_000 }));
    const gone = s.expenses.create(exp(s, co, p.id, '2025-06-06', 'B', { Labor: 400_000 }));
    expect(s.financials.propertyFinancials(p.id).bridge.expensesCents).toBe(1_400_000);
    s.expenses.void(gone.id);
    let f = s.financials.propertyFinancials(p.id);
    expect(f.bridge.expensesCents).toBe(1_000_000);
    expect(f.bridge.profitCents).toBe(31_000_000 - 21_000_000);
    expect(f.byYear.find((y) => y.year === 2025)!.expensesCents).toBe(1_000_000);
    expect(f.byYear.flatMap((y) => y.items).map((i) => i.expenseId)).toEqual([keep.id]);
    expect(s.expenses.list({ scope: co }).total).toBe(1);
    expect(s.expenses.list({ scope: co, includeVoided: true }).total).toBe(2);
    expect(err(() => s.expenses.update(gone.id, { propertyId: p.id, vendorName: 'B', expenseDate: '2025-06-06', totalCents: 1, allocations: [{ categoryId: s.cat(co, 'Labor'), amountCents: 1 }], notes: '', stagedFileIds: [], removeAttachmentIds: [] })).code).toBe('CONFLICT');
    s.expenses.unvoid(gone.id);
    f = s.financials.propertyFinancials(p.id);
    expect(f.bridge.expensesCents).toBe(1_400_000);
    expect(s.expenses.get(gone.id).events.map((e) => e.type)).toEqual(['created', 'voided', 'unvoided']);
  });

  it('edits recalculate totals immediately and record what changed', () => {
    const co = s.companies.create(company('Edit LLC')).id;
    const p = s.properties.create(co, prop());
    const e = s.expenses.create(exp(s, co, p.id, '2025-05-05', 'Old Vendor', { Materials: 10_000 }));
    s.expenses.update(e.id, { propertyId: p.id, vendorName: 'New Vendor', expenseDate: '2025-05-06', totalCents: 12_500, allocations: [{ categoryId: s.cat(co, 'Plumbing'), amountCents: 12_500 }], notes: '', stagedFileIds: [], removeAttachmentIds: [] });
    expect(s.financials.propertyFinancials(p.id).bridge.expensesCents).toBe(12_500);
    const detail = s.expenses.get(e.id);
    expect(detail.events.at(-1)!.detail).toMatch(/Vendor Old Vendor to New Vendor.*Amount \$100\.00 to \$125\.00.*Categories changed/);
  });

  it('reassigning the property must stay inside the company', () => {
    const a = s.companies.create(company('Move A')).id;
    const b = s.companies.create(company('Move B')).id;
    const pa = s.properties.create(a, prop({ address1: '1 A St' }));
    const pa2 = s.properties.create(a, prop({ address1: '2 A St' }));
    const pb = s.properties.create(b, prop({ address1: '1 B St' }));
    const e = s.expenses.create(exp(s, a, pa.id, '2025-05-05', 'V', { Materials: 100 }));
    const upd = (propertyId: number | null) => s.expenses.update(e.id, { propertyId, vendorName: 'V', expenseDate: '2025-05-05', totalCents: 100, allocations: [{ categoryId: s.cat(a, 'Materials'), amountCents: 100 }], notes: '', stagedFileIds: [], removeAttachmentIds: [] });
    expect(err(() => upd(pb.id)).fields?.propertyId).toMatch(/different company/);
    expect(upd(pa2.id).propertyId).toBe(pa2.id);
    expect(upd(null).propertyId).toBeNull();
  });
});

describe('receipt attachments', () => {
  it('copies into managed storage with opaque names; the original can move or vanish', () => {
    const co = s.companies.create(company('Files LLC')).id;
    const original = path.join(s.dir, 'my receipt (final).png');
    fs.writeFileSync(original, PNG);
    const staged = s.expenses.stageFile('my receipt (final).png', fs.readFileSync(original));
    fs.rmSync(original); // user moves or deletes the source
    const e = s.expenses.create(exp(s, co, null, '2026-01-02', 'V', { Materials: 100 }, { stagedFileIds: [staged.stagedId] }));
    const att = e.attachments[0]!;
    const { path: stored, name } = s.expenses.attachmentFile(att.id);
    expect(name).toBe('my receipt (final).png');
    expect(path.basename(stored)).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(fs.readFileSync(stored).equals(PNG)).toBe(true);
    expect(fs.readdirSync(path.join(s.dir, 'staging'))).toHaveLength(0);
  });

  it('validates by content: rejects HEIC, renamed files, empty and oversized files', () => {
    expect(err(() => s.expenses.stageFile('IMG_1.HEIC', Buffer.from('x'))).message).toMatch(/HEIC photos are not supported yet/);
    expect(err(() => s.expenses.stageFile('evil.png', Buffer.from('MZ\x90\x00 not an image'))).message).toMatch(/only JPG, PNG and PDF/);
    expect(err(() => s.expenses.stageFile('empty.pdf', Buffer.alloc(0))).message).toMatch(/empty/);
    expect(err(() => s.expenses.stageFile('huge.pdf', Buffer.concat([PDF, Buffer.alloc(26 * 1024 * 1024)]))).message).toMatch(/larger than 25 MB/);
    expect(s.expenses.stageFile('..\\..\\evil\\receipt.pdf', PDF).name).toBe('receipt.pdf');
  });

  it('a missing staged file fails the save cleanly and removes files already copied', () => {
    const co = s.companies.create(company('Fail LLC')).id;
    const ok = s.expenses.stageFile('a.png', PNG);
    const input = exp(s, co, null, '2026-01-02', 'V', { Materials: 100 }, { stagedFileIds: [ok.stagedId, 'f'.repeat(32)] });
    expect(err(() => s.expenses.create(input)).message).toMatch(/no longer available/);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM expense').get()).toEqual({ n: 0 });
    expect(fs.existsSync(s.receiptsDir) ? fs.readdirSync(s.receiptsDir) : []).toHaveLength(0);
    // The failed save can be retried with the file that is still staged.
    expect(s.expenses.create({ ...input, stagedFileIds: [ok.stagedId] }).attachments).toHaveLength(1);
  });

  it('removing a receipt in an edit deletes its file only after the change is saved', () => {
    const co = s.companies.create(company('Rm LLC')).id;
    const staged = s.expenses.stageFile('a.png', PNG);
    const e = s.expenses.create(exp(s, co, null, '2026-01-02', 'V', { Materials: 100 }, { stagedFileIds: [staged.stagedId] }));
    const attId = e.attachments[0]!.id;
    s.expenses.update(e.id, { propertyId: null, vendorName: 'V', expenseDate: '2026-01-02', totalCents: 100, allocations: [{ categoryId: s.cat(co, 'Materials'), amountCents: 100 }], notes: '', stagedFileIds: [], removeAttachmentIds: [attId] });
    expect(s.expenses.get(e.id).attachments).toHaveLength(0);
    expect(fs.readdirSync(s.receiptsDir)).toHaveLength(0);
  });
});

describe('listing and search', () => {
  it('scopes by company, hides voided by default, and filters by property, category, dates and text', () => {
    const a = s.companies.create(company('List A')).id;
    const b = s.companies.create(company('List B')).id;
    const p = s.properties.create(a, prop());
    s.expenses.create(exp(s, a, p.id, '2025-03-01', "Mary's Hardware & Supply", { Materials: 5_000 }, { notes: 'Deck boards' }));
    s.expenses.create(exp(s, a, null, '2026-01-01', 'Northfield Insurance', { Insurance: 9_000 }));
    const voided = s.expenses.create(exp(s, a, p.id, '2025-04-01', 'Voided Vendor', { Labor: 1_000 }));
    s.expenses.void(voided.id);
    s.expenses.create(exp(s, b, null, '2025-03-01', "Mary's Hardware & Supply", { Materials: 777 }));

    expect(s.expenses.list({ scope: a }).total).toBe(2);
    expect(s.expenses.list({ scope: a }).rows.every((r) => r.companyId === a)).toBe(true);
    expect(s.expenses.list({ scope: 'all' }).total).toBe(3);
    expect(s.expenses.list({ scope: a, includeVoided: true }).total).toBe(3);
    expect(s.expenses.list({ scope: a, property: p.id }).total).toBe(1);
    expect(s.expenses.list({ scope: a, property: 'general' }).rows[0]!.vendorName).toBe('Northfield Insurance');
    expect(s.expenses.list({ scope: a, categoryId: s.cat(a, 'Insurance') }).total).toBe(1);
    expect(s.expenses.list({ scope: a, from: '2025-12-01', to: '2026-12-31' }).total).toBe(1);
    expect(s.expenses.list({ scope: a, q: 'marys hardware' }).total).toBe(1);
    expect(s.expenses.list({ scope: a, q: 'deck' }).total).toBe(1);
    expect(s.expenses.list({ scope: a, q: "'; DROP TABLE expense; --" }).total).toBe(0);
    expect(s.expenses.list({ scope: a, sort: 'amount', dir: 'asc' }).rows.map((r) => r.totalCents)).toEqual([5_000, 9_000]);
    expect(s.expenses.suggestVendors(a, 'mary')).toEqual(["Mary's Hardware & Supply"]);
    expect(s.expenses.suggestVendors(b, 'north')).toEqual([]); // vendor suggestions never cross companies
  });
});

describe('categories', () => {
  it('seeds the starter list with stable reporting groups for every new company', () => {
    const co = s.companies.create(company('Seed LLC')).id;
    const cats = s.categories.list(co);
    expect(cats).toHaveLength(22); // the original 15 plus 7 added for cars and rentals
    expect(cats.find((c) => c.name === 'Title & Registration')!.reportingGroup).toBe('purchase_closing');
    expect(cats.find((c) => c.name === 'Realtor Commissions')!.reportingGroup).toBe('selling_realtor');
    expect(cats.find((c) => c.name === 'Seller Closing Costs')!.reportingGroup).toBe('selling_closing');
    expect(cats.find((c) => c.name === 'Other Selling Costs')!.reportingGroup).toBe('selling_other');
    expect(cats.find((c) => c.name === 'Purchase Closing Costs')!.reportingGroup).toBe('purchase_closing');
  });

  it('renaming and archiving keep the group; remapping needs confirmation and updates reports', () => {
    const co = s.companies.create(company('Map LLC')).id;
    const p = s.properties.create(co, prop());
    const mat = s.cat(co, 'Materials');
    s.expenses.create(exp(s, co, p.id, '2025-05-05', 'V', { Materials: 10_000 }));
    s.categories.rename(mat, 'Building Materials');
    expect(s.categories.mustGet(mat)).toMatchObject({ name: 'Building Materials', reportingGroup: 'renovation' });
    expect(err(() => s.categories.setReportingGroup(mat, 'holding', false)).code).toBe('CONFLICT');
    expect(s.categories.mustGet(mat).reportingGroup).toBe('renovation');
    expect(s.financials.propertyFinancials(p.id).bridge.groups).toMatchObject({ renovation: 10_000, holding: 0 });
    s.categories.setReportingGroup(mat, 'holding', true);
    expect(s.financials.propertyFinancials(p.id).bridge.groups).toMatchObject({ renovation: 0, holding: 10_000 });
    s.categories.archive(mat);
    expect(s.financials.propertyFinancials(p.id).bridge.groups.holding).toBe(10_000);
  });

  it('rejects duplicate names within a company but allows the same name in another company', () => {
    const a = s.companies.create(company('Dup A')).id;
    const b = s.companies.create(company('Dup B')).id;
    expect(err(() => s.categories.create(a, ' materials ', 'renovation')).code).toBe('VALIDATION');
    expect(s.categories.create(a, 'Dumpster Rental', 'renovation').name).toBe('Dumpster Rental');
    expect(s.categories.create(b, 'Dumpster Rental', 'holding').reportingGroup).toBe('holding');
  });
});

describe('totals always reconcile (randomized)', () => {
  it('years, categories and lifetime agree with raw database sums, voids excluded', () => {
    const co = s.companies.create(company('Fuzz LLC')).id;
    const p = s.properties.create(co, prop({ purchaseDate: '2022-03-01' }));
    const names = ['Materials', 'Labor', 'Insurance', 'Property Taxes', 'Realtor Commissions', 'Other'];
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const made: number[] = [];
    for (let i = 0; i < 60; i++) {
      const lines: Record<string, number> = {};
      const k = 1 + rnd(3);
      for (let j = 0; j < k; j++) lines[names[rnd(names.length)]!] = 1 + rnd(500_000);
      const date = `${2020 + rnd(8)}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
      made.push(s.expenses.create(exp(s, co, p.id, date, `V${rnd(5)}`, lines)).id);
    }
    for (let i = 0; i < 10; i++) s.expenses.void(made[rnd(made.length)]!);
    const f = s.financials.propertyFinancials(p.id);
    const raw = (s.db.prepare("SELECT COALESCE(SUM(a.amount_cents),0) AS n FROM expense e JOIN expense_allocation a ON a.expense_id=e.id WHERE e.property_id=? AND e.status='posted'").get(p.id) as { n: number }).n;
    const headers = (s.db.prepare("SELECT COALESCE(SUM(total_cents),0) AS n FROM expense WHERE property_id=? AND status='posted'").get(p.id) as { n: number }).n;
    expect(f.bridge.expensesCents).toBe(raw);
    expect(raw).toBe(headers);
    expect(f.reconciliation.matches).toBe(true);
    expect(f.byYear.reduce((a, y) => a + y.categories.reduce((x, c) => x + c.cents, 0), 0)).toBe(raw);
    expect(f.byYear.reduce((a, y) => a + y.items.reduce((x, i) => x + i.totalCents, 0), 0)).toBe(raw);
    const mismatches = s.db.prepare('SELECT e.id FROM expense e WHERE e.total_cents <> (SELECT SUM(amount_cents) FROM expense_allocation WHERE expense_id = e.id)').all();
    expect(mismatches).toEqual([]);
  });
});

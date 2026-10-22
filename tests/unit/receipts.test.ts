import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../../src/shared/errors';
import { ReceiptService } from '../../src/services/receiptService';
import { openDatabase } from '../../src/db/connection';
import { CompanyService } from '../../src/services/companyService';
import { ExpenseService } from '../../src/services/expenseService';
import { ReceiptFiles } from '../../src/services/receiptFiles';
import { company, makeStack, prop, TODAY, type Stack } from './helpers';
import { FakeOcr, failingReceipt, fakeReceipt } from './fakeOcr';

let s: Stack;
let co: number;
beforeEach(() => {
  s = makeStack();
  co = s.companies.create(company('Receipts LLC')).id;
});
afterEach(() => s.cleanup());

const HARBOR = 'HARBOR LUMBER & SUPPLY\\nDate 09/18/2026\\nDrywall 71.10\\nSUBTOTAL 152.45\\nTAX 12.80\\nTOTAL 165.25\\nCASH TENDERED 184.25';
const stage = (name: string, bytes: Buffer) => s.expenses.stageFile(name, bytes).stagedId;
const importOne = async (name: string, text: string, companyId = co, propertyId: number | null = null) => {
  const r = await s.receipts.importGroups(companyId, propertyId, [[stage(name, fakeReceipt(text))]]);
  await s.receipts.whenIdle();
  return r;
};
const err = (fn: () => unknown): AppError => {
  try { fn(); } catch (e) { if (e instanceof AppError) return e; throw e; }
  throw new Error('expected AppError');
};
const errAsync = async (fn: () => Promise<unknown>): Promise<AppError> => {
  try { await fn(); } catch (e) { if (e instanceof AppError) return e; throw e; }
  throw new Error('expected AppError');
};

describe('import and suggestions', () => {
  it('reads a receipt into a draft with suggestions, and it is not an expense', async () => {
    const r = await importOne('harbor.png', HARBOR);
    expect(r.rejected).toEqual([]);
    const d = s.receipts.get(r.created[0]!.id);
    expect(d.status).toBe('needs_review');
    expect(d).toMatchObject({ vendor: 'Harbor Lumber & Supply', expenseDate: '2026-09-18', totalCents: 16_525, pageCount: 1 });
    expect(d.suggestion?.total).toMatchObject({ labeled: true, ambiguous: false });
    expect(d.suggestion?.category).toMatchObject({ name: 'Materials', source: 'keyword' });
    expect(d.ocrText).toContain('TOTAL 165.25');
    expect(s.expenses.list({ scope: co }).total).toBe(0);
    expect(s.financials.companyOverhead(co, null, null)).toBe(0);
  });

  it('stores a private copy under an opaque name; the original may be deleted', async () => {
    const original = path.join(s.dir, 'my receipt.png');
    fs.writeFileSync(original, fakeReceipt(HARBOR));
    const id = s.expenses.stageFile('my receipt.png', fs.readFileSync(original)).stagedId;
    fs.rmSync(original);
    await s.receipts.importGroups(co, null, [[id]]);
    await s.receipts.whenIdle();
    const stored = fs.readdirSync(s.receiptsDir);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f]{32}\.png$/);
  });

  it('suggests from a vendor rule first, labeled as such, and never creates rules on its own', async () => {
    s.receipts.createRule(co, 'harbor lumber & supply', s.cat(co, 'Labor'));
    const r = await importOne('a.png', HARBOR);
    const d = s.receipts.get(r.created[0]!.id);
    expect(d.suggestion?.category).toMatchObject({ name: 'Labor', source: 'rule', detail: 'Based on your vendor rule' });
    expect(d.categoryId).toBe(s.cat(co, 'Labor'));
    // Saving without ticking "remember" leaves the rules exactly as they were.
    s.receipts.update(d.id, { categoryId: s.cat(co, 'Materials') });
    s.receipts.post(d.id);
    expect(s.receipts.rules(co)).toHaveLength(1);
    expect(s.receipts.rules(co)[0]!.categoryName).toBe('Labor');
  });

  it('matches store-numbered vendors exactly on the cleaned key, never fuzzily, and scopes rules per company', async () => {
    const other = s.companies.create(company('Other LLC')).id;
    s.receipts.createRule(co, 'Harbor Lumber & Supply #1234', s.cat(co, 'Labor'));
    const same = await importOne('a.png', HARBOR); // "Harbor Lumber & Supply" has the same key as "...#1234"
    expect(s.receipts.get(same.created[0]!.id).suggestion?.category?.source).toBe('rule');
    const near = await importOne('b.png', HARBOR.replace('HARBOR', 'HARBOUR'));
    expect(s.receipts.get(near.created[0]!.id).suggestion?.category?.source).toBe('keyword'); // different spelling: no rule
    const foreign = await importOne('c.png', HARBOR, other);
    expect(s.receipts.get(foreign.created[0]!.id).suggestion?.category?.source).toBe('keyword'); // rules belong to one company
  });

  it('with no rule and no keyword, leaves the category for the person to choose', async () => {
    const r = await importOne('x.png', "Joe's Diner\\n09/18/2026\\nTOTAL 12.00");
    const d = s.receipts.get(r.created[0]!.id);
    expect(d.suggestion?.category).toBeNull();
    expect(d.categoryId).toBeNull();
    expect(err(() => s.receipts.post(d.id)).fields?.category).toBeTruthy();
  });

  it('groups several images as the pages of one receipt, and keeps a PDF on its own', async () => {
    const r = await s.receipts.importGroups(co, null, [[stage('p1.png', fakeReceipt('BRIGHTLINE ELECTRIC\\nLabor 100.00')), stage('p2.png', fakeReceipt('AMOUNT DUE 100.00'))]]);
    await s.receipts.whenIdle();
    expect(r.created).toHaveLength(1);
    const d = s.receipts.get(r.created[0]!.id);
    expect(d.pageCount).toBe(2);
    expect(d.files.map((f) => f.name)).toEqual(['p1.png', 'p2.png']);
    expect(d.totalCents).toBe(10_000);
    const pdfStaged = stage('doc.pdf', Buffer.from('%PDF-1.4\nGABLETEXT:x\n'));
    const mixed = await s.receipts.importGroups(co, null, [[pdfStaged, stage('p3.png', fakeReceipt('x'))]]);
    expect(mixed.rejected[0]!.reason).toMatch(/PDF is kept as its own receipt/);
  });

  it('reports bad files one by one without stopping the others', async () => {
    const r = await s.receipts.importGroups(co, null, [
      [stage('good.png', fakeReceipt(HARBOR))],
      [stage('locked.png', failingReceipt('GABLEFAIL:encrypted'))],
      [stage('broken.png', failingReceipt('GABLEFAIL:corrupt'))],
      [stage('long.png', failingReceipt('GABLEFAIL:too_many_pages'))],
    ]);
    await s.receipts.whenIdle();
    expect(r.created).toHaveLength(1);
    expect(r.rejected.map((x) => x.names[0])).toEqual(['locked.png', 'broken.png', 'long.png']);
    expect(r.rejected[0]!.reason).toMatch(/encrypted/);
    expect(fs.readdirSync(s.receiptsDir)).toHaveLength(1); // rejected files leave nothing behind
  });

  it('keeps a receipt usable by hand when the reader itself is unavailable', async () => {
    const r = await s.receipts.importGroups(co, null, [[stage('r.png', failingReceipt('GABLEINFRA'))]]);
    const d = s.receipts.get(r.created[0]!.id);
    expect(d.status).toBe('failed');
    expect(d.errorMessage).toMatch(/Enter the details by hand/);
    s.receipts.update(d.id, { vendor: 'Redwood Hardware', expenseDate: '2026-09-03', totalCents: 5_812, categoryId: s.cat(co, 'Materials') });
    expect(s.receipts.post(d.id).totalCents).toBe(5_812);
  });

  it('assigns company and property at import and rejects mismatches', async () => {
    const other = s.companies.create(company('Other LLC')).id;
    const p = s.properties.create(co, prop());
    const r = await importOne('a.png', HARBOR, co, p.id);
    expect(r.created[0]).toMatchObject({ companyId: co, propertyId: p.id });
    expect((await errAsync(() => s.receipts.importGroups(other, p.id, [[stage('b.png', fakeReceipt('x'))]]))).message).toMatch(/different company/);
    s.companies.archive(other, co);
    expect((await errAsync(() => s.receipts.importGroups(other, null, [[stage('c.png', fakeReceipt('x'))]]))).code).toBe('ARCHIVED');
  });
});

describe('review and posting', () => {
  it('saving creates one expense with the receipt as its attachment, and the draft cannot post twice', async () => {
    const p = s.properties.create(co, prop());
    const r = await importOne('harbor.png', HARBOR, co, p.id);
    const id = r.created[0]!.id;
    s.receipts.update(id, { totalCents: 16_525 }); // the person confirms the labeled total, not the cash tendered
    const e1 = s.receipts.post(id);
    expect(e1).toMatchObject({ vendorName: 'Harbor Lumber & Supply', totalCents: 16_525, propertyId: p.id });
    expect(e1.attachments).toHaveLength(1);
    const e2 = s.receipts.post(id); // retrying a completed save
    expect(e2.id).toBe(e1.id);
    expect(s.expenses.list({ scope: co }).total).toBe(1);
    expect(s.receipts.get(id)).toMatchObject({ status: 'saved', postedExpenseId: e1.id, files: [] });
    expect(fs.readdirSync(s.receiptsDir)).toHaveLength(1); // the file moved to the expense, not copied
    expect(s.financials.propertyFinancials(p.id).bridge.expensesCents).toBe(16_525);
  });

  it('a split saves exactly, and a bad split is explained', async () => {
    const r = await importOne('a.png', "Redwood Hardware\\n09/03/2026\\nTOTAL 100.00");
    const id = r.created[0]!.id;
    s.receipts.update(id, { split: true, allocations: [{ categoryId: s.cat(co, 'Materials'), amountCents: 6_000 }, { categoryId: s.cat(co, 'Electrical'), amountCents: 3_000 }] });
    expect(err(() => s.receipts.markReviewed(id, true)).fields?.allocations).toMatch(/\$90\.00, not \$100\.00/);
    s.receipts.update(id, { allocations: [{ categoryId: s.cat(co, 'Materials'), amountCents: 6_000 }, { categoryId: s.cat(co, 'Electrical'), amountCents: 4_000 }] });
    const e = s.receipts.post(id);
    expect(e.allocations.map((a) => a.amountCents).sort()).toEqual([4_000, 6_000]);
    expect(e.totalCents).toBe(10_000);
  });

  it('Save All Reviewed saves only reviewed drafts; unreviewed ones stay in the queue', async () => {
    const a = (await importOne('a.png', HARBOR)).created[0]!.id;
    const b = (await importOne('b.png', 'Metro Utilities\\n09/05/2026\\nTOTAL 143.77')).created[0]!.id;
    const c = (await importOne('c.png', 'Keystone Plumbing Co.\\n09/06/2026\\nTOTAL 80.00')).created[0]!.id;
    s.receipts.markReviewed(a, true);
    s.receipts.markReviewed(b, true);
    const out = s.receipts.postReviewed(co);
    expect(out.saved.map((x) => x.draftId).sort()).toEqual([a, b].sort());
    expect(out.failed).toEqual([]);
    expect(out.skipped).toBe(1);
    expect(s.receipts.get(c).status).toBe('needs_review');
    expect(s.expenses.list({ scope: co }).total).toBe(2);
  });

  it('editing after review asks for a fresh review, so nothing changed since review is saved unseen', async () => {
    const id = (await importOne('a.png', HARBOR)).created[0]!.id;
    s.receipts.markReviewed(id, true);
    expect(s.receipts.get(id).status).toBe('reviewed');
    s.receipts.update(id, { totalCents: 20_000 });
    expect(s.receipts.get(id).status).toBe('needs_review');
    expect(s.receipts.postReviewed(co).saved).toEqual([]);
  });

  it('partial success identifies exactly what failed, and a retry saves the rest without duplicates', async () => {
    const good = (await importOne('good.png', HARBOR)).created[0]!.id;
    const bad = (await importOne('bad.png', 'Metro Utilities\\n09/05/2026\\nTOTAL 143.77')).created[0]!.id;
    s.receipts.markReviewed(good, true);
    s.receipts.markReviewed(bad, true);
    // After review, the category the draft uses is archived: that one cannot be saved yet.
    const utilities = s.cat(co, 'Utilities');
    s.categories.archive(utilities);
    const first = s.receipts.postReviewed(co);
    expect(first.saved.map((x) => x.draftId)).toEqual([good]);
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0]).toMatchObject({ draftId: bad, name: 'bad.png' });
    expect(first.failed[0]!.message).toMatch(/archived/);
    expect(s.expenses.list({ scope: co }).total).toBe(1);
    // Fix and retry: the first receipt is not saved a second time.
    s.categories.restore(utilities);
    const second = s.receipts.postReviewed(co);
    expect(second.saved.map((x) => x.draftId)).toEqual([bad]);
    expect(s.expenses.list({ scope: co }).total).toBe(2);
    const third = s.receipts.postReviewed(co);
    expect(third.saved).toEqual([]);
    expect(s.expenses.list({ scope: co }).total).toBe(2);
  });

  it('remember-this-vendor is off by default and creates a company rule only when ticked', async () => {
    const id = (await importOne('a.png', HARBOR)).created[0]!.id;
    expect(s.receipts.get(id).rememberVendor).toBe(false);
    s.receipts.update(id, { rememberVendor: true });
    s.receipts.post(id);
    expect(s.receipts.rules(co)).toMatchObject([{ vendorName: 'Harbor Lumber & Supply', categoryName: 'Materials' }]);
    const again = (await importOne('b.png', HARBOR)).created[0]!;
    expect(s.receipts.get(again.id).suggestion?.category?.source).toBe('rule');
    s.receipts.deleteRule(s.receipts.rules(co)[0]!.id);
    expect(s.receipts.rules(co)).toEqual([]);
  });

  it('rejects a property or category from another company on a draft', async () => {
    const other = s.companies.create(company('Other LLC')).id;
    const op = s.properties.create(other, prop());
    const id = (await importOne('a.png', HARBOR)).created[0]!.id;
    expect(err(() => s.receipts.update(id, { propertyId: op.id })).fields?.propertyId).toBeTruthy();
    expect(err(() => s.receipts.update(id, { categoryId: s.cat(other, 'Materials') })).message).toMatch(/different company/);
    expect(() => s.db.prepare('UPDATE receipt_draft SET company_id = ? WHERE id = ?').run(other, id)).toThrow(/cannot be changed/);
  });
});

describe('duplicates', () => {
  it('warns about the exact same file already saved, blocks saving until confirmed, then allows it', async () => {
    const first = (await importOne('a.png', HARBOR)).created[0]!.id;
    s.receipts.post(first);
    const again = (await importOne('copy.png', HARBOR)).created[0]!;
    expect(again.duplicates.map((d) => d.kind)).toContain('same_file');
    expect(again.duplicates[0]!.message).toMatch(/already saved with the expense for Harbor Lumber & Supply/);
    const e = err(() => s.receipts.post(again.id));
    expect(e.code).toBe('CONFLICT');
    expect(e.fields?.duplicateOverride).toBeTruthy();
    expect(s.expenses.list({ scope: co }).total).toBe(1);
    s.receipts.update(again.id, { duplicateOverride: true });
    s.receipts.post(again.id);
    expect(s.expenses.list({ scope: co }).total).toBe(2);
  });

  it('flags the same file twice in the queue, and a possible duplicate by vendor, date and amount', async () => {
    const a = (await importOne('a.png', HARBOR)).created[0]!.id;
    const b = (await importOne('b.png', HARBOR)).created[0]!;
    expect(b.duplicates.some((d) => d.message.includes('review queue'))).toBe(true);
    expect(s.receipts.get(a).duplicates.some((d) => d.message.includes('review queue'))).toBe(true); // both copies are flagged
    s.receipts.update(a, { duplicateOverride: true });
    s.receipts.post(a);
    const c = (await importOne('c.png', HARBOR.replace('Drywall 71.10', 'Different item 71.10'))).created[0]!; // different file, same vendor/date/total
    expect(s.receipts.get(c.id).duplicates).toEqual([expect.objectContaining({ kind: 'possible' })]);
  });

  it('never compares across companies', async () => {
    const other = s.companies.create(company('Other LLC')).id;
    const a = (await importOne('a.png', HARBOR)).created[0]!.id;
    s.receipts.post(a);
    const b = (await importOne('b.png', HARBOR, other)).created[0]!;
    expect(b.duplicates).toEqual([]);
  });
});

describe('reading control', () => {
  it('a retry never overwrites corrected fields without consent', async () => {
    const id = (await importOne('a.png', HARBOR)).created[0]!.id;
    s.receipts.update(id, { totalCents: 16_525, vendor: 'Harbor Lumber (my edit)' });
    s.receipts.retry(id, false);
    await s.receipts.whenIdle();
    expect(s.receipts.get(id)).toMatchObject({ vendor: 'Harbor Lumber (my edit)', totalCents: 16_525, status: 'needs_review' });
    s.receipts.retry(id, true); // explicit consent
    await s.receipts.whenIdle();
    expect(s.receipts.get(id)).toMatchObject({ vendor: 'Harbor Lumber & Supply', touched: [] });
  });

  it('cancelling stops reading, leaves the receipt reviewable, and a later retry works', async () => {
    const r = await s.receipts.importGroups(co, null, [[stage('slow.png', Buffer.concat([fakeReceipt(HARBOR), Buffer.from('GABLEWAIT')]))]]);
    const id = r.created[0]!.id;
    await new Promise((res) => setTimeout(res, 30));
    expect(s.receipts.get(id).status).toBe('processing');
    s.receipts.cancel(id);
    await s.receipts.whenIdle();
    expect(s.receipts.get(id)).toMatchObject({ status: 'needs_review', errorMessage: expect.stringMatching(/cancelled/) });
    expect(s.receipts.get(id).progress).toBeNull();
  });

  it('a read failure marks that receipt failed with guidance and others are unaffected', async () => {
    const r = await s.receipts.importGroups(co, null, [[stage('ok.png', fakeReceipt(HARBOR))], [stage('bad.png', failingReceipt('GABLEREADFAIL'))]]);
    await s.receipts.whenIdle();
    const [ok, bad] = r.created.map((d) => s.receipts.get(d.id));
    expect(ok!.status).toBe('needs_review');
    expect(bad!.status).toBe('failed');
    expect(bad!.errorMessage).toMatch(/Enter the details by hand/);
  });

  it('skip, bring back, and remove (which deletes the stored files)', async () => {
    const id = (await importOne('a.png', HARBOR)).created[0]!.id;
    s.receipts.skip(id);
    expect(s.receipts.get(id).status).toBe('skipped');
    expect(err(() => s.receipts.post(id)).message).toMatch(/skipped/);
    s.receipts.unskip(id);
    expect(s.receipts.get(id).status).toBe('needs_review');
    s.receipts.remove(id);
    expect(s.receipts.list({ scope: 'all' })).toEqual([]);
    expect(fs.readdirSync(s.receiptsDir)).toEqual([]);
    expect(s.receipts.orphanedFiles(s.receiptsDir)).toEqual([]);
  });

  it('reads at most the configured number of receipts at once, through a 20-document mixed batch', async () => {
    const groups: string[][] = [];
    for (let i = 0; i < 14; i++) groups.push([stage(`ok${i}.png`, fakeReceipt(`Vendor ${i} Supply\\n09/${String(i + 1).padStart(2, '0')}/2026\\nTOTAL ${10 + i}.00`))]);
    for (let i = 0; i < 3; i++) groups.push([stage(`corrupt${i}.png`, failingReceipt('GABLEFAIL:corrupt'))]);
    for (let i = 0; i < 3; i++) groups.push([stage(`unreadable${i}.png`, failingReceipt('GABLEREADFAIL'))]);
    const r = await s.receipts.importGroups(co, null, groups);
    await s.receipts.whenIdle();
    expect(r.created).toHaveLength(17);
    expect(r.rejected).toHaveLength(3);
    expect(s.ocr.maxActive).toBeLessThanOrEqual(2);
    const states = s.receipts.list({ scope: co }).map((d) => d.status);
    expect(states.filter((x) => x === 'needs_review')).toHaveLength(14);
    expect(states.filter((x) => x === 'failed')).toHaveLength(3);
  });

  it('serves page previews through the reader', async () => {
    const id = (await importOne('a.png', HARBOR)).created[0]!.id;
    const p = await s.receipts.preview(id, 1);
    expect(p.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await errAsync(() => s.receipts.preview(id, 5))).code).toBe('NOT_FOUND');
  });
});

describe('restart', () => {
  it('drafts and corrections persist, and interrupted reads start again', async () => {
    const done = (await importOne('done.png', HARBOR)).created[0]!.id;
    s.receipts.update(done, { vendor: 'My correction' });
    // A second receipt is "mid-read" when the app stops.
    const stuck = (await importOne('stuck.png', 'Metro Utilities\\n09/05/2026\\nTOTAL 143.77')).created[0]!.id;
    s.db.prepare("UPDATE receipt_draft SET status = 'processing', vendor = NULL, total_cents = NULL WHERE id = ?").run(stuck);
    s.db.close();

    const db = openDatabase(path.join(s.dir, 'gable.db'));
    s.db = db; // so cleanup closes the reopened connection
    const companies = new CompanyService(db, path.join(s.dir, 'logos'));
    const files = new ReceiptFiles(s.receiptsDir, path.join(s.dir, 'staging'));
    const expenses = new ExpenseService(db, companies, files);
    const receipts = new ReceiptService(db, companies, expenses, files, new FakeOcr(), { today: () => TODAY });
    expect(receipts.get(done)).toMatchObject({ vendor: 'My correction', status: 'needs_review' });
    receipts.recoverInterrupted();
    await receipts.whenIdle();
    expect(receipts.get(stuck)).toMatchObject({ status: 'needs_review', vendor: 'Metro Utilities', totalCents: 14_377 });
    expect(receipts.get(done).vendor).toBe('My correction'); // untouched by recovery
  });
});

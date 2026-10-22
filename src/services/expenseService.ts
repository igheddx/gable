import type { Db } from '../db/connection';
import { ExpenseRepository } from '../db/expenseRepository';
import { PropertyRepository } from '../db/propertyRepository';
import { CategoryRepository } from '../db/categoryRepository';
import { AppError } from '../shared/errors';
import { isValidIsoDate, formatUsDate } from '../shared/dates';
import { formatCents } from '../shared/money';
import type { ExpenseInput, ExpenseQuery, ExpenseUpdate } from '../shared/schemas';
import type { Expense, ExpenseDetail, ExpensePage, StagedFile } from '../shared/types';
import type { CompanyService } from './companyService';
import type { ReceiptFiles, StoredFile } from './receiptFiles';

interface Checked {
  companyId: number;
  propertyId: number | null;
  vendorName: string;
  date: string;
  totalCents: number;
  notes: string | null;
  lines: { categoryId: number; amountCents: number }[];
}

export class ExpenseService {
  private readonly repo: ExpenseRepository;
  private readonly props: PropertyRepository;
  private readonly cats: CategoryRepository;

  constructor(
    private readonly db: Db,
    private readonly companies: CompanyService,
    private readonly files: ReceiptFiles,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.repo = new ExpenseRepository(db);
    this.props = new PropertyRepository(db);
    this.cats = new CategoryRepository(db);
  }

  stageFile(name: string, bytes: Uint8Array): StagedFile {
    return this.files.stage(name, bytes);
  }

  suggestVendors(companyId: number, prefix: string): string[] {
    return this.repo.suggestVendors(companyId, prefix);
  }

  list(query: ExpenseQuery): ExpensePage {
    return this.repo.list(query);
  }

  get(id: number): ExpenseDetail {
    const e = this.mustGet(id);
    return { ...e, events: this.repo.events(id) };
  }

  /**
   * Posts an expense. Saving again with the same idempotency key returns the first result,
   * so a double click or a retry after a lost response can never create a second expense.
   */
  create(input: ExpenseInput): Expense {
    const existing = this.repo.findByKey(input.idempotencyKey);
    if (existing !== undefined) return this.mustGet(existing);

    this.companies.requireActive(input.companyId);
    const c = this.check(input.companyId, input, null);
    const promoted: StoredFile[] = [];
    try {
      for (const id of input.stagedFileIds ?? []) promoted.push(this.files.promote(id));
      const id = this.db.transaction(() => {
        const now = this.now();
        const vendorId = this.repo.vendorId(c.companyId, c.vendorName, now);
        const expenseId = this.repo.insertExpense({ companyId: c.companyId, propertyId: c.propertyId, vendorId, date: c.date, totalCents: c.totalCents, notes: c.notes, key: input.idempotencyKey }, now);
        this.repo.replaceAllocations(expenseId, c.lines);
        this.assertBalanced(expenseId, c.totalCents);
        for (const f of promoted) this.repo.addAttachment(expenseId, f, now);
        this.repo.addEvent(expenseId, 'created', `Added ${formatCents(c.totalCents)} for ${c.vendorName}`, now);
        return expenseId;
      })();
      for (const sid of input.stagedFileIds ?? []) this.files.discardStaged(sid);
      return this.mustGet(id);
    } catch (err) {
      // Nothing was saved: remove any managed copies so no file is left without a record.
      for (const f of promoted) this.files.remove(f.storedName);
      const raced = this.repo.findByKey(input.idempotencyKey);
      if (raced !== undefined) return this.mustGet(raced);
      throw this.friendly(err);
    }
  }

  /**
   * Posts an expense from a reviewed receipt draft. The files are already in managed storage, so
   * they become the expense's attachments without being copied again. `inTransaction` lets the
   * caller complete the draft atomically, so a retry can never post twice.
   */
  createFromStored(
    input: Omit<ExpenseInput, 'stagedFileIds'>,
    stored: StoredFile[],
    inTransaction: (expenseId: number, now: string) => void,
  ): Expense {
    const existing = this.repo.findByKey(input.idempotencyKey);
    if (existing !== undefined) return this.mustGet(existing);
    this.companies.requireActive(input.companyId);
    const c = this.check(input.companyId, input, null);
    try {
      const id = this.db.transaction(() => {
        const now = this.now();
        const vendorId = this.repo.vendorId(c.companyId, c.vendorName, now);
        const expenseId = this.repo.insertExpense({ companyId: c.companyId, propertyId: c.propertyId, vendorId, date: c.date, totalCents: c.totalCents, notes: c.notes, key: input.idempotencyKey }, now);
        this.repo.replaceAllocations(expenseId, c.lines);
        this.assertBalanced(expenseId, c.totalCents);
        for (const f of stored) this.repo.addAttachment(expenseId, f, now);
        this.repo.addEvent(expenseId, 'created', `Added ${formatCents(c.totalCents)} for ${c.vendorName} from a reviewed receipt`, now);
        inTransaction(expenseId, now);
        return expenseId;
      })();
      return this.mustGet(id);
    } catch (err) {
      const raced = this.repo.findByKey(input.idempotencyKey);
      if (raced !== undefined) return this.mustGet(raced);
      throw this.friendly(err);
    }
  }

  update(id: number, input: ExpenseUpdate): ExpenseDetail {
    const before = this.mustGet(id);
    this.companies.requireActive(before.companyId);
    if (before.status === 'voided') throw new AppError('CONFLICT', 'This expense is voided. Restore it before editing.');
    const c = this.check(before.companyId, input, before);
    const removeIds = new Set(input.removeAttachmentIds ?? []);
    const current = this.repo.attachmentsFor(id);
    for (const rid of removeIds) if (!current.some((a) => a.id === rid)) throw new AppError('VALIDATION', 'One of the receipts to remove no longer exists.');

    const promoted: StoredFile[] = [];
    try {
      for (const sid of input.stagedFileIds ?? []) promoted.push(this.files.promote(sid));
      this.db.transaction(() => {
        const now = this.now();
        const vendorId = this.repo.vendorId(c.companyId, c.vendorName, now);
        this.repo.updateExpense(id, { propertyId: c.propertyId, vendorId, date: c.date, totalCents: c.totalCents, notes: c.notes }, now);
        this.repo.replaceAllocations(id, c.lines);
        this.assertBalanced(id, c.totalCents);
        for (const rid of removeIds) this.repo.removeAttachment(rid);
        for (const f of promoted) this.repo.addAttachment(id, f, now);
        const summary = this.diff(before, c, promoted.length, removeIds.size);
        if (summary) this.repo.addEvent(id, 'edited', summary, now);
      })();
      for (const sid of input.stagedFileIds ?? []) this.files.discardStaged(sid);
      for (const a of current) if (removeIds.has(a.id)) this.files.remove(a.storedName);
      return this.get(id);
    } catch (err) {
      for (const f of promoted) this.files.remove(f.storedName);
      throw this.friendly(err);
    }
  }

  void(id: number): ExpenseDetail {
    const e = this.mustGet(id);
    this.companies.requireActive(e.companyId);
    if (e.status === 'voided') return this.get(id);
    const now = this.now();
    this.db.transaction(() => {
      this.repo.setStatus(id, 'voided', now);
      this.repo.addEvent(id, 'voided', `Voided ${formatCents(e.totalCents)} for ${e.vendorName}. It no longer counts in any total.`, now);
    })();
    return this.get(id);
  }

  unvoid(id: number): ExpenseDetail {
    const e = this.mustGet(id);
    this.companies.requireActive(e.companyId);
    if (e.status === 'posted') return this.get(id);
    const now = this.now();
    this.db.transaction(() => {
      this.repo.setStatus(id, 'posted', now);
      this.repo.addEvent(id, 'unvoided', `Restored ${formatCents(e.totalCents)} for ${e.vendorName}. It counts in totals again.`, now);
    })();
    return this.get(id);
  }

  /** Location of a managed receipt for the platform to open. Only files we stored are ever returned. */
  attachmentFile(attachmentId: number): { path: string; name: string } {
    const a = this.repo.attachment(attachmentId);
    if (!a) throw new AppError('NOT_FOUND', 'That receipt no longer exists.');
    return { path: this.files.pathOf(a.storedName), name: a.originalName };
  }

  private mustGet(id: number): Expense {
    const e = this.repo.get(id);
    if (!e) throw new AppError('NOT_FOUND', 'That expense no longer exists.');
    return e;
  }

  private assertBalanced(expenseId: number, total: number): void {
    if (this.repo.allocationSum(expenseId) !== total) throw new AppError('VALIDATION', 'The category amounts must add up to the total exactly.', { allocations: 'Amounts do not add up to the total.' });
  }

  /** Business rules shared by create and update. `existing` lets an edit keep an archived category it already uses. */
  private check(companyId: number, i: { propertyId: number | null; vendorName: string; expenseDate: string; totalCents: number; allocations: { categoryId: number; amountCents: number }[]; notes: string }, existing: Expense | null): Checked {
    const e: Record<string, string> = {};
    const vendorName = i.vendorName.trim();
    if (vendorName === '') e.vendorName = 'Enter the vendor.';
    if (!isValidIsoDate(i.expenseDate)) e.expenseDate = 'Enter a valid date.';
    if (i.propertyId !== null) {
      const p = this.props.get(i.propertyId);
      if (!p) e.propertyId = 'That property no longer exists.';
      else if (p.companyId !== companyId) e.propertyId = 'That property belongs to a different company.';
      else if (p.isArchived && existing?.propertyId !== p.id) e.propertyId = 'That property is archived. Restore it before adding expenses.';
    }
    const seen = new Set<number>();
    let sum = 0;
    for (const l of i.allocations) {
      const cat = this.cats.get(l.categoryId);
      if (!cat) e.allocations = 'A category no longer exists.';
      else if (cat.companyId !== companyId) e.allocations = 'A category belongs to a different company.';
      else if (cat.isArchived && !existing?.allocations.some((a) => a.categoryId === cat.id)) e.allocations = `"${cat.name}" is archived. Choose another category.`;
      if (seen.has(l.categoryId)) e.allocations = 'Use each category once. Combine the amounts instead.';
      seen.add(l.categoryId);
      sum += l.amountCents;
    }
    if (!e.allocations && sum !== i.totalCents) e.allocations = `The category amounts add up to ${formatCents(sum)}, not ${formatCents(i.totalCents)}.`;
    if (Object.keys(e).length) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', e);
    return { companyId, propertyId: i.propertyId, vendorName, date: i.expenseDate, totalCents: i.totalCents, notes: i.notes.trim() === '' ? null : i.notes.trim(), lines: i.allocations };
  }

  private diff(before: Expense, after: Checked, added: number, removed: number): string {
    const parts: string[] = [];
    if (before.vendorName.toLowerCase() !== after.vendorName.toLowerCase()) parts.push(`Vendor ${before.vendorName} to ${after.vendorName}`);
    if (before.expenseDate !== after.date) parts.push(`Date ${formatUsDate(before.expenseDate)} to ${formatUsDate(after.date)}`);
    if (before.totalCents !== after.totalCents) parts.push(`Amount ${formatCents(before.totalCents)} to ${formatCents(after.totalCents)}`);
    if (before.propertyId !== after.propertyId) parts.push('Property changed');
    const cats = (ls: { categoryId: number; amountCents: number }[]) => ls.map((l) => `${l.categoryId}:${l.amountCents}`).sort().join(',');
    if (cats(before.allocations) !== cats(after.lines)) parts.push('Categories changed');
    if ((before.notes || '') !== (after.notes ?? '')) parts.push('Notes changed');
    if (added) parts.push(`${added} receipt${added === 1 ? '' : 's'} added`);
    if (removed) parts.push(`${removed} receipt${removed === 1 ? '' : 's'} removed`);
    return parts.join('; ');
  }

  private friendly(err: unknown): unknown {
    if (err instanceof AppError) return err;
    const msg = err instanceof Error ? err.message : '';
    if (/archived/.test(msg)) return new AppError('ARCHIVED', 'That company or property is archived. Restore it first.');
    if (/different company/.test(msg)) return new AppError('VALIDATION', 'That property, vendor or category belongs to a different company.');
    return err;
  }
}

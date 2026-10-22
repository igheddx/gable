import type { Db } from './connection';
import { normalizeSearch, searchTokens } from '../shared/search';
import { expenseQuerySchema, type ExpenseQuery } from '../shared/schemas';
import type { Allocation, Attachment, Expense, ExpenseEvent, ExpensePage } from '../shared/types';
import type { ReportingGroup } from '../shared/categories';

interface Row {
  id: number; company_id: number; company_name: string; property_id: number | null; property_address: string | null;
  vendor_name: string; expense_date: string; total_cents: number; notes: string | null; status: 'posted' | 'voided'; created_at: string;
}

const SELECT = `
  SELECT e.id, e.company_id, c.display_name AS company_name, e.property_id, p.address1 AS property_address,
         v.name AS vendor_name, e.expense_date, e.total_cents, e.notes, e.status, e.created_at
  FROM expense e
  JOIN company c ON c.id = e.company_id
  JOIN vendor v ON v.id = e.vendor_id
  LEFT JOIN property p ON p.id = e.property_id`;

export interface NewAttachment { storedName: string; originalName: string; sha256: string; sizeBytes: number; mime: string }

const SORT = { date: 'e.expense_date', amount: 'e.total_cents', vendor: 'v.name COLLATE NOCASE' } as const;

export class ExpenseRepository {
  constructor(private readonly db: Db) {}

  findVendor(companyId: number, name: string): { id: number } | undefined {
    return this.db.prepare('SELECT id FROM vendor WHERE company_id = ? AND name_key = ?').get(companyId, normalizeSearch(name)) as { id: number } | undefined;
  }

  vendorId(companyId: number, name: string, now: string): number {
    const found = this.findVendor(companyId, name);
    if (found) return found.id;
    return Number(this.db.prepare('INSERT INTO vendor (company_id, name, name_key, created_at) VALUES (?, ?, ?, ?)').run(companyId, name, normalizeSearch(name), now).lastInsertRowid);
  }

  suggestVendors(companyId: number, prefix: string, limit = 8): string[] {
    const toks = searchTokens(prefix);
    const where = toks.map(() => "name_key LIKE ? ESCAPE '\\'").join(' AND ');
    const rows = this.db
      .prepare(`SELECT name FROM vendor WHERE company_id = ? ${where ? 'AND ' + where : ''} ORDER BY name COLLATE NOCASE LIMIT ?`)
      .all(companyId, ...toks.map((t) => `%${t}%`), limit) as { name: string }[];
    return rows.map((r) => r.name);
  }

  insertExpense(e: { companyId: number; propertyId: number | null; vendorId: number; date: string; totalCents: number; notes: string | null; key: string }, now: string): number {
    return Number(this.db
      .prepare(`INSERT INTO expense (company_id, property_id, vendor_id, expense_date, total_cents, notes, idempotency_key, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(e.companyId, e.propertyId, e.vendorId, e.date, e.totalCents, e.notes, e.key, now, now).lastInsertRowid);
  }

  updateExpense(id: number, e: { propertyId: number | null; vendorId: number; date: string; totalCents: number; notes: string | null }, now: string): void {
    this.db.prepare('UPDATE expense SET property_id = ?, vendor_id = ?, expense_date = ?, total_cents = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run(e.propertyId, e.vendorId, e.date, e.totalCents, e.notes, now, id);
  }

  setStatus(id: number, status: 'posted' | 'voided', now: string): void {
    this.db.prepare('UPDATE expense SET status = ?, voided_at = ?, updated_at = ? WHERE id = ?').run(status, status === 'voided' ? now : null, now, id);
  }

  replaceAllocations(expenseId: number, lines: { categoryId: number; amountCents: number }[]): void {
    this.db.prepare('DELETE FROM expense_allocation WHERE expense_id = ?').run(expenseId);
    const ins = this.db.prepare('INSERT INTO expense_allocation (expense_id, category_id, amount_cents) VALUES (?, ?, ?)');
    for (const l of lines) ins.run(expenseId, l.categoryId, l.amountCents);
  }

  allocationSum(expenseId: number): number {
    return (this.db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM expense_allocation WHERE expense_id = ?').get(expenseId) as { s: number }).s;
  }

  addAttachment(expenseId: number, a: NewAttachment, now: string): void {
    this.db.prepare('INSERT INTO expense_attachment (expense_id, original_name, stored_name, sha256, size_bytes, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(expenseId, a.originalName, a.storedName, a.sha256, a.sizeBytes, a.mime, now);
  }

  attachmentsFor(expenseId: number): (Attachment & { storedName: string })[] {
    return (this.db.prepare('SELECT id, original_name, stored_name, size_bytes, mime FROM expense_attachment WHERE expense_id = ? ORDER BY id').all(expenseId) as
      { id: number; original_name: string; stored_name: string; size_bytes: number; mime: string }[])
      .map((r) => ({ id: r.id, originalName: r.original_name, sizeBytes: r.size_bytes, mime: r.mime, storedName: r.stored_name }));
  }

  attachment(id: number): { id: number; expenseId: number; storedName: string; originalName: string; mime: string } | undefined {
    const r = this.db.prepare('SELECT id, expense_id, stored_name, original_name, mime FROM expense_attachment WHERE id = ?').get(id) as
      { id: number; expense_id: number; stored_name: string; original_name: string; mime: string } | undefined;
    return r && { id: r.id, expenseId: r.expense_id, storedName: r.stored_name, originalName: r.original_name, mime: r.mime };
  }

  removeAttachment(id: number): void {
    this.db.prepare('DELETE FROM expense_attachment WHERE id = ?').run(id);
  }

  addEvent(expenseId: number, type: ExpenseEvent['type'], detail: string, now: string): void {
    this.db.prepare('INSERT INTO expense_event (expense_id, type, detail, at) VALUES (?, ?, ?, ?)').run(expenseId, type, detail, now);
  }

  events(expenseId: number): ExpenseEvent[] {
    return this.db.prepare('SELECT id, type, detail, at FROM expense_event WHERE expense_id = ? ORDER BY id').all(expenseId) as ExpenseEvent[];
  }

  findByKey(key: string): number | undefined {
    return (this.db.prepare('SELECT id FROM expense WHERE idempotency_key = ?').get(key) as { id: number } | undefined)?.id;
  }

  get(id: number): Expense | undefined {
    const r = this.db.prepare(`${SELECT} WHERE e.id = ?`).get(id) as Row | undefined;
    return r && this.hydrate([r])[0];
  }

  private hydrate(rows: Row[]): Expense[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const allocs = this.db
      .prepare(`SELECT a.expense_id, a.category_id, c.name, c.reporting_group, a.amount_cents FROM expense_allocation a JOIN category c ON c.id = a.category_id WHERE a.expense_id IN (${marks}) ORDER BY a.amount_cents DESC, c.name`)
      .all(...ids) as { expense_id: number; category_id: number; name: string; reporting_group: ReportingGroup; amount_cents: number }[];
    const atts = this.db
      .prepare(`SELECT id, expense_id, original_name, size_bytes, mime FROM expense_attachment WHERE expense_id IN (${marks}) ORDER BY id`)
      .all(...ids) as { id: number; expense_id: number; original_name: string; size_bytes: number; mime: string }[];
    return rows.map((r): Expense => ({
      id: r.id, companyId: r.company_id, companyName: r.company_name, propertyId: r.property_id, propertyAddress: r.property_address,
      vendorName: r.vendor_name, expenseDate: r.expense_date, totalCents: r.total_cents, notes: r.notes ?? '', status: r.status, createdAt: r.created_at,
      allocations: allocs.filter((a) => a.expense_id === r.id).map((a): Allocation => ({ categoryId: a.category_id, categoryName: a.name, reportingGroup: a.reporting_group, amountCents: a.amount_cents })),
      attachments: atts.filter((a) => a.expense_id === r.id).map((a): Attachment => ({ id: a.id, originalName: a.original_name, sizeBytes: a.size_bytes, mime: a.mime })),
    }));
  }

  list(input: ExpenseQuery): ExpensePage {
    const q = expenseQuerySchema.parse(input);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.scope !== 'all') { where.push('e.company_id = ?'); params.push(q.scope); }
    if (!q.includeVoided) where.push("e.status = 'posted'");
    if (q.property === 'general') where.push('e.property_id IS NULL');
    else if (q.property !== null) { where.push('e.property_id = ?'); params.push(q.property); }
    if (q.categoryId !== null) { where.push('EXISTS (SELECT 1 FROM expense_allocation a WHERE a.expense_id = e.id AND a.category_id = ?)'); params.push(q.categoryId); }
    if (q.from) { where.push('e.expense_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('e.expense_date <= ?'); params.push(q.to); }
    for (const tok of searchTokens(q.q)) {
      const like = `%${tok}%`;
      where.push("(v.name_key LIKE ? ESCAPE '\\' OR lower(COALESCE(e.notes, '')) LIKE ? ESCAPE '\\')");
      params.push(like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = 'FROM expense e JOIN vendor v ON v.id = e.vendor_id';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n ${from} ${clause}`).get(...params) as { n: number }).n;
    const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
    const rows = this.db
      .prepare(`${SELECT} ${clause} ORDER BY ${SORT[q.sort]} ${dir}, e.id ${dir} LIMIT ? OFFSET ?`)
      .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as Row[];
    return { rows: this.hydrate(rows), total, page: q.page, pageSize: q.pageSize };
  }
}

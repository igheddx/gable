import type { Db } from './connection';
import { incomeQuerySchema, type IncomeQuery } from '../shared/schemas';
import type { Income, IncomePage } from '../shared/types';

interface Row {
  id: number; company_id: number; company_name: string; property_id: number; property_name: string; income_date: string;
  amount_cents: number; category: string; notes: string | null; status: 'posted' | 'voided'; created_at: string;
}

const SELECT = `
  SELECT i.id, i.company_id, c.display_name AS company_name, i.property_id, p.address1 AS property_name, i.income_date,
         i.amount_cents, i.category, i.notes, i.status, i.created_at
  FROM income i JOIN company c ON c.id = i.company_id JOIN property p ON p.id = i.property_id`;

const toDto = (r: Row): Income => ({
  id: r.id, companyId: r.company_id, companyName: r.company_name, propertyId: r.property_id, propertyName: r.property_name,
  incomeDate: r.income_date, amountCents: r.amount_cents, category: r.category, notes: r.notes ?? '', status: r.status, createdAt: r.created_at,
});

export class IncomeRepository {
  constructor(private readonly db: Db) {}

  get(id: number): Income | undefined {
    const r = this.db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
    return r && toDto(r);
  }

  findByKey(key: string): number | undefined {
    return (this.db.prepare('SELECT id FROM income WHERE idempotency_key = ?').get(key) as { id: number } | undefined)?.id;
  }

  insert(i: { companyId: number; propertyId: number; date: string; amountCents: number; category: string; notes: string | null; key: string }, now: string): number {
    return Number(
      this.db
        .prepare(`INSERT INTO income (company_id, property_id, income_date, amount_cents, category, notes, idempotency_key, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(i.companyId, i.propertyId, i.date, i.amountCents, i.category, i.notes, i.key, now, now).lastInsertRowid,
    );
  }

  update(id: number, i: { date: string; amountCents: number; category: string; notes: string | null }, now: string): void {
    this.db.prepare('UPDATE income SET income_date = ?, amount_cents = ?, category = ?, notes = ?, updated_at = ? WHERE id = ?').run(i.date, i.amountCents, i.category, i.notes, now, id);
  }

  setStatus(id: number, status: 'posted' | 'voided', now: string): void {
    this.db.prepare('UPDATE income SET status = ?, voided_at = ?, updated_at = ? WHERE id = ?').run(status, status === 'voided' ? now : null, now, id);
  }

  list(input: IncomeQuery): IncomePage {
    const q = incomeQuerySchema.parse(input);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.scope !== 'all') { where.push('i.company_id = ?'); params.push(q.scope); }
    if (!q.includeVoided) where.push("i.status = 'posted'");
    if (q.propertyId !== null) { where.push('i.property_id = ?'); params.push(q.propertyId); }
    if (q.from) { where.push('i.income_date >= ?'); params.push(q.from); }
    if (q.to) { where.push('i.income_date <= ?'); params.push(q.to); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM income i ${clause}`).get(...params) as { n: number }).n;
    const rows = this.db
      .prepare(`${SELECT} ${clause} ORDER BY i.income_date DESC, i.id DESC LIMIT ? OFFSET ?`)
      .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as Row[];
    return { rows: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
  }
}

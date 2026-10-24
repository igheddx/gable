import type { Db } from './connection';
import type { PropertyFields } from '../shared/schemas';
import { searchTokens } from '../shared/search';
import type { PropertyQuery } from '../shared/schemas';
import { propertyQuerySchema } from '../shared/schemas';
import type { Property, PropertyPage } from '../shared/types';

interface Row {
  id: number;
  company_id: number;
  company_name: string;
  company_archived: number;
  business_type_id: number;
  business_type_name: string;
  template: Property['template'];
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  identifier: string | null;
  purchase_date: string | null;
  purchase_price_cents: number | null;
  status: Property['status'];
  sale_date: string | null;
  sale_price_cents: number | null;
  description: string | null;
  notes: string | null;
  is_archived: number;
}

const SELECT = `
  SELECT p.id, p.company_id, c.display_name AS company_name, c.is_archived AS company_archived,
         p.business_type_id, bt.name AS business_type_name, bt.template,
         p.address1, p.address2, p.city, p.state, p.zip, p.identifier, p.purchase_date, p.purchase_price_cents,
         p.status, p.sale_date, p.sale_price_cents, p.description, p.notes, p.is_archived
  FROM property p JOIN company c ON c.id = p.company_id JOIN business_type bt ON bt.id = p.business_type_id`;

const toDto = (r: Row): Property => ({
  id: r.id,
  companyId: r.company_id,
  companyName: r.company_name,
  companyArchived: r.company_archived === 1,
  businessTypeId: r.business_type_id,
  businessTypeName: r.business_type_name,
  template: r.template,
  address1: r.address1,
  address2: r.address2 ?? '',
  city: r.city,
  state: r.state,
  zip: r.zip,
  identifier: r.identifier ?? '',
  purchaseDate: r.purchase_date,
  purchasePriceCents: r.purchase_price_cents,
  status: r.status,
  saleDate: r.sale_date,
  salePriceCents: r.sale_price_cents,
  description: r.description ?? '',
  notes: r.notes ?? '',
  isArchived: r.is_archived === 1,
});

const SORT_SQL = {
  address: 'p.address1 COLLATE NOCASE',
  purchaseDate: 'p.purchase_date',
  purchasePrice: 'p.purchase_price_cents',
  status: 'p.status',
} as const;

const blank = (s: string): string | null => (s === '' ? null : s);

export class PropertyRepository {
  constructor(private readonly db: Db) {}

  get(id: number): Property | undefined {
    const r = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
    return r && toDto(r);
  }

  insert(companyId: number, f: PropertyFields, searchText: string, now: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO property (company_id, business_type_id, address1, address2, city, state, zip, identifier, search_text, purchase_date,
           purchase_price_cents, status, sale_date, sale_price_cents, description, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(companyId, f.businessTypeId ?? 1, f.address1, blank(f.address2), f.city, f.state, f.zip, blank(f.identifier ?? ''), searchText, f.purchaseDate,
        f.purchasePriceCents, f.status, f.saleDate, f.salePriceCents, blank(f.description), blank(f.notes), now, now);
    return Number(r.lastInsertRowid);
  }

  update(id: number, f: PropertyFields, searchText: string, now: string): void {
    this.db
      .prepare(
        `UPDATE property SET address1 = ?, address2 = ?, city = ?, state = ?, zip = ?, identifier = ?, search_text = ?, purchase_date = ?,
           purchase_price_cents = ?, status = ?, sale_date = ?, sale_price_cents = ?, description = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(f.address1, blank(f.address2), f.city, f.state, f.zip, blank(f.identifier ?? ''), searchText, f.purchaseDate, f.purchasePriceCents,
        f.status, f.saleDate, f.salePriceCents, blank(f.description), blank(f.notes), now, id);
  }

  setArchived(id: number, archived: boolean, now: string): void {
    this.db.prepare('UPDATE property SET is_archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
  }

  countForCompany(companyId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM property WHERE company_id = ?').get(companyId) as { n: number }).n;
  }

  /** Company-scoped search. Every value is a bound parameter; sort columns come from a fixed map. */
  list(input: PropertyQuery): PropertyPage {
    const q = propertyQuerySchema.parse(input);
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.scope !== 'all') {
      where.push('p.company_id = ?');
      params.push(q.scope);
    }
    if (!q.includeArchived) where.push('p.is_archived = 0');
    for (const tok of searchTokens(q.q)) {
      where.push("p.search_text LIKE ? ESCAPE '\\'");
      params.push(`%${tok.replace(/[\\%_]/g, '\\$&')}%`);
    }
    const range = (col: string, from: string | null, to: string | null) => {
      if (from) { where.push(`${col} >= ?`); params.push(from); }
      if (to) { where.push(`${col} <= ?`); params.push(to); }
    };
    if (q.status) { where.push('p.status = ?'); params.push(q.status); }
    if (q.businessTypeId !== null) { where.push('p.business_type_id = ?'); params.push(q.businessTypeId); }
    range('p.purchase_date', q.purchaseFrom, q.purchaseTo);
    range('p.sale_date', q.saleFrom, q.saleTo);
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM property p ${clause}`).get(...params) as { n: number }).n;
    const dir = q.dir === 'desc' ? 'DESC' : 'ASC';
    const rows = this.db
      .prepare(`${SELECT} ${clause} ORDER BY ${SORT_SQL[q.sort]} ${dir}, p.id ${dir} LIMIT ? OFFSET ?`)
      .all(...params, q.pageSize, (q.page - 1) * q.pageSize) as Row[];
    return { rows: rows.map(toDto), total, page: q.page, pageSize: q.pageSize };
  }
}

import type { Db } from './connection';
import { ADDED_STARTER_CATEGORIES, STARTER_CATEGORIES, type ReportingGroup } from '../shared/categories';
import { normalizeSearch } from '../shared/search';
import type { Category } from '../shared/types';

interface Row { id: number; company_id: number; name: string; reporting_group: ReportingGroup; is_archived: number }
const toDto = (r: Row): Category => ({ id: r.id, companyId: r.company_id, name: r.name, reportingGroup: r.reporting_group, isArchived: r.is_archived === 1 });

export class CategoryRepository {
  constructor(private readonly db: Db) {}

  list(companyId: number, includeArchived: boolean): Category[] {
    return (this.db
      .prepare('SELECT id, company_id, name, reporting_group, is_archived FROM category WHERE company_id = ? AND (? = 1 OR is_archived = 0) ORDER BY is_archived, sort_order, name COLLATE NOCASE')
      .all(companyId, includeArchived ? 1 : 0) as Row[]).map(toDto);
  }

  get(id: number): Category | undefined {
    const r = this.db.prepare('SELECT id, company_id, name, reporting_group, is_archived FROM category WHERE id = ?').get(id) as Row | undefined;
    return r && toDto(r);
  }

  findByKey(companyId: number, key: string): Category | undefined {
    const r = this.db.prepare('SELECT id, company_id, name, reporting_group, is_archived FROM category WHERE company_id = ? AND name_key = ?').get(companyId, key) as Row | undefined;
    return r && toDto(r);
  }

  insert(companyId: number, name: string, group: ReportingGroup, now: string): number {
    const next = (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM category WHERE company_id = ?').get(companyId) as { n: number }).n;
    return Number(this.db
      .prepare('INSERT INTO category (company_id, name, name_key, reporting_group, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(companyId, name, normalizeSearch(name), group, next, now, now).lastInsertRowid);
  }

  rename(id: number, name: string, now: string): void {
    this.db.prepare('UPDATE category SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name, normalizeSearch(name), now, id);
  }

  setGroup(id: number, group: ReportingGroup, now: string): void {
    this.db.prepare('UPDATE category SET reporting_group = ?, updated_at = ? WHERE id = ?').run(group, now, id);
  }

  setArchived(id: number, archived: boolean, now: string): void {
    this.db.prepare('UPDATE category SET is_archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
  }

  seedStarter(companyId: number, now: string): void {
    [...STARTER_CATEGORIES, ...ADDED_STARTER_CATEGORIES].forEach((c, i) => {
      this.db
        .prepare('INSERT INTO category (company_id, name, name_key, reporting_group, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(companyId, c.name, normalizeSearch(c.name), c.group, i, now, now);
    });
  }
}

import type { Db } from './connection';
import type { BusinessType, Template } from '../shared/businessTypes';

interface Row { id: number; name: string; template: Template; is_builtin: number; is_archived: number }

const toDto = (r: Row): BusinessType => ({ id: r.id, name: r.name, template: r.template, isBuiltin: r.is_builtin === 1, isArchived: r.is_archived === 1 });

export class BusinessTypeRepository {
  constructor(private readonly db: Db) {}

  list(includeArchived: boolean): BusinessType[] {
    const rows = this.db
      .prepare(`SELECT id, name, template, is_builtin, is_archived FROM business_type ${includeArchived ? '' : 'WHERE is_archived = 0'} ORDER BY sort_order, name COLLATE NOCASE`)
      .all() as Row[];
    return rows.map(toDto);
  }

  get(id: number): BusinessType | undefined {
    const r = this.db.prepare('SELECT id, name, template, is_builtin, is_archived FROM business_type WHERE id = ?').get(id) as Row | undefined;
    return r && toDto(r);
  }

  findByKey(key: string): BusinessType | undefined {
    const r = this.db.prepare('SELECT id, name, template, is_builtin, is_archived FROM business_type WHERE name_key = ?').get(key) as Row | undefined;
    return r && toDto(r);
  }

  insert(name: string, key: string, template: Template, now: string): number {
    const next = (this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM business_type').get() as { n: number }).n;
    return Number(
      this.db
        .prepare('INSERT INTO business_type (name, name_key, template, is_builtin, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
        .run(name, key, template, next, now, now).lastInsertRowid,
    );
  }

  rename(id: number, name: string, key: string, now: string): void {
    this.db.prepare('UPDATE business_type SET name = ?, name_key = ?, updated_at = ? WHERE id = ?').run(name, key, now, id);
  }

  setArchived(id: number, archived: boolean, now: string): void {
    this.db.prepare('UPDATE business_type SET is_archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
  }

  itemCount(id: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM property WHERE business_type_id = ?').get(id) as { n: number }).n;
  }
}

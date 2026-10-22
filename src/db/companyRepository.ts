import type { Db } from './connection';

export interface CompanyRow {
  id: number;
  display_name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  logo_file: string | null;
  is_archived: number;
}

export interface CompanyWrite {
  displayName: string;
  nameKey: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

const COLUMNS = 'id, display_name, legal_name, address, phone, email, logo_file, is_archived';

export class CompanyRepository {
  constructor(private readonly db: Db) {}

  list(includeArchived: boolean): CompanyRow[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM company WHERE (? = 1 OR is_archived = 0) ORDER BY is_archived, display_name COLLATE NOCASE`)
      .all(includeArchived ? 1 : 0) as CompanyRow[];
  }

  get(id: number): CompanyRow | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM company WHERE id = ?`).get(id) as CompanyRow | undefined;
  }

  findByNameKey(key: string): CompanyRow | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM company WHERE name_key = ?`).get(key) as CompanyRow | undefined;
  }

  insert(c: CompanyWrite, now: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO company (display_name, name_key, legal_name, address, phone, email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.displayName, c.nameKey, c.legalName, c.address, c.phone, c.email, now, now);
    return Number(r.lastInsertRowid);
  }

  update(id: number, c: CompanyWrite, now: string): void {
    this.db
      .prepare(
        `UPDATE company SET display_name = ?, name_key = ?, legal_name = ?, address = ?, phone = ?, email = ?, updated_at = ? WHERE id = ?`,
      )
      .run(c.displayName, c.nameKey, c.legalName, c.address, c.phone, c.email, now, id);
  }

  setArchived(id: number, archived: boolean, now: string): void {
    this.db.prepare('UPDATE company SET is_archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now, id);
  }

  setLogo(id: number, file: string | null, now: string): void {
    this.db.prepare('UPDATE company SET logo_file = ?, updated_at = ? WHERE id = ?').run(file, now, id);
  }
}

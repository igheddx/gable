import type { Db } from './connection';
import type { DraftStatus } from '../shared/types';

export interface DraftRow {
  id: number; company_id: number; property_id: number | null; status: DraftStatus; error_message: string | null;
  vendor: string | null; expense_date: string | null; total_cents: number | null; notes: string | null; category_id: number | null;
  split: number; allocations: string | null; suggestions: string | null; touched: string; ocr_text: string | null;
  ocr_confidence: number | null; ocr_notes: string | null; remember_vendor: number; duplicate_override: number;
  posting_token: string; posted_expense_id: number | null; page_count: number; created_at: string;
}
export interface DraftFileRow { id: number; draft_id: number; position: number; original_name: string; stored_name: string; sha256: string; size_bytes: number; mime: string; pages: number }

const COLS = `id, company_id, property_id, status, error_message, vendor, expense_date, total_cents, notes, category_id, split, allocations,
  suggestions, touched, ocr_text, ocr_confidence, ocr_notes, remember_vendor, duplicate_override, posting_token, posted_expense_id, page_count, created_at`;

/** Fields a service may write on a draft. Column names are fixed here; values are always bound. */
const WRITABLE = new Set([
  'property_id', 'status', 'error_message', 'vendor', 'expense_date', 'total_cents', 'notes', 'category_id', 'split', 'allocations',
  'suggestions', 'touched', 'ocr_text', 'ocr_confidence', 'ocr_notes', 'remember_vendor', 'duplicate_override', 'posted_expense_id', 'page_count',
]);

export class ReceiptRepository {
  constructor(private readonly db: Db) {}

  insertDraft(d: { companyId: number; propertyId: number | null; token: string; pageCount: number }, now: string): number {
    return Number(this.db
      .prepare(`INSERT INTO receipt_draft (company_id, property_id, status, posting_token, page_count, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)`)
      .run(d.companyId, d.propertyId, d.token, d.pageCount, now, now).lastInsertRowid);
  }

  insertFile(draftId: number, position: number, f: { originalName: string; storedName: string; sha256: string; sizeBytes: number; mime: string; pages: number }): void {
    this.db.prepare('INSERT INTO receipt_draft_file (draft_id, position, original_name, stored_name, sha256, size_bytes, mime, pages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(draftId, position, f.originalName, f.storedName, f.sha256, f.sizeBytes, f.mime, f.pages);
  }

  files(draftId: number): DraftFileRow[] {
    return this.db.prepare('SELECT id, draft_id, position, original_name, stored_name, sha256, size_bytes, mime, pages FROM receipt_draft_file WHERE draft_id = ? ORDER BY position').all(draftId) as DraftFileRow[];
  }

  deleteFiles(draftId: number): void {
    this.db.prepare('DELETE FROM receipt_draft_file WHERE draft_id = ?').run(draftId);
  }

  deleteDraft(id: number): void {
    this.db.prepare('DELETE FROM receipt_draft WHERE id = ?').run(id);
  }

  get(id: number): DraftRow | undefined {
    return this.db.prepare(`SELECT ${COLS} FROM receipt_draft WHERE id = ?`).get(id) as DraftRow | undefined;
  }

  list(scope: number | 'all', includeSaved: boolean): DraftRow[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM receipt_draft WHERE (? = 'all' OR company_id = ?) AND (? = 1 OR status <> 'saved') ORDER BY id`)
      .all(scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope, includeSaved ? 1 : 0) as DraftRow[];
  }

  byStatus(status: DraftStatus): DraftRow[] {
    return this.db.prepare(`SELECT ${COLS} FROM receipt_draft WHERE status = ? ORDER BY id`).all(status) as DraftRow[];
  }

  update(id: number, patch: Record<string, string | number | null>, now: string): void {
    const keys = Object.keys(patch);
    for (const k of keys) if (!WRITABLE.has(k)) throw new Error(`Unwritable draft column: ${k}`);
    if (keys.length === 0) return;
    this.db.prepare(`UPDATE receipt_draft SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => patch[k]!), now, id);
  }

  /** Posted expenses in this company with the same file content. */
  expensesWithHash(companyId: number, sha256: string): { id: number; vendor: string; date: string; total: number }[] {
    return this.db
      .prepare(`SELECT e.id, v.name AS vendor, e.expense_date AS date, e.total_cents AS total
                FROM expense_attachment a JOIN expense e ON e.id = a.expense_id JOIN vendor v ON v.id = e.vendor_id
                WHERE e.company_id = ? AND a.sha256 = ? ORDER BY e.id`)
      .all(companyId, sha256) as { id: number; vendor: string; date: string; total: number }[];
  }

  /** Other unsaved drafts in this company holding the same file content. */
  otherDraftsWithHash(companyId: number, sha256: string, exceptDraftId: number): { id: number }[] {
    return this.db
      .prepare(`SELECT DISTINCT d.id FROM receipt_draft_file f JOIN receipt_draft d ON d.id = f.draft_id
                WHERE d.company_id = ? AND f.sha256 = ? AND d.id <> ? AND d.status NOT IN ('saved', 'skipped') ORDER BY d.id`)
      .all(companyId, sha256, exceptDraftId) as { id: number }[];
  }

  possibleExpenseMatches(companyId: number, date: string, totalCents: number): { id: number; vendor: string }[] {
    return this.db
      .prepare(`SELECT e.id, v.name AS vendor FROM expense e JOIN vendor v ON v.id = e.vendor_id
                WHERE e.company_id = ? AND e.expense_date = ? AND e.total_cents = ? AND e.status = 'posted' ORDER BY e.id`)
      .all(companyId, date, totalCents) as { id: number; vendor: string }[];
  }

  // ----- vendor rules -----
  rules(companyId: number): { id: number; company_id: number; vendor_key: string; vendor_name: string; category_id: number; category_name: string }[] {
    return this.db
      .prepare(`SELECT r.id, r.company_id, r.vendor_key, r.vendor_name, r.category_id, c.name AS category_name
                FROM vendor_rule r JOIN category c ON c.id = r.category_id WHERE r.company_id = ? ORDER BY r.vendor_name COLLATE NOCASE`)
      .all(companyId) as { id: number; company_id: number; vendor_key: string; vendor_name: string; category_id: number; category_name: string }[];
  }

  ruleFor(companyId: number, key: string): { id: number; category_id: number } | undefined {
    return this.db.prepare('SELECT id, category_id FROM vendor_rule WHERE company_id = ? AND vendor_key = ?').get(companyId, key) as { id: number; category_id: number } | undefined;
  }

  upsertRule(companyId: number, key: string, name: string, categoryId: number, now: string): void {
    this.db
      .prepare(`INSERT INTO vendor_rule (company_id, vendor_key, vendor_name, category_id, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(company_id, vendor_key) DO UPDATE SET category_id = excluded.category_id, vendor_name = excluded.vendor_name`)
      .run(companyId, key, name, categoryId, now);
  }

  ruleCompany(id: number): number | undefined {
    return (this.db.prepare('SELECT company_id FROM vendor_rule WHERE id = ?').get(id) as { company_id: number } | undefined)?.company_id;
  }

  deleteRule(id: number): void {
    this.db.prepare('DELETE FROM vendor_rule WHERE id = ?').run(id);
  }
}

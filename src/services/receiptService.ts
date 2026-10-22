import crypto from 'node:crypto';
import fs from 'node:fs';
import type { Db } from '../db/connection';
import { CategoryRepository } from '../db/categoryRepository';
import { ExpenseRepository } from '../db/expenseRepository';
import { PropertyRepository } from '../db/propertyRepository';
import { ReceiptRepository, type DraftFileRow, type DraftRow } from '../db/receiptRepository';
import { AppError } from '../shared/errors';
import { formatCents } from '../shared/money';
import { formatUsDate, isValidIsoDate, todayIso } from '../shared/dates';
import { keywordCategory, parseReceiptText, type ParsedReceipt } from '../shared/receiptParser';
import { vendorKey } from '../shared/search';
import type { DraftPatch, DraftQuery } from '../shared/schemas';
import { draftQuerySchema } from '../shared/schemas';
import type {
  DraftDuplicate, DraftStatus, DraftSuggestion, Expense, ImportResult, PostAllResult, ReceiptDraft, ReceiptDraftDetail, ReceiptEvent, VendorRule,
} from '../shared/types';
import type { CompanyService } from './companyService';
import type { ExpenseService } from './expenseService';
import type { ReceiptFiles, StoredFile } from './receiptFiles';
import { OcrFileError, type OcrExecutor } from './ocr/types';

interface Suggestions { parsed: ParsedReceipt; category: DraftSuggestion['category'] }

export interface ReceiptServiceOptions {
  /** How many receipts are read at the same time. Never more than the executor can run. */
  concurrency?: number;
  now?: () => string;
  today?: () => string;
}

/**
 * Receipt drafts: files are copied into managed storage, read locally for suggestions, and wait for a
 * person to review them. Nothing here counts as an expense until `post` runs, and `post` is idempotent.
 */
export class ReceiptService {
  private readonly repo: ReceiptRepository;
  private readonly cats: CategoryRepository;
  private readonly expRepo: ExpenseRepository;
  private readonly props: PropertyRepository;
  private readonly listeners = new Set<(e: ReceiptEvent) => void>();
  private readonly progress = new Map<number, { page: number; pages: number }>();
  private readonly aborts = new Map<number, AbortController>();
  private readonly queue: number[] = [];
  private running = 0;
  private readonly concurrency: number;
  private readonly now: () => string;
  private readonly today: () => string;
  private idle: Array<() => void> = [];
  private stopped = false;

  constructor(
    private readonly db: Db,
    private readonly companies: CompanyService,
    private readonly expenses: ExpenseService,
    private readonly files: ReceiptFiles,
    private readonly ocr: OcrExecutor,
    opts: ReceiptServiceOptions = {},
  ) {
    this.repo = new ReceiptRepository(db);
    this.cats = new CategoryRepository(db);
    this.expRepo = new ExpenseRepository(db);
    this.props = new PropertyRepository(db);
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.now = opts.now ?? (() => new Date().toISOString());
    this.today = opts.today ?? (() => todayIso());
  }

  onEvent(cb: (e: ReceiptEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Resolves when nothing is queued or running. For tests and orderly shutdown. */
  whenIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((r) => this.idle.push(r));
  }

  /** Stops all reading immediately (used before the data is replaced). Interrupted receipts start again on the next launch. */
  stopAll(): void {
    this.stopped = true;
    this.queue.length = 0;
    for (const ac of this.aborts.values()) ac.abort();
  }

  /** After a restart, interrupted reads start over; nothing the person already typed is touched. */
  recoverInterrupted(): void {
    for (const d of this.repo.byStatus('processing')) this.repo.update(d.id, { status: 'queued' }, this.now());
    for (const d of this.repo.byStatus('queued')) this.enqueue(d.id);
  }

  // ---------------------------------------------------------------- import

  /**
   * Adds receipts to the review queue. Each group of staged files becomes one draft (several images are
   * the pages of one receipt; a PDF is always its own receipt). Files that cannot be used are reported
   * one by one and never stop the others.
   */
  async importGroups(companyId: number, propertyId: number | null, groups: string[][]): Promise<ImportResult> {
    this.companies.requireActive(companyId);
    if (propertyId !== null) {
      const p = this.props.get(propertyId);
      if (!p) throw new AppError('NOT_FOUND', 'That property no longer exists.');
      if (p.companyId !== companyId) throw new AppError('VALIDATION', 'That property belongs to a different company.');
      if (p.isArchived) throw new AppError('ARCHIVED', 'That property is archived. Restore it before adding receipts.');
    }
    const result: ImportResult = { created: [], rejected: [] };
    for (const group of groups) {
      const infos = group.map((id) => {
        try { return this.files.stagedInfo(id); } catch { return null; }
      });
      const names = infos.map((i, n) => i?.name ?? `file ${n + 1}`);
      if (infos.some((i) => i === null)) { result.rejected.push({ names, reason: 'A file is no longer available. Add it again.' }); continue; }
      const ok = infos as NonNullable<(typeof infos)[number]>[];
      if (ok.length > 1 && ok.some((i) => i.mime === 'application/pdf')) {
        result.rejected.push({ names, reason: 'A PDF is kept as its own receipt. Add it separately from the images.' });
        continue;
      }
      let pageCounts: number[] = [];
      let readable = true;
      let infraNote: string | null = null;
      try {
        const checks = await Promise.all(ok.map((i) => this.ocr.run('inspect', { path: i.path, mime: i.mime })));
        pageCounts = checks.map((c) => c.pages);
      } catch (e) {
        if (e instanceof OcrFileError && e.code !== 'failed' && e.code !== 'timeout') {
          result.rejected.push({ names, reason: e.message });
          for (const id of group) this.files.discardStaged(id);
          continue;
        }
        // The reader itself is unavailable: keep the receipt so it can still be entered by hand.
        readable = false;
        infraNote = 'Automatic reading is not available right now. Enter the details by hand.';
        pageCounts = ok.map(() => 1);
      }
      const promoted: StoredFile[] = [];
      try {
        for (const id of group) promoted.push(this.files.promote(id));
        const draftId = this.db.transaction(() => {
          const id = this.repo.insertDraft({ companyId, propertyId, token: crypto.randomUUID(), pageCount: pageCounts.reduce((a, b) => a + b, 0) }, this.now());
          promoted.forEach((f, i) => this.repo.insertFile(id, i, { ...f, pages: pageCounts[i] ?? 1 }));
          if (!readable) this.repo.update(id, { status: 'failed', error_message: infraNote }, this.now());
          return id;
        })();
        for (const id of group) this.files.discardStaged(id);
        result.created.push(this.toDto(this.repo.get(draftId)!));
        if (readable) this.enqueue(draftId);
      } catch (err) {
        for (const f of promoted) this.files.remove(f.storedName);
        const msg = err instanceof AppError ? err.message : 'This receipt could not be added.';
        result.rejected.push({ names, reason: msg });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- reading queue

  private enqueue(id: number): void {
    if (this.queue.includes(id) || this.aborts.has(id)) return;
    this.queue.push(id);
    this.repo.update(id, { status: 'queued', error_message: null }, this.now());
    this.emit(id);
    this.pump();
  }

  private pump(): void {
    while (!this.stopped && this.running < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.running += 1;
      void this.read(id).finally(() => {
        this.running -= 1;
        this.pump();
        if (this.running === 0 && this.queue.length === 0) { for (const r of this.idle.splice(0)) r(); }
      });
    }
  }

  private async read(id: number, opts: { overwrite?: boolean } = {}): Promise<void> {
    const row = this.repo.get(id);
    if (!row || row.status === 'saved' || row.status === 'skipped') return;
    const files = this.repo.files(id);
    const ac = new AbortController();
    this.aborts.set(id, ac);
    this.repo.update(id, { status: 'processing' }, this.now());
    this.progress.set(id, { page: 0, pages: row.page_count });
    this.emit(id);
    try {
      const r = await this.ocr.run('recognize', {
        files: files.map((f) => ({ path: this.files.pathOf(f.stored_name), mime: f.mime, name: f.original_name })),
      }, {
        signal: ac.signal,
        onProgress: (p) => {
          if (p.stage === 'reading') { this.progress.set(id, { page: p.page ?? 0, pages: p.pages ?? row.page_count }); this.emit(id); }
        },
      });
      const fresh = this.repo.get(id);
      if (!fresh || fresh.status === 'skipped') return;
      this.applyReading(fresh, r.text, { confidence: r.confidence, notes: r.notes }, opts.overwrite === true);
    } catch (e) {
      if (this.stopped) return; // the database is being replaced; leave the draft as it is
      const cancelled = e instanceof OcrFileError && e.code === 'cancelled';
      const msg = e instanceof OcrFileError ? e.message : 'This receipt could not be read.';
      this.repo.update(id, cancelled
        ? { status: 'needs_review', error_message: 'Reading was cancelled. Enter the details by hand, or try reading again.' }
        : { status: 'failed', error_message: `${msg} Enter the details by hand, or try again.` }, this.now());
    } finally {
      this.aborts.delete(id);
      this.progress.delete(id);
      if (!this.stopped) this.emit(id);
    }
  }

  /** Turns recognized text into suggestions, filling only fields the person has not touched (unless told to overwrite). */
  private applyReading(row: DraftRow, text: string, meta: { confidence: number | null; notes: string[] }, overwrite: boolean): void {
    const knownVendors = this.expRepo.suggestVendors(row.company_id, '', 500);
    const parsed = parseReceiptText(text, { today: this.today(), knownVendors });
    const category = this.suggestCategory(row.company_id, parsed.vendor?.value ?? '', text);
    const touched = new Set<string>(JSON.parse(row.touched) as string[]);
    if (overwrite) touched.clear();
    const patch: Record<string, string | number | null> = {
      status: 'needs_review', error_message: null, ocr_text: text, ocr_confidence: meta.confidence, ocr_notes: JSON.stringify(meta.notes),
      suggestions: JSON.stringify({ parsed, category } satisfies Suggestions), touched: JSON.stringify([...touched]),
    };
    if (!touched.has('vendor') && parsed.vendor) patch.vendor = parsed.vendor.value;
    if (!touched.has('expenseDate') && parsed.date) patch.expense_date = parsed.date.iso;
    if (!touched.has('totalCents') && parsed.total) patch.total_cents = parsed.total.cents;
    if (!touched.has('category') && !row.split && category) patch.category_id = category.categoryId;
    this.repo.update(row.id, patch, this.now());
  }

  /** Vendor rule first (exact vendor key), then a keyword hint, otherwise nothing: "Select category". */
  private suggestCategory(companyId: number, vendor: string, text: string): DraftSuggestion['category'] {
    const active = this.cats.list(companyId, false);
    const key = vendor ? vendorKey(vendor) : '';
    const rule = key ? this.repo.ruleFor(companyId, key) : undefined;
    if (rule) {
      const c = active.find((x) => x.id === rule.category_id);
      if (c) return { categoryId: c.id, name: c.name, source: 'rule', detail: 'Based on your vendor rule' };
    }
    const head = text.split(/\r?\n/).slice(0, 8).join(' ');
    const hit = keywordCategory(`${vendor} ${head}`);
    if (hit) {
      const c = active.find((x) => x.name.toLowerCase() === hit.category.toLowerCase());
      if (c) return { categoryId: c.id, name: c.name, source: 'keyword', detail: `Suggested from the word "${hit.word}"` };
    }
    return null;
  }

  retry(id: number, overwriteEdited: boolean): ReceiptDraft {
    const row = this.mustGet(id);
    if (row.status === 'saved') throw new AppError('CONFLICT', 'This receipt was already saved.');
    if (row.status === 'processing' || row.status === 'queued') return this.toDto(row);
    if (overwriteEdited) {
      // Clearing the touched list is the person's explicit consent to replace their edits.
      this.repo.update(id, { touched: '[]' }, this.now());
    }
    this.repo.update(id, { status: 'queued', error_message: null }, this.now());
    this.queue.push(id);
    this.emit(id);
    this.pump();
    return this.toDto(this.repo.get(id)!);
  }

  cancel(id: number): void {
    const qi = this.queue.indexOf(id);
    if (qi >= 0) {
      this.queue.splice(qi, 1);
      this.repo.update(id, { status: 'needs_review', error_message: 'Reading was cancelled. Enter the details by hand, or try reading again.' }, this.now());
      this.emit(id);
      return;
    }
    this.aborts.get(id)?.abort();
  }

  // ---------------------------------------------------------------- drafts

  list(query: DraftQuery): ReceiptDraft[] {
    const q = draftQuerySchema.parse(query);
    return this.repo.list(q.scope, q.includeSaved).map((r) => this.toDto(r));
  }

  get(id: number): ReceiptDraftDetail {
    const row = this.mustGet(id);
    return { ...this.toDto(row), ocrText: row.ocr_text ?? '' };
  }

  update(id: number, patch: DraftPatch): ReceiptDraft {
    const row = this.mustGet(id);
    this.assertOpen(row);
    const p = patch;
    const touched = new Set<string>(JSON.parse(row.touched) as string[]);
    const w: Record<string, string | number | null> = {};
    if (p.vendor !== undefined) { w.vendor = p.vendor.trim() || null; touched.add('vendor'); }
    if (p.expenseDate !== undefined) {
      if (p.expenseDate !== null && !isValidIsoDate(p.expenseDate)) throw new AppError('VALIDATION', 'Enter a valid date.', { expenseDate: 'Enter a valid date.' });
      w.expense_date = p.expenseDate; touched.add('expenseDate');
    }
    if (p.totalCents !== undefined) { w.total_cents = p.totalCents; touched.add('totalCents'); }
    if (p.notes !== undefined) w.notes = p.notes.trim() || null;
    if (p.propertyId !== undefined) {
      if (p.propertyId !== null) {
        const prop = this.props.get(p.propertyId);
        if (!prop) throw new AppError('NOT_FOUND', 'That property no longer exists.');
        if (prop.companyId !== row.company_id) throw new AppError('VALIDATION', 'That property belongs to a different company.', { propertyId: 'Choose a property from this company.' });
        if (prop.isArchived) throw new AppError('ARCHIVED', 'That property is archived.', { propertyId: 'That property is archived.' });
      }
      w.property_id = p.propertyId;
    }
    if (p.categoryId !== undefined) {
      if (p.categoryId !== null) this.assertCategory(row.company_id, p.categoryId);
      w.category_id = p.categoryId; touched.add('category');
    }
    if (p.split !== undefined) { w.split = p.split ? 1 : 0; touched.add('category'); }
    if (p.allocations !== undefined) {
      for (const a of p.allocations) this.assertCategory(row.company_id, a.categoryId);
      w.allocations = JSON.stringify(p.allocations); touched.add('category');
    }
    if (p.rememberVendor !== undefined) w.remember_vendor = p.rememberVendor ? 1 : 0;
    if (p.duplicateOverride !== undefined) w.duplicate_override = p.duplicateOverride ? 1 : 0;
    w.touched = JSON.stringify([...touched]);
    // Any edit after review means the person should look again.
    if (row.status === 'reviewed') w.status = 'needs_review';
    this.repo.update(id, w, this.now());
    this.emit(id);
    return this.toDto(this.repo.get(id)!);
  }

  markReviewed(id: number, reviewed: boolean): ReceiptDraft {
    const row = this.mustGet(id);
    this.assertOpen(row);
    if (!reviewed) {
      if (row.status === 'reviewed') this.repo.update(id, { status: 'needs_review' }, this.now());
    } else {
      this.validateForPosting(row);
      this.repo.update(id, { status: 'reviewed' }, this.now());
    }
    this.emit(id);
    return this.toDto(this.repo.get(id)!);
  }

  skip(id: number): ReceiptDraft {
    const row = this.mustGet(id);
    if (row.status === 'saved') throw new AppError('CONFLICT', 'This receipt was already saved.');
    this.cancel(id);
    this.repo.update(id, { status: 'skipped' }, this.now());
    this.emit(id);
    return this.toDto(this.repo.get(id)!);
  }

  unskip(id: number): ReceiptDraft {
    const row = this.mustGet(id);
    if (row.status === 'skipped') this.repo.update(id, { status: row.suggestions ? 'needs_review' : 'failed' }, this.now());
    this.emit(id);
    return this.toDto(this.repo.get(id)!);
  }

  /** Removes an unsaved receipt and its stored files. A saved receipt belongs to its expense and cannot be removed here. */
  remove(id: number): void {
    const row = this.mustGet(id);
    if (row.status === 'saved') throw new AppError('CONFLICT', 'This receipt was saved as an expense. Void the expense instead.');
    this.cancel(id);
    const files = this.repo.files(id);
    this.db.transaction(() => { this.repo.deleteFiles(id); this.repo.deleteDraft(id); })();
    for (const f of files) this.files.remove(f.stored_name);
  }

  // ---------------------------------------------------------------- posting

  /**
   * Saves one reviewed draft as an expense. Safe to call again: the draft's posting token makes the
   * expense idempotent, and a saved draft simply returns the expense it already produced.
   */
  post(id: number): Expense {
    const row = this.mustGet(id);
    if (row.status === 'saved' && row.posted_expense_id !== null) return this.expenses.get(row.posted_expense_id);
    if (row.status === 'queued' || row.status === 'processing') throw new AppError('CONFLICT', 'This receipt is still being read. Wait for it to finish, or cancel reading.');
    if (row.status === 'skipped') throw new AppError('CONFLICT', 'This receipt was skipped. Bring it back before saving.');
    const input = this.validateForPosting(row);
    const dup = this.duplicatesFor(row);
    if (dup.length > 0 && row.duplicate_override === 0) {
      throw new AppError('CONFLICT', `${dup[0]!.message} Confirm that this is a different purchase to save it anyway.`, { duplicateOverride: 'Confirm this is a different purchase.' });
    }
    const files = this.repo.files(id);
    const stored: StoredFile[] = files.map((f) => ({ storedName: f.stored_name, originalName: f.original_name, sha256: f.sha256, sizeBytes: f.size_bytes, mime: f.mime }));
    const expense = this.expenses.createFromStored(
      { ...input, idempotencyKey: `draft-${row.posting_token}` },
      stored,
      (expenseId, now) => {
        // Same transaction as the expense: the draft becomes saved, owns no files, and the optional rule is created.
        this.repo.deleteFiles(id);
        this.repo.update(id, { status: 'saved', posted_expense_id: expenseId, error_message: null }, now);
        if (row.remember_vendor === 1 && !row.split && input.allocations.length === 1 && input.vendorName) {
          this.repo.upsertRule(row.company_id, vendorKey(input.vendorName), input.vendorName, input.allocations[0]!.categoryId, now);
        }
      },
    );
    this.emit(id);
    return expense;
  }

  /** Saves every draft the person marked Reviewed. Failures are reported one by one and can be retried safely. */
  postReviewed(scope: number | 'all'): PostAllResult {
    const result: PostAllResult = { saved: [], failed: [], skipped: 0 };
    for (const row of this.repo.list(scope, false)) {
      if (row.status !== 'reviewed') { result.skipped += 1; continue; }
      try {
        const e = this.post(row.id);
        result.saved.push({ draftId: row.id, expenseId: e.id });
      } catch (err) {
        const name = this.repo.files(row.id)[0]?.original_name ?? `Receipt ${row.id}`;
        const detail = err instanceof AppError ? Object.values(err.fields ?? {})[0] ?? err.message : 'This receipt could not be saved.';
        result.failed.push({ draftId: row.id, name, message: detail });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- previews

  /** One page of a draft as a PNG data URL. Pages are numbered across all of the draft's files. */
  async preview(id: number, page: number): Promise<{ dataUrl: string; pageCount: number }> {
    const row = this.mustGet(id);
    const files = this.repo.files(id);
    let remaining = Math.max(1, page);
    for (const f of files) {
      if (remaining <= f.pages) {
        const r = await this.ocr.run('preview', { path: this.files.pathOf(f.stored_name), mime: f.mime, page: remaining, maxWidth: 1100 });
        return { dataUrl: `data:image/png;base64,${Buffer.from(r.png).toString('base64')}`, pageCount: row.page_count };
      }
      remaining -= f.pages;
    }
    throw new AppError('NOT_FOUND', 'That page does not exist.');
  }

  // ---------------------------------------------------------------- vendor rules (explicit only)

  rules(companyId: number): VendorRule[] {
    return this.repo.rules(companyId).map((r) => ({ id: r.id, companyId: r.company_id, vendorName: r.vendor_name, categoryId: r.category_id, categoryName: r.category_name }));
  }

  createRule(companyId: number, vendorName: string, categoryId: number): VendorRule[] {
    this.companies.requireActive(companyId);
    const name = vendorName.trim();
    if (!name || vendorKey(name) === '') throw new AppError('VALIDATION', 'Enter the vendor name.', { vendorName: 'Enter the vendor name.' });
    this.assertCategory(companyId, categoryId);
    this.repo.upsertRule(companyId, vendorKey(name), name, categoryId, this.now());
    return this.rules(companyId);
  }

  deleteRule(id: number): void {
    const company = this.repo.ruleCompany(id);
    if (company === undefined) throw new AppError('NOT_FOUND', 'That rule no longer exists.');
    this.repo.deleteRule(id);
  }

  // ---------------------------------------------------------------- helpers

  private mustGet(id: number): DraftRow {
    const r = this.repo.get(id);
    if (!r) throw new AppError('NOT_FOUND', 'That receipt no longer exists.');
    return r;
  }

  private assertOpen(row: DraftRow): void {
    if (row.status === 'saved') throw new AppError('CONFLICT', 'This receipt was already saved as an expense.');
  }

  private assertCategory(companyId: number, categoryId: number): void {
    const c = this.cats.get(categoryId);
    if (!c) throw new AppError('NOT_FOUND', 'That category no longer exists.');
    if (c.companyId !== companyId) throw new AppError('VALIDATION', 'That category belongs to a different company.');
    if (c.isArchived) throw new AppError('ARCHIVED', `"${c.name}" is archived. Choose another category.`);
  }

  /** Everything required to save, with messages keyed by field. Returns the expense input on success. */
  private validateForPosting(row: DraftRow): Omit<Parameters<ExpenseService['createFromStored']>[0], 'idempotencyKey'> & { idempotencyKey: string } {
    const e: Record<string, string> = {};
    const vendor = (row.vendor ?? '').trim();
    if (!vendor) e.vendor = 'Enter the vendor.';
    if (!row.expense_date) e.expenseDate = 'Enter the expense date.';
    if (row.total_cents === null) e.totalCents = 'Enter the total.';
    let allocations: { categoryId: number; amountCents: number }[] = [];
    if (row.split === 1) {
      allocations = row.allocations ? (JSON.parse(row.allocations) as typeof allocations) : [];
      const sum = allocations.reduce((a, l) => a + l.amountCents, 0);
      if (allocations.length < 2) e.allocations = 'Add at least two categories to split, or turn the split off.';
      else if (row.total_cents !== null && sum !== row.total_cents) e.allocations = `The category amounts add up to ${formatCents(sum)}, not ${formatCents(row.total_cents)}.`;
    } else if (row.category_id === null) e.category = 'Choose a category.';
    else if (row.total_cents !== null) allocations = [{ categoryId: row.category_id, amountCents: row.total_cents }];
    if (Object.keys(e).length) throw new AppError('VALIDATION', 'Please complete the highlighted fields.', e);
    return {
      companyId: row.company_id, propertyId: row.property_id, vendorName: vendor, expenseDate: row.expense_date!, totalCents: row.total_cents!,
      allocations, notes: row.notes ?? '', idempotencyKey: '',
    };
  }

  /** Warnings only; the person can always override because genuine purchases can look alike. */
  private duplicatesFor(row: DraftRow): DraftDuplicate[] {
    const out: DraftDuplicate[] = [];
    for (const f of this.repo.files(row.id)) {
      for (const e of this.repo.expensesWithHash(row.company_id, f.sha256)) {
        out.push({ kind: 'same_file', expenseId: e.id, message: `This exact file is already saved with the expense for ${e.vendor} on ${formatUsDate(e.date)} (${formatCents(e.total)}).` });
      }
      for (const d of this.repo.otherDraftsWithHash(row.company_id, f.sha256, row.id)) {
        out.push({ kind: 'same_file', draftId: d.id, message: 'This exact file is also in your review queue.' });
      }
    }
    if (row.vendor && row.expense_date && row.total_cents !== null) {
      const key = vendorKey(row.vendor);
      for (const m of this.repo.possibleExpenseMatches(row.company_id, row.expense_date, row.total_cents)) {
        if (vendorKey(m.vendor) === key && !out.some((o) => o.expenseId === m.id)) {
          out.push({ kind: 'possible', expenseId: m.id, message: `An expense for ${m.vendor} on ${formatUsDate(row.expense_date)} for ${formatCents(row.total_cents)} is already saved.` });
        }
      }
    }
    return out;
  }

  private toDto(r: DraftRow): ReceiptDraft {
    const files: DraftFileRow[] = this.repo.files(r.id);
    const sug = r.suggestions ? (JSON.parse(r.suggestions) as Suggestions) : null;
    const company = this.companies.get(r.company_id);
    const property = r.property_id ? this.props.get(r.property_id) : undefined;
    return {
      id: r.id, companyId: r.company_id, companyName: company.displayName, propertyId: r.property_id, propertyAddress: property?.address1 ?? null,
      status: r.status, errorMessage: r.error_message, vendor: r.vendor ?? '', expenseDate: r.expense_date, totalCents: r.total_cents,
      categoryId: r.category_id, split: r.split === 1, allocations: r.allocations ? (JSON.parse(r.allocations) as ReceiptDraft['allocations']) : [],
      notes: r.notes ?? '', rememberVendor: r.remember_vendor === 1, duplicateOverride: r.duplicate_override === 1,
      touched: JSON.parse(r.touched) as string[],
      suggestion: sug
        ? {
            vendor: sug.parsed.vendor ? { candidates: sug.parsed.vendor.candidates, matchedKnown: sug.parsed.vendor.matchedKnown } : null,
            date: sug.parsed.date ? { candidates: sug.parsed.date.candidates, ambiguous: sug.parsed.date.ambiguous } : null,
            total: sug.parsed.total ? { candidates: sug.parsed.total.candidates, ambiguous: sug.parsed.total.ambiguous, labeled: sug.parsed.total.labeled, label: sug.parsed.total.label } : null,
            category: sug.category,
          }
        : null,
      files: files.map((f) => ({ id: f.id, name: f.original_name, mime: f.mime, sizeBytes: f.size_bytes, pages: f.pages })),
      pageCount: r.page_count, ocrConfidence: r.ocr_confidence, ocrNotes: r.ocr_notes ? (JSON.parse(r.ocr_notes) as string[]) : [],
      duplicates: r.status === 'saved' ? [] : this.duplicatesFor(r),
      postedExpenseId: r.posted_expense_id, progress: this.progress.get(r.id) ?? null, createdAt: r.created_at,
    };
  }

  private emit(id: number): void {
    const r = this.repo.get(id);
    if (!r) return;
    const e: ReceiptEvent = { draftId: id, status: r.status as DraftStatus, progress: this.progress.get(id) ?? null };
    for (const l of this.listeners) l(e);
  }

  /** Unused-file sweep helper for diagnostics: stored files no draft or attachment refers to. */
  orphanedFiles(receiptsDir: string): string[] {
    const known = new Set<string>([
      ...(this.db.prepare('SELECT stored_name AS n FROM receipt_draft_file').all() as { n: string }[]).map((x) => x.n),
      ...(this.db.prepare('SELECT stored_name AS n FROM expense_attachment').all() as { n: string }[]).map((x) => x.n),
    ]);
    return fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir).filter((f) => !known.has(f)) : [];
  }
}

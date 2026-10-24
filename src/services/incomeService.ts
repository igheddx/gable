import type { Db } from '../db/connection';
import { IncomeRepository } from '../db/incomeRepository';
import { PropertyRepository } from '../db/propertyRepository';
import { AppError } from '../shared/errors';
import { isValidIsoDate } from '../shared/dates';
import { INCOME_CATEGORIES, TEMPLATE_INFO } from '../shared/businessTypes';
import type { IncomeInput, IncomeQuery, IncomeUpdate } from '../shared/schemas';
import type { Income, IncomePage, Property } from '../shared/types';
import type { CompanyService } from './companyService';

/**
 * Money received by a rental or an ongoing business. Like expenses, income entries are voided, never deleted,
 * and saving twice with the same key can only ever create one entry.
 */
export class IncomeService {
  private readonly repo: IncomeRepository;
  private readonly props: PropertyRepository;

  constructor(private readonly db: Db, private readonly companies: CompanyService, private readonly now: () => string = () => new Date().toISOString()) {
    this.repo = new IncomeRepository(db);
    this.props = new PropertyRepository(db);
  }

  list(query: IncomeQuery): IncomePage {
    return this.repo.list(query);
  }

  get(id: number): Income {
    return this.mustGet(id);
  }

  create(input: IncomeInput): Income {
    const existing = this.repo.findByKey(input.idempotencyKey);
    if (existing !== undefined) return this.mustGet(existing);
    this.companies.requireActive(input.companyId);
    const prop = this.checkItem(input.companyId, input.propertyId);
    const c = this.check(prop, input);
    try {
      const id = this.repo.insert({ companyId: input.companyId, propertyId: input.propertyId, date: c.date, amountCents: c.amountCents, category: c.category, notes: c.notes, key: input.idempotencyKey }, this.now());
      return this.mustGet(id);
    } catch (err) {
      const raced = this.repo.findByKey(input.idempotencyKey);
      if (raced !== undefined) return this.mustGet(raced);
      throw this.friendly(err);
    }
  }

  update(id: number, input: IncomeUpdate): Income {
    const before = this.mustGet(id);
    this.companies.requireActive(before.companyId);
    if (before.status === 'voided') throw new AppError('CONFLICT', 'This income entry is voided. Restore it before editing.');
    const prop = this.props.get(before.propertyId)!;
    const c = this.check(prop, input);
    this.repo.update(id, c, this.now());
    return this.mustGet(id);
  }

  void(id: number): Income {
    const i = this.mustGet(id);
    this.companies.requireActive(i.companyId);
    if (i.status === 'voided') return i;
    this.repo.setStatus(id, 'voided', this.now());
    return this.mustGet(id);
  }

  unvoid(id: number): Income {
    const i = this.mustGet(id);
    this.companies.requireActive(i.companyId);
    if (i.status === 'posted') return i;
    this.repo.setStatus(id, 'posted', this.now());
    return this.mustGet(id);
  }

  private mustGet(id: number): Income {
    const i = this.repo.get(id);
    if (!i) throw new AppError('NOT_FOUND', 'That income entry no longer exists.');
    return i;
  }

  private checkItem(companyId: number, propertyId: number): Property {
    const p = this.props.get(propertyId);
    if (!p) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', { propertyId: 'That item no longer exists.' });
    if (p.companyId !== companyId) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', { propertyId: 'That item belongs to a different company.' });
    if (p.isArchived) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', { propertyId: 'That item is archived. Restore it before adding income.' });
    if (!TEMPLATE_INFO[p.template].tracksIncome) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', { propertyId: `${p.businessTypeName} items do not take income.` });
    return p;
  }

  private check(prop: Property, i: IncomeUpdate): { date: string; amountCents: number; category: string; notes: string | null } {
    const e: Record<string, string> = {};
    if (!isValidIsoDate(i.incomeDate)) e.incomeDate = 'Enter a valid date.';
    const allowed = INCOME_CATEGORIES[prop.template] ?? [];
    if (!allowed.includes(i.category)) e.category = 'Choose a type of income.';
    if (Object.keys(e).length) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', e);
    return { date: i.incomeDate, amountCents: i.amountCents, category: i.category, notes: i.notes.trim() === '' ? null : i.notes.trim() };
  }

  private friendly(err: unknown): unknown {
    if (err instanceof AppError) return err;
    const msg = err instanceof Error ? err.message : '';
    if (/archived/.test(msg)) return new AppError('ARCHIVED', 'That company or item is archived. Restore it first.');
    if (/different company/.test(msg)) return new AppError('VALIDATION', 'That item belongs to a different company.');
    return err;
  }
}

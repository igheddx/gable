import type { Db } from '../db/connection';
import { PropertyRepository } from '../db/propertyRepository';
import { AppError } from '../shared/errors';
import { isValidIsoDate } from '../shared/dates';
import { normalizeSearch } from '../shared/search';
import type { PropertyFields, PropertyQuery } from '../shared/schemas';
import type { Property, PropertyPage } from '../shared/types';
import type { CompanyService } from './companyService';

export class PropertyService {
  private readonly repo: PropertyRepository;

  constructor(
    private readonly db: Db,
    private readonly companies: CompanyService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.repo = new PropertyRepository(db);
  }

  list(query: PropertyQuery): PropertyPage {
    if (query.scope !== 'all' && !Number.isInteger(query.scope)) throw new AppError('VALIDATION', 'Choose a company.');
    return this.repo.list(query);
  }

  get(id: number): Property {
    return this.mustGet(id);
  }

  /** Every property belongs to exactly one company, chosen here and never changed afterwards. */
  create(companyId: number, fields: PropertyFields): Property {
    this.companies.requireActive(companyId);
    const clean = this.validate(fields);
    const id = this.repo.insert(companyId, clean, this.searchText(clean), this.now());
    return this.mustGet(id);
  }

  /**
   * Updates facts about a property. The company is not an input and cannot change.
   * Moving a Sold property back to another status clears its sale and must be confirmed.
   */
  update(id: number, fields: PropertyFields, opts: { confirmReopenSale?: boolean } = {}): Property {
    const existing = this.mustGet(id);
    this.assertEditable(existing);
    const clean = this.validate(fields);
    if (existing.status === 'Sold' && clean.status !== 'Sold' && !opts.confirmReopenSale) {
      throw new AppError('CONFLICT', 'This property is marked Sold. Reopening it removes the sale date and price. Confirm to continue.', { status: 'Confirm reopening the sale.' });
    }
    this.repo.update(id, clean, this.searchText(clean), this.now());
    return this.mustGet(id);
  }

  archive(id: number): Property {
    this.mustGet(id);
    this.repo.setArchived(id, true, this.now());
    return this.mustGet(id);
  }

  restore(id: number): Property {
    const p = this.mustGet(id);
    if (p.companyArchived) throw new AppError('ARCHIVED', `${p.companyName} is archived. Restore the company first.`);
    this.repo.setArchived(id, false, this.now());
    return this.mustGet(id);
  }

  private mustGet(id: number): Property {
    const p = this.repo.get(id);
    if (!p) throw new AppError('NOT_FOUND', 'That property no longer exists.');
    return p;
  }

  private assertEditable(p: Property): void {
    if (p.isArchived) throw new AppError('ARCHIVED', 'This property is archived. Restore it before making changes.');
    if (p.companyArchived) throw new AppError('ARCHIVED', `${p.companyName} is archived. Restore it before making changes.`);
  }

  private searchText(f: PropertyFields): string {
    return normalizeSearch([f.address1, f.address2, f.city, f.state, f.zip].join(' '));
  }

  private validate(f: PropertyFields): PropertyFields {
    const e: Record<string, string> = {};
    const state = f.state.trim().toUpperCase();
    if (f.address1.trim() === '') e.address1 = 'Enter the street address.';
    if (f.city.trim() === '') e.city = 'Enter the city.';
    if (!/^[A-Z]{2}$/.test(state)) e.state = 'Use the 2-letter state code, like TN.';
    if (!/^\d{5}(-\d{4})?$/.test(f.zip.trim())) e.zip = 'Enter a ZIP code like 37201.';
    if (!isValidIsoDate(f.purchaseDate)) e.purchaseDate = 'Enter a valid purchase date.';
    if (f.status === 'Sold') {
      if (f.saleDate === null || !isValidIsoDate(f.saleDate)) e.saleDate = 'Enter the sale date.';
      if (f.salePriceCents === null) e.salePriceCents = 'Enter the sale price.';
      if (f.saleDate && isValidIsoDate(f.saleDate) && isValidIsoDate(f.purchaseDate) && f.saleDate < f.purchaseDate) {
        e.saleDate = 'The sale date cannot be before the purchase date.';
      }
    } else if (f.saleDate !== null || f.salePriceCents !== null) {
      e.status = 'Only a Sold property can have a sale date or price. Change the status to Sold, or clear the sale.';
    }
    if (Object.keys(e).length) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', e);
    return { ...f, address1: f.address1.trim(), address2: f.address2.trim(), city: f.city.trim(), state, zip: f.zip.trim(), description: f.description.trim(), notes: f.notes.trim() };
  }
}

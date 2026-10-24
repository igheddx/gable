import type { Db } from '../db/connection';
import { PropertyRepository } from '../db/propertyRepository';
import { AppError } from '../shared/errors';
import { isValidIsoDate } from '../shared/dates';
import { normalizeSearch } from '../shared/search';
import type { PropertyFields, PropertyQuery } from '../shared/schemas';
import type { Property, PropertyPage } from '../shared/types';
import { TEMPLATE_INFO, statusesFor, type BusinessType } from '../shared/businessTypes';
import { BusinessTypeService } from './businessTypeService';
import type { CompanyService } from './companyService';

export class PropertyService {
  private readonly repo: PropertyRepository;

  constructor(
    private readonly db: Db,
    private readonly companies: CompanyService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.repo = new PropertyRepository(db);
    this.types = new BusinessTypeService(db, now);
  }

  private readonly types: BusinessTypeService;

  list(query: PropertyQuery): PropertyPage {
    if (query.scope !== 'all' && !Number.isInteger(query.scope)) throw new AppError('VALIDATION', 'Choose a company.');
    return this.repo.list(query);
  }

  get(id: number): Property {
    return this.mustGet(id);
  }

  /**
   * Every item belongs to exactly one company and one business type, chosen here and never changed afterwards.
   * Omitting the business type creates a renovation, the original kind of item.
   */
  create(companyId: number, fields: PropertyFields): Property {
    this.companies.requireActive(companyId);
    const type = this.types.requireUsable(fields.businessTypeId ?? 1);
    const clean = this.validate(fields, type);
    const id = this.repo.insert(companyId, clean, this.searchText(clean, type), this.now());
    return this.mustGet(id);
  }

  /**
   * Updates facts about a property. The company is not an input and cannot change.
   * Moving a Sold property back to another status clears its sale and must be confirmed.
   */
  update(id: number, fields: PropertyFields, opts: { confirmReopenSale?: boolean } = {}): Property {
    const existing = this.mustGet(id);
    this.assertEditable(existing);
    if (fields.businessTypeId !== undefined && fields.businessTypeId !== existing.businessTypeId) {
      throw new AppError('VALIDATION', 'The business type of an existing item cannot be changed.');
    }
    const type = this.types.get(existing.businessTypeId);
    const clean = this.validate(fields, type);
    if (existing.status === 'Sold' && clean.status !== 'Sold' && !opts.confirmReopenSale) {
      throw new AppError('CONFLICT', 'This property is marked Sold. Reopening it removes the sale date and price. Confirm to continue.', { status: 'Confirm reopening the sale.' });
    }
    this.repo.update(id, clean, this.searchText(clean, type), this.now());
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

  private searchText(f: PropertyFields, type: BusinessType): string {
    return normalizeSearch([f.address1, f.address2, f.city, f.state, f.zip, f.identifier ?? '', type.name].join(' '));
  }

  private validate(f: PropertyFields, type: BusinessType): PropertyFields {
    const info = TEMPLATE_INFO[type.template];
    const e: Record<string, string> = {};
    const name = f.address1.trim();
    let address2 = f.address2.trim();
    let city = f.city.trim();
    let state = f.state.trim().toUpperCase();
    let zip = f.zip.trim();
    if (info.hasAddress) {
      if (name === '') e.address1 = 'Enter the street address.';
      if (city === '') e.city = 'Enter the city.';
      if (!/^[A-Z]{2}$/.test(state)) e.state = 'Choose a state.';
      if (!/^\d{5}(-\d{4})?$/.test(zip)) e.zip = 'Enter a ZIP code like 37201.';
    } else {
      if (name === '') e.address1 = 'Enter a name.';
      address2 = ''; city = ''; state = ''; zip = '';
    }
    const identifier = info.identifierLabel ? (f.identifier ?? '').trim() : '';

    let purchaseDate = f.purchaseDate;
    let purchasePriceCents = f.purchasePriceCents;
    if (info.purchase === 'none') {
      purchaseDate = null; purchasePriceCents = null;
    } else {
      const dateOk = purchaseDate !== null && isValidIsoDate(purchaseDate);
      if (info.purchase === 'required') {
        if (!dateOk) e.purchaseDate = 'Enter a valid purchase date.';
        if (purchasePriceCents === null) e.purchasePriceCents = 'Enter the purchase price.';
      } else if (purchaseDate !== null || purchasePriceCents !== null) {
        if (!dateOk) e.purchaseDate = 'Enter the purchase date, or clear the price.';
        if (purchasePriceCents === null) e.purchasePriceCents = 'Enter the purchase price, or clear the date.';
      }
    }

    if (!statusesFor(type.template).includes(f.status)) e.status = `${f.status} is not a status for this kind of item.`;
    else if (f.status === 'Sold') {
      if (f.saleDate === null || !isValidIsoDate(f.saleDate)) e.saleDate = 'Enter the sale date.';
      if (f.salePriceCents === null) e.salePriceCents = 'Enter the sale price.';
      if (f.saleDate && isValidIsoDate(f.saleDate) && purchaseDate && isValidIsoDate(purchaseDate) && f.saleDate < purchaseDate) {
        e.saleDate = 'The sale date cannot be before the purchase date.';
      }
    } else if (f.saleDate !== null || f.salePriceCents !== null) {
      e.status = 'Only a Sold item can have a sale date or price. Change the status to Sold, or clear the sale.';
    }
    if (Object.keys(e).length) throw new AppError('VALIDATION', 'Please fix the highlighted fields.', e);
    return {
      ...f, businessTypeId: type.id, address1: name, address2, city, state, zip, identifier, purchaseDate, purchasePriceCents,
      description: f.description.trim(), notes: f.notes.trim(),
    };
  }
}

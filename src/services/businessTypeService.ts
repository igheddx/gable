import type { Db } from '../db/connection';
import { BusinessTypeRepository } from '../db/businessTypeRepository';
import { AppError } from '../shared/errors';
import { normalizeSearch } from '../shared/search';
import type { BusinessType } from '../shared/businessTypes';
import type { BusinessTypeInput } from '../shared/schemas';

/**
 * The kinds of business Gable tracks. Renovation, Rental and Vehicle are built in and permanent. A person can add
 * their own (a name plus one of two templates) and archive or rename those. A type never changes its template.
 */
export class BusinessTypeService {
  private readonly repo: BusinessTypeRepository;

  constructor(db: Db, private readonly now: () => string = () => new Date().toISOString()) {
    this.repo = new BusinessTypeRepository(db);
  }

  list(includeArchived = false): BusinessType[] {
    return this.repo.list(includeArchived);
  }

  get(id: number): BusinessType {
    const t = this.repo.get(id);
    if (!t) throw new AppError('NOT_FOUND', 'That business type no longer exists.');
    return t;
  }

  /** A type that new items can be created under. */
  requireUsable(id: number): BusinessType {
    const t = this.get(id);
    if (t.isArchived) throw new AppError('ARCHIVED', `${t.name} is archived. Restore it in Settings before adding new items.`);
    return t;
  }

  create(input: BusinessTypeInput): BusinessType {
    const name = this.cleanName(input.name, null);
    return this.get(this.repo.insert(name, normalizeSearch(name), input.template, this.now()));
  }

  rename(id: number, name: string): BusinessType {
    const t = this.mustBeCustom(id);
    const clean = this.cleanName(name, t.id);
    this.repo.rename(id, clean, normalizeSearch(clean), this.now());
    return this.get(id);
  }

  archive(id: number): BusinessType {
    this.mustBeCustom(id);
    this.repo.setArchived(id, true, this.now());
    return this.get(id);
  }

  restore(id: number): BusinessType {
    this.mustBeCustom(id);
    this.repo.setArchived(id, false, this.now());
    return this.get(id);
  }

  itemCount(id: number): number {
    return this.repo.itemCount(id);
  }

  private mustBeCustom(id: number): BusinessType {
    const t = this.get(id);
    if (t.isBuiltin) throw new AppError('CONFLICT', `${t.name} is built in and cannot be changed.`);
    return t;
  }

  private cleanName(name: string, selfId: number | null): string {
    const clean = name.trim();
    if (clean === '') throw new AppError('VALIDATION', 'Enter a name for the business type.', { name: 'Enter a name.' });
    const clash = this.repo.findByKey(normalizeSearch(clean));
    if (clash && clash.id !== selfId) throw new AppError('VALIDATION', `A business type named "${clash.name}" already exists.`, { name: `"${clash.name}" already exists.` });
    return clean;
  }
}

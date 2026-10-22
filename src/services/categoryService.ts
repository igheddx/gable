import type { Db } from '../db/connection';
import { CategoryRepository } from '../db/categoryRepository';
import { AppError } from '../shared/errors';
import { normalizeSearch } from '../shared/search';
import type { ReportingGroup } from '../shared/categories';
import type { Category } from '../shared/types';
import type { CompanyService } from './companyService';

/** Company-scoped categories. Renaming or archiving never changes a category's reporting group. */
export class CategoryService {
  private readonly repo: CategoryRepository;

  constructor(db: Db, private readonly companies: CompanyService, private readonly now: () => string = () => new Date().toISOString()) {
    this.repo = new CategoryRepository(db);
  }

  list(companyId: number, includeArchived = false): Category[] {
    return this.repo.list(companyId, includeArchived);
  }

  create(companyId: number, name: string, group: ReportingGroup): Category {
    this.companies.requireActive(companyId);
    const clean = this.cleanName(companyId, name, null);
    return this.mustGet(this.repo.insert(companyId, clean, group, this.now()));
  }

  rename(id: number, name: string): Category {
    const c = this.mustGet(id);
    this.companies.requireActive(c.companyId);
    this.repo.rename(id, this.cleanName(c.companyId, name, id), this.now());
    return this.mustGet(id);
  }

  /** Remapping changes how past and future expenses roll up in every report, so it must be confirmed. */
  setReportingGroup(id: number, group: ReportingGroup, confirmed: boolean): Category {
    const c = this.mustGet(id);
    this.companies.requireActive(c.companyId);
    if (c.reportingGroup === group) return c;
    if (!confirmed) {
      throw new AppError('CONFLICT', `Moving "${c.name}" to a different group changes how all of its expenses, past and future, appear in reports. Confirm to continue.`, { reportingGroup: 'Confirm the change.' });
    }
    this.repo.setGroup(id, group, this.now());
    return this.mustGet(id);
  }

  archive(id: number): Category {
    this.mustGet(id);
    this.repo.setArchived(id, true, this.now());
    return this.mustGet(id);
  }

  restore(id: number): Category {
    this.mustGet(id);
    this.repo.setArchived(id, false, this.now());
    return this.mustGet(id);
  }

  mustGet(id: number): Category {
    const c = this.repo.get(id);
    if (!c) throw new AppError('NOT_FOUND', 'That category no longer exists.');
    return c;
  }

  private cleanName(companyId: number, name: string, selfId: number | null): string {
    const clean = name.trim();
    if (clean === '') throw new AppError('VALIDATION', 'Enter a category name.', { name: 'Enter a category name.' });
    const clash = this.repo.findByKey(companyId, normalizeSearch(clean));
    if (clash && clash.id !== selfId) throw new AppError('VALIDATION', `A category named "${clash.name}" already exists.`, { name: `"${clash.name}" already exists.` });
    return clean;
  }
}

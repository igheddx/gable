import type { Db } from '../db/connection';
import { PropertyRepository } from '../db/propertyRepository';
import { AppError } from '../shared/errors';
import { REPORTING_GROUPS, type ReportingGroup } from '../shared/categories';
import { roiBasisPoints } from '../shared/money';
import { todayIso } from '../shared/dates';
import type { PropertyFinancials, YearItem, YearRow } from '../shared/types';

const emptyGroups = (): Record<ReportingGroup, number> =>
  Object.fromEntries(REPORTING_GROUPS.map((g) => [g, 0])) as Record<ReportingGroup, number>;

/**
 * One calculation layer for property money. Everything is integer cents and every query
 * counts allocation lines of posted (not voided) expenses exactly once, so the lifetime
 * bridge and the year-by-year view always reconcile.
 */
export class FinancialService {
  private readonly props: PropertyRepository;

  constructor(private readonly db: Db, private readonly today: () => string = () => todayIso()) {
    this.props = new PropertyRepository(db);
  }

  propertyFinancials(propertyId: number): PropertyFinancials {
    const p = this.props.get(propertyId);
    if (!p) throw new AppError('NOT_FOUND', 'That property no longer exists.');

    const lines = this.db
      .prepare(
        `SELECT substr(e.expense_date, 1, 4) AS year, c.id AS category_id, c.name AS name, c.reporting_group AS grp, SUM(a.amount_cents) AS cents
         FROM expense e
         JOIN expense_allocation a ON a.expense_id = e.id
         JOIN category c ON c.id = a.category_id
         WHERE e.property_id = ? AND e.status = 'posted'
         GROUP BY year, c.id`,
      )
      .all(propertyId) as { year: string; category_id: number; name: string; grp: ReportingGroup; cents: number }[];

    const items = this.db
      .prepare(
        `SELECT e.id, e.expense_date, v.name AS vendor, e.total_cents,
                (SELECT group_concat(c.name, ', ') FROM expense_allocation a JOIN category c ON c.id = a.category_id WHERE a.expense_id = e.id) AS categories,
                (SELECT COUNT(*) FROM expense_attachment t WHERE t.expense_id = e.id) AS attachments
         FROM expense e JOIN vendor v ON v.id = e.vendor_id
         WHERE e.property_id = ? AND e.status = 'posted'
         ORDER BY e.expense_date, e.id`,
      )
      .all(propertyId) as { id: number; expense_date: string; vendor: string; total_cents: number; categories: string; attachments: number }[];

    const lifetime = emptyGroups();
    for (const l of lines) lifetime[l.grp] += l.cents;
    const expensesCents = REPORTING_GROUPS.reduce((s, g) => s + lifetime[g], 0);

    const purchaseYear = Number(p.purchaseDate.slice(0, 4));
    const sold = p.status === 'Sold' && p.saleDate !== null && p.salePriceCents !== null;
    const saleYear = sold ? Number(p.saleDate!.slice(0, 4)) : null;
    const endYear = saleYear ?? Number(this.today().slice(0, 4));
    const activityYears = lines.map((l) => Number(l.year));
    const first = Math.min(purchaseYear, ...activityYears);
    const last = Math.max(purchaseYear, endYear, ...activityYears);

    const byYear: YearRow[] = [];
    for (let y = first; y <= last; y++) {
      const groups = emptyGroups();
      const cats = lines.filter((l) => Number(l.year) === y).map((l) => ({ categoryId: l.category_id, name: l.name, group: l.grp, cents: l.cents }));
      for (const c of cats) groups[c.group] += c.cents;
      const exp = REPORTING_GROUPS.reduce((s, g) => s + groups[g], 0);
      const purchaseCents = y === purchaseYear ? p.purchasePriceCents : 0;
      byYear.push({
        year: y,
        purchaseCents,
        groups,
        categories: cats.sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name)),
        expensesCents: exp,
        investmentCents: purchaseCents + exp,
        saleProceedsCents: sold && y === saleYear ? p.salePriceCents! : 0,
        items: items.filter((i) => Number(i.expense_date.slice(0, 4)) === y).map((i): YearItem => ({ expenseId: i.id, date: i.expense_date, vendorName: i.vendor, totalCents: i.total_cents, categories: i.categories, attachmentCount: i.attachments })),
      });
    }

    const projectCostCents = p.purchasePriceCents + expensesCents;
    const profitCents = sold ? p.salePriceCents! - projectCostCents : null;
    const yearsExpensesCents = byYear.reduce((s, y) => s + y.expensesCents, 0);
    return {
      propertyId,
      purchasePriceCents: p.purchasePriceCents,
      salePriceCents: sold ? p.salePriceCents : null,
      bridge: {
        groups: lifetime,
        expensesCents,
        projectCostCents,
        profitCents,
        roiBasisPoints: profitCents === null ? null : roiBasisPoints(profitCents, projectCostCents),
      },
      byYear,
      reconciliation: { lifetimeExpensesCents: expensesCents, yearsExpensesCents, matches: yearsExpensesCents === expensesCents },
    };
  }

  /** General company expenses (no property) in a date range, kept separate from any property's profit. */
  companyOverhead(companyId: number, from: string | null, to: string | null): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(total_cents), 0) AS s FROM expense
         WHERE company_id = ? AND property_id IS NULL AND status = 'posted' AND (? IS NULL OR expense_date >= ?) AND (? IS NULL OR expense_date <= ?)`,
      )
      .get(companyId, from, from, to, to) as { s: number };
    return row.s;
  }
}

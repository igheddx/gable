import type { Db } from '../db/connection';
import { AppError } from '../shared/errors';
import { GROUP_LABELS, REPORTING_GROUPS, SELLING_GROUPS, type ReportingGroup } from '../shared/categories';
import { formatUsDate, isValidIsoDate, todayIso } from '../shared/dates';
import { daysBetween } from '../shared/duration';
import { roiBasisPoints } from '../shared/money';
import type { Cell, Column, OverviewData, ReportDoc, ReportRequest, SummaryLine, Table } from '../shared/reportTypes';
import { TEMPLATE_INFO } from '../shared/businessTypes';
import type { Property } from '../shared/types';
import { FinancialService } from './financialService';
import type { PropertyService } from './propertyService';
import type { CompanyService } from './companyService';

type Scope = number | 'all';

interface PropRow {
  id: number; companyId: number; company: string; address: string; purchaseDate: string; saleDate: string | null; status: string;
  purchaseCents: number; saleCents: number | null; archived: boolean; typeName: string;
}
interface PropMoney extends PropRow { groups: Record<ReportingGroup, number>; expensesCents: number; projectCostCents: number; profitCents: number | null; roiBp: number | null; days: number }

/** Renovations and buy-and-sell items have a purchase, costs and a sale, so profit and return apply to them. */
const PROFIT_TEMPLATES = "bt.template IN ('renovation', 'buy_sell')";
/** Rentals and ongoing businesses are tracked by income against expenses instead. */
const INCOME_TEMPLATES = "bt.template IN ('rental', 'income_expense')";

const emptyGroups = (): Record<ReportingGroup, number> => Object.fromEntries(REPORTING_GROUPS.map((g) => [g, 0])) as Record<ReportingGroup, number>;

const money = (key: string, label: string, width = 14): Column => ({ key, label, type: 'money', width });

/**
 * All dashboard figures and report tables come from these queries, so a total shown on screen,
 * written to Excel and printed to PDF is always the same number. Voided expenses are excluded everywhere.
 */
export class ReportService {
  constructor(
    private readonly db: Db,
    private readonly companies: CompanyService,
    private readonly properties: PropertyService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly today: () => string = () => todayIso(),
  ) {
    this.fin = new FinancialService(db, today);
  }

  private readonly fin: FinancialService;

  // ------------------------------------------------------------------ shared queries

  private scopeName(scope: Scope): string {
    return scope === 'all' ? 'All companies' : this.companies.get(scope).displayName;
  }

  private props(scope: Scope, where: string, params: (string | number)[]): PropRow[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.company_id, c.display_name AS company, p.address1, p.address2, p.purchase_date, p.sale_date, p.status,
                p.purchase_price_cents, p.sale_price_cents, p.is_archived, bt.name AS type_name
         FROM property p JOIN company c ON c.id = p.company_id JOIN business_type bt ON bt.id = p.business_type_id
         WHERE (? = 'all' OR p.company_id = ?) ${where ? 'AND ' + where : ''} ORDER BY c.display_name COLLATE NOCASE, p.address1 COLLATE NOCASE, p.id`,
      )
      .all(scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope, ...params) as {
      id: number; company_id: number; company: string; address1: string; address2: string | null; purchase_date: string | null; sale_date: string | null;
      status: string; purchase_price_cents: number | null; sale_price_cents: number | null; is_archived: number; type_name: string;
    }[];
    return rows.map((r) => ({
      id: r.id, companyId: r.company_id, company: r.company, address: r.address2 ? `${r.address1}, ${r.address2}` : r.address1,
      purchaseDate: r.purchase_date ?? '', saleDate: r.sale_date, status: r.status, purchaseCents: r.purchase_price_cents ?? 0, saleCents: r.sale_price_cents, archived: r.is_archived === 1, typeName: r.type_name,
    }));
  }

  private withMoney(rows: PropRow[], asOf: string): PropMoney[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const lines = this.db
      .prepare(
        `SELECT e.property_id AS pid, c.reporting_group AS grp, SUM(a.amount_cents) AS cents
         FROM expense e JOIN expense_allocation a ON a.expense_id = e.id JOIN category c ON c.id = a.category_id
         WHERE e.status = 'posted' AND e.property_id IN (${ids.map(() => '?').join(',')}) GROUP BY e.property_id, c.reporting_group`,
      )
      .all(...ids) as { pid: number; grp: ReportingGroup; cents: number }[];
    return rows.map((r) => {
      const groups = emptyGroups();
      for (const l of lines) if (l.pid === r.id) groups[l.grp] += l.cents;
      const expensesCents = REPORTING_GROUPS.reduce((s, g) => s + groups[g], 0);
      const projectCostCents = r.purchaseCents + expensesCents;
      const sold = r.status === 'Sold' && r.saleCents !== null && r.saleDate !== null;
      const profitCents = sold ? r.saleCents! - projectCostCents : null;
      const end = sold ? r.saleDate! : asOf;
      return { ...r, groups, expensesCents, projectCostCents, profitCents, roiBp: profitCents === null ? null : roiBasisPoints(profitCents, projectCostCents), days: r.purchaseDate > end ? 0 : daysBetween(r.purchaseDate, end) };
    });
  }

  private soldRows(scope: Scope, from: string | null, to: string | null): PropMoney[] {
    const where = ["p.status = 'Sold'", 'p.sale_date IS NOT NULL', PROFIT_TEMPLATES];
    const params: string[] = [];
    if (from) { where.push('p.sale_date >= ?'); params.push(from); }
    if (to) { where.push('p.sale_date <= ?'); params.push(to); }
    return this.withMoney(this.props(scope, where.join(' AND '), params), this.today());
  }

  private unsoldRows(scope: Scope): PropMoney[] {
    return this.withMoney(this.props(scope, `p.status <> 'Sold' AND p.is_archived = 0 AND ${PROFIT_TEMPLATES}`, []), this.today());
  }

  private expenseLines(scope: Scope, from: string | null, to: string | null, propertyIds?: number[]): { id: number; date: string; companyId: number; company: string; propertyId: number | null; property: string | null; vendor: string; cents: number; categories: string; attachments: number }[] {
    const where = ["e.status = 'posted'", "(? = 'all' OR e.company_id = ?)"];
    const params: (string | number)[] = [scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope];
    if (from) { where.push('e.expense_date >= ?'); params.push(from); }
    if (to) { where.push('e.expense_date <= ?'); params.push(to); }
    if (propertyIds) {
      if (propertyIds.length === 0) return [];
      where.push(`e.property_id IN (${propertyIds.map(() => '?').join(',')})`);
      params.push(...propertyIds);
    }
    const rows = this.db
      .prepare(
        `SELECT e.id, e.expense_date AS date, e.company_id, co.display_name AS company, e.property_id, p.address1 AS property, v.name AS vendor, e.total_cents AS cents,
                (SELECT group_concat(c.name, ', ') FROM expense_allocation a JOIN category c ON c.id = a.category_id WHERE a.expense_id = e.id) AS categories,
                (SELECT COUNT(*) FROM expense_attachment t WHERE t.expense_id = e.id) AS attachments
         FROM expense e JOIN vendor v ON v.id = e.vendor_id JOIN company co ON co.id = e.company_id LEFT JOIN property p ON p.id = e.property_id
         WHERE ${where.join(' AND ')} ORDER BY e.expense_date, e.id`,
      )
      .all(...params) as { id: number; date: string; company_id: number; company: string; property_id: number | null; property: string | null; vendor: string; cents: number; categories: string; attachments: number }[];
    return rows.map((r) => ({ id: r.id, date: r.date, companyId: r.company_id, company: r.company, propertyId: r.property_id, property: r.property, vendor: r.vendor, cents: r.cents, categories: r.categories, attachments: r.attachments }));
  }

  private allocationLines(scope: Scope, from: string | null, to: string | null, propertyIds?: number[]): { date: string; company: string; property: string | null; vendor: string; category: string; group: ReportingGroup; cents: number }[] {
    const where = ["e.status = 'posted'", "(? = 'all' OR e.company_id = ?)"];
    const params: (string | number)[] = [scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope];
    if (from) { where.push('e.expense_date >= ?'); params.push(from); }
    if (to) { where.push('e.expense_date <= ?'); params.push(to); }
    if (propertyIds) {
      if (propertyIds.length === 0) return [];
      where.push(`e.property_id IN (${propertyIds.map(() => '?').join(',')})`);
      params.push(...propertyIds);
    }
    return (this.db
      .prepare(
        `SELECT e.expense_date AS date, co.display_name AS company, p.address1 AS property, v.name AS vendor, c.name AS category, c.reporting_group AS grp, a.amount_cents AS cents
         FROM expense_allocation a JOIN expense e ON e.id = a.expense_id JOIN category c ON c.id = a.category_id
         JOIN vendor v ON v.id = e.vendor_id JOIN company co ON co.id = e.company_id LEFT JOIN property p ON p.id = e.property_id
         WHERE ${where.join(' AND ')} ORDER BY e.expense_date, e.id, c.name`,
      )
      .all(...params) as { date: string; company: string; property: string | null; vendor: string; category: string; grp: ReportingGroup; cents: number }[])
      .map((r) => ({ date: r.date, company: r.company, property: r.property, vendor: r.vendor, category: r.category, group: r.grp, cents: r.cents }));
  }

  // ------------------------------------------------------------------ overview

  overview(scope: Scope, from: string, to: string, periodLabel: string): OverviewData {
    this.assertRange(from, to);
    const unsold = this.unsoldRows(scope);
    const sold = this.soldRows(scope, from, to);
    const general = this.generalByCompany(scope, from, to);
    const flow = this.incomeFlowByCompany(scope, from, to);
    const names = scope === 'all' ? this.companies.list(false).map((c) => ({ id: c.id, name: c.displayName })) : [{ id: scope, name: this.scopeName(scope) }];
    const recent = this.db
      .prepare(
        `SELECT e.id, e.expense_date AS date, v.name AS vendor, COALESCE(p.address1, 'General company expense') AS target, co.display_name AS company, e.total_cents AS cents
         FROM expense e JOIN vendor v ON v.id = e.vendor_id JOIN company co ON co.id = e.company_id LEFT JOIN property p ON p.id = e.property_id
         WHERE e.status = 'posted' AND (? = 'all' OR e.company_id = ?) ORDER BY e.id DESC LIMIT 8`,
      )
      .all(scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope) as { id: number; date: string; vendor: string; target: string; company: string; cents: number }[];
    return {
      scope, from, to, periodLabel,
      activeProperties: unsold.length,
      unsoldInvestmentCents: unsold.reduce((s, p) => s + p.projectCostCents, 0),
      realizedProfitCents: sold.reduce((s, p) => s + (p.profitCents ?? 0), 0),
      soldInPeriod: sold.length,
      generalExpensesCents: [...general.values()].reduce((a, b) => a + b, 0),
      incomeAssets: [...flow.values()].reduce((s, f) => s + f.assets, 0),
      incomeCents: [...flow.values()].reduce((s, f) => s + f.income, 0),
      incomeExpensesCents: [...flow.values()].reduce((s, f) => s + f.expenses, 0),
      companies: names.map((c) => ({
        companyId: c.id, name: c.name,
        activeProperties: unsold.filter((p) => p.companyId === c.id).length,
        unsoldInvestmentCents: unsold.filter((p) => p.companyId === c.id).reduce((s, p) => s + p.projectCostCents, 0),
        realizedProfitCents: sold.filter((p) => p.companyId === c.id).reduce((s, p) => s + (p.profitCents ?? 0), 0),
        generalExpensesCents: general.get(c.id) ?? 0,
        incomeAssets: flow.get(c.id)?.assets ?? 0,
        incomeCents: flow.get(c.id)?.income ?? 0,
        incomeExpensesCents: flow.get(c.id)?.expenses ?? 0,
      })),
      recent: recent.map((r) => ({ expenseId: r.id, date: r.date, vendor: r.vendor, target: r.target, companyName: r.company, cents: r.cents })),
    };
  }

  /** Rentals and ongoing businesses by company: active items, income received and expenses paid within the period. */
  private incomeFlowByCompany(scope: Scope, from: string, to: string): Map<number, { assets: number; income: number; expenses: number }> {
    const out = new Map<number, { assets: number; income: number; expenses: number }>();
    const slot = (id: number) => { let v = out.get(id); if (!v) { v = { assets: 0, income: 0, expenses: 0 }; out.set(id, v); } return v; };
    const s = [scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope];
    for (const r of this.db
      .prepare(`SELECT p.company_id AS id, COUNT(*) AS n FROM property p JOIN business_type bt ON bt.id = p.business_type_id
                WHERE p.is_archived = 0 AND p.status <> 'Sold' AND ${INCOME_TEMPLATES} AND (? = 'all' OR p.company_id = ?) GROUP BY p.company_id`)
      .all(...s) as { id: number; n: number }[]) slot(r.id).assets = r.n;
    for (const r of this.db
      .prepare(`SELECT i.company_id AS id, SUM(i.amount_cents) AS v FROM income i WHERE i.status = 'posted' AND i.income_date >= ? AND i.income_date <= ? AND (? = 'all' OR i.company_id = ?) GROUP BY i.company_id`)
      .all(from, to, ...s) as { id: number; v: number }[]) slot(r.id).income = r.v;
    for (const r of this.db
      .prepare(`SELECT e.company_id AS id, SUM(e.total_cents) AS v FROM expense e JOIN property p ON p.id = e.property_id JOIN business_type bt ON bt.id = p.business_type_id
                WHERE e.status = 'posted' AND ${INCOME_TEMPLATES} AND e.expense_date >= ? AND e.expense_date <= ? AND (? = 'all' OR e.company_id = ?) GROUP BY e.company_id`)
      .all(from, to, ...s) as { id: number; v: number }[]) slot(r.id).expenses = r.v;
    return out;
  }

  private generalByCompany(scope: Scope, from: string | null, to: string | null): Map<number, number> {
    const rows = this.db
      .prepare(
        `SELECT company_id AS id, SUM(total_cents) AS s FROM expense
         WHERE property_id IS NULL AND status = 'posted' AND (? = 'all' OR company_id = ?) AND (? IS NULL OR expense_date >= ?) AND (? IS NULL OR expense_date <= ?)
         GROUP BY company_id`,
      )
      .all(scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope, from, from, to, to) as { id: number; s: number }[];
    return new Map(rows.map((r) => [r.id, r.s]));
  }

  // ------------------------------------------------------------------ reports

  build(req: ReportRequest): ReportDoc {
    if (req.from && !isValidIsoDate(req.from)) throw new AppError('VALIDATION', 'Enter a valid start date.', { from: 'Enter a valid start date.' });
    if (req.to && !isValidIsoDate(req.to)) throw new AppError('VALIDATION', 'Enter a valid end date.', { to: 'Enter a valid end date.' });
    if (req.from && req.to) this.assertRange(req.from, req.to);
    switch (req.kind) {
      case 'property': return this.propertyReport(req.propertyId);
      case 'income-expense': return this.incomeExpenseReport(req.scope, req.from, req.to);
      case 'sold-performance': return this.soldPerformance(req.scope, req.from, req.to);
      case 'expense-activity': return this.expenseActivity(req.scope, req.from, req.to);
      case 'portfolio-snapshot': return this.portfolioSnapshot(req.scope);
    }
  }

  private assertRange(from: string, to: string): void {
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) throw new AppError('VALIDATION', 'Enter valid dates.');
    if (to < from) throw new AppError('VALIDATION', 'The end date cannot be before the start date.', { to: 'The end date cannot be before the start date.' });
  }

  private base(kind: ReportDoc['kind'], title: string, basis: string, scope: Scope | null, filters: [string, string][]): Omit<ReportDoc, 'summary' | 'tables' | 'notes'> {
    return {
      kind, title, basis, company: scope === null ? '' : this.scopeName(scope), filters, generatedAt: this.now(), asOf: this.today(),
      companyId: typeof scope === 'number' ? scope : null,
    };
  }

  private range(from: string | null, to: string | null): string {
    return from || to ? `${from ? formatUsDate(from) : 'the beginning'} to ${to ? formatUsDate(to) : 'today'}` : 'All dates';
  }

  /** Income entries (posted) for rentals and ongoing businesses, selected by INCOME date. */
  private incomeLines(scope: Scope, from: string | null, to: string | null, propertyId?: number): { id: number; date: string; company: string; propertyId: number; property: string; type: string; category: string; notes: string; cents: number }[] {
    const where = ["i.status = 'posted'", "(? = 'all' OR i.company_id = ?)"];
    const params: (string | number)[] = [scope === 'all' ? 'all' : 'x', scope === 'all' ? 0 : scope];
    if (from) { where.push('i.income_date >= ?'); params.push(from); }
    if (to) { where.push('i.income_date <= ?'); params.push(to); }
    if (propertyId !== undefined) { where.push('i.property_id = ?'); params.push(propertyId); }
    return (this.db
      .prepare(
        `SELECT i.id, i.income_date AS date, co.display_name AS company, i.property_id, p.address1 AS property, bt.name AS type, i.category, i.notes, i.amount_cents AS cents
         FROM income i JOIN company co ON co.id = i.company_id JOIN property p ON p.id = i.property_id JOIN business_type bt ON bt.id = p.business_type_id
         WHERE ${where.join(' AND ')} ORDER BY i.income_date, i.id`,
      )
      .all(...params) as { id: number; date: string; company: string; property_id: number; property: string; type: string; category: string; notes: string | null; cents: number }[])
      .map((r) => ({ id: r.id, date: r.date, company: r.company, propertyId: r.property_id, property: r.property, type: r.type, category: r.category, notes: r.notes ?? '', cents: r.cents }));
  }

  /** Rentals and ongoing businesses: income received against expenses paid in the period. Purchases and sales are not part of it. */
  private incomeExpenseReport(scope: Scope, from: string | null, to: string | null): ReportDoc {
    const all = scope === 'all';
    const base = this.base('income-expense', 'Rental and other income', 'Income selected by INCOME date and expenses by EXPENSE date, for rentals and ongoing businesses only. Purchases and sales of these items, and renovation or vehicle costs, are not included.', scope, [['Date range', this.range(from, to)]]);
    const items = this.props(scope, INCOME_TEMPLATES, []);
    const ids = new Set(items.map((i) => i.id));
    const income = this.incomeLines(scope, from, to).filter((i) => ids.has(i.propertyId));
    const exp = this.expenseLines(scope, from, to, [...ids]);
    const alloc = this.allocationLines(scope, from, to, [...ids]);
    const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);
    const incomeTotal = sum(income);
    const expTotal = sum(exp);

    const byAsset = items
      .map((it) => {
        const inc = sum(income.filter((i) => i.propertyId === it.id));
        const ex = sum(exp.filter((e) => e.propertyId === it.id));
        return { it, inc, ex };
      })
      .filter((r) => !r.it.archived || r.inc !== 0 || r.ex !== 0);
    const assetCols: Column[] = [
      ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      { key: 'asset', label: 'Item', type: 'text', width: 30 }, { key: 'type', label: 'Type', type: 'text', width: 16 },
      money('income', 'Income'), money('expenses', 'Expenses'), money('net', 'Net income'),
    ];
    const incomeByCat = new Map<string, number>();
    for (const i of income) incomeByCat.set(i.category, (incomeByCat.get(i.category) ?? 0) + i.cents);
    const expByCat = new Map<string, number>();
    for (const a of alloc) expByCat.set(a.category, (expByCat.get(a.category) ?? 0) + a.cents);
    const months = new Map<string, { inc: number; ex: number }>();
    for (const i of income) { const m = i.date.slice(0, 7); const v = months.get(m) ?? { inc: 0, ex: 0 }; v.inc += i.cents; months.set(m, v); }
    for (const e of exp) { const m = e.date.slice(0, 7); const v = months.get(m) ?? { inc: 0, ex: 0 }; v.ex += e.cents; months.set(m, v); }
    const catRows = (m: Map<string, number>): Cell[][] => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => [k, v]);
    return {
      ...base,
      summary: [
        { label: 'Items with activity', value: byAsset.filter((r) => r.inc !== 0 || r.ex !== 0).length, type: 'int' },
        { label: 'Income received', value: incomeTotal, type: 'money' },
        { label: 'Expenses paid', value: expTotal, type: 'money' },
        { label: 'Net income (income minus expenses)', value: incomeTotal - expTotal, type: 'money', emphasis: true },
      ],
      tables: [
        { id: 'by-item', title: 'By item', sheet: 'By Item', columns: assetCols,
          rows: byAsset.map((r): Cell[] => [...(all ? [r.it.company] : []), r.it.address, r.it.typeName, r.inc, r.ex, r.inc - r.ex]),
          totals: byAsset.length ? ['Total', ...(all ? [null] : []), null, incomeTotal, expTotal, incomeTotal - expTotal] : undefined, empty: 'No rentals or ongoing businesses yet.' },
        { id: 'by-month', title: 'By month', sheet: 'By Month',
          columns: [{ key: 'month', label: 'Month', type: 'text', width: 12 }, money('income', 'Income'), money('expenses', 'Expenses'), money('net', 'Net income')],
          rows: [...months.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, v]): Cell[] => [m, v.inc, v.ex, v.inc - v.ex]),
          totals: months.size ? ['Total', incomeTotal, expTotal, incomeTotal - expTotal] : undefined, empty: 'No activity in this period.' },
        { id: 'income-by-category', title: 'Income by type', sheet: 'Income By Type', columns: [{ key: 'category', label: 'Type of income', type: 'text', width: 28 }, money('amount', 'Amount')],
          rows: catRows(incomeByCat), totals: incomeByCat.size ? ['Total', incomeTotal] : undefined, empty: 'No income in this period.' },
        { id: 'expenses-by-category', title: 'Expenses by category', sheet: 'Expenses By Category', columns: [{ key: 'category', label: 'Category', type: 'text', width: 28 }, money('amount', 'Amount')],
          rows: catRows(expByCat), totals: expByCat.size ? ['Total', sum(alloc)] : undefined, empty: 'No expenses in this period.' },
        { id: 'income', title: 'Income entries', sheet: 'Income',
          columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []), { key: 'asset', label: 'Item', type: 'text', width: 28 }, { key: 'category', label: 'Type of income', type: 'text', width: 20 }, { key: 'notes', label: 'Notes', type: 'text', width: 30 }, money('amount', 'Amount')],
          rows: income.map((i): Cell[] => [i.date, ...(all ? [i.company] : []), i.property, i.category, i.notes, i.cents]),
          totals: income.length ? ['Total', ...(all ? [null] : []), null, null, null, incomeTotal] : undefined, empty: 'No income entries in this period.' },
        { id: 'expenses', title: 'Expenses', sheet: 'Expenses',
          columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []), { key: 'asset', label: 'Item', type: 'text', width: 28 }, { key: 'vendor', label: 'Vendor', type: 'text', width: 26 }, { key: 'cat', label: 'Categories', type: 'text', width: 28 }, money('amount', 'Amount')],
          rows: exp.map((e): Cell[] => [e.date, ...(all ? [e.company] : []), e.property ?? '', e.vendor, e.categories, e.cents]),
          totals: exp.length ? ['Total', ...(all ? [null] : []), null, null, null, expTotal] : undefined, empty: 'No expenses in this period.' },
      ],
      notes: ['Voided income and expenses are excluded.', 'This is a management report, not a financial statement, tax return or cash-flow statement. Mortgage principal, depreciation and taxes are not included.'],
    };
  }

  /** One rental or ongoing business, lifetime, by year. */
  private cashFlowReport(prop: Property): ReportDoc {
    const flow = this.fin.cashFlow(prop.id);
    const base = this.base('property', `Item report: ${prop.address1}`, 'Income received and expenses paid for one item, by year. Income is counted by income date and expenses by expense date; voided entries are excluded.', prop.companyId, [['Item', prop.city ? `${prop.address1}, ${prop.city}, ${prop.state} ${prop.zip}` : prop.address1], ['Type', prop.businessTypeName]]);
    const income = this.incomeLines(prop.companyId, null, null, prop.id);
    const exp = this.expenseLines(prop.companyId, null, null, [prop.id]);
    const alloc = this.allocationLines(prop.companyId, null, null, [prop.id]);
    const yearRows = flow.byYear.map((y): Cell[] => [y.year, y.incomeCents, y.expensesCents, y.netCents]);
    return {
      ...base,
      summary: [
        ...(prop.purchaseDate ? [{ label: 'Purchase date', value: prop.purchaseDate, type: 'date' as const }] : []),
        ...(prop.purchasePriceCents !== null ? [{ label: 'Purchase price (not part of net income)', value: prop.purchasePriceCents, type: 'money' as const }] : []),
        { label: 'Income received', value: flow.incomeCents, type: 'money' },
        { label: 'Expenses paid', value: flow.expensesCents, type: 'money' },
        { label: 'Net income (income minus expenses)', value: flow.netCents, type: 'money', emphasis: true },
      ],
      tables: [
        { id: 'by-year', title: 'By year', sheet: 'By Year',
          columns: [{ key: 'year', label: 'Year', type: 'year', width: 8 }, money('income', 'Income'), money('expenses', 'Expenses'), money('net', 'Net income')],
          rows: yearRows, totals: ['All years', flow.incomeCents, flow.expensesCents, flow.netCents], empty: 'No activity.' },
        { id: 'income', title: 'Income entries', sheet: 'Income',
          columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, { key: 'category', label: 'Type of income', type: 'text', width: 22 }, { key: 'notes', label: 'Notes', type: 'text', width: 34 }, money('amount', 'Amount')],
          rows: income.map((i): Cell[] => [i.date, i.category, i.notes, i.cents]), totals: income.length ? ['Total', null, null, flow.incomeCents] : undefined, empty: 'No income recorded.' },
        { id: 'expenses', title: 'Expenses', sheet: 'Expenses',
          columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, { key: 'vendor', label: 'Vendor', type: 'text', width: 28 }, { key: 'cat', label: 'Categories', type: 'text', width: 30 }, { key: 'rec', label: 'Receipts', type: 'int', width: 9 }, money('amount', 'Amount')],
          rows: exp.map((e): Cell[] => [e.date, e.vendor, e.categories, e.attachments, e.cents]), totals: exp.length ? ['Total', null, null, null, flow.expensesCents] : undefined, empty: 'No expenses recorded.' },
        this.allocationTable(alloc, false, false),
      ],
      notes: ['The purchase price, if recorded, is shown for reference and is not part of net income.', 'This is a management report, not a financial statement or tax return.'],
    };
  }

  /** Individual property profitability. Same structure as the property screen. */
  private propertyReport(propertyId: number | null): ReportDoc {
    if (propertyId === null) throw new AppError('VALIDATION', 'Choose a property.');
    const prop = this.properties.get(propertyId);
    if (TEMPLATE_INFO[prop.template].tracksIncome) return this.cashFlowReport(prop);
    const [m] = this.withMoney(this.props(prop.companyId, 'p.id = ?', [propertyId]), this.today());
    if (!m) throw new AppError('NOT_FOUND', 'That property no longer exists.');
    const sold = m.profitCents !== null;
    const base = this.base('property', `Property report: ${m.address}`, 'Lifetime costs of one property, from purchase through sale or today. Expenses are counted by expense date; voided expenses are excluded.', prop.companyId, [['Property', `${m.address}, ${prop.city}, ${prop.state} ${prop.zip}`], ['Status', m.status]]);
    const summary: SummaryLine[] = [
      { label: 'Purchase date', value: m.purchaseDate, type: 'date' },
      { label: 'Purchase price', value: m.purchaseCents, type: 'money' },
      ...(sold ? [{ label: 'Sale date', value: m.saleDate, type: 'date' as const }, { label: 'Gross sale price', value: m.saleCents, type: 'money' as const }] : []),
      { label: sold ? 'Days held' : 'Held to date (days)', value: m.days, type: 'days' },
      { label: 'Lifetime expenses', value: m.expensesCents, type: 'money' },
      { label: sold ? 'Total project cost' : 'Recorded investment to date', value: m.projectCostCents, type: 'money', emphasis: true },
      ...(sold ? [{ label: 'Profit before taxes', value: m.profitCents, type: 'money' as const, emphasis: true }, { label: 'Return on cost (not annualized)', value: m.roiBp, type: 'percent' as const, emphasis: true }] : []),
    ];
    const g = m.groups;
    const bridgeRows: Cell[][] = [
      ['Purchase price', m.purchaseCents],
      [GROUP_LABELS.purchase_closing, g.purchase_closing],
      [GROUP_LABELS.renovation, g.renovation],
      [GROUP_LABELS.holding, g.holding],
      ['Selling costs', SELLING_GROUPS.reduce((s, k) => s + g[k], 0)],
      ...SELLING_GROUPS.map((k) => [`   ${GROUP_LABELS[k]}`, g[k]] as Cell[]),
      [GROUP_LABELS.other, g.other],
      [sold ? 'Total project cost' : 'Recorded investment to date', m.projectCostCents],
      ...(sold ? [['Gross sale price', m.saleCents], ['Profit before taxes', m.profitCents]] as Cell[][] : []),
    ];
    const exp = this.expenseLines(prop.companyId, null, null, [propertyId]);
    const alloc = this.allocationLines(prop.companyId, null, null, [propertyId]);
    const fin = this.byYear(m, exp, alloc);
    const yearCols: Column[] = [{ key: 'year', label: 'Year', type: 'year', width: 8 }, money('purchase', 'Purchase price'), ...REPORTING_GROUPS.map((k) => money(k, GROUP_LABELS[k], 16)), money('exp', 'Total expenses'), money('inv', 'Investment (purchase + expenses)', 18), money('sale', 'Sale proceeds')];
    return {
      ...base,
      summary,
      tables: [
        { id: 'costs', title: 'Lifetime cost bridge', sheet: 'Costs', columns: [{ key: 'item', label: 'Item', type: 'text', width: 34 }, money('amount', 'Amount')], rows: bridgeRows, empty: '' },
        {
          id: 'by-year', title: 'Property by year', sheet: 'Property By Year', columns: yearCols, rows: fin.rows,
          totals: ['All years', fin.totals.purchase, ...REPORTING_GROUPS.map((k) => fin.totals.groups[k]), fin.totals.exp, fin.totals.inv, fin.totals.sale], empty: 'No activity.',
        },
        {
          id: 'expenses', title: 'Expenses', sheet: 'Expenses',
          columns: [{ key: 'date', label: 'Date', type: 'date', width: 12 }, { key: 'vendor', label: 'Vendor', type: 'text', width: 28 }, { key: 'cat', label: 'Categories', type: 'text', width: 30 }, { key: 'rec', label: 'Receipts', type: 'int', width: 9 }, money('amount', 'Amount')],
          rows: exp.map((e) => [e.date, e.vendor, e.categories, e.attachments, e.cents]), totals: ['Total', null, null, null, exp.reduce((s, e) => s + e.cents, 0)], empty: 'No expenses recorded.',
        },
        this.allocationTable(alloc, false),
      ],
      notes: [
        'Purchase price is shown once, in the year of purchase, and is not part of annual expenses.',
        'Sale proceeds are shown separately and are never netted against expenses.',
        'This is a management report, not a financial statement or tax return.',
      ],
    };
  }

  private byYear(m: PropMoney, exp: ReturnType<ReportService['expenseLines']>, alloc: ReturnType<ReportService['allocationLines']>) {
    const years = new Set<number>([Number(m.purchaseDate.slice(0, 4)), ...alloc.map((a) => Number(a.date.slice(0, 4)))]);
    const endYear = m.status === 'Sold' && m.saleDate ? Number(m.saleDate.slice(0, 4)) : Number(this.today().slice(0, 4));
    years.add(endYear);
    const lo = Math.min(...years);
    const hi = Math.max(...years);
    const totals = { purchase: 0, groups: emptyGroups(), exp: 0, inv: 0, sale: 0 };
    const rows: Cell[][] = [];
    for (let y = lo; y <= hi; y++) {
      const groups = emptyGroups();
      for (const a of alloc) if (Number(a.date.slice(0, 4)) === y) groups[a.group] += a.cents;
      const e = REPORTING_GROUPS.reduce((s, k) => s + groups[k], 0);
      const purchase = y === Number(m.purchaseDate.slice(0, 4)) ? m.purchaseCents : 0;
      const sale = m.status === 'Sold' && m.saleDate && y === Number(m.saleDate.slice(0, 4)) ? m.saleCents ?? 0 : 0;
      rows.push([y, purchase, ...REPORTING_GROUPS.map((k) => groups[k]), e, purchase + e, sale]);
      totals.purchase += purchase; totals.exp += e; totals.inv += purchase + e; totals.sale += sale;
      for (const k of REPORTING_GROUPS) totals.groups[k] += groups[k];
    }
    void exp;
    return { rows, totals };
  }

  private allocationTable(alloc: ReturnType<ReportService['allocationLines']>, showCompany: boolean, propertyColumn = true): Table {
    const columns: Column[] = [
      { key: 'date', label: 'Expense date', type: 'date', width: 13 },
      ...(showCompany ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      ...(propertyColumn ? [{ key: 'property', label: 'Property', type: 'text' as const, width: 26 }] : []),
      { key: 'vendor', label: 'Vendor', type: 'text', width: 26 },
      { key: 'category', label: 'Category', type: 'text', width: 24 },
      { key: 'group', label: 'Reporting group', type: 'text', width: 24 },
      money('amount', 'Amount'),
    ];
    const rows = alloc.map((a): Cell[] => [a.date, ...(showCompany ? [a.company] : []), ...(propertyColumn ? [a.property ?? 'General company'] : []), a.vendor, a.category, GROUP_LABELS[a.group], a.cents]);
    const totals: Cell[] = columns.map((c, i) => (i === 0 ? 'Total' : c.key === 'amount' ? alloc.reduce((s, a) => s + a.cents, 0) : null));
    return { id: 'allocations', title: 'Category allocations', sheet: 'Allocations', columns, rows, totals, empty: 'No expenses.' };
  }

  /** Properties selected by SALE date, with their full lifetime costs (even those incurred outside the period). */
  private soldPerformance(scope: Scope, from: string | null, to: string | null): ReportDoc {
    const sold = this.soldRows(scope, from, to);
    const all = scope === 'all';
    const base = this.base('sold-performance', 'Sold-property performance', 'Properties selected by SALE date. Each shows its full lifetime costs, including expenses dated before the period.', scope, [['Sale date range', this.range(from, to)]]);
    const ids = sold.map((p) => p.id);
    const exp = this.expenseLines(scope, null, null, ids);
    const alloc = this.allocationLines(scope, null, null, ids);
    const tot = {
      sale: sold.reduce((s, p) => s + (p.saleCents ?? 0), 0), cost: sold.reduce((s, p) => s + p.projectCostCents, 0),
      profit: sold.reduce((s, p) => s + (p.profitCents ?? 0), 0), purchase: sold.reduce((s, p) => s + p.purchaseCents, 0),
      groups: emptyGroups(),
    };
    for (const p of sold) for (const k of REPORTING_GROUPS) tot.groups[k] += p.groups[k];
    const sellingOf = (g: Record<ReportingGroup, number>) => SELLING_GROUPS.reduce((s, k) => s + g[k], 0);
    // A Type column appears only when something other than a renovation is in the report.
    const showType = sold.some((p) => p.typeName !== 'Renovation');
    const columns: Column[] = [
      ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      { key: 'address', label: 'Property', type: 'text', width: 28 },
      ...(showType ? [{ key: 'type', label: 'Type', type: 'text' as const, width: 14 }] : []),
      { key: 'purchased', label: 'Purchased', type: 'date', width: 12 },
      { key: 'sold', label: 'Sold', type: 'date', width: 12 },
      { key: 'days', label: 'Days held', type: 'days', width: 10 },
      money('purchase', 'Purchase price'), money('closing', 'Purchase closing'), money('reno', 'Renovation and repairs'), money('holding', 'Holding'),
      money('selling', 'Selling costs'), money('other', 'Other costs'), money('cost', 'Total project cost'), money('sale', 'Gross sale price'),
      money('profit', 'Profit before taxes'), { key: 'roi', label: 'Return on cost', type: 'percent', width: 12 },
    ];
    const rows = sold.map((p): Cell[] => [
      ...(all ? [p.company] : []), p.address, ...(showType ? [p.typeName] : []), p.purchaseDate, p.saleDate, p.days, p.purchaseCents, p.groups.purchase_closing, p.groups.renovation, p.groups.holding,
      sellingOf(p.groups), p.groups.other, p.projectCostCents, p.saleCents, p.profitCents, p.roiBp,
    ]);
    const totals: Cell[] = [...(all ? ['Total'] : []), all ? null : 'Total', ...(showType ? [null] : []), null, null, null, tot.purchase, tot.groups.purchase_closing, tot.groups.renovation, tot.groups.holding, sellingOf(tot.groups), tot.groups.other, tot.cost, tot.sale, tot.profit, roiBasisPoints(tot.profit, tot.cost)];
    if (all) totals[1] = null;
    const expCols: Column[] = [
      ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      { key: 'property', label: 'Property', type: 'text', width: 26 }, { key: 'date', label: 'Date', type: 'date', width: 12 },
      { key: 'vendor', label: 'Vendor', type: 'text', width: 26 }, { key: 'cat', label: 'Categories', type: 'text', width: 28 }, money('amount', 'Amount'),
    ];
    return {
      ...base,
      summary: [
        { label: 'Properties sold in this period', value: sold.length, type: 'int' },
        { label: 'Total gross sale prices', value: tot.sale, type: 'money' },
        { label: 'Total project cost (lifetime)', value: tot.cost, type: 'money' },
        { label: 'Total profit before taxes', value: tot.profit, type: 'money', emphasis: true },
        { label: 'Overall return on cost (not annualized)', value: roiBasisPoints(tot.profit, tot.cost), type: 'percent', emphasis: true },
      ],
      tables: [
        { id: 'properties', title: 'Sold properties', sheet: 'Properties', columns, rows, totals: rows.length ? totals : undefined, empty: 'No properties were sold in this period.' },
        { id: 'expenses', title: 'Lifetime expenses of these properties', sheet: 'Expenses', columns: expCols,
          rows: exp.map((e): Cell[] => [...(all ? [e.company] : []), e.property ?? '', e.date, e.vendor, e.categories, e.cents]),
          totals: expCols.map((c, i) => (i === 0 ? 'Total' : c.key === 'amount' ? exp.reduce((s, e) => s + e.cents, 0) : null)), empty: 'No expenses.' },
        this.allocationTable(alloc, all),
      ],
      notes: [
        'Selected by sale date. Expenses recorded after a sale can change a sold property\'s profit; this report shows the latest recorded data as of the date above.',
        'General company expenses are not part of any property\'s profit and are not included here.',
        'This is a management report, not a financial statement or tax return.',
      ],
    };
  }

  /** Expenses selected by EXPENSE date. General company expenses are a separate section. */
  private expenseActivity(scope: Scope, from: string | null, to: string | null): ReportDoc {
    const all = scope === 'all';
    const base = this.base('expense-activity', 'Expense activity', 'Expenses selected by EXPENSE date, not by purchase or sale date. General company expenses are listed separately.', scope, [['Expense date range', this.range(from, to)]]);
    const exp = this.expenseLines(scope, from, to);
    const alloc = this.allocationLines(scope, from, to);
    const propertyExp = exp.filter((e) => e.propertyId !== null);
    const general = exp.filter((e) => e.propertyId === null);
    const sum = (xs: { cents: number }[]) => xs.reduce((s, x) => s + x.cents, 0);

    const catMap = new Map<string, { group: ReportingGroup; property: number; general: number }>();
    const propMap = new Map<string, { company: string; cents: number }>();
    for (const a of alloc) {
      const c = catMap.get(a.category) ?? { group: a.group, property: 0, general: 0 };
      if (a.property === null) c.general += a.cents; else c.property += a.cents;
      catMap.set(a.category, c);
    }
    for (const e of propertyExp) {
      const key = `${e.company}\u0000${e.property}`;
      const cur = propMap.get(key) ?? { company: e.company, cents: 0 };
      cur.cents += e.cents;
      propMap.set(key, cur);
    }
    const byCat = [...catMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const byProp = [...propMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const expCols = (withProperty: boolean): Column[] => [
      { key: 'date', label: 'Date', type: 'date', width: 12 },
      ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      ...(withProperty ? [{ key: 'property', label: 'Property', type: 'text' as const, width: 26 }] : []),
      { key: 'vendor', label: 'Vendor', type: 'text', width: 26 }, { key: 'cat', label: 'Categories', type: 'text', width: 28 }, money('amount', 'Amount'),
    ];
    const expRows = (xs: typeof exp, withProperty: boolean): Cell[][] => xs.map((e) => [e.date, ...(all ? [e.company] : []), ...(withProperty ? [e.property ?? 'General company'] : []), e.vendor, e.categories, e.cents]);
    const tot = (cols: Column[], xs: typeof exp): Cell[] => cols.map((c, i) => (i === 0 ? 'Total' : c.key === 'amount' ? sum(xs) : null));
    return {
      ...base,
      summary: [
        { label: 'Expenses recorded in this period', value: exp.length, type: 'int' },
        { label: 'Property expenses', value: sum(propertyExp), type: 'money' },
        { label: 'General company expenses', value: sum(general), type: 'money' },
        { label: 'All expenses in period', value: sum(exp), type: 'money', emphasis: true },
      ],
      tables: [
        { id: 'by-category', title: 'By category', sheet: 'By Category',
          columns: [{ key: 'category', label: 'Category', type: 'text', width: 28 }, { key: 'group', label: 'Reporting group', type: 'text', width: 24 }, money('property', 'Property expenses'), money('general', 'General company expenses'), money('total', 'Total')],
          rows: byCat.map(([n, c]): Cell[] => [n, GROUP_LABELS[c.group], c.property, c.general, c.property + c.general]),
          totals: ['Total', null, byCat.reduce((s, [, c]) => s + c.property, 0), byCat.reduce((s, [, c]) => s + c.general, 0), byCat.reduce((s, [, c]) => s + c.property + c.general, 0)], empty: 'No expenses in this period.' },
        { id: 'by-property', title: 'By property', sheet: 'By Property',
          columns: [{ key: 'property', label: 'Property', type: 'text', width: 30 }, ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []), money('amount', 'Expenses')],
          rows: byProp.map(([k, v]): Cell[] => [k.split('\u0000')[1]!, ...(all ? [v.company] : []), v.cents]),
          totals: ['Total', ...(all ? [null] : []), byProp.reduce((s, [, v]) => s + v.cents, 0)], empty: 'No property expenses in this period.' },
        { id: 'general', title: 'General company expenses (not part of any property)', sheet: 'General Company', columns: expCols(false), rows: expRows(general, false), totals: tot(expCols(false), general), empty: 'No general company expenses in this period.' },
        { id: 'expenses', title: 'Property expenses', sheet: 'Expenses', columns: expCols(true), rows: expRows(propertyExp, true), totals: tot(expCols(true), propertyExp), empty: 'No property expenses in this period.' },
        this.allocationTable(alloc, all),
      ],
      notes: ['Selected by expense date. Voided expenses are excluded.', 'This is a management report, not a financial statement, tax return or cash-flow report.'],
    };
  }

  /** Unsold investment recorded to date, kept apart from realized results of sold properties. */
  private portfolioSnapshot(scope: Scope): ReportDoc {
    const all = scope === 'all';
    const unsold = this.unsoldRows(scope);
    const sold = this.soldRows(scope, null, null);
    const base = this.base('portfolio-snapshot', 'Current portfolio snapshot', 'Unsold properties show cost recorded to date. Sold properties show realized results. The two are never added together.', scope, []);
    const showType = [...unsold, ...sold].some((p) => p.typeName !== 'Renovation');
    const typeCol: Column[] = showType ? [{ key: 'type', label: 'Type', type: 'text', width: 14 }] : [];
    const uCols: Column[] = [
      ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      { key: 'address', label: 'Property', type: 'text', width: 28 }, ...typeCol, { key: 'status', label: 'Status', type: 'text', width: 12 }, { key: 'purchased', label: 'Purchased', type: 'date', width: 12 },
      { key: 'days', label: 'Held to date (days)', type: 'days', width: 12 }, money('purchase', 'Purchase price'), money('exp', 'Expenses to date'), money('inv', 'Recorded investment'),
    ];
    const uTotals: Cell[] = uCols.map((c, i) => (i === 0 ? 'Total' : c.key === 'purchase' ? unsold.reduce((s, p) => s + p.purchaseCents, 0) : c.key === 'exp' ? unsold.reduce((s, p) => s + p.expensesCents, 0) : c.key === 'inv' ? unsold.reduce((s, p) => s + p.projectCostCents, 0) : null));
    const sCols: Column[] = [
      ...(all ? [{ key: 'company', label: 'Company', type: 'text' as const, width: 22 }] : []),
      { key: 'address', label: 'Property', type: 'text', width: 28 }, ...typeCol, { key: 'sold', label: 'Sold', type: 'date', width: 12 }, { key: 'days', label: 'Days held', type: 'days', width: 10 },
      money('cost', 'Total project cost'), money('sale', 'Gross sale price'), money('profit', 'Profit before taxes'), { key: 'roi', label: 'Return on cost', type: 'percent', width: 12 },
    ];
    const sCost = sold.reduce((s, p) => s + p.projectCostCents, 0);
    const sProfit = sold.reduce((s, p) => s + (p.profitCents ?? 0), 0);
    const sTotals: Cell[] = sCols.map((c, i) => (i === 0 ? 'Total' : c.key === 'cost' ? sCost : c.key === 'sale' ? sold.reduce((s, p) => s + (p.saleCents ?? 0), 0) : c.key === 'profit' ? sProfit : c.key === 'roi' ? roiBasisPoints(sProfit, sCost) : null));
    return {
      ...base,
      summary: [
        { label: 'Unsold properties', value: unsold.length, type: 'int' },
        { label: 'Recorded investment in unsold properties', value: unsold.reduce((s, p) => s + p.projectCostCents, 0), type: 'money', emphasis: true },
        { label: 'Sold properties (all time)', value: sold.length, type: 'int' },
        { label: 'Realized profit before taxes on sold properties', value: sProfit, type: 'money', emphasis: true },
      ],
      tables: [
        { id: 'unsold', title: 'Unsold properties: investment recorded to date', sheet: 'Unsold', columns: uCols,
          rows: unsold.map((p): Cell[] => [...(all ? [p.company] : []), p.address, ...(showType ? [p.typeName] : []), p.status, p.purchaseDate, p.days, p.purchaseCents, p.expensesCents, p.projectCostCents]), totals: unsold.length ? uTotals : undefined, empty: 'No unsold properties.' },
        { id: 'sold', title: 'Sold properties: realized results', sheet: 'Sold', columns: sCols,
          rows: sold.map((p): Cell[] => [...(all ? [p.company] : []), p.address, ...(showType ? [p.typeName] : []), p.saleDate, p.days, p.projectCostCents, p.saleCents, p.profitCents, p.roiBp]), totals: sold.length ? sTotals : undefined, empty: 'No sold properties.' },
      ],
      notes: [
        'Recorded investment is cost recorded so far. It is not a market value, and no value is estimated.',
        'This is a management report, not a balance sheet or financial statement.',
      ],
    };
  }
}


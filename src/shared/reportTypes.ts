/**
 * A report is built once as plain data, then shown on screen, written to Excel, and printed to PDF
 * from that same data, so every total reconciles across all three. Money is integer cents,
 * dates are YYYY-MM-DD, percentages are basis points.
 */
export type ReportKind = 'property' | 'sold-performance' | 'expense-activity' | 'portfolio-snapshot';

export type CellType = 'text' | 'money' | 'date' | 'int' | 'percent' | 'days' | 'year';
export type Cell = string | number | null;

export interface Column { key: string; label: string; type: CellType; width?: number }

export interface Table {
  id: string;
  title: string;
  /** Worksheet name (31 characters at most). */
  sheet: string;
  columns: Column[];
  rows: Cell[][];
  /** A totals row aligned to `columns`; null cells are left blank. */
  totals?: Cell[];
  /** Shown when there are no rows. */
  empty: string;
}

export interface SummaryLine { label: string; value: Cell; type: CellType; emphasis?: boolean }

export interface ReportDoc {
  kind: ReportKind;
  title: string;
  /** The rule that decides what is included, stated plainly (for example "by sale date"). */
  basis: string;
  /** Company name, or "All companies". */
  company: string;
  filters: [string, string][];
  /** When this report was produced, and the date its figures are current to. */
  generatedAt: string;
  asOf: string;
  summary: SummaryLine[];
  tables: Table[];
  notes: string[];
  /** Present when the report is for exactly one company. */
  companyId: number | null;
}

export interface ReportRequest {
  kind: ReportKind;
  scope: number | 'all';
  from: string | null;
  to: string | null;
  propertyId: number | null;
}

export interface OverviewData {
  scope: number | 'all';
  from: string;
  to: string;
  periodLabel: string;
  activeProperties: number;
  unsoldInvestmentCents: number;
  realizedProfitCents: number;
  soldInPeriod: number;
  generalExpensesCents: number;
  companies: { companyId: number; name: string; activeProperties: number; unsoldInvestmentCents: number; realizedProfitCents: number; generalExpensesCents: number }[];
  recent: { expenseId: number; date: string; vendor: string; target: string; companyName: string; cents: number }[];
}

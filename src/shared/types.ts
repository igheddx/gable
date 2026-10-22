import type { PropertyStatus } from './schemas';

export interface Company {
  id: number;
  displayName: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  hasLogo: boolean;
  isArchived: boolean;
  isDefault: boolean;
}

export interface Property {
  id: number;
  companyId: number;
  companyName: string;
  companyArchived: boolean;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  purchaseDate: string;
  purchasePriceCents: number;
  status: PropertyStatus;
  saleDate: string | null;
  salePriceCents: number | null;
  description: string;
  notes: string;
  isArchived: boolean;
}

export interface PropertyPage {
  rows: Property[];
  total: number;
  page: number;
  pageSize: number;
}

import type { ReportingGroup } from './categories';

export interface Category {
  id: number;
  companyId: number;
  name: string;
  reportingGroup: ReportingGroup;
  isArchived: boolean;
}

export interface Allocation { categoryId: number; categoryName: string; reportingGroup: ReportingGroup; amountCents: number }

export interface Attachment { id: number; originalName: string; sizeBytes: number; mime: string }

export interface ExpenseEvent { id: number; type: 'created' | 'edited' | 'voided' | 'unvoided'; detail: string; at: string }

export interface Expense {
  id: number;
  companyId: number;
  companyName: string;
  propertyId: number | null;
  propertyAddress: string | null;
  vendorName: string;
  expenseDate: string;
  totalCents: number;
  notes: string;
  status: 'posted' | 'voided';
  allocations: Allocation[];
  attachments: Attachment[];
  createdAt: string;
}

export interface ExpenseDetail extends Expense { events: ExpenseEvent[] }

export interface ExpensePage { rows: Expense[]; total: number; page: number; pageSize: number }

export interface StagedFile { stagedId: string; name: string; sizeBytes: number }

export interface YearItem { expenseId: number; date: string; vendorName: string; totalCents: number; categories: string; attachmentCount: number }

export interface YearRow {
  year: number;
  /** Purchase price appears once, in the purchase year. */
  purchaseCents: number;
  groups: Record<ReportingGroup, number>;
  categories: { categoryId: number; name: string; group: ReportingGroup; cents: number }[];
  /** Posted expenses only; excludes the purchase price. */
  expensesCents: number;
  /** Purchase price (in its year) plus expenses. */
  investmentCents: number;
  /** Shown separately in the sale year; never netted against expenses. */
  saleProceedsCents: number;
  items: YearItem[];
}

export interface PropertyFinancials {
  propertyId: number;
  purchasePriceCents: number;
  salePriceCents: number | null;
  bridge: {
    groups: Record<ReportingGroup, number>;
    expensesCents: number;
    /** Purchase price plus every posted expense. */
    projectCostCents: number;
    /** Only for sold properties. */
    profitCents: number | null;
    roiBasisPoints: number | null;
  };
  byYear: YearRow[];
  reconciliation: { lifetimeExpensesCents: number; yearsExpensesCents: number; matches: boolean };
}

export type DraftStatus = 'queued' | 'processing' | 'needs_review' | 'reviewed' | 'failed' | 'skipped' | 'saved';

export interface DraftFile { id: number; name: string; mime: string; sizeBytes: number; pages: number }

export interface DraftDuplicate { kind: 'same_file' | 'possible'; message: string; expenseId?: number; draftId?: number }

export interface DraftSuggestion {
  vendor: { candidates: string[]; matchedKnown: boolean } | null;
  date: { candidates: string[]; ambiguous: boolean } | null;
  total: { candidates: number[]; ambiguous: boolean; labeled: boolean; label: string } | null;
  category: { categoryId: number; name: string; source: 'rule' | 'keyword'; detail: string } | null;
}

export interface ReceiptDraft {
  id: number;
  companyId: number;
  companyName: string;
  propertyId: number | null;
  propertyAddress: string | null;
  status: DraftStatus;
  errorMessage: string | null;
  vendor: string;
  expenseDate: string | null;
  totalCents: number | null;
  categoryId: number | null;
  split: boolean;
  allocations: { categoryId: number; amountCents: number }[];
  notes: string;
  rememberVendor: boolean;
  duplicateOverride: boolean;
  /** Field names the person has set or corrected. A retry never overwrites these without consent. */
  touched: string[];
  suggestion: DraftSuggestion | null;
  files: DraftFile[];
  pageCount: number;
  ocrConfidence: number | null;
  ocrNotes: string[];
  duplicates: DraftDuplicate[];
  postedExpenseId: number | null;
  /** Live reading progress, only while processing. */
  progress: { page: number; pages: number } | null;
  createdAt: string;
}

export interface ReceiptDraftDetail extends ReceiptDraft { ocrText: string }

export interface ImportResult { created: ReceiptDraft[]; rejected: { names: string[]; reason: string }[] }

export interface PostAllResult { saved: { draftId: number; expenseId: number }[]; failed: { draftId: number; name: string; message: string }[]; skipped: number }

export interface VendorRule { id: number; companyId: number; vendorName: string; categoryId: number; categoryName: string }

export interface ReceiptEvent { draftId: number; status: DraftStatus; progress: { page: number; pages: number } | null }

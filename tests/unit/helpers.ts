import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from '../../src/db/connection';
import { CategoryService } from '../../src/services/categoryService';
import { CompanyService } from '../../src/services/companyService';
import { ExpenseService } from '../../src/services/expenseService';
import { FinancialService } from '../../src/services/financialService';
import { PropertyService } from '../../src/services/propertyService';
import { ReceiptFiles } from '../../src/services/receiptFiles';
import { ReceiptService } from '../../src/services/receiptService';
import { FakeOcr } from './fakeOcr';
import type { ExpenseInput, PropertyFields } from '../../src/shared/schemas';

export interface Stack {
  dir: string;
  db: Db;
  companies: CompanyService;
  properties: PropertyService;
  categories: CategoryService;
  expenses: ExpenseService;
  financials: FinancialService;
  files: ReceiptFiles;
  receipts: ReceiptService;
  ocr: FakeOcr;
  receiptsDir: string;
  /** Category id by name for a company (starter categories are seeded on company creation). */
  cat: (companyId: number, name: string) => number;
  cleanup: () => void;
}

export const TODAY = '2026-10-22';

/** Real SQLite in a temp folder, with the real services on top. */
export function makeStack(): Stack {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-svc-'));
  const db = openDatabase(path.join(dir, 'gable.db'));
  const companies = new CompanyService(db, path.join(dir, 'logos'));
  const properties = new PropertyService(db, companies);
  const categories = new CategoryService(db, companies);
  const receiptsDir = path.join(dir, 'receipts');
  const files = new ReceiptFiles(receiptsDir, path.join(dir, 'staging'));
  const expenses = new ExpenseService(db, companies, files);
  const financials = new FinancialService(db, () => TODAY);
  const ocr = new FakeOcr();
  const receipts = new ReceiptService(db, companies, expenses, files, ocr, { concurrency: 2, today: () => TODAY });
  const stack: Stack = {
    dir, db, companies, properties, categories, expenses, financials, files, receipts, ocr, receiptsDir,
    cat: (companyId, name) => {
      const c = categories.list(companyId, true).find((x) => x.name === name);
      if (!c) throw new Error(`no category ${name}`);
      return c.id;
    },
    // Close whichever connection is current (a test may have reopened the database) so Windows can delete the files.
    cleanup: () => {
      stack.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return stack;
}

export const company = (displayName: string) => ({ displayName, legalName: '', address: '', phone: '', email: '' });

export const prop = (over: Partial<PropertyFields> = {}): PropertyFields => ({
  address1: '125 Oak Drive', address2: '', city: 'Riverton', state: 'TN', zip: '37201',
  purchaseDate: '2025-01-15', purchasePriceCents: 20_000_000, status: 'Held',
  saleDate: null, salePriceCents: null, description: '', notes: '', ...over,
});

let keyCounter = 0;
/** A valid expense input for `s`; amounts are in cents; `cats` maps category name to cents. */
export function exp(
  s: Stack, companyId: number, propertyId: number | null, date: string, vendor: string, cats: Record<string, number>,
  over: Partial<ExpenseInput> = {},
): ExpenseInput {
  const allocations = Object.entries(cats).map(([name, amountCents]) => ({ categoryId: s.cat(companyId, name), amountCents }));
  return {
    companyId, propertyId, vendorName: vendor, expenseDate: date,
    totalCents: allocations.reduce((a, l) => a + l.amountCents, 0), allocations, notes: '',
    idempotencyKey: `test-key-${String(++keyCounter).padStart(8, '0')}`, stagedFileIds: [], ...over,
  };
}

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
export const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 2)]);

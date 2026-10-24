import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from '../../src/db/connection';
import { BusinessTypeService } from '../../src/services/businessTypeService';
import { CategoryService } from '../../src/services/categoryService';
import { IncomeService } from '../../src/services/incomeService';
import { CompanyService } from '../../src/services/companyService';
import { ExpenseService } from '../../src/services/expenseService';
import { FinancialService } from '../../src/services/financialService';
import { PropertyService } from '../../src/services/propertyService';
import { ReceiptFiles } from '../../src/services/receiptFiles';
import { ReceiptService } from '../../src/services/receiptService';
import { FakeOcr } from './fakeOcr';
import type { ExpenseInput, IncomeInput, PropertyFields } from '../../src/shared/schemas';

export interface Stack {
  dir: string;
  db: Db;
  companies: CompanyService;
  properties: PropertyService;
  businessTypes: BusinessTypeService;
  income: IncomeService;
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
  const businessTypes = new BusinessTypeService(db);
  const income = new IncomeService(db, companies);
  const categories = new CategoryService(db, companies);
  const receiptsDir = path.join(dir, 'receipts');
  const files = new ReceiptFiles(receiptsDir, path.join(dir, 'staging'));
  const expenses = new ExpenseService(db, companies, files);
  const financials = new FinancialService(db, () => TODAY);
  const ocr = new FakeOcr();
  const receipts = new ReceiptService(db, companies, expenses, files, ocr, { concurrency: 2, today: () => TODAY });
  const stack: Stack = {
    dir, db, companies, properties, businessTypes, income, categories, expenses, financials, files, receipts, ocr, receiptsDir,
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

/** A vehicle (the built-in buy-and-sell type, id 3): a name instead of an address. */
export const vehicle = (over: Partial<PropertyFields> = {}): PropertyFields => ({
  address1: '2018 Honda Accord', address2: '', city: '', state: '', zip: '', identifier: '1HGCV1F3XJA000001',
  purchaseDate: '2026-01-10', purchasePriceCents: 1_000_000, status: 'Held',
  saleDate: null, salePriceCents: null, description: '', notes: '', businessTypeId: 3, ...over,
});

/** A rental (the built-in rental type, id 2): an address, with the purchase optional. */
export const rental = (over: Partial<PropertyFields> = {}): PropertyFields => ({
  address1: '8 Elm Court', address2: '', city: 'Riverton', state: 'TN', zip: '37201',
  purchaseDate: null, purchasePriceCents: null, status: 'Held',
  saleDate: null, salePriceCents: null, description: '', notes: '', businessTypeId: 2, ...over,
});

export const RENTAL_TYPE = 2;
export const VEHICLE_TYPE = 3;

let incomeCounter = 0;
export const inc = (companyId: number, propertyId: number, date: string, cents: number, category = 'Rent', over: Partial<IncomeInput> = {}): IncomeInput => ({
  companyId, propertyId, incomeDate: date, amountCents: cents, category, notes: '', idempotencyKey: `income-key-${String(++incomeCounter).padStart(8, '0')}`, ...over,
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

import { BackupService } from '../../src/services/backup/backupService';

/** A backup service bound to a stack's folders. The stack's db handle may be replaced after a restore. */
export function backupFor(s: Stack, over: Partial<ConstructorParameters<typeof BackupService>[0]> = {}): BackupService {
  return new BackupService({
    paths: { root: s.dir, database: path.join(s.dir, 'gable.db'), receipts: s.receiptsDir, logos: path.join(s.dir, 'logos'), staging: path.join(s.dir, 'staging'), backups: path.join(s.dir, 'backups') },
    getDb: () => s.db,
    files: s.files,
    appVersion: '0.1.0-test',
    ...over,
  });
}

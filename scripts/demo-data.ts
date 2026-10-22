/**
 * Fictional demo data built through the real services, so the demo database exercises
 * the same rules as production. Names, addresses and amounts are invented.
 */
import fs from 'node:fs';
import { openDatabase } from '../src/db/connection';
import { SettingsRepository } from '../src/db/settingsRepository';
import { resolveDataPaths } from '../src/platform/paths';
import { CompanyService } from '../src/services/companyService';
import { PropertyService } from '../src/services/propertyService';
import { CategoryService } from '../src/services/categoryService';
import { ExpenseService } from '../src/services/expenseService';
import { ReceiptFiles } from '../src/services/receiptFiles';
import type { PropertyFields } from '../src/shared/schemas';

const co = (displayName: string, legalName = '') => ({ displayName, legalName, address: '', phone: '', email: '' });
const p = (over: Partial<PropertyFields>): PropertyFields => ({
  address1: '', address2: '', city: '', state: 'TN', zip: '', purchaseDate: '2025-01-15', purchasePriceCents: 0,
  status: 'Held', saleDate: null, salePriceCents: null, description: '', notes: '', ...over,
});

/** Replaces any existing data under `root` with the demo set. Never call with a real data folder. */
export function buildDemoData(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
  const paths = resolveDataPaths(root);
  const db = openDatabase(paths.database);
  const companies = new CompanyService(db, paths.logos);
  const properties = new PropertyService(db, companies);
  const categories = new CategoryService(db, companies);
  const expenses = new ExpenseService(db, companies, new ReceiptFiles(paths.receipts, paths.staging));
  let n = 0;
  /** Adds one posted expense; `lines` maps category name to dollars. */
  const spend = (companyId: number, propertyId: number | null, date: string, vendor: string, lines: Record<string, number>) => {
    const allocations = Object.entries(lines).map(([name, dollars]) => ({ categoryId: categories.list(companyId).find((c) => c.name === name)!.id, amountCents: Math.round(dollars * 100) }));
    expenses.create({ companyId, propertyId, vendorName: vendor, expenseDate: date, totalCents: allocations.reduce((a, l) => a + l.amountCents, 0), allocations, notes: '', idempotencyKey: `demo-${String(++n).padStart(6, '0')}`, stagedFileIds: [] });
  };

  const oak = companies.create(co('Oak House LLC', 'Oak House Limited Liability Company')).id;
  const cedar = companies.create(co('Cedar Homes LLC')).id;
  const north = companies.create(co('North Property LLC')).id;
  companies.setDefault(cedar);

  const oakDrive = properties.create(oak, p({ address1: '125 Oak Drive', city: 'Riverton', zip: '37201', purchaseDate: '2025-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 }));
  const willow = properties.create(oak, p({ address1: '48 Willow Court', city: 'Riverton', zip: '37205', purchaseDate: '2026-02-03', purchasePriceCents: 18_500_000, status: 'Renovating' }));
  properties.create(oak, p({ address1: "902 St. Mary's Lane", city: 'Eastbrook', zip: '37214', purchaseDate: '2021-06-22', purchasePriceCents: 14_250_000, status: 'Held' }));
  const hollow = properties.create(cedar, p({ address1: '17 Oak Hollow Road', city: 'Eastbrook', zip: '37214', purchaseDate: '2025-09-10', purchasePriceCents: 26_900_000, status: 'Listed' }));
  properties.create(cedar, p({ address1: '310 Cedar Ridge Way', city: 'Lakemont', zip: '37380', purchaseDate: '2026-04-18', purchasePriceCents: 21_000_000, status: 'Renovating' }));
  properties.create(cedar, p({ address1: '2204 Magnolia Boulevard', address2: 'Unit 3B', city: 'Lakemont', zip: '37380', purchaseDate: '2023-11-02', purchasePriceCents: 33_750_000, status: 'Held' }));
  const northgate = properties.create(north, p({ address1: '71 Northgate Terrace', city: 'Pinecrest', zip: '37402', purchaseDate: '2021-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 35_000_000 }));
  properties.create(north, p({ address1: '5 Birch Lane', city: 'Pinecrest', zip: '37402', purchaseDate: '2025-12-01', purchasePriceCents: 15_800_000, status: 'Listed' }));

  // 125 Oak Drive: the guide's standard project ($268,000 cost, $42,000 profit, 15.67%).
  spend(oak, oakDrive.id, '2025-01-15', 'Summit Title & Closing', { 'Purchase Closing Costs': 5_000 });
  spend(oak, oakDrive.id, '2025-04-10', 'Harbor Lumber & Supply', { Materials: 20_000 });
  spend(oak, oakDrive.id, '2026-01-20', 'Brightline Electric', { Labor: 15_000 });
  spend(oak, oakDrive.id, '2025-09-30', 'First Lender Bank', { 'Financing Interest & Fees': 10_000 });
  spend(oak, oakDrive.id, '2026-03-15', 'Summit Title & Closing', { 'Realtor Commissions': 15_000, 'Seller Closing Costs': 3_000 });
  spend(oak, null, '2026-02-01', 'Northfield Insurance', { Insurance: 1_000 }); // company overhead: not part of any property's profit
  spend(oak, willow.id, '2026-09-18', 'Harbor Lumber & Supply', { Materials: 1_842.5 });
  spend(oak, willow.id, '2026-09-12', 'Brightline Electric', { Electrical: 4_200 });
  spend(cedar, hollow.id, '2026-08-20', 'Keystone Plumbing Co.', { Plumbing: 3_125.75 });

  // 71 Northgate Terrace: the guide's historical project, 2021 to 2026 ($280,000 cost, $70,000 profit, 25%).
  spend(north, northgate.id, '2021-01-15', 'Summit Title & Closing', { 'Purchase Closing Costs': 5_000 });
  spend(north, northgate.id, '2022-06-01', 'Redwood Hardware', { Labor: 15_000, Materials: 10_000 });
  spend(north, northgate.id, '2023-05-01', 'County Trustee', { 'Property Taxes': 5_000, Insurance: 3_000 });
  spend(north, northgate.id, '2024-07-01', 'Keystone Plumbing Co.', { Maintenance: 12_000 });
  spend(north, northgate.id, '2025-08-01', 'First Lender Bank', { 'Financing Interest & Fees': 10_000 });
  spend(north, northgate.id, '2026-03-15', 'Summit Title & Closing', { 'Realtor Commissions': 15_000, 'Seller Closing Costs': 5_000 });

  new SettingsRepository(db).set('app.demoData', '1');
  db.close();
}

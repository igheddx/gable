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

  const oak = companies.create(co('Oak House LLC', 'Oak House Limited Liability Company')).id;
  const cedar = companies.create(co('Cedar Homes LLC')).id;
  const north = companies.create(co('North Property LLC')).id;
  companies.setDefault(cedar);

  properties.create(oak, p({ address1: '125 Oak Drive', city: 'Riverton', zip: '37201', purchaseDate: '2025-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 31_000_000 }));
  properties.create(oak, p({ address1: '48 Willow Court', city: 'Riverton', zip: '37205', purchaseDate: '2026-02-03', purchasePriceCents: 18_500_000, status: 'Renovating' }));
  properties.create(oak, p({ address1: "902 St. Mary's Lane", city: 'Eastbrook', zip: '37214', purchaseDate: '2021-06-22', purchasePriceCents: 14_250_000, status: 'Held' }));
  properties.create(cedar, p({ address1: '17 Oak Hollow Road', city: 'Eastbrook', zip: '37214', purchaseDate: '2025-09-10', purchasePriceCents: 26_900_000, status: 'Listed' }));
  properties.create(cedar, p({ address1: '310 Cedar Ridge Way', city: 'Lakemont', zip: '37380', purchaseDate: '2026-04-18', purchasePriceCents: 21_000_000, status: 'Renovating' }));
  properties.create(cedar, p({ address1: '2204 Magnolia Boulevard', address2: 'Unit 3B', city: 'Lakemont', zip: '37380', purchaseDate: '2023-11-02', purchasePriceCents: 33_750_000, status: 'Held' }));
  properties.create(north, p({ address1: '71 Northgate Terrace', city: 'Pinecrest', zip: '37402', purchaseDate: '2021-01-15', purchasePriceCents: 20_000_000, status: 'Sold', saleDate: '2026-03-15', salePriceCents: 35_000_000 }));
  properties.create(north, p({ address1: '5 Birch Lane', city: 'Pinecrest', zip: '37402', purchaseDate: '2025-12-01', purchasePriceCents: 15_800_000, status: 'Listed' }));

  new SettingsRepository(db).set('app.demoData', '1');
  db.close();
}

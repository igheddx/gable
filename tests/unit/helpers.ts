import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Db } from '../../src/db/connection';
import { CompanyService } from '../../src/services/companyService';
import { PropertyService } from '../../src/services/propertyService';
import type { PropertyFields } from '../../src/shared/schemas';

export interface Stack {
  dir: string;
  db: Db;
  companies: CompanyService;
  properties: PropertyService;
  cleanup: () => void;
}

/** Real SQLite in a temp folder, with the real services on top. */
export function makeStack(): Stack {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gable-svc-'));
  const db = openDatabase(path.join(dir, 'gable.db'));
  const companies = new CompanyService(db, path.join(dir, 'logos'));
  const properties = new PropertyService(db, companies);
  return {
    dir, db, companies, properties,
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const company = (displayName: string) => ({ displayName, legalName: '', address: '', phone: '', email: '' });

export const prop = (over: Partial<PropertyFields> = {}): PropertyFields => ({
  address1: '125 Oak Drive', address2: '', city: 'Riverton', state: 'TN', zip: '37201',
  purchaseDate: '2025-01-15', purchasePriceCents: 20_000_000, status: 'Held',
  saleDate: null, salePriceCents: null, description: '', notes: '', ...over,
});

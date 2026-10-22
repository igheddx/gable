/**
 * FICTIONAL SAMPLE DATA for the design preview. Names, addresses and amounts are invented.
 * Replaced by real database records in later stages.
 */

export interface FxCompany { id: string; name: string }
export interface FxProperty {
  id: string; companyId: string; address: string; city: string; state: string; zip: string;
  status: 'Held' | 'Renovating' | 'Listed' | 'Sold'; purchaseDate: string; purchaseCents: number;
}
export interface FxExpense {
  id: string; companyId: string; propertyId: string | null; vendor: string; date: string;
  category: string; cents: number; preview?: boolean;
}

export const COMPANIES: FxCompany[] = [
  { id: 'oak', name: 'Oak House LLC' },
  { id: 'cedar', name: 'Cedar Homes LLC' },
  { id: 'north', name: 'North Property LLC' },
];

export const PROPERTIES: FxProperty[] = [
  { id: 'p1', companyId: 'oak', address: '125 Oak Drive', city: 'Riverton', state: 'TN', zip: '37201', status: 'Sold', purchaseDate: '2025-01-15', purchaseCents: 20_000_000 },
  { id: 'p2', companyId: 'oak', address: '48 Willow Court', city: 'Riverton', state: 'TN', zip: '37205', status: 'Renovating', purchaseDate: '2026-02-03', purchaseCents: 18_500_000 },
  { id: 'p3', companyId: 'oak', address: "902 St. Mary's Lane", city: 'Eastbrook', state: 'TN', zip: '37214', status: 'Held', purchaseDate: '2021-06-22', purchaseCents: 14_250_000 },
  { id: 'p4', companyId: 'cedar', address: '17 Oak Hollow Road', city: 'Eastbrook', state: 'TN', zip: '37214', status: 'Listed', purchaseDate: '2025-09-10', purchaseCents: 26_900_000 },
  { id: 'p5', companyId: 'cedar', address: '310 Cedar Ridge Way', city: 'Lakemont', state: 'TN', zip: '37380', status: 'Renovating', purchaseDate: '2026-04-18', purchaseCents: 21_000_000 },
  { id: 'p6', companyId: 'cedar', address: '2204 Magnolia Boulevard, Unit 3B', city: 'Lakemont', state: 'TN', zip: '37380', status: 'Held', purchaseDate: '2023-11-02', purchaseCents: 33_750_000 },
  { id: 'p7', companyId: 'north', address: '71 Northgate Terrace', city: 'Pinecrest', state: 'TN', zip: '37402', status: 'Sold', purchaseDate: '2021-01-15', purchaseCents: 20_000_000 },
  { id: 'p8', companyId: 'north', address: '5 Birch Lane', city: 'Pinecrest', state: 'TN', zip: '37402', status: 'Listed', purchaseDate: '2025-12-01', purchaseCents: 15_800_000 },
];

export const CATEGORIES = [
  'Materials', 'Labor', 'Plumbing', 'Electrical', 'Permits', 'Utilities', 'Insurance', 'Property Taxes',
  'Financing Interest & Fees', 'Maintenance', 'Purchase Closing Costs', 'Realtor Commissions',
  'Seller Closing Costs', 'Other Selling Costs', 'Other',
];

export const VENDORS = [
  'Harbor Lumber & Supply', 'Brightline Electric', 'Keystone Plumbing Co.', 'City Permit Office',
  'Summit Title & Closing', 'Northfield Insurance', 'Redwood Hardware', 'Metro Utilities',
];

export const SEED_EXPENSES: FxExpense[] = [
  { id: 'e1', companyId: 'oak', propertyId: 'p2', vendor: 'Harbor Lumber & Supply', date: '2026-09-18', category: 'Materials', cents: 184_250 },
  { id: 'e2', companyId: 'oak', propertyId: 'p2', vendor: 'Brightline Electric', date: '2026-09-12', category: 'Electrical', cents: 420_000 },
  { id: 'e3', companyId: 'oak', propertyId: null, vendor: 'Northfield Insurance', date: '2026-09-01', category: 'Insurance', cents: 100_000 },
  { id: 'e4', companyId: 'cedar', propertyId: 'p5', vendor: 'City Permit Office', date: '2026-08-27', category: 'Permits', cents: 65_000 },
  { id: 'e5', companyId: 'cedar', propertyId: 'p4', vendor: 'Keystone Plumbing Co.', date: '2026-08-20', category: 'Plumbing', cents: 312_575 },
  { id: 'e6', companyId: 'north', propertyId: 'p8', vendor: 'Redwood Hardware', date: '2026-08-11', category: 'Materials', cents: 8_940 },
];

export type ReceiptStatus = 'Processing' | 'Needs review' | 'Reviewed' | 'Failed' | 'Skipped';

export interface FxReceipt {
  id: string;
  file: string;
  pages: number;
  companyId: string;
  propertyId: string | null;
  status: ReceiptStatus;
  /** Sample suggestions standing in for OCR output. Null when "OCR failed". */
  suggestion: { vendor: string; date: string; total: string; category: string; categorySource: string } | null;
  /** Lines printed on the synthetic sample receipt. */
  lines: [string, string][];
  duplicateOf?: string;
  note?: string;
}

export const RECEIPTS: FxReceipt[] = [
  {
    id: 'r1', file: 'harbor-lumber-0918.jpg', pages: 1, companyId: 'oak', propertyId: 'p2', status: 'Needs review',
    suggestion: { vendor: 'Harbor Lumber & Supply', date: '09/18/2026', total: '184.25', category: 'Materials', categorySource: 'Based on your vendor rule' },
    lines: [['2x4x8 Stud', '62.40'], ['Drywall 1/2 in', '71.10'], ['Screws 5lb', '18.95'], ['SUBTOTAL', '152.45'], ['TAX', '12.80'], ['TOTAL', '165.25'], ['CASH TENDERED', '184.25'], ['CHANGE', '19.00']],
    note: 'Two amounts look like totals. Check which is correct.',
  },
  {
    id: 'r2', file: 'brightline-invoice-2231.pdf', pages: 3, companyId: 'oak', propertyId: 'p2', status: 'Needs review',
    suggestion: { vendor: 'Brightline Electric', date: '09/12/2026', total: '4,200.00', category: 'Electrical', categorySource: 'Keyword match: "electric"' },
    lines: [['Panel upgrade labor', '2,800.00'], ['Breakers and wire', '1,100.00'], ['Permit pass-through', '300.00'], ['AMOUNT DUE', '4,200.00']],
  },
  {
    id: 'r3', file: 'IMG_4471.jpg', pages: 1, companyId: 'oak', propertyId: 'p2', status: 'Failed', suggestion: null,
    lines: [['(image too dark to read)', '']],
    note: 'Text could not be read from this file. Enter the details by hand, or try again.',
  },
  {
    id: 'r4', file: 'redwood-hardware.png', pages: 1, companyId: 'oak', propertyId: 'p3', status: 'Needs review',
    suggestion: { vendor: 'Redwood Hardware', date: '09/03/2026', total: '58.12', category: '', categorySource: '' },
    lines: [['Hinges (4)', '19.96'], ['Paint tray set', '14.50'], ['Caulk', '9.80'], ['Sales tax', '3.86'], ['TOTAL', '58.12']],
    duplicateOf: 'Redwood Hardware, 09/03/2026, $58.12 (saved 09/04/2026)',
  },
  {
    id: 'r5', file: 'metro-utilities-sept.pdf', pages: 1, companyId: 'oak', propertyId: 'p3', status: 'Reviewed',
    suggestion: { vendor: 'Metro Utilities', date: '09/05/2026', total: '143.77', category: 'Utilities', categorySource: 'Based on your vendor rule' },
    lines: [['Water/sewer', '89.20'], ['Electric', '54.57'], ['TOTAL DUE', '143.77']],
  },
  {
    id: 'r6', file: 'scan-0007.pdf', pages: 2, companyId: 'oak', propertyId: null, status: 'Processing', suggestion: null,
    lines: [['(reading text...)', '']],
  },
];

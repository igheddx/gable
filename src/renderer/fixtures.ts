/**
 * FICTIONAL SAMPLE DATA for the design preview. Names, addresses and amounts are invented.
 * Replaced by real database records in later stages.
 */

export interface FxExpense {
  id: string; companyId: number; propertyId: number | null; vendor: string; date: string;
  category: string; cents: number; preview?: boolean;
}

export const CATEGORIES = [
  'Materials', 'Labor', 'Plumbing', 'Electrical', 'Permits', 'Utilities', 'Insurance', 'Property Taxes',
  'Financing Interest & Fees', 'Maintenance', 'Purchase Closing Costs', 'Realtor Commissions',
  'Seller Closing Costs', 'Other Selling Costs', 'Other',
];

export const VENDORS = [
  'Harbor Lumber & Supply', 'Brightline Electric', 'Keystone Plumbing Co.', 'City Permit Office',
  'Summit Title & Closing', 'Northfield Insurance', 'Redwood Hardware', 'Metro Utilities',
];

export type ReceiptStatus = 'Processing' | 'Needs review' | 'Reviewed' | 'Failed' | 'Skipped';

export interface FxReceipt {
  id: string;
  file: string;
  pages: number;
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
    id: 'r1', file: 'harbor-lumber-0918.jpg', pages: 1, status: 'Needs review',
    suggestion: { vendor: 'Harbor Lumber & Supply', date: '09/18/2026', total: '184.25', category: 'Materials', categorySource: 'Based on your vendor rule' },
    lines: [['2x4x8 Stud', '62.40'], ['Drywall 1/2 in', '71.10'], ['Screws 5lb', '18.95'], ['SUBTOTAL', '152.45'], ['TAX', '12.80'], ['TOTAL', '165.25'], ['CASH TENDERED', '184.25'], ['CHANGE', '19.00']],
    note: 'Two amounts look like totals. Check which is correct.',
  },
  {
    id: 'r2', file: 'brightline-invoice-2231.pdf', pages: 3, status: 'Needs review',
    suggestion: { vendor: 'Brightline Electric', date: '09/12/2026', total: '4,200.00', category: 'Electrical', categorySource: 'Keyword match: "electric"' },
    lines: [['Panel upgrade labor', '2,800.00'], ['Breakers and wire', '1,100.00'], ['Permit pass-through', '300.00'], ['AMOUNT DUE', '4,200.00']],
  },
  {
    id: 'r3', file: 'IMG_4471.jpg', pages: 1, status: 'Failed', suggestion: null,
    lines: [['(image too dark to read)', '']],
    note: 'Text could not be read from this file. Enter the details by hand, or try again.',
  },
  {
    id: 'r4', file: 'redwood-hardware.png', pages: 1, status: 'Needs review',
    suggestion: { vendor: 'Redwood Hardware', date: '09/03/2026', total: '58.12', category: '', categorySource: '' },
    lines: [['Hinges (4)', '19.96'], ['Paint tray set', '14.50'], ['Caulk', '9.80'], ['Sales tax', '3.86'], ['TOTAL', '58.12']],
    duplicateOf: 'Redwood Hardware, 09/03/2026, $58.12 (saved 09/04/2026)',
  },
  {
    id: 'r5', file: 'metro-utilities-sept.pdf', pages: 1, status: 'Reviewed',
    suggestion: { vendor: 'Metro Utilities', date: '09/05/2026', total: '143.77', category: 'Utilities', categorySource: 'Based on your vendor rule' },
    lines: [['Water/sewer', '89.20'], ['Electric', '54.57'], ['TOTAL DUE', '143.77']],
  },
  {
    id: 'r6', file: 'scan-0007.pdf', pages: 2, status: 'Processing', suggestion: null,
    lines: [['(reading text...)', '']],
  },
];

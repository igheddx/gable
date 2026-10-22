import { describe, expect, it } from 'vitest';
import { keywordCategory, parseDate, parseReceiptText, parseTotal, parseVendor } from '../../src/shared/receiptParser';

const TODAY = '2026-10-22';
const lines = (s: string) => s.split('\n');

describe('total parsing', () => {
  it('prefers the labeled total over subtotal, tax, cash tendered and change', () => {
    const t = parseTotal(lines(`Drywall 71.10
Screws 18.95
SUBTOTAL 152.45
TAX 12.80
TOTAL 165.25
CASH TENDERED 184.25
CHANGE 19.00`));
    expect(t).toMatchObject({ cents: 16_525, labeled: true, ambiguous: false });
  });

  it('ignores "total tax" and "subtotal" lines and handles thousands separators', () => {
    expect(parseTotal(lines('Sub total 4,000.00\nTotal tax 200.00\nAmount due $4,200.00'))).toMatchObject({ cents: 420_000, labeled: true, label: 'amount due' });
  });

  it('flags two different labeled totals as ambiguous and keeps both as candidates', () => {
    const t = parseTotal(lines('TOTAL 120.00\nSurcharge 15.00\nTOTAL DUE 135.00'))!;
    expect(t.cents).toBe(13_500); // the stronger label wins, but it is flagged
    expect(t.ambiguous).toBe(true);
    expect(t.candidates).toEqual(expect.arrayContaining([12_000, 13_500]));
  });

  it('finds an amount on the line after the label', () => {
    expect(parseTotal(lines('GRAND TOTAL\n$58.12'))).toMatchObject({ cents: 5_812, labeled: true });
  });

  it('with no label, offers the largest amount as an unlabeled, ambiguous guess', () => {
    const t = parseTotal(lines('Hinges 19.96\nPaint tray 14.50\nCaulk 9.80'))!;
    expect(t).toMatchObject({ cents: 1_996, labeled: false, ambiguous: true });
  });

  it('returns null when there are no amounts and never invents one from other numbers', () => {
    expect(parseTotal(lines('Invoice 20250 Total items 4\nPO 1234'))).toBeNull();
  });
});

describe('date parsing', () => {
  it('reads US numeric, ISO and month-name formats', () => {
    expect(parseDate(['Date: 09/18/2026'], TODAY)?.iso).toBe('2026-09-18');
    expect(parseDate(['9/5/26'], TODAY)?.iso).toBe('2026-09-05');
    expect(parseDate(['2026-03-15'], TODAY)?.iso).toBe('2026-03-15');
    expect(parseDate(['Sep 18, 2026'], TODAY)?.iso).toBe('2026-09-18');
    expect(parseDate(['18 September 2026'], TODAY)?.iso).toBe('2026-09-18');
    expect(parseDate(['25/12/2025'], TODAY)?.iso).toBe('2025-12-25'); // 25 can only be a day
  });

  it('skips due, expiry and terms dates, and implausible years', () => {
    expect(parseDate(['Due date 10/30/2026', 'Invoice date 09/12/2026'], TODAY)).toMatchObject({ iso: '2026-09-12', ambiguous: false });
    expect(parseDate(['Valid until 01/01/2030'], TODAY)).toBeNull();
    expect(parseDate(['02/30/2026'], TODAY)).toBeNull();
    expect(parseDate(['01/01/1985'], TODAY)).toBeNull();
  });

  it('marks several different dates as ambiguous and prefers a labeled one', () => {
    const d = parseDate(['Printed 09/20/2026', 'Invoice date 09/12/2026'], TODAY)!;
    expect(d.iso).toBe('2026-09-12');
    expect(d.ambiguous).toBe(true);
    expect(d.candidates).toEqual(['2026-09-20', '2026-09-12']);
  });
});

describe('vendor parsing', () => {
  it('takes the first real name line and skips receipt words, addresses, phones and dates', () => {
    const v = parseVendor(lines('RECEIPT\n123 Main Street\n(615) 555-0142\nHARBOR LUMBER & SUPPLY\n09/18/2026'))!;
    expect(v.value).toBe('Harbor Lumber & Supply');
  });

  it('prefers an exact known vendor, but never fuzzy-matches', () => {
    expect(parseVendor(lines('Welcome\nharbor lumber & supply'), ['Harbor Lumber & Supply'])).toMatchObject({ value: 'Harbor Lumber & Supply', matchedKnown: true });
    expect(parseVendor(lines('Harbour Lumber & Supply'), ['Harbor Lumber & Supply'])).toMatchObject({ value: 'Harbour Lumber & Supply', matchedKnown: false });
  });

  it('returns null when nothing looks like a name', () => {
    expect(parseVendor(lines('12345\n$5.00\n09/18/2026'))).toBeNull();
  });
});

describe('whole receipt', () => {
  it('parses a typical receipt end to end', () => {
    const r = parseReceiptText(`Brightline Electric
Invoice date 09/12/2026
Panel upgrade labor 2,800.00
--- page 2 ---
AMOUNT DUE 4,200.00`, { today: TODAY });
    expect(r.vendor?.value).toBe('Brightline Electric');
    expect(r.date?.iso).toBe('2026-09-12');
    expect(r.total?.cents).toBe(420_000);
  });
});

describe('category keywords', () => {
  it('suggests from words, with a contractor named Electric treated as Electrical but a utility as Utilities', () => {
    expect(keywordCategory('Harbor Lumber & Supply')?.category).toBe('Materials');
    expect(keywordCategory('Brightline Electric')?.category).toBe('Electrical');
    expect(keywordCategory('Brightline Electric Co.')?.category).toBe('Electrical'); // "Co." is too ambiguous to call a utility
    expect(keywordCategory('Middle Tennessee Electric Cooperative')?.category).toBe('Utilities');
    expect(keywordCategory('Metro Utilities')?.category).toBe('Utilities');
    expect(keywordCategory('Keystone Plumbing Co.')?.category).toBe('Plumbing');
    expect(keywordCategory('Joe\'s Diner')).toBeNull();
  });
});

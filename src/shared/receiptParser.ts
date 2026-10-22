import { isValidIsoDate } from './dates';
import { normalizeSearch } from './search';

/**
 * Transparent, deterministic extraction of suggestions from receipt text.
 * Output is only ever a suggestion for a person to review; OCR confidence is never used as proof.
 */

export interface ParsedReceipt {
  vendor: { value: string; candidates: string[]; matchedKnown: boolean } | null;
  date: { iso: string; candidates: string[]; ambiguous: boolean } | null;
  total: { cents: number; candidates: number[]; ambiguous: boolean; labeled: boolean; label: string } | null;
}

const AMOUNT = /(?:[$S]\s?)?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g;
const NOT_A_TOTAL = /\b(sub\s?-?total|tax|vat|tendered|cash|change|tip|gratuity|discount|savings|you saved|balance forward|previous balance|credit card|visa|mastercard|amex|payment)\b/;
const STRONG_TOTAL = /\b(grand total|total due|amount due|balance due|total amount|invoice total|amount payable|total payable|total to pay)\b/;
const PLAIN_TOTAL = /\btotal\b/;

function amountsIn(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const cents = Number(m[1]!.replace(/,/g, '')) * 100 + Number(m[2]);
    if (cents > 0 && cents <= 99_999_999_999) out.push(cents);
  }
  return out;
}

export function parseTotal(lines: string[]): ParsedReceipt['total'] {
  type Cand = { cents: number; score: number; label: string; index: number };
  const cands: Cand[] = [];
  lines.forEach((raw, i) => {
    const line = raw.toLowerCase();
    const strong = STRONG_TOTAL.test(line);
    const plain = !strong && PLAIN_TOTAL.test(line);
    if (!strong && !plain) return;
    // "Total tax" and "subtotal" lines describe parts, not the amount owed.
    if (NOT_A_TOTAL.test(line.replace(STRONG_TOTAL, ''))) return;
    let found = amountsIn(raw);
    if (found.length === 0) {
      // Layout with the label on one line and the amount on the next.
      const next = lines.slice(i + 1, i + 3).find((l) => amountsIn(l).length > 0 && !NOT_A_TOTAL.test(l.toLowerCase()));
      if (next) found = amountsIn(next);
    }
    if (found.length === 0) return;
    cands.push({ cents: found[found.length - 1]!, score: strong ? 100 : 80, label: strong ? (line.match(STRONG_TOTAL)![0]) : 'total', index: i });
  });

  if (cands.length > 0) {
    const distinct = [...new Set(cands.map((c) => c.cents))];
    const top = Math.max(...cands.map((c) => c.score));
    const best = [...cands].filter((c) => c.score === top).sort((a, b) => b.index - a.index)[0]!;
    return { cents: best.cents, candidates: distinct, ambiguous: distinct.length > 1, labeled: true, label: best.label };
  }

  // Nothing labeled: offer the largest plausible amount, clearly marked as a guess.
  const guesses = lines.flatMap((l) => (NOT_A_TOTAL.test(l.toLowerCase()) ? [] : amountsIn(l)));
  if (guesses.length === 0) return null;
  const distinct = [...new Set(guesses)].sort((a, b) => b - a);
  return { cents: distinct[0]!, candidates: distinct.slice(0, 5), ambiguous: true, labeled: false, label: 'largest amount' };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SKIP_DATE_LINE = /\b(due|expir\w*|valid|exp|pay by|terms|net \d+|good until|renew\w*)\b/i;
const DATE_LABEL = /\b(date|invoice|inv|issued|purchased|transaction|sale)\b/i;

function pad(n: number): string { return String(n).padStart(2, '0'); }

function toIso(y: number, m: number, d: number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidIsoDate(iso) ? iso : null;
}

function datesIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) out.push(iso);
  }
  for (const m of line.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g)) {
    let a = Number(m[1]); let b = Number(m[2]);
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    // United States format is month first; a first number above 12 can only be a day.
    if (a > 12 && b <= 12) [a, b] = [b, a];
    const iso = toIso(y, a, b);
    if (iso) out.push(iso);
  }
  const monthName = new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi');
  for (const m of line.matchAll(monthName)) {
    const iso = toIso(Number(m[3]), MONTHS.indexOf(m[1]!.toLowerCase()) + 1, Number(m[2]));
    if (iso) out.push(iso);
  }
  const dayFirst = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*\\.?,?\\s+(\\d{4})\\b`, 'gi');
  for (const m of line.matchAll(dayFirst)) {
    const iso = toIso(Number(m[3]), MONTHS.indexOf(m[2]!.toLowerCase()) + 1, Number(m[1]));
    if (iso) out.push(iso);
  }
  return out;
}

export function parseDate(lines: string[], today: string): ParsedReceipt['date'] {
  const horizon = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const found: { iso: string; labeled: boolean; index: number }[] = [];
  lines.forEach((line, index) => {
    if (SKIP_DATE_LINE.test(line)) return;
    for (const iso of datesIn(line)) {
      if (iso < '2000-01-01' || iso > horizon) continue;
      found.push({ iso, labeled: DATE_LABEL.test(line), index });
    }
  });
  if (found.length === 0) return null;
  const distinct = [...new Set(found.map((f) => f.iso))];
  const labeled = found.filter((f) => f.labeled);
  const pick = (labeled.length > 0 ? labeled : found).sort((a, b) => a.index - b.index)[0]!;
  return { iso: pick.iso, candidates: distinct, ambiguous: distinct.length > 1 };
}

const NOISE_LINE = /\b(receipt|invoice|order|customer copy|merchant copy|thank you|welcome|tel|phone|fax|www|http|store\s?#?\d*|cashier|sold to|bill to|ship to|page \d+|sample|fictional|copy|duplicate)\b|@|\.com\b/i;
const ADDRESS_LINE = /^\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|hwy|highway|pkwy|suite|ste)\b\.?/i;
const PHONE = /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/;

function cleanVendor(s: string): string {
  const t = s.replace(/[|_~=*#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const letters = t.replace(/[^A-Za-z]/g, '');
  const isCaps = letters.length > 2 && letters === letters.toUpperCase();
  return isCaps ? t.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Co|Corp)\b/g, (w) => (w === 'Llc' ? 'LLC' : w)) : t;
}

export function parseVendor(lines: string[], knownVendors: string[] = []): ParsedReceipt['vendor'] {
  const top = lines.slice(0, 12).map((l) => l.trim()).filter(Boolean);
  const candidates = top.filter((l) => {
    const letters = l.replace(/[^A-Za-z]/g, '').length;
    if (letters < 3) return false;
    if (letters < l.replace(/\s/g, '').length / 2) return false; // mostly digits and symbols
    if (NOISE_LINE.test(l) || ADDRESS_LINE.test(l) || PHONE.test(l)) return false;
    if (datesIn(l).length > 0 || amountsIn(l).length > 0) return false;
    return true;
  }).map(cleanVendor);
  if (candidates.length === 0) return null;
  const known = new Map(knownVendors.map((v) => [normalizeSearch(v), v]));
  const hit = candidates.find((c) => known.has(normalizeSearch(c)));
  if (hit) return { value: known.get(normalizeSearch(hit))!, candidates: candidates.slice(0, 4), matchedKnown: true };
  return { value: candidates[0]!, candidates: candidates.slice(0, 4), matchedKnown: false };
}

export function parseReceiptText(text: string, opts: { today: string; knownVendors?: string[] }): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !/^---\s*page\s*\d+\s*---$/i.test(l));
  return { vendor: parseVendor(lines, opts.knownVendors), date: parseDate(lines, opts.today), total: parseTotal(lines) };
}

/**
 * Category keyword hints, applied only when no vendor rule exists. Each entry names a starter
 * category; a company that has renamed or archived it simply gets no suggestion.
 */
export const CATEGORY_KEYWORDS: ReadonlyArray<{ category: string; words: RegExp }> = [
  { category: 'Utilities', words: /\b(utilit\w*|water dept|sewer|power (co|company)|light (&|and) power|energy|gas (co|company)|electric (coop|cooperative))\b/i },
  { category: 'Electrical', words: /\b(electric\w*|wiring|breaker|conduit)\b/i },
  { category: 'Plumbing', words: /\b(plumb\w*|pipe|faucet|water heater|drain)\b/i },
  { category: 'Permits', words: /\b(permit\w*|inspection|building dept|code enforcement)\b/i },
  { category: 'Insurance', words: /\b(insurance|assurance|underwriters)\b/i },
  { category: 'Property Taxes', words: /\b(trustee|tax collector|property tax|county tax|assessor)\b/i },
  { category: 'Materials', words: /\b(lumber|drywall|hardware|supply|supplies|paint|flooring|tile|roofing|concrete|building materials)\b/i },
  { category: 'Labor', words: /\b(labor|labour|contractor|contracting|construction|handyman|carpentry|framing)\b/i },
];

export function keywordCategory(text: string): { category: string; word: string } | null {
  for (const k of CATEGORY_KEYWORDS) {
    const m = k.words.exec(text);
    if (m) return { category: k.category, word: m[0].toLowerCase() };
  }
  return null;
}

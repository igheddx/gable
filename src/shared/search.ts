/**
 * Search text normalization shared by indexing and querying so that punctuation,
 * apostrophes, case and accents never cause a miss ("St. Mary's" matches "marys").
 */
export function normalizeSearch(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function searchTokens(input: string): string[] {
  const n = normalizeSearch(input);
  return n === '' ? [] : n.split(' ');
}

/**
 * A key for matching the same vendor across receipts: like normalizeSearch, but ignores store
 * numbers and filler ("Home Depot #1234", "Home Depot Store 77" are the same vendor).
 * Matching is exact on this key. There is no fuzzy matching.
 */
export function vendorKey(name: string): string {
  const words = normalizeSearch(name).split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (/^\d+$/.test(w)) continue; // store and branch numbers
    if ((w === 'store' || w === 'no' || w === 'number') && (i === words.length - 1 || /^\d+$/.test(words[i + 1]!))) continue;
    out.push(w);
  }
  return out.join(' ');
}

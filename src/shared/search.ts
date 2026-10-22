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

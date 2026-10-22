/** Date-only values are 'YYYY-MM-DD' strings with no timezone. */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export type DateParse = { ok: true; iso: string } | { ok: false; message: string };

/** Accepts MM/DD/YYYY (also M/D/YYYY and MM-DD-YYYY, or an ISO date). */
export function parseUsDate(input: string): DateParse {
  const s = input.trim();
  if (s === '') return { ok: false, message: 'Enter a date.' };
  if (ISO.test(s)) return isValidIsoDate(s) ? { ok: true, iso: s } : { ok: false, message: 'That date does not exist.' };
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return { ok: false, message: 'Use the format MM/DD/YYYY.' };
  const iso = `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  return isValidIsoDate(iso) ? { ok: true, iso } : { ok: false, message: 'That date does not exist.' };
}

export function formatUsDate(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

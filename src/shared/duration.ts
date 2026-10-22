import { isValidIsoDate } from './dates';

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). Same day is 0. No timezone or DST effects. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export interface Ymd { years: number; months: number; days: number }

/**
 * Calendar-aware years/months/days from `from` to `to` (inclusive of neither end semantics:
 * 2021-01-15 to 2026-03-15 is 5 years 2 months 0 days). Month ends clamp: Jan 31 + 1 month = Feb 28/29.
 */
export function ymdBetween(from: string, to: string): Ymd {
  if (!isValidIsoDate(from) || !isValidIsoDate(to) || to < from) throw new Error('Invalid date range');
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number, number];
  let totalMonths = (ty - fy) * 12 + (tm - fm);
  // Anniversary day in the target month, clamped to that month's length.
  const clampedDay = (y: number, m: number) => Math.min(fd, new Date(Date.UTC(y, m, 0)).getUTCDate());
  const monthAnchor = (n: number): [number, number] => {
    const idx = fm - 1 + n;
    return [fy + Math.floor(idx / 12), (((idx % 12) + 12) % 12) + 1];
  };
  let [ay, am] = monthAnchor(totalMonths);
  if (to < `${ay}-${String(am).padStart(2, '0')}-${String(clampedDay(ay, am)).padStart(2, '0')}`) {
    totalMonths -= 1;
    [ay, am] = monthAnchor(totalMonths);
  }
  const anchor = `${ay}-${String(am).padStart(2, '0')}-${String(clampedDay(ay, am)).padStart(2, '0')}`;
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days: daysBetween(anchor, to) };
}

export function formatYmd({ years, months, days }: Ymd): string {
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [years && part(years, 'year'), months && part(months, 'month'), days && part(days, 'day')].filter(Boolean);
  return parts.length ? (parts as string[]).join(' ') : '0 days';
}

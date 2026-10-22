import { todayIso } from '../shared/dates';

export interface Period { key: string; label: string; from: string | null; to: string | null }

/** Ready-made date ranges. "to" for the current year is the year end, so future-dated records are not hidden. */
export function periodPresets(today: string = todayIso()): Period[] {
  const y = Number(today.slice(0, 4));
  const yearAgo = `${y - 1}${today.slice(4)}`;
  return [
    { key: 'this-year', label: `This year (${y})`, from: `${y}-01-01`, to: `${y}-12-31` },
    { key: 'last-year', label: `Last year (${y - 1})`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
    { key: 'last-12', label: 'Last 12 months', from: yearAgo, to: today },
    { key: 'all', label: 'All dates', from: null, to: null },
    { key: 'custom', label: 'Choose dates…', from: null, to: null },
  ];
}

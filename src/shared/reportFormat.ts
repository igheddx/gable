import { formatBasisPoints, formatCents } from './money';
import { formatUsDate } from './dates';
import type { Cell, CellType } from './reportTypes';

/** How a report cell is written for people: the same on screen and in the PDF. */
export function formatCell(v: Cell, type: CellType): string {
  if (v === null || v === '') return '';
  if (typeof v === 'string') return type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatUsDate(v) : v;
  switch (type) {
    case 'money': return formatCents(v);
    case 'percent': return formatBasisPoints(v);
    case 'int': case 'days': return v.toLocaleString('en-US');
    case 'year': return String(v); // 2021, never 2,021
    default: return String(v);
  }
}

export const isNumericType = (t: CellType): boolean => t === 'money' || t === 'int' || t === 'days' || t === 'percent' || t === 'year';

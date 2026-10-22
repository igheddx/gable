import { describe, expect, it } from 'vitest';
import { daysBetween, formatYmd, ymdBetween } from '../../src/shared/duration';
import { normalizeSearch, searchTokens } from '../../src/shared/search';

describe('daysBetween', () => {
  it('matches the guide fixtures', () => {
    expect(daysBetween('2021-01-15', '2026-03-15')).toBe(1885);
    expect(daysBetween('2025-01-15', '2026-03-15')).toBe(424);
  });
  it('same day is zero and leap years count', () => {
    expect(daysBetween('2026-03-15', '2026-03-15')).toBe(0);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2025-02-28', '2025-03-01')).toBe(1);
    expect(daysBetween('2023-12-31', '2024-12-31')).toBe(366);
  });
  it('is unaffected by daylight-saving transitions', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // US spring forward 2026-03-08
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2); // fall back 2026-11-01
  });
});

describe('ymdBetween', () => {
  it('matches the guide fixtures', () => {
    expect(ymdBetween('2021-01-15', '2026-03-15')).toEqual({ years: 5, months: 2, days: 0 });
    expect(formatYmd(ymdBetween('2021-01-15', '2026-03-15'))).toBe('5 years 2 months');
    expect(ymdBetween('2025-01-15', '2026-03-15')).toEqual({ years: 1, months: 2, days: 0 });
  });
  it('handles same day, singular units and plain days', () => {
    expect(formatYmd(ymdBetween('2026-03-15', '2026-03-15'))).toBe('0 days');
    expect(formatYmd(ymdBetween('2025-03-15', '2026-04-16'))).toBe('1 year 1 month 1 day');
    expect(formatYmd(ymdBetween('2026-03-15', '2026-03-20'))).toBe('5 days');
  });
  it('clamps month ends: an anniversary on a missing day lands on the last day of that month', () => {
    expect(ymdBetween('2026-01-31', '2026-02-27')).toEqual({ years: 0, months: 0, days: 27 });
    expect(ymdBetween('2026-01-31', '2026-02-28')).toEqual({ years: 0, months: 1, days: 0 });
    expect(ymdBetween('2026-01-31', '2026-03-31')).toEqual({ years: 0, months: 2, days: 0 });
    expect(ymdBetween('2024-02-29', '2025-02-27')).toEqual({ years: 0, months: 11, days: 29 });
    expect(ymdBetween('2024-02-29', '2025-02-28')).toEqual({ years: 1, months: 0, days: 0 });
    expect(ymdBetween('2024-02-29', '2028-02-29')).toEqual({ years: 4, months: 0, days: 0 });
    expect(ymdBetween('2025-05-31', '2025-06-29')).toEqual({ years: 0, months: 0, days: 29 });
    expect(ymdBetween('2025-05-31', '2025-06-30')).toEqual({ years: 0, months: 1, days: 0 });
  });
  it('rejects reversed ranges and invalid dates', () => {
    expect(() => ymdBetween('2026-03-16', '2026-03-15')).toThrow();
    expect(() => ymdBetween('2026-02-30', '2026-03-15')).toThrow();
  });
});

describe('search normalization', () => {
  it('ignores case, punctuation, apostrophes and accents', () => {
    expect(normalizeSearch("St. Mary's  Lane #4")).toBe('st marys lane 4');
    expect(normalizeSearch('Café Straße')).toBe('cafe strasse');
    expect(searchTokens('  oak  drive ')).toEqual(['oak', 'drive']);
    expect(searchTokens('!!!')).toEqual([]);
  });
});

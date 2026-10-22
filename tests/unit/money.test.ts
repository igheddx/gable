import { describe, expect, it } from 'vitest';
import { centsToInput, formatCents, parseCurrency } from '../../src/shared/money';
import { formatUsDate, isValidIsoDate, parseUsDate, todayIso } from '../../src/shared/dates';

describe('parseCurrency', () => {
  it.each([
    ['1,234.50', 123450],
    ['$1234.5', 123450],
    ['12', 1200],
    ['.5', 50],
    ['0.01', 1],
    ['19.99', 1999],
    ['  $ 7.10 ', 710],
    ['999,999,999.99', 99_999_999_999],
  ])('parses %s to %i cents', (input, cents) => {
    expect(parseCurrency(input)).toEqual({ ok: true, cents });
  });

  it('is exact where floating point is not (0.1 + 0.2 style inputs)', () => {
    expect(parseCurrency('0.29')).toEqual({ ok: true, cents: 29 });
    expect(parseCurrency('1.15')).toEqual({ ok: true, cents: 115 });
    expect(parseCurrency('4.35')).toEqual({ ok: true, cents: 435 });
  });

  it.each(['', '   ', 'abc', '12.345', '1,23.45', '1.2.3', '$', '.', '12a', '1e5'])('rejects %j', (input) => {
    expect(parseCurrency(input).ok).toBe(false);
  });

  it.each(['-5', '$-5', '(5.00)', '−5'])('rejects negative %j with a helpful message', (input) => {
    const r = parseCurrency(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/positive/);
  });

  it('rejects zero and oversized amounts', () => {
    expect(parseCurrency('0')).toMatchObject({ ok: false });
    expect(parseCurrency('1,000,000,000.00')).toMatchObject({ ok: false });
  });
});

describe('formatCents', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(20_000_000)).toBe('$200,000.00');
    expect(formatCents(-1999)).toBe('-$19.99');
    expect(centsToInput(123450)).toBe('1234.50');
  });
});

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('1800-01-01')).toBe(false);
  });
  it('parses US input to ISO without timezone shifts', () => {
    expect(parseUsDate('3/5/2021')).toEqual({ ok: true, iso: '2021-03-05' });
    expect(parseUsDate('03-15-2026')).toEqual({ ok: true, iso: '2026-03-15' });
    expect(parseUsDate('2026-03-15')).toEqual({ ok: true, iso: '2026-03-15' });
    expect(parseUsDate('02/30/2026')).toMatchObject({ ok: false });
    expect(parseUsDate('hello')).toMatchObject({ ok: false });
    expect(formatUsDate('2021-01-05')).toBe('01/05/2021');
  });
  it('todayIso uses the local calendar date', () => {
    expect(todayIso(new Date(2026, 2, 15, 23, 59))).toBe('2026-03-15');
    expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

import { formatBasisPoints, roiBasisPoints, roundDiv } from '../../src/shared/money';

describe('ROI math', () => {
  it('matches the guide fixtures', () => {
    expect(roiBasisPoints(4_200_000, 26_800_000)).toBe(1567);
    expect(formatBasisPoints(1567)).toBe('15.67%');
    expect(roiBasisPoints(7_000_000, 28_000_000)).toBe(2500);
    expect(formatBasisPoints(2500)).toBe('25.00%');
  });
  it('rounds half away from zero and handles losses and zero cost', () => {
    expect(roundDiv(5, 10)).toBe(1);
    expect(roundDiv(-5, 10)).toBe(-1);
    expect(roundDiv(4, 10)).toBe(0);
    expect(roiBasisPoints(-2_000_000, 11_000_000)).toBe(-1818);
    expect(formatBasisPoints(-1818)).toBe('-18.18%');
    expect(formatBasisPoints(-5)).toBe('-0.05%');
    expect(roiBasisPoints(100, 0)).toBeNull();
  });
});

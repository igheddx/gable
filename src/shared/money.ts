/** Money is integer cents. No floating-point arithmetic touches amounts. */

export const MAX_CENTS = 99_999_999_999; // $999,999,999.99

export type MoneyParse = { ok: true; cents: number } | { ok: false; message: string };

/** Parses user-typed dollars ("1,234.50", "$12", ".5") into cents using string logic only. */
export function parseCurrency(input: string): MoneyParse {
  let s = input.trim();
  if (s === '') return { ok: false, message: 'Enter an amount.' };
  if (/^\(.*\)$/.test(s) || s.startsWith('-') || s.startsWith('$-') || s.startsWith('−')) {
    return { ok: false, message: 'Amounts must be positive. Credits and refunds are not supported yet.' };
  }
  s = s.replace(/^\$/, '').replace(/\s/g, '');
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d*)?$/.test(s) || s === '' || s === '.') {
    return { ok: false, message: 'Enter an amount like 1,234.50.' };
  }
  const [whole = '', frac = ''] = s.replace(/,/g, '').split('.');
  if (frac.length > 2) return { ok: false, message: 'Use at most two decimal places.' };
  const wholeDigits = whole === '' ? '0' : whole;
  if (wholeDigits.length > 9) return { ok: false, message: 'That amount is too large.' };
  const cents = Number(wholeDigits) * 100 + Number(frac.padEnd(2, '0'));
  if (cents > MAX_CENTS) return { ok: false, message: 'That amount is too large.' };
  if (cents === 0) return { ok: false, message: 'Amount must be greater than $0.00.' };
  return { ok: true, cents };
}

/** 123456 -> "$1,234.56". Integer math only. */
export function formatCents(cents: number, opts: { symbol?: boolean } = {}): string {
  const symbol = opts.symbol ?? true;
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rem = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${symbol ? '$' : ''}${dollars}.${rem}`;
}

/** Plain editable string for an input ("1234.50"). */
export function centsToInput(cents: number): string {
  return formatCents(cents, { symbol: false }).replace(/,/g, '');
}

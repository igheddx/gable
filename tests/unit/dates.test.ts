import { describe, expect, it } from 'vitest';
import { formatDateTyping, parseUsDate } from '../../src/shared/dates';

/** Types the text one character at a time, the way the field receives it. */
function typeOut(text: string): string {
  let value = '';
  for (const ch of text) value = formatDateTyping(value + ch, false);
  return value;
}

describe('formatDateTyping', () => {
  it('adds the slashes while digits are typed', () => {
    expect(typeOut('03152024')).toBe('03/15/2024');
    expect(typeOut('01152021')).toBe('01/15/2021');
  });
  it('shows each step as it goes', () => {
    const steps: string[] = [];
    let v = '';
    for (const ch of '03152024') { v = formatDateTyping(v + ch); steps.push(v); }
    expect(steps).toEqual(['0', '03/', '03/1', '03/15/', '03/15/2', '03/15/20', '03/15/202', '03/15/2024']);
  });
  it('pads a first digit that cannot start a month or a day', () => {
    expect(formatDateTyping('3')).toBe('03/');
    expect(typeOut('3152024')).toBe('03/15/2024');
    expect(typeOut('0515')).toBe('05/15/');
    expect(typeOut('1052024')).toBe('10/05/2024');
    expect(typeOut('0572024')).toBe('05/07/2024');
  });
  it('accepts typed separators and pads one-digit parts', () => {
    expect(typeOut('3/5/2024')).toBe('03/05/2024');
    expect(typeOut('3-5-2024')).toBe('03/05/2024');
    expect(typeOut('03/15/2024')).toBe('03/15/2024');
  });
  it('converts a pasted ISO date', () => {
    expect(formatDateTyping('2024-03-15')).toBe('03/15/2024');
  });
  it('ignores letters and extra digits', () => {
    expect(typeOut('03a15x2024')).toBe('03/15/2024');
    expect(formatDateTyping('03/15/202499')).toBe('03/15/2024');
  });
  it('lets Backspace remove a slash without re-adding it', () => {
    expect(formatDateTyping('03', true)).toBe('03');
    expect(formatDateTyping('03/15', true)).toBe('03/15');
    expect(formatDateTyping('03/15/', true)).toBe('03/15');
  });
  it('formats to something parseUsDate accepts', () => {
    const r = parseUsDate(typeOut('03152024'));
    expect(r).toEqual({ ok: true, iso: '2024-03-15' });
  });
  it('leaves an empty field empty', () => {
    expect(formatDateTyping('')).toBe('');
  });
});

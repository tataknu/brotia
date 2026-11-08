import { describe, expect, it } from 'vitest';
import { isMonthDay, monthDayLabel, parseNumberInput } from './parse';

describe('parse helpers', () => {
  it('parses numbers with separators and the real minus sign', () => {
    expect(parseNumberInput('1,234.5')).toBe(1234.5);
    expect(parseNumberInput('−2.4')).toBe(-2.4);
    expect(parseNumberInput('-')).toBeNull();
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('abc')).toBeNull();
    expect(parseNumberInput('5', { min: 6 })).toBeNull();
    expect(parseNumberInput('5', { max: 4 })).toBeNull();
  });
  it('validates month-days and labels them', () => {
    expect(isMonthDay('09-01')).toBe(true);
    expect(isMonthDay('02-29')).toBe(false);
    expect(isMonthDay('13-01')).toBe(false);
    expect(isMonthDay('9-1')).toBe(false);
    expect(monthDayLabel('11-10')).toBe('Nov 10');
    expect(monthDayLabel('bad')).toBe('bad');
  });
});

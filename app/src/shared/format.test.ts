import { describe, expect, it } from 'vitest';
import { date, localDate, money, pct, signed, timestampUTC, withUnit } from './format';

describe('format', () => {
  it('formats money', () => {
    expect(money(125000)).toBe('$125,000');
    expect(money(125000, 'CLP')).toBe('CLP 125,000');
    expect(money(null)).toBe('–');
    expect(money(1_250_000, 'USD', { compact: true })).toBe('$1.3M');
  });
  it('formats dates without timezone drift', () => {
    expect(date('2026-11-06')).toBe('Nov 6, 2026');
    expect(date('2026-01-01', 'month')).toBe('Jan 2026');
  });
  it('formats percents', () => {
    expect(pct(0.234)).toBe('23%');
  });
});

describe('localDate', () => {
  it('shows plain dates as-is and timestamps in local time', () => {
    expect(localDate('2026-11-06')).toBe('Nov 6, 2026');
    const d = new Date(2026, 10, 6, 21, 30); // 21:30 local: still Nov 6 locally, whatever the UTC date is
    expect(localDate(d.toISOString())).toBe('Nov 6, 2026');
    expect(localDate(undefined)).toBe('–');
  });
});

describe('v1 helpers', () => {
  it('signs numbers with a real minus', () => {
    expect(signed(-3.14)).toBe('−3.1');
    expect(signed(0.4, 1, { plus: true })).toBe('+0.4');
    expect(signed(-0.01)).toBe('0.0');
    expect(withUnit(-2.4, '°C')).toBe('−2.4 °C');
    expect(withUnit(null, 'mm')).toBe('–');
  });
  it('formats UTC timestamps', () => {
    expect(timestampUTC('2026-11-07T16:07:00Z')).toBe('Nov 7, 2026, 16:07 UTC');
  });
});

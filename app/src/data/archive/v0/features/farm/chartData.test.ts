import { describe, expect, it } from 'vitest';
import { installmentsInRange, latestVsNormal, monthTicks, stressWindowIntervals, timelineEndFor, toTimePoints, trailingSum } from './chartData';
import { parseISODate } from '@/domain/dates';

describe('stressWindowIntervals', () => {
  it('splits a year-wrapping window across the 24-month range and clips both ends', () => {
    const out = stressWindowIntervals({ start: '12-15', end: '03-15' }, '2024-11-06', '2026-11-06');
    expect(out).toEqual([
      { start: '2024-12-15', end: '2025-03-15' },
      { start: '2025-12-15', end: '2026-03-15' },
    ]);
  });

  it('clips a window that is open at the range start', () => {
    const out = stressWindowIntervals({ start: '10-01', end: '12-31' }, '2024-11-06', '2026-11-06');
    expect(out).toEqual([
      { start: '2024-11-06', end: '2024-12-31' },
      { start: '2025-10-01', end: '2025-12-31' },
      { start: '2026-10-01', end: '2026-11-06' },
    ]);
  });

  it('handles a non-wrapping window', () => {
    const out = stressWindowIntervals({ start: '06-01', end: '08-31' }, '2024-11-06', '2026-11-06');
    expect(out).toEqual([
      { start: '2025-06-01', end: '2025-08-31' },
      { start: '2026-06-01', end: '2026-08-31' },
    ]);
  });

  it('normalizes Feb 29 in non-leap years', () => {
    const out = stressWindowIntervals({ start: '12-01', end: '02-29' }, '2024-11-06', '2025-12-31');
    expect(out[0]).toEqual({ start: '2024-12-01', end: '2025-03-01' });
  });
});

describe('helpers', () => {
  it('toTimePoints keeps nulls and builds the band', () => {
    const tp = toTimePoints([{ date: '2026-01-01', value: null, mean: 0.5, p10: 0.4, p90: 0.6 }]);
    expect(tp[0]).toEqual({ t: parseISODate('2026-01-01'), date: '2026-01-01', value: null, mean: 0.5, band: [0.4, 0.6] });
  });

  it('installmentsInRange filters and sorts', () => {
    const out = installmentsInRange(
      [
        { dueDate: '2027-01-01', amount: 1 },
        { dueDate: '2026-02-01', amount: 2 },
        { dueDate: '2025-02-01', amount: 3 },
      ],
      '2024-11-06',
      '2026-11-06',
    );
    expect(out.map((i) => i.amount)).toEqual([3, 2]);
  });

  it('monthTicks steps on month starts inside the range', () => {
    const ticks = monthTicks('2024-11-06', '2025-06-01', 3);
    expect(ticks).toEqual([parseISODate('2024-12-01'), parseISODate('2025-03-01'), parseISODate('2025-06-01')]);
  });

  it('latestVsNormal skips trailing nulls', () => {
    const r = latestVsNormal([
      { date: 'a', value: 1, mean: 2, p10: 1, p90: 3 },
      { date: 'b', value: null, mean: 2, p10: 1, p90: 3 },
    ]);
    expect(r?.date).toBe('a');
  });

  it('trailingSum adds values (nulls as 0) and means', () => {
    const pts = [1, 2, 3].map((v, i) => ({ date: String(i), value: i === 1 ? null : v, mean: 1, p10: 0, p90: 2 }));
    expect(trailingSum(pts, 2)).toEqual({ value: 3, mean: 2 });
  });
});

describe('timelineEndFor', () => {
  const asOf = '2026-11-06';
  it('shows at least six months past today', () => {
    expect(timelineEndFor(asOf, [])).toBe('2027-05-06');
    expect(timelineEndFor(asOf, [{ dueDate: '2026-01-01', amount: 1 }])).toBe('2027-05-06');
  });
  it('extends to the last installment, capped at twelve months', () => {
    expect(timelineEndFor(asOf, [{ dueDate: '2027-08-01', amount: 1 }])).toBe('2027-08-11');
    expect(timelineEndFor(asOf, [{ dueDate: '2027-02-01', amount: 1 }, { dueDate: '2029-02-01', amount: 1 }])).toBe('2027-11-16');
  });
  it('always includes the next upcoming installment', () => {
    expect(timelineEndFor(asOf, [{ dueDate: '2028-03-01', amount: 1 }])).toBe('2028-03-11');
  });
});

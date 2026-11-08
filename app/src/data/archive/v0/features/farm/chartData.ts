/**
 * Pure chart-data shaping for the farm drill-down (no React, no DOM).
 * Charts use a numeric time axis (t = UTC ms) so reference lines and areas can sit on any date.
 */
import type { Installment, SeriesPoint, Tier } from '@/domain/types';
import { addDays, addMonths, parseISODate, toISODate } from '@/domain/dates';
import { TIER_CUTOFFS } from '@/data/api';

export interface TimePoint {
  t: number;
  date: string;
  value: number | null;
  mean: number;
  /** [p10, p90]: this field's own same-time-of-year range. */
  band: [number, number];
}

export function toTimePoints(points: SeriesPoint[]): TimePoint[] {
  return points.map((p) => ({ t: parseISODate(p.date), date: p.date, value: p.value, mean: p.mean, band: [p.p10, p.p90] }));
}

export interface DateInterval {
  start: string;
  end: string;
}

/**
 * Calendar intervals covered by a 'MM-DD'..'MM-DD' window between two ISO dates, clipped to the range.
 * Handles windows that wrap the year end (e.g. 12-15..03-15).
 */
export function stressWindowIntervals(window: { start: string; end: string }, rangeStart: string, rangeEnd: string): DateInterval[] {
  const y0 = Number(rangeStart.slice(0, 4)) - 1;
  const y1 = Number(rangeEnd.slice(0, 4));
  const wraps = window.start > window.end;
  const out: DateInterval[] = [];
  for (let y = y0; y <= y1; y++) {
    const s = normalize(`${y}-${window.start}`);
    const e = normalize(`${wraps ? y + 1 : y}-${window.end}`);
    const cs = s < rangeStart ? rangeStart : s;
    const ce = e > rangeEnd ? rangeEnd : e;
    if (cs <= ce) out.push({ start: cs, end: ce });
  }
  return out;
}

/** Normalizes impossible dates such as 2025-02-29 to a real date. */
function normalize(iso: string): string {
  return toISODate(parseISODate(iso));
}

/** Installments whose due date lies inside [start, end]. */
export function installmentsInRange(installments: Installment[], start: string, end: string): Installment[] {
  return installments.filter((i) => i.dueDate >= start && i.dueDate <= end).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/**
 * End of the farm timeline: at least 6 months past `asOf`, extended to the last installment but
 * capped at 12 months past `asOf` (so 24 months of history stay readable), except that the next
 * upcoming installment is always included.
 */
export function timelineEndFor(asOf: string, installments: Installment[]): string {
  const min = addMonths(asOf, 6);
  const cap = addMonths(asOf, 12);
  const future = installments.map((i) => i.dueDate).filter((d) => d > asOf).sort();
  if (future.length === 0) return min;
  const last = future[future.length - 1];
  const next = future[0];
  let end = last < cap ? last : cap;
  if (next > end) end = next;
  if (end < min) end = min;
  // A little room after the last marker so it is not drawn on the chart edge.
  return addDays(end, 10);
}

/** Tick positions (UTC ms) on the first day of every `stepMonths` month inside [start, end]. */
export function monthTicks(start: string, end: string, stepMonths = 3): number[] {
  const out: number[] = [];
  let d = `${start.slice(0, 7)}-01`;
  if (d < start) d = addMonths(d, 1);
  while (d <= end) {
    out.push(parseISODate(d));
    d = addMonths(d, stepMonths);
  }
  return out;
}

/**
 * Score cut-offs used to shade tier bands on the trend chart, taken from the data engine.
 * The tier shown on pills always comes from the assessment itself.
 */
export { TIER_CUTOFFS };

export const TIER_BANDS: { tier: Tier; y1: number; y2: number }[] = [
  { tier: 'normal', y1: 0, y2: TIER_CUTOFFS.watch },
  { tier: 'watch', y1: TIER_CUTOFFS.watch, y2: TIER_CUTOFFS.high },
  { tier: 'high', y1: TIER_CUTOFFS.high, y2: 100 },
];

/** Summary of a series' latest non-null value vs its baseline mean, for chart captions. */
export function latestVsNormal(points: SeriesPoint[]): { date: string; value: number; mean: number; p10: number; p90: number } | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.value !== null && Number.isFinite(p.value)) return { date: p.date, value: p.value, mean: p.mean, p10: p.p10, p90: p.p90 };
  }
  return null;
}

/** Sum of value and of mean over the last `days` points of a daily series (e.g. 30-day rain vs normal). */
export function trailingSum(points: SeriesPoint[], days: number): { value: number; mean: number } {
  const tail = points.slice(-days);
  return {
    value: tail.reduce((s, p) => s + (p.value ?? 0), 0),
    mean: tail.reduce((s, p) => s + p.mean, 0),
  };
}

/**
 * Timezone-safe date helpers working on 'YYYY-MM-DD' strings (UTC internally).
 * Never use local-time Date arithmetic for domain dates.
 */

const MS_DAY = 86_400_000;

export function parseISODate(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

export function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toISODate(parseISODate(iso) + days * MS_DAY);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseISODate(toIso) - parseISODate(fromIso)) / MS_DAY);
}

function daysInMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

/** Adds calendar months, clamping to month end (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm0 = total - ny * 12;
  const nd = Math.min(d, daysInMonth(ny, nm0));
  return toISODate(Date.UTC(ny, nm0, nd));
}

/** 'MM-DD' part of an ISO date. */
export function monthDay(iso: string): string {
  return iso.slice(5, 10);
}

/** Day of year 1..366 (UTC). */
export function dayOfYear(iso: string): number {
  const t = parseISODate(iso);
  const start = Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
  return Math.floor((t - start) / MS_DAY) + 1;
}

/** True when the date's MM-DD lies in [start, end]; handles windows that wrap the year end. */
export function inMonthDayWindow(iso: string, window: { start: string; end: string }): boolean {
  const md = monthDay(iso);
  if (window.start <= window.end) return md >= window.start && md <= window.end;
  return md >= window.start || md <= window.end;
}

/** Inclusive list of ISO dates from start to end stepping `stepDays`. */
export function dateRange(startIso: string, endIso: string, stepDays = 1): string[] {
  const out: string[] = [];
  const end = parseISODate(endIso);
  for (let t = parseISODate(startIso); t <= end; t += stepDays * MS_DAY) out.push(toISODate(t));
  return out;
}

/** Today's date in UTC, 'YYYY-MM-DD' (the contract's default asOf). */
export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Pure input parsing helpers for the wizard (node-tested). */

/** Parses a typed number ("12,500.5" and a real minus sign are fine). null when empty, not finite or out of range. */
export function parseNumberInput(s: string, range?: { min?: number; max?: number }): number | null {
  const clean = s.replace(/[,\s]/g, '').replace(/−/g, '-');
  if (clean === '' || clean === '-' || clean === '.') return null;
  const n = Number(clean);
  if (!Number.isFinite(n)) return null;
  if (range?.min !== undefined && n < range.min) return null;
  if (range?.max !== undefined && n > range.max) return null;
  return n;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Valid inclusive month-day 'MM-DD' (29 Feb is not allowed: the contract folds it into 28 Feb). */
export function isMonthDay(s: string): boolean {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= DAYS_IN_MONTH[mo - 1];
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '09-01' → 'Sep 1'. Returns the input when it is not a valid month-day. */
export function monthDayLabel(md: string): string {
  if (!isMonthDay(md)) return md;
  const [m, d] = md.split('-').map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

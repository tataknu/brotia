/**
 * Lead time: how early the field signal showed before the money was due. The signal starts on the first date of the
 * first run of RUN consecutive points below the farm's own usual band (p10), so one noisy point does not count.
 * Shared by the Season and Loan slides so both quote the same date.
 */
export type BandPt = { date: string; value: number | null; p10: number | null; estimated?: boolean };

const RUN = 3;

export function firstPersistentBelow(points: BandPt[]): string | null {
  let start: string | null = null;
  let run = 0;
  for (const p of points) {
    const below = p.value != null && p.p10 != null && p.value < p.p10;
    if (below) {
      if (run === 0) start = p.date;
      run += 1;
      if (run >= RUN) return start;
    } else {
      run = 0;
      start = null;
    }
  }
  return null;
}

/** Whole months from `from` to `to` (ISO dates), rounded down; null when either is missing or `to` is earlier. */
export function monthsBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (b < a) return null;
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return m;
}

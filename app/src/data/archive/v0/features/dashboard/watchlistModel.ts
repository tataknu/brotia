/** Pure watchlist filtering/sorting and portfolio summaries (no React). */
import type { CropType, Farm, FarmAssessment, Portfolio, Tier, Zone } from '@/domain/types';
import { outstandingAt } from '@/domain/schedule';

export interface WatchRow {
  rank: number;
  assessment: FarmAssessment;
  farm: Farm;
  zone: Zone | undefined;
}

export type WatchSort = 'score' | 'exposure';

export interface WatchFilter {
  tier: Tier | 'all';
  crop: CropType | 'all';
  zoneId: string | 'all';
  sortBy: WatchSort;
}

export const DEFAULT_WATCH_FILTER: WatchFilter = { tier: 'all', crop: 'all', zoneId: 'all', sortBy: 'score' };

/** Joins ranked assessments with their farm and zone; rank = position in the score ranking (1-based). */
export function buildRows(portfolio: Portfolio, ranked: FarmAssessment[]): WatchRow[] {
  const farms = new Map(portfolio.farms.map((f) => [f.id, f]));
  const zones = new Map(portfolio.zones.map((z) => [z.id, z]));
  const rows: WatchRow[] = [];
  ranked.forEach((a) => {
    const farm = farms.get(a.farmId);
    if (!farm) return;
    rows.push({ rank: rows.length + 1, assessment: a, farm, zone: zones.get(farm.zoneId) });
  });
  return rows;
}

export function filterAndSort(rows: WatchRow[], f: WatchFilter): WatchRow[] {
  const out = rows.filter(
    (r) => (f.tier === 'all' || r.assessment.tier === f.tier) && (f.crop === 'all' || r.farm.crop === f.crop) && (f.zoneId === 'all' || r.farm.zoneId === f.zoneId),
  );
  if (f.sortBy === 'exposure') {
    out.sort((a, b) => b.assessment.exposure - a.assessment.exposure || b.assessment.score - a.assessment.score);
  } else {
    out.sort((a, b) => a.rank - b.rank);
  }
  return out;
}

/** Outstanding principal across all farm loans at a date (cheap summary for portfolio cards). */
export function portfolioExposure(p: Portfolio, asOf: string): number {
  return p.farms.reduce((s, f) => s + (f.loan ? outstandingAt(f.loan, asOf) : 0), 0);
}

export function portfolioAreaHa(p: Portfolio): number {
  return p.farms.reduce((s, f) => s + (Number.isFinite(f.areaHa) ? f.areaHa : 0), 0);
}

/** Safe share: 0 when the total is 0. */
export function share(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

/**
 * Fake-data API. SIGNATURES ARE FINAL CONTRACT (foundation-owned).
 * Implementation lives in src/data/engine/** (builder C).
 *
 * Rules: pure TS, deterministic, no network, no DOM, no Math.random (seeded PRNG keyed by the farm's
 * location grid cell and farm id). Each field is compared against its OWN simulated history for the
 * same time of year (zone.baselineYears event-free runs), never against fixed thresholds alone.
 */
import type {
  Alert,
  ClimateEvent,
  Farm,
  FarmAssessment,
  FarmSeries,
  Portfolio,
  PortfolioAssessment,
  SeriesPoint,
  Tier,
  Zone,
} from '@/domain/types';
import { parseISODate, toISODate } from '@/domain/dates';
import { AS_OF as ENGINE_AS_OF, SERIES_START as ENGINE_SERIES_START, getModel } from './engine/model';
import { assessFarmFull, TIER_CUTOFFS as ENGINE_TIER_CUTOFFS, tierOf as engineTierOf } from './engine/assess';
import { alertsImpl, assessPortfolioImpl, climateEventsImpl } from './engine/portfolio';
import { makeSample } from './engine/sample';

/** Demo "today". */
export const AS_OF: string = ENGINE_AS_OF;
/** First date covered by every FarmSeries (AS_OF minus 24 months). */
export const SERIES_START: string = ENGINE_SERIES_START;

/** Stress-score cut-offs used for tiers (watch >= 35, high >= 60). Extra helper. */
export const TIER_CUTOFFS: { readonly watch: number; readonly high: number } = ENGINE_TIER_CUTOFFS;
/** Tier for a 0..100 stress score, using TIER_CUTOFFS. Extra helper. */
export function tierOf(score: number): Tier {
  return engineTierOf(score);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Last 24 months of NDVI/NDMI (every 5 days, null when cloudy), ETo, precipitation, soil moisture and
 * temperatures, each with this field's own same-day-of-year baseline (mean, p10, p90).
 * Precipitation bands are expressed as a daily rate from 30-day totals, so summing them by week or
 * month (aggregate(..., 'sum')) gives a meaningful "typical range" for that period.
 */
export function getFarmSeries(farm: Farm, zone: Zone): FarmSeries {
  return getModel(farm, zone).series;
}

export function assessFarm(farm: Farm, zone: Zone): FarmAssessment {
  return assessFarmFull(farm, zone).assessment;
}

export function assessPortfolio(p: Portfolio): PortfolioAssessment {
  return assessPortfolioImpl(p);
}

/** Recent climate disasters touching the portfolio, newest first (3–6 for the sample portfolio). */
export function getClimateEvents(p: Portfolio): ClimateEvent[] {
  return climateEventsImpl(p);
}

/** Tier changes over the last 26 weeks, newest first. */
export function getAlerts(p: Portfolio): Alert[] {
  return alertsImpl(p);
}

export function makeSamplePortfolio(): Portfolio {
  return makeSample();
}

/**
 * Aggregates points into calendar weeks (Monday start) or months (1st of month).
 * Each output point's date is the bucket start. `value` aggregates non-null values (null when all are
 * null); mean/p10/p90 are aggregated the same way (sum or mean).
 */
export function aggregate(points: SeriesPoint[], by: 'week' | 'month', how: 'sum' | 'mean'): SeriesPoint[] {
  const buckets = new Map<string, SeriesPoint[]>();
  for (const p of points) {
    let key: string;
    if (by === 'month') key = `${p.date.slice(0, 7)}-01`;
    else {
      const t = parseISODate(p.date);
      const dow = (new Date(t).getUTCDay() + 6) % 7; // 0 = Monday
      key = toISODate(t - dow * 86_400_000);
    }
    const arr = buckets.get(key);
    if (arr) arr.push(p);
    else buckets.set(key, [p]);
  }
  const agg = (xs: number[]) => (xs.length === 0 ? 0 : how === 'sum' ? xs.reduce((a, b) => a + b, 0) : xs.reduce((a, b) => a + b, 0) / xs.length);
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, ps]) => {
      const vals = ps.map((p) => p.value).filter((v): v is number => v !== null);
      return {
        date,
        value: vals.length ? r3(agg(vals)) : null,
        mean: r3(agg(ps.map((p) => p.mean))),
        p10: r3(agg(ps.map((p) => p.p10))),
        p90: r3(agg(ps.map((p) => p.p90))),
      };
    });
}

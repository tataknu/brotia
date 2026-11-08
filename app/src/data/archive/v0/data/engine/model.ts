/**
 * Farm model = the field's "actual" simulated last 24 months (with injected events) plus
 * zone.baselineYears event-free baseline runs of the same field. Baseline bands are same-day-of-year
 * statistics pooled over all baseline runs, both years of the window and a +/-7-day window.
 */
import type { Farm, FarmSeries, SeriesPoint, Zone } from '@/domain/types';
import { addDays, addMonths, dateRange, daysBetween } from '@/domain/dates';
import { bindEvents, EVENT_DEFS, type EventDef } from './events';
import { simulate, type DailySim } from './simulate';
import { clamp, r1, r2, r3 } from './rng';

export const AS_OF = '2026-11-06';
export const SERIES_START = addMonths(AS_OF, -24);
const SPINUP_DAYS = 150;
const HALF_WINDOW = 7;
/** Length of the 24-month window in days (inclusive). */
export const WINDOW_DAYS = daysBetween(SERIES_START, AS_OF) + 1;

export type DailyVar = 'precip' | 'eto' | 'sm' | 'tmax' | 'tmin' | 'ndvi' | 'ndmi';

export interface Band {
  mean: Float64Array;
  p10: Float64Array;
  p90: Float64Array;
  sd: Float64Array;
}

export interface EngineOptions {
  /** Scale factor per event id (tests / what-if). Default: every event at its natural intensity. */
  eventScale?: Record<string, number>;
  /** Replace the event catalogue entirely. */
  events?: EventDef[];
}

export interface FarmModel {
  key: string;
  dates: string[];
  actual: DailySim;
  runs: DailySim[];
  /** Window indices of the 5-day satellite passes. */
  obsIdx: number[];
  ndviObs: (number | null)[];
  ndmiObs: (number | null)[];
  bands: Record<DailyVar, Band>;
  /** Run arrays used for precipitation bands (30-day centred daily rate). */
  precipRate: Float64Array[];
  series: FarmSeries;
}

function sliceSim(s: DailySim, from: number): DailySim {
  return {
    dates: s.dates.slice(from),
    precip: s.precip.subarray(from),
    eto: s.eto.subarray(from),
    sm: s.sm.subarray(from),
    tmax: s.tmax.subarray(from),
    tmin: s.tmin.subarray(from),
    ndvi: s.ndvi.subarray(from),
    ndmi: s.ndmi.subarray(from),
    green: s.green.subarray(from),
    cloudy: s.cloudy.subarray(from),
    obsNoise: s.obsNoise.subarray(from),
    stage: s.stage.slice(from),
    campaign: s.campaign.slice(from),
    cropDay: s.cropDay.subarray(from),
  };
}

function rolling30(precip: Float64Array, from: number): Float64Array {
  const n = precip.length;
  const out = new Float64Array(n - from);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + precip[i];
  for (let i = from; i < n; i++) {
    const a = Math.max(0, i - 15);
    const b = Math.min(n, i + 15);
    out[i - from] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

/** Window indices with the same day of year as `i` (the window holds no Feb 29). */
export function sameDoyIndices(i: number, n: number = WINDOW_DAYS): number[] {
  const k = ((i % 365) + 365) % 365;
  const out: number[] = [];
  for (let j = k; j < n; j += 365) out.push(j);
  return out;
}

/** Pooled baseline samples for window index i: all runs, same DOY in both years, +/- `half` days. */
export function pooledSamples(arrays: ArrayLike<number>[], i: number, half = HALF_WINDOW, extra?: (arr: number, j: number) => number): number[] {
  const out: number[] = [];
  for (const j0 of sameDoyIndices(i)) {
    for (let o = -half; o <= half; o++) {
      const j = j0 + o;
      if (j < 0 || j >= WINDOW_DAYS) continue;
      for (let r = 0; r < arrays.length; r++) out.push(extra ? extra(r, j) : arrays[r][j]);
    }
  }
  return out;
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statsOf(vals: number[]) {
  const sorted = Float64Array.from(vals).sort();
  const mean = vals.reduce((s, v) => s + v, 0) / Math.max(1, vals.length);
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, vals.length - 1));
  return { mean, p10: quantileSorted(sorted, 0.1), p90: quantileSorted(sorted, 0.9), sd };
}

function computeBand(n: number, sampler: (i: number) => number[], onlyAt?: number[]): Band {
  const band: Band = { mean: new Float64Array(n), p10: new Float64Array(n), p90: new Float64Array(n), sd: new Float64Array(n) };
  const cache = new Map<number, ReturnType<typeof statsOf>>();
  const idxs = onlyAt ?? Array.from({ length: n }, (_, i) => i);
  for (const i of idxs) {
    const k = i % 365;
    let s = cache.get(k);
    if (!s) {
      s = statsOf(sampler(i));
      cache.set(k, s);
    }
    band.mean[i] = s.mean;
    band.p10[i] = s.p10;
    band.p90[i] = s.p90;
    band.sd[i] = s.sd;
  }
  return band;
}

export function modelKey(farm: Farm, zone: Zone, opts?: EngineOptions): string {
  return JSON.stringify([
    farm.id,
    farm.centroid.map((c) => Math.round(c * 1e5) / 1e5),
    farm.crop,
    farm.sowingDate ?? '',
    baselineYearsOf(zone),
    !!zone.irrigated,
    opts?.eventScale ?? null,
    opts?.events ? opts.events.map((e) => e.id) : null,
  ]);
}

export function baselineYearsOf(zone: Zone): number {
  return clamp(Math.round(zone.baselineYears || 5), 3, 10);
}

const MODEL_CACHE = new Map<string, FarmModel>();
const MAX_CACHE = 64;

export function clearModelCache(): void {
  MODEL_CACHE.clear();
}

export function getModel(farm: Farm, zone: Zone, opts?: EngineOptions): FarmModel {
  const key = modelKey(farm, zone, opts);
  const hit = MODEL_CACHE.get(key);
  if (hit) return hit;
  const m = buildModel(farm, zone, key, opts);
  if (MODEL_CACHE.size >= MAX_CACHE) MODEL_CACHE.clear();
  MODEL_CACHE.set(key, m);
  return m;
}

function buildModel(farm: Farm, zone: Zone, key: string, opts?: EngineOptions): FarmModel {
  const start = addDays(SERIES_START, -SPINUP_DAYS);
  const [lng, lat] = farm.centroid;
  const events = bindEvents(opts?.events ?? EVENT_DEFS, lng, lat, opts?.eventScale);
  const base = { farm, irrigated: !!zone.irrigated, start, end: AS_OF };
  const actualFull = simulate({ ...base, runKey: 'actual', events, neutralYears: [2025, 2026], calm: true });
  const nRuns = baselineYearsOf(zone);
  const runsFull: DailySim[] = [];
  for (let k = 1; k <= nRuns; k++) runsFull.push(simulate({ ...base, runKey: `base-${k}`, events: [] }));

  const actual = sliceSim(actualFull, SPINUP_DAYS);
  const runs = runsFull.map((r) => sliceSim(r, SPINUP_DAYS));
  const n = WINDOW_DAYS;
  const dates = actual.dates;
  const obsIdx = dateRange(SERIES_START, AS_OF, 5).map((d) => daysBetween(SERIES_START, d));

  const precipRate = runsFull.map((r) => rolling30(r.precip, SPINUP_DAYS));
  const daily = (get: (r: DailySim) => Float64Array) => {
    const arrs = runs.map(get);
    return computeBand(n, (i) => pooledSamples(arrs, i));
  };
  const ndviArrs = runs.map((r) => r.ndvi);
  const ndmiArrs = runs.map((r) => r.ndmi);
  const bands: Record<DailyVar, Band> = {
    precip: computeBand(n, (i) => pooledSamples(precipRate, i)),
    eto: daily((r) => r.eto),
    sm: daily((r) => r.sm),
    tmax: daily((r) => r.tmax),
    tmin: daily((r) => r.tmin),
    ndvi: computeBand(n, (i) => pooledSamples(ndviArrs, i, HALF_WINDOW, (r, j) => runs[r].ndvi[j] + 0.015 * runs[r].obsNoise[j]), obsIdx),
    ndmi: computeBand(n, (i) => pooledSamples(ndmiArrs, i, HALF_WINDOW, (r, j) => runs[r].ndmi[j] + 0.02 * runs[r].obsNoise[j]), obsIdx),
  };

  const ndviObs = obsIdx.map((i) => (actual.cloudy[i] ? null : clamp(actual.ndvi[i] + 0.015 * actual.obsNoise[i], 0.05, 0.95)));
  const ndmiObs = obsIdx.map((i) => (actual.cloudy[i] ? null : clamp(actual.ndmi[i] + 0.02 * actual.obsNoise[i], -0.3, 0.6)));

  const pt = (i: number, value: number | null, b: Band, round: (x: number) => number, min?: number): SeriesPoint => ({
    date: dates[i],
    value: value === null ? null : round(min !== undefined ? Math.max(min, value) : value),
    mean: round(b.mean[i]),
    p10: round(min !== undefined ? Math.max(min, b.p10[i]) : b.p10[i]),
    p90: round(b.p90[i]),
  });
  const dailySeries = (arr: Float64Array, b: Band, round: (x: number) => number, min?: number) =>
    Array.from({ length: n }, (_, i) => pt(i, arr[i], b, round, min));

  const series: FarmSeries = {
    ndvi: obsIdx.map((i, k) => pt(i, ndviObs[k], bands.ndvi, r3)),
    ndmi: obsIdx.map((i, k) => pt(i, ndmiObs[k], bands.ndmi, r3)),
    eto: dailySeries(actual.eto, bands.eto, r2, 0),
    precip: dailySeries(actual.precip, bands.precip, r1, 0),
    soilMoisture: dailySeries(actual.sm, bands.sm, r3, 0),
    tmax: dailySeries(actual.tmax, bands.tmax, r1),
    tmin: dailySeries(actual.tmin, bands.tmin, r1),
  };

  return { key, dates, actual, runs, obsIdx, ndviObs, ndmiObs, bands, precipRate, series };
}

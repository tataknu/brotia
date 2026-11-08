/**
 * Farm assessment: compares recent conditions with the field's OWN same-time-of-year history and
 * turns them into peril severities, a 0..100 score, a tier, plain-language drivers and a headline.
 */
import type { Driver, Farm, FarmAssessment, Peril, Thresholds, Tier, Zone } from '@/domain/types';
import { effectiveThresholds } from '@/domain/defaults';
import { addDays, daysBetween, inMonthDayWindow } from '@/domain/dates';
import { nextInstallment, outstandingAt } from '@/domain/schedule';
import { THETA_WP } from './simulate';
import { AS_OF, getModel, pooledSamples, quantileSorted, SERIES_START, WINDOW_DAYS, type EngineOptions, type FarmModel } from './model';
import { campaignPlan, type Stage } from './crops';
import { clamp, r2, ramp } from './rng';
import { compactMoney, fmt0, fmt1, fmt2, ordinal, periodPhrase, plural, shortDate } from './text';

export type Component = 'rain' | 'dryspell' | 'soil' | 'vegetation' | 'frost' | 'heat' | 'flood' | 'hail';

export interface Evaluation {
  date: string;
  score: number;
  tier: Tier;
  perils: Record<Peril, number>;
  vegetation: number;
  drivers: Driver[];
  headline: string;
  stage: Stage;
  inStressWindow: boolean;
}

/** Stress-score cut-offs: watch from 35, high stress from 60. */
export const TIER_CUTOFFS = { watch: 35, high: 60 } as const;

export function tierOf(score: number): Tier {
  return score >= TIER_CUTOFFS.high ? 'high' : score >= TIER_CUTOFFS.watch ? 'watch' : 'normal';
}

/** Score weights. One saturated drought alone gives 64 (high); hail/frost alone at most watch. */
const WEIGHTS: Record<Peril | 'vegetation', number> = { drought: 1, vegetation: 0.8, flood: 0.5, frost: 0.4, hail: 0.4, heat: 0.4 };
const WEIGHT_SUM = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------- per-model helpers

interface Prefix {
  actual: Float64Array;
  runs: Float64Array[];
}
const PREFIX = new WeakMap<FarmModel, Prefix>();

function prefixOf(arr: ArrayLike<number>): Float64Array {
  const p = new Float64Array(arr.length + 1);
  for (let i = 0; i < arr.length; i++) p[i + 1] = p[i] + arr[i];
  return p;
}

function prefixes(m: FarmModel): Prefix {
  let p = PREFIX.get(m);
  if (!p) {
    p = { actual: prefixOf(m.actual.precip), runs: m.runs.map((r) => prefixOf(r.precip)) };
    PREFIX.set(m, p);
  }
  return p;
}

const sumRange = (p: Float64Array, a: number, b: number) => p[b + 1] - p[a];

/** Window starts [a, b] (length `len` ending at ti) at the same time of year in every baseline year that fits. */
function sameTimeWindows(ti: number, len: number): [number, number][] {
  const out: [number, number][] = [];
  for (const shift of [-365, 0, 365]) {
    const b = ti + shift;
    const a = b - len + 1;
    if (a >= 0 && b < WINDOW_DAYS) out.push([a, b]);
  }
  return out;
}

function longestDry(precip: ArrayLike<number>, a: number, b: number): { longest: number; current: number } {
  let longest = 0;
  let run = 0;
  for (let i = a; i <= b; i++) {
    if (precip[i] < 1) {
      run += 1;
      if (run > longest) longest = run;
    } else run = 0;
  }
  return { longest, current: run };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((x, y) => x - y);
  return quantileSorted(s, 0.5);
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

// ---------------------------------------------------------------- evaluation at one date

interface Comp {
  key: Component;
  peril: Peril | 'vegetation';
  severity: number;
  text: string;
  short: string;
  metric: string;
  value: number;
  normal: number;
  /** Always show, even at severity 0 (context drivers). */
  context?: boolean;
}

function stagePhrase(stage: Stage, m: FarmModel, ti: number, farm: Farm): string {
  switch (stage) {
    case 'waiting':
      return 'delaying sowing';
    case 'establishment':
      return 'during crop establishment';
    case 'vegetative':
      return 'during vegetative growth';
    case 'flowering':
      return 'during flowering';
    case 'grainfill':
      return 'during grain fill';
    case 'maturity':
      return 'near harvest';
    default: {
      const date = m.dates[ti];
      const soon = campaignPlan(farm, date, addDays(date, 45)).some((c) => c.sow > date && c.sow <= addDays(date, 45));
      return soon ? 'before sowing' : 'with no crop in the ground';
    }
  }
}

export function evaluateAt(m: FarmModel, farm: Farm, zone: Zone, th: Thresholds, ti: number): Evaluation {
  const date = m.dates[ti];
  const pre = prefixes(m);
  const a = m.actual;
  const runs = m.runs;
  const period = periodPhrase(date);
  const comps: Comp[] = [];
  const inField = Math.max(...Array.from({ length: 30 }, (_, k) => (ti - k >= 0 ? a.green[ti - k] : 0))) > 0.1 ? 1 : 0;

  // ---- rain deficit (30 & 60 days vs this field's same-season history)
  const w30 = sameTimeWindows(ti, 30);
  const w60 = sameTimeWindows(ti, 60);
  const act30 = sumRange(pre.actual, ti - 29, ti);
  const act60 = sumRange(pre.actual, ti - 59, ti);
  const norm30 = mean(pre.runs.flatMap((p) => w30.map(([x, y]) => sumRange(p, x, y))));
  const norm60 = mean(pre.runs.flatMap((p) => w60.map(([x, y]) => sumRange(p, x, y))));
  const d30 = norm30 > 1 ? 1 - act30 / norm30 : 0;
  const d60 = norm60 > 1 ? 1 - act60 / norm60 : 0;
  const deficit = 0.4 * d30 + 0.6 * d60;
  const thrRain = Math.max(0.05, th.rainDeficitPct / 100);
  const relRain = ramp(norm60, 25, 110); // a deficit in the dry season is not a drought
  const sevRain = ramp(deficit, 0.5 * thrRain, 1.5 * thrRain) * relRain;
  const pctOf = norm60 > 0 ? (100 * act60) / norm60 : 100;
  comps.push({
    key: 'rain',
    peril: 'drought',
    severity: sevRain,
    text: `Rain ${fmt0(pctOf)}% of normal over the last 60 days (${fmt0(act60)} mm vs ${fmt0(norm60)} mm typical for this field)`,
    short: `rain ${fmt0(pctOf)}% of normal`,
    metric: 'rain_60d_mm',
    value: Math.round(act60),
    normal: Math.round(norm60),
    context: true,
  });

  // ---- dry spell (longest run of < 1 mm days in the last 60 days)
  const spell = longestDry(a.precip, ti - 59, ti);
  const normSpell = median(runs.flatMap((r) => w60.map(([x, y]) => longestDry(r.precip, x, y).longest)));
  const thrDry = Math.max(3, th.dryDays);
  const sevSpell = ramp(spell.longest - normSpell, 0, thrDry) * ramp(spell.longest, 0.5 * thrDry, thrDry) * ramp(norm60, 15, 80);
  if (sevSpell > 0.02 || spell.longest >= thrDry) {
    const ongoing = spell.current === spell.longest && spell.current > 0;
    comps.push({
      key: 'dryspell',
      peril: 'drought',
      severity: sevSpell,
      text: `${spell.longest} days in a row without meaningful rain${ongoing ? ' so far' : ''} (typical longest dry spell for this time of year: ${fmt0(normSpell)} days)`,
      short: `${spell.longest} dry days in a row`,
      metric: 'dry_spell_days',
      value: spell.longest,
      normal: Math.round(normSpell),
    });
  }

  // ---- soil moisture percentile vs own history
  const smNow = (a.sm[ti] + a.sm[Math.max(0, ti - 1)] + a.sm[Math.max(0, ti - 2)]) / 3;
  const smSamples = pooledSamples(runs.map((r) => r.sm), ti).sort((x, y) => x - y);
  const below = smSamples.filter((v) => v < smNow).length;
  const pctile = smSamples.length ? (100 * below) / smSamples.length : 50;
  const smMedian = quantileSorted(smSamples, 0.5);
  const thrSoil = clamp(th.soilMoisturePctile, 1, 60);
  const relSoil = clamp(Math.max(inField, relRain), 0.25, 1);
  const sevSoil = ramp(2 * thrSoil - pctile, 0, 2 * thrSoil) * relSoil * (smMedian - THETA_WP > 0.02 ? 1 : 0.3);
  comps.push({
    key: 'soil',
    peril: 'drought',
    severity: sevSoil,
    text: `Soil moisture at the ${ordinal(Math.max(1, pctile))} percentile of this field's history for ${period} (${fmt2(smNow)} vs ${fmt2(smMedian)} m³/m³ typical)`,
    short: `soil moisture at the ${ordinal(Math.max(1, pctile))} percentile`,
    metric: 'soil_moisture_pctile',
    value: Math.round(pctile),
    normal: 50,
    context: true,
  });

  // ---- vegetation: NDVI z-anomaly on the latest 2 clear observations
  const clear: number[] = [];
  for (let k = m.obsIdx.length - 1; k >= 0 && clear.length < 2; k--) {
    const idx = m.obsIdx[k];
    if (idx > ti) continue;
    if (ti - idx > 25) break;
    if (m.ndviObs[k] !== null) clear.push(k);
  }
  let sevVeg = 0;
  if (clear.length) {
    const vals = clear.map((k) => m.ndviObs[k] as number);
    const means = clear.map((k) => m.bands.ndvi.mean[m.obsIdx[k]]);
    const sds = clear.map((k) => Math.max(0.03, m.bands.ndvi.sd[m.obsIdx[k]]));
    const z = mean(vals.map((v, i) => (v - means[i]) / sds[i]));
    const v = mean(vals);
    const mu = mean(means);
    const anomPct = mu > 0 ? (100 * (v - mu)) / mu : 0;
    const relVeg = ramp(mu, 0.28, 0.45);
    const thrZ = Math.max(0.3, Math.abs(th.ndviAnomalyZ));
    sevVeg = ramp(-z, 0.5 * thrZ, 1.5 * thrZ) * relVeg;
    // Plain language only; the raw NDVI values are shown on the driver's own sub-line (metric vs normal).
    const text =
      relVeg < 0.2
        ? 'Field is bare or just sown, so crop greenness is not informative yet'
        : Math.abs(anomPct) < 3
          ? `Crop greenness in line with this field's normal for ${period}`
          : `Crop greenness ${fmt0(Math.abs(anomPct))}% ${anomPct < 0 ? 'below' : 'above'} this field's normal for ${period}`;
    comps.push({
      key: 'vegetation',
      peril: 'vegetation',
      severity: sevVeg,
      text,
      short: anomPct < 0 ? `greenness ${fmt0(Math.abs(anomPct))}% below normal` : 'greenness near normal',
      metric: 'ndvi',
      value: r2(v),
      normal: r2(mu),
      context: relVeg >= 0.2,
    });
  }

  // ---- frost / heat days in the last 30 days
  const w30Runs = runs.flatMap((r) => w30.map(([x, y]) => ({ r, x, y })));
  let frostN = 0;
  let minT = Infinity;
  let heatN = 0;
  let maxT = -Infinity;
  for (let i = ti - 29; i <= ti; i++) {
    if (a.tmin[i] <= th.frostC) frostN += 1;
    if (a.tmax[i] >= th.heatC) heatN += 1;
    minT = Math.min(minT, a.tmin[i]);
    maxT = Math.max(maxT, a.tmax[i]);
  }
  const countIn = (arr: ArrayLike<number>, x: number, y: number, pred: (v: number) => boolean) => {
    let c = 0;
    for (let i = x; i <= y; i++) if (pred(arr[i])) c += 1;
    return c;
  };
  const normFrost = mean(w30Runs.map(({ r, x, y }) => countIn(r.tmin, x, y, (v) => v <= th.frostC)));
  const normHeat = mean(w30Runs.map(({ r, x, y }) => countIn(r.tmax, x, y, (v) => v >= th.heatC)));
  const cropFactor = 0.4 + 0.6 * inField;
  const sevFrost = ramp(frostN - normFrost, 0, 2) * cropFactor;
  if (frostN > 0) {
    comps.push({
      key: 'frost',
      peril: 'frost',
      severity: sevFrost,
      text: `${frostN} frost ${plural(frostN, 'night', 'nights')} in the last 30 days, down to ${fmt1(minT)} °C (normal for this field: ${fmt0(normFrost)})`,
      short: `${frostN} frost ${plural(frostN, 'night', 'nights')}`,
      metric: 'frost_nights_30d',
      value: frostN,
      normal: r2(normFrost),
    });
  }
  const sevHeat = ramp(heatN - normHeat, 1, 8) * cropFactor;
  if (heatN > 0 && heatN - normHeat >= 1) {
    comps.push({
      key: 'heat',
      peril: 'heat',
      severity: sevHeat,
      text: `${heatN} ${plural(heatN, 'day', 'days')} at or above ${fmt0(th.heatC)} °C in the last 30 days, peaking at ${fmt1(maxT)} °C (normal for this field: ${fmt0(normHeat)})`,
      short: `${heatN} days above ${fmt0(th.heatC)} °C`,
      metric: 'heat_days_30d',
      value: heatN,
      normal: r2(normHeat),
    });
  }

  // ---- flood: max 72 h rain in the last 30 days
  let max72 = 0;
  let max72End = ti;
  for (let i = ti - 29; i <= ti; i++) {
    const s = sumRange(pre.actual, i - 2, i);
    if (s > max72) {
      max72 = s;
      max72End = i;
    }
  }
  const thrFlood = Math.max(20, th.flood72hMm);
  const sevFlood = ramp(max72, 0.6 * thrFlood, 1.3 * thrFlood);
  if (sevFlood > 0) {
    comps.push({
      key: 'flood',
      peril: 'flood',
      severity: sevFlood,
      text: `${fmt0(max72)} mm of rain in 72 hours up to ${shortDate(m.dates[max72End])} (flood threshold ${fmt0(thrFlood)} mm)`,
      short: `${fmt0(max72)} mm in 72 hours`,
      metric: 'rain_72h_mm',
      value: Math.round(max72),
      normal: thrFlood,
    });
  }

  // ---- hail: sudden NDVI drop between consecutive clear passes (beyond the normal seasonal change)
  let bestDrop = 0;
  let dropInfo: { from: number; to: number; v0: number; v1: number } | null = null;
  let prevK = -1;
  for (let k = 0; k < m.obsIdx.length; k++) {
    const idx = m.obsIdx[k];
    if (idx > ti) break;
    if (m.ndviObs[k] === null) continue;
    if (prevK >= 0 && idx > ti - 30 && idx - m.obsIdx[prevK] <= 20) {
      const v0 = m.ndviObs[prevK] as number;
      const v1 = m.ndviObs[k] as number;
      const st = a.stage[idx];
      let frostBetween = false;
      for (let j = m.obsIdx[prevK]; j <= idx; j++) if (a.tmin[j] <= th.frostC + 0.5) frostBetween = true;
      if (v0 > 0.35 && st !== 'fallow' && st !== 'maturity' && !frostBetween) {
        const drop = v0 - v1 - (m.bands.ndvi.mean[m.obsIdx[prevK]] - m.bands.ndvi.mean[idx]);
        if (drop > bestDrop) {
          bestDrop = drop;
          dropInfo = { from: m.obsIdx[prevK], to: idx, v0, v1 };
        }
      }
    }
    prevK = k;
  }
  const sevHail = ramp(bestDrop, 0.08, 0.25);
  if (sevHail > 0 && dropInfo) {
    comps.push({
      key: 'hail',
      peril: 'hail',
      severity: sevHail,
      text: `Sudden loss of crop greenness between ${shortDate(m.dates[dropInfo.from])} and ${shortDate(m.dates[dropInfo.to])} (NDVI ${fmt2(dropInfo.v0)} → ${fmt2(dropInfo.v1)}), consistent with hail or storm damage`,
      short: 'sudden greenness loss',
      metric: 'ndvi_drop',
      value: r2(dropInfo.v0 - dropInfo.v1),
      normal: r2(m.bands.ndvi.mean[dropInfo.from] - m.bands.ndvi.mean[dropInfo.to]),
    });
  }

  // ---- combine
  const inWindow = inMonthDayWindow(date, zone.stressWindow);
  const windowMult = inWindow ? 1.5 : 1;
  const irrigMult = zone.irrigated ? 0.4 : 1;
  const stage = a.stage[ti];
  const stageTxt = stagePhrase(stage, m, ti, farm);
  // A dry spell on a field with no crop and no sowing coming up matters less for repayment.
  const idleMult = stageTxt === 'with no crop in the ground' ? 0.6 : 1;
  for (const c of comps) {
    let s = c.severity;
    if (c.peril === 'drought') s *= irrigMult * idleMult;
    c.severity = clamp(s * windowMult, 0, 1);
  }
  const by = (k: Component) => comps.find((c) => c.key === k)?.severity ?? 0;
  const dr = [by('rain'), by('dryspell'), by('soil')];
  const drought = clamp(0.5 * Math.max(...dr) + 0.5 * mean(dr), 0, 1);
  const perils: Record<Peril, number> = {
    drought: r2(drought),
    flood: r2(by('flood')),
    frost: r2(by('frost')),
    hail: r2(by('hail')),
    heat: r2(by('heat')),
  };
  const veg = by('vegetation');
  const all: Record<Peril | 'vegetation', number> = { ...perils, drought, vegetation: veg };
  const wmean = (Object.keys(WEIGHTS) as (Peril | 'vegetation')[]).reduce((s, k) => s + WEIGHTS[k] * all[k], 0) / WEIGHT_SUM;
  const max = Math.max(...Object.values(all));
  const score = Math.round(clamp(100 * (0.5 * wmean + 0.5 * max), 0, 100));
  const tier = tierOf(score);

  const sorted = comps
    .filter((c) => c.context || c.severity > 0.02)
    .sort((x, y) => y.severity - x.severity || (x.context ? 1 : 0) - (y.context ? 1 : 0))
    .slice(0, 6);
  const drivers: Driver[] = sorted.map((c) => ({
    peril: c.peril,
    severity: r2(c.severity),
    text: c.text,
    metric: c.metric,
    value: c.value,
    normal: c.normal,
  }));

  const headline = makeHeadline(tier, sorted, stageTxt, period, farm, ti === WINDOW_DAYS - 1 ? AS_OF : date);
  return { date, score, tier, perils, vegetation: r2(veg), drivers, headline, stage, inStressWindow: inWindow };
}

const PERIL_TITLE: Record<Peril | 'vegetation', string> = {
  drought: 'Drought',
  vegetation: 'Crop greenness below normal',
  flood: 'Flood risk',
  frost: 'Frost damage',
  hail: 'Possible hail damage',
  heat: 'Heat stress',
};

function makeHeadline(tier: Tier, comps: Comp[], stage: string, period: string, farm: Farm, dateIso: string): string {
  const top = comps[0];
  const outstanding = farm.loan ? outstandingAt(farm.loan, dateIso) : 0;
  const money = farm.loan && outstanding > 0 ? compactMoney(outstanding, farm.loan.currency) : '';
  if (tier === 'normal' || !top || top.severity < 0.05) {
    if (top && top.severity >= 0.25) return `Mostly normal for ${period}; ${top.short} is worth watching.`;
    return `Conditions close to this field's normal for ${period}.`;
  }
  const second = comps.slice(1).find((c) => c.severity >= 0.2 && c.key !== top.key);
  const tail = `${second ? `; ${second.short}` : ''}${money ? ` (${money} outstanding)` : ''}.`;
  if (top.peril === 'vegetation') return `Crop greenness ${top.short.replace('greenness ', '')} for this field ${stage}${tail}`;
  const reasons = second ? `${top.short} and ${second.short}` : top.short;
  return `${PERIL_TITLE[top.peril]} ${stage}: ${reasons}${money ? ` (${money} outstanding)` : ''}.`;
}

// ---------------------------------------------------------------- farm-level assessment + memo

export interface FarmAssessmentFull {
  assessment: FarmAssessment;
  weekly: Evaluation[];
}

const ASSESS_CACHE = new Map<string, FarmAssessmentFull>();

export function clearAssessCache(): void {
  ASSESS_CACHE.clear();
}

export function assessFarmFull(farm: Farm, zone: Zone, opts?: EngineOptions): FarmAssessmentFull {
  const th = effectiveThresholds(farm, zone);
  const m = getModel(farm, zone, opts);
  const key = JSON.stringify([m.key, th, zone.stressWindow, !!zone.irrigated, farm.loan ?? null]);
  const hit = ASSESS_CACHE.get(key);
  if (hit) return hit;

  const weekly: Evaluation[] = [];
  for (let w = 25; w >= 0; w--) {
    const date = addDays(AS_OF, -7 * w);
    const ti = daysBetween(SERIES_START, date);
    weekly.push(evaluateAt(m, farm, zone, th, ti));
  }
  const now = weekly[weekly.length - 1];
  const loan = farm.loan;
  const exposure = loan ? outstandingAt(loan, AS_OF) : 0;
  const horizon = addDays(AS_OF, 120);
  const installmentsInStress =
    loan && now.tier !== 'normal' ? loan.installments.filter((i) => i.dueDate > AS_OF && i.dueDate <= horizon).length : 0;
  const assessment: FarmAssessment = {
    farmId: farm.id,
    score: now.score,
    tier: now.tier,
    headline: now.headline,
    drivers: now.drivers,
    perils: now.perils,
    trend: weekly.map((e) => ({ date: e.date, score: e.score })),
    exposure,
    nextInstallment: loan ? nextInstallment(loan, AS_OF) : null,
    installmentsInStress,
    inStressWindow: now.inStressWindow,
  };
  const full = { assessment, weekly };
  if (ASSESS_CACHE.size >= 500) ASSESS_CACHE.clear();
  ASSESS_CACHE.set(key, full);
  return full;
}


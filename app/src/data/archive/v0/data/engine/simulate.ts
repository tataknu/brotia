/**
 * One daily simulation run for a field: weather -> soil water bucket -> crop canopy (NDVI/NDMI).
 *
 * Randomness: regional weather comes from an RNG keyed by a 0.25° grid cell (neighbouring fields share
 * storms and dry spells); field-level noise comes from an RNG keyed by the farm id. All random draws
 * happen in a fixed order BEFORE event effects are applied, so changing an event's intensity never shifts
 * the random stream (scores respond monotonically to injected stress).
 */
import type { Farm } from '@/domain/types';
import { addDays, dayOfYear, daysBetween } from '@/domain/dates';
import { dayClimate, hargreavesEto, locationClimate } from './climate';
import { campaignPlan, greenFraction, stageOf, type Campaign, type Stage } from './crops';
import { combinedEffect, type BoundEvent } from './events';
import { clamp, makeRng } from './rng';

export const THETA_WP = 0.12;
export const THETA_FC = 0.33;
export const THETA_SAT = 0.4;
const ROOT_MM = 500;
const THETA_SOW = 0.19;
const MAX_SOW_DELAY = 35;

export interface SimInput {
  farm: Pick<Farm, 'id' | 'crop' | 'sowingDate' | 'centroid'>;
  irrigated: boolean;
  /** 'actual' or 'base-1'..'base-N'. */
  runKey: string;
  events: BoundEvent[];
  start: string;
  end: string;
  /** Hydrological years ('YYYY' of the July that starts them) whose rain factor is held near normal. */
  neutralYears?: number[];
  /**
   * Keep the run's pre-event rain close to its climatology over ~1-month horizons (feedback on wet-day
   * odds). Used for the 'actual' run so the only large anomalies in the demo are the injected events.
   */
  calm?: boolean;
}

export interface DailySim {
  dates: string[];
  precip: Float64Array;
  eto: Float64Array;
  sm: Float64Array;
  tmax: Float64Array;
  tmin: Float64Array;
  ndvi: Float64Array;
  ndmi: Float64Array;
  /** Canopy fraction 0..1. */
  green: Float64Array;
  /** Pre-event cloud flag for the satellite pass that day. */
  cloudy: Uint8Array;
  /** Observation noise for NDVI/NDMI on that day. */
  obsNoise: Float64Array;
  stage: Stage[];
  /** Active (or awaited) campaign per day, or null. */
  campaign: (Campaign | null)[];
  /** Days since effective sowing (-1 when fallow). */
  cropDay: Int32Array;
}

export function cellKey(lng: number, lat: number): string {
  return `${Math.round(lng * 4)}:${Math.round(lat * 4)}`;
}

function hydroYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) >= 7 ? y : y - 1;
}

export function simulate(input: SimInput): DailySim {
  const { farm, runKey } = input;
  const [lng, lat] = farm.centroid;
  const cell = cellKey(lng, lat);
  const wx = makeRng(`wx|${cell}|${runKey}`);
  const local = makeRng(`local|${farm.id}|${runKey}`);
  const loc = locationClimate(lng, lat);
  const n = daysBetween(input.start, input.end) + 1;
  const plan = campaignPlan(farm, input.start, input.end);

  const out: DailySim = {
    dates: new Array(n),
    precip: new Float64Array(n),
    eto: new Float64Array(n),
    sm: new Float64Array(n),
    tmax: new Float64Array(n),
    tmin: new Float64Array(n),
    ndvi: new Float64Array(n),
    ndmi: new Float64Array(n),
    green: new Float64Array(n),
    cloudy: new Uint8Array(n),
    obsNoise: new Float64Array(n),
    stage: new Array(n),
    campaign: new Array(n),
    cropDay: new Int32Array(n),
  };

  const yearFactor = new Map<number, number>();
  const rainYearFactor = (hy: number) => {
    let f = yearFactor.get(hy);
    if (f === undefined) {
      const r = makeRng(`year|${cell}|${runKey}|${hy}`);
      f = clamp(1 + 0.12 * r.normal(), 0.7, 1.3);
      if (input.neutralYears?.includes(hy)) f = 1 + (f - 1) * 0.15;
      yearFactor.set(hy, f);
    }
    return f;
  };
  // Management / variety quality of each campaign (peak NDVI scaling).
  const campaignQuality = new Map<Campaign, number>();
  for (const c of plan) {
    const r = makeRng(`camp|${farm.id}|${runKey}|${c.sow}|${c.crop}`);
    campaignQuality.set(c, clamp(1 + 0.03 * r.normal(), 0.92, 1.06));
  }
  // Bare-soil / residue level differs a little between fields.
  const bareBase = 0.17 + 0.03 * makeRng(`bare|${farm.id}`).uniform();

  let wet = false;
  let calmActual = 0;
  let calmExpected = 0;
  let ta = 0;
  let tb = 0;
  let surazoLeft = 0;
  let surazoDay = 0;
  let S = 0.24 * ROOT_MM;
  let dmg = 0;
  let frostDmg = 0;
  let hailDmg = 0;
  let ci = 0; // index of next campaign to start
  let active: Campaign | null = null;
  let activeSow = '';
  let waitingFor: Campaign | null = null;
  let waitDays = 0;

  for (let i = 0; i < n; i++) {
    const d = addDays(input.start, i);
    out.dates[i] = d;
    const doy = dayOfYear(d);
    const clim = dayClimate(doy, loc);

    // ---- random draws (fixed order, independent of events)
    const uWet = wx.uniform();
    const gAmt = wx.gamma(0.9) / 0.9;
    const nA = wx.normal();
    const nB = wx.normal();
    const uSurazo = wx.uniform();
    const uSurazoLen = wx.uniform();
    const nLocalRain = local.normal();
    const nLocalT = local.normal();
    const uCloud = local.uniform();
    const nObs = local.normal();

    // ---- precipitation (two-state Markov chain)
    const persistence = 0.3;
    let pWet: number = wet ? clim.wetFreq + persistence * (1 - clim.wetFreq) : clim.wetFreq * (1 - persistence);
    const yf = rainYearFactor(hydroYear(d));
    let amountMult = 1;
    if (input.calm && calmExpected > 5) {
      const ratio = calmActual / calmExpected;
      const k = clamp(1 + 1.6 * (1 - ratio), 0.45, 2.2);
      pWet = clamp(pWet * k, 0.02, 0.9);
      amountMult = clamp(1 + 0.6 * (1 - ratio), 0.6, 1.6);
    }
    wet = uWet < pWet;
    let rain = 0;
    if (wet) {
      const meanWet = (clim.rainMean / clim.wetFreq) * yf;
      rain = Math.min(150, meanWet * gAmt * amountMult * Math.exp(0.15 * nLocalRain));
      if (rain < 0.3) rain = 0.3;
    }
    if (input.calm) {
      const decay = Math.exp(-1 / 30);
      calmActual = calmActual * decay + rain;
      calmExpected = calmExpected * decay + clim.rainMean * yf;
    }

    // ---- temperature (AR(1) anomalies + winter cold fronts)
    ta = 0.7 * ta + 0.714 * 1.8 * nA;
    tb = 0.6 * tb + 0.8 * 1.3 * nB;
    if (surazoLeft === 0 && clim.wetness < 0.3 && uSurazo < 0.03) {
      surazoLeft = 2 + Math.floor(uSurazoLen * 3);
      surazoDay = 0;
    }
    let surazo = 0;
    if (surazoLeft > 0) {
      surazo = [1, 0.8, 0.5, 0.3, 0.2][surazoDay] ?? 0.2;
      surazoLeft -= 1;
      surazoDay += 1;
    }
    let tmax = clim.tmax + ta + 0.3 * nLocalT - (wet ? (rain > 20 ? 3.5 : 2.2) : 0) - 7 * surazo;
    let tmin = clim.tmin + 0.5 * ta + tb + 0.2 * nLocalT + (wet ? 0.8 : 0) - 6.5 * surazo;

    // ---- injected events (after all draws)
    const eff = input.events.length ? combinedEffect(input.events, d) : null;
    let hailHit = 0;
    if (eff) {
      rain = rain * eff.rainMult + eff.rainAdd;
      if (rain < 0.3) rain = 0;
      tmax += eff.tmaxAdd;
      tmin = Math.min(tmin + eff.tminAdd, eff.tminCap);
      hailHit = eff.hail;
    }
    if (tmin > tmax - 3) tmin = tmax - 3;

    const eto = clamp(hargreavesEto(doy, loc.latRad, tmax, tmin) * (rain > 5 ? 0.82 : 1), 1.2, 8.5);

    // ---- crop calendar (sowing waits for soil moisture)
    let theta = S / ROOT_MM;
    if (active && daysBetween(activeSow, d) >= active.seasonDays) active = null;
    while (ci < plan.length && plan[ci].sow <= d) {
      const c = plan[ci];
      if (i === 0 && c.sow < d) {
        // Sown before the simulation starts (spin-up): assume it went in on schedule.
        if (daysBetween(c.sow, d) < c.seasonDays) {
          active = c;
          activeSow = c.sow;
        }
        ci += 1;
        continue;
      }
      if (c.perennial || theta >= THETA_SOW || waitDays >= MAX_SOW_DELAY) {
        active = c;
        activeSow = d;
        dmg = 0;
        frostDmg = 0;
        hailDmg = 0;
        waitingFor = null;
        waitDays = 0;
        ci += 1;
      } else {
        waitingFor = c;
        waitDays += 1;
        break;
      }
    }
    const x = active ? daysBetween(activeSow, d) : -1;
    const g = active ? greenFraction(x, active.seasonDays, active.perennial) : 0;

    // ---- soil water bucket
    const kc = 0.3 + 0.85 * g;
    const fw = clamp((theta - THETA_WP) / (0.55 * (THETA_FC - THETA_WP)), 0, 1);
    const runoff = rain > 30 ? 0.35 * (rain - 30) : 0;
    S += rain - runoff;
    if (input.irrigated && g > 0.05 && theta < 0.24) S += 30;
    S -= kc * eto * fw;
    if (S > THETA_FC * ROOT_MM) S -= 0.3 * (S - THETA_FC * ROOT_MM);
    S = clamp(S, THETA_WP * ROOT_MM * 0.97, THETA_SAT * ROOT_MM);
    theta = S / ROOT_MM;

    // ---- canopy damage
    if (active && g > 0.02) {
      const stress = 1 - clamp((theta - THETA_WP) / (0.45 * (THETA_FC - THETA_WP)), 0, 1);
      dmg = Math.min(0.7, dmg * 0.985 + 0.028 * stress + (theta > 0.385 ? 0.02 : 0));
      if (tmin <= -0.5) frostDmg = Math.min(0.65, frostDmg + 0.13 * (-tmin + 0.5));
      if (hailHit > 0) hailDmg = Math.max(hailDmg, hailHit);
    }
    frostDmg *= 0.992;
    hailDmg *= 0.985;

    const quality = active ? campaignQuality.get(active) ?? 1 : 1;
    const bare = bareBase + 0.1 * clamp((theta - THETA_WP) / (THETA_FC - THETA_WP), 0, 1);
    const peak = active ? Math.min(0.92, active.peak * quality) : bare;
    const ndvi = clamp(bare + (peak - bare) * g * (1 - dmg) * (1 - frostDmg) * (1 - hailDmg), 0.08, 0.95);
    const ndmi = clamp(-0.15 + (0.55 * (ndvi - 0.2)) / 0.65 + 0.6 * (theta - 0.25), -0.3, 0.6);

    let stage: Stage = 'fallow';
    if (active) {
      if (active.perennial) {
        const p = x / active.seasonDays;
        stage = p < 0.06 ? 'establishment' : p < 0.8 ? 'vegetative' : 'maturity';
      } else stage = stageOf(x, active.seasonDays);
    } else if (waitingFor) stage = 'waiting';

    out.precip[i] = rain;
    out.eto[i] = eto;
    out.sm[i] = theta;
    out.tmax[i] = tmax;
    out.tmin[i] = tmin;
    out.ndvi[i] = ndvi;
    out.ndmi[i] = ndmi;
    out.green[i] = g;
    // Satellite pass: cloudier in the rainy season and on rainy days (pre-event draw keeps it stable).
    out.cloudy[i] = uCloud < 0.08 + 0.26 * clim.wetness + (uWet < pWet ? 0.3 : 0) ? 1 : 0;
    out.obsNoise[i] = nObs;
    out.stage[i] = stage;
    out.campaign[i] = active ?? waitingFor;
    out.cropDay[i] = active ? x : -1;
  }
  return out;
}

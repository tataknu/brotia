/**
 * Climatology of the Santa Cruz (Bolivia) lowlands: rainy season Nov–Mar, dry season Jun–Sep.
 * Monthly normals are interpolated to the day of year between mid-month anchors.
 */
import { clamp } from './rng';

// Okinawa / central soy belt reference (about 1,150 mm a year).
const RAIN_MM = [185, 155, 140, 85, 65, 40, 30, 28, 45, 85, 125, 165];
const WET_FREQ = [0.45, 0.42, 0.38, 0.28, 0.2, 0.14, 0.1, 0.1, 0.14, 0.24, 0.32, 0.4];
const TMAX = [31.0, 30.8, 30.2, 28.6, 26.0, 24.8, 25.0, 27.6, 30.0, 31.6, 31.8, 31.4];
const TMIN = [21.4, 21.2, 20.6, 18.8, 16.0, 14.2, 13.4, 14.6, 16.8, 19.2, 20.4, 21.0];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MID_DOY = DAYS.map((_, m) => DAYS.slice(0, m).reduce((a, b) => a + b, 0) + DAYS[m] / 2);

function interp(table: number[], doy: number): number {
  const d = ((doy - 1) % 365) + 0.5;
  let i = 11;
  for (let k = 0; k < 12; k++) if (MID_DOY[k] <= d) i = k;
  const j = (i + 1) % 12;
  const a = MID_DOY[i];
  let b = MID_DOY[j];
  let x = d;
  if (j === 0) {
    b += 365;
    if (x < a) x += 365;
  }
  const t = (x - a) / (b - a);
  return table[i] * (1 - t) + table[j] * t;
}

export interface DayClimate {
  /** Mean daily rain (mm). */
  rainMean: number;
  /** Probability that a day is wet. */
  wetFreq: number;
  tmax: number;
  tmin: number;
  /** 0 in the driest month, 1 in the wettest. */
  wetness: number;
}

export interface LocationClimate {
  rainFactor: number;
  tmaxAdj: number;
  tminAdj: number;
  latRad: number;
}

/** West of the Río Grande is wetter than the eastern expansion frontier; the south is a bit colder. */
export function locationClimate(lng: number, lat: number): LocationClimate {
  return {
    rainFactor: clamp(1 + 0.3 * (-62.9 - lng), 0.65, 1.3),
    tmaxAdj: clamp(0.6 * (lng + 62.9), -0.8, 0.8),
    tminAdj: clamp(1.5 * (lat + 17.2), -1.5, 1),
    latRad: (lat * Math.PI) / 180,
  };
}

export function dayClimate(doy: number, loc: LocationClimate): DayClimate {
  const monthlyRain = interp(RAIN_MM, doy);
  const dim = 30.4;
  const wetFreq = interp(WET_FREQ, doy);
  return {
    rainMean: (monthlyRain / dim) * loc.rainFactor,
    wetFreq: clamp(wetFreq * (0.85 + 0.15 * loc.rainFactor), 0.05, 0.6),
    tmax: interp(TMAX, doy) + loc.tmaxAdj,
    tmin: interp(TMIN, doy) + loc.tminAdj,
    wetness: clamp((monthlyRain - 28) / (185 - 28), 0, 1),
  };
}

/** Extraterrestrial radiation (FAO-56), in mm/day of evaporation equivalent. */
export function extraterrestrialMm(doy: number, latRad: number): number {
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * doy);
  const decl = 0.409 * Math.sin(((2 * Math.PI) / 365) * doy - 1.39);
  const ws = Math.acos(clamp(-Math.tan(latRad) * Math.tan(decl), -1, 1));
  const ra = ((24 * 60) / Math.PI) * 0.082 * dr * (ws * Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.sin(ws));
  return ra * 0.408;
}

/** Hargreaves reference evapotranspiration, mm/day. */
export function hargreavesEto(doy: number, latRad: number, tmax: number, tmin: number): number {
  const ra = extraterrestrialMm(doy, latRad);
  const tmean = (tmax + tmin) / 2;
  const dt = Math.max(1, tmax - tmin);
  return 0.0023 * ra * (tmean + 17.8) * Math.sqrt(dt);
}

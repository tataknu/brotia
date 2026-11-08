/**
 * Injected climate events (v0 fake data). Each event has a geographic footprint (intensity 0..1 at a
 * location) and a per-day effect applied AFTER all random draws, so scaling an event never changes the
 * underlying random weather. Farms anywhere inside a footprint (including user-drawn ones) are hit.
 */
import type { ClimateEvent, Peril } from '@/domain/types';
import { daysBetween } from '@/domain/dates';
import { clamp, ramp } from './rng';

export interface DayEffect {
  rainMult: number;
  rainAdd: number;
  tmaxAdd: number;
  tminAdd: number;
  /** Tmin is capped at this value (cold-front frost nights). */
  tminCap: number;
  /** Fraction of green canopy destroyed (hail). */
  hail: number;
}

export const NO_EFFECT: DayEffect = { rainMult: 1, rainAdd: 0, tmaxAdd: 0, tminAdd: 0, tminCap: Infinity, hail: 0 };

export interface EventDef {
  id: string;
  kind: Peril;
  title: string;
  region: string;
  start: string;
  end: string;
  baseSeverity: ClimateEvent['severity'];
  center: [number, number];
  /** Minimum footprint intensity for a farm to count as affected. */
  affectedAt: number;
  footprint(lng: number, lat: number): number;
  /** Effect for a day at a given intensity, or null when the day is outside the event. */
  effect(dateISO: string, intensity: number): Partial<DayEffect> | null;
}

/** Equirectangular distance in km (accurate enough at these scales). */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const latMid = (((a[1] + b[1]) / 2) * Math.PI) / 180;
  const dx = (a[0] - b[0]) * 111.32 * Math.cos(latMid);
  const dy = (a[1] - b[1]) * 110.57;
  return Math.sqrt(dx * dx + dy * dy);
}

function radial(center: [number, number], plateauKm: number, radiusKm: number) {
  return (lng: number, lat: number) => 1 - ramp(distanceKm([lng, lat], center), plateauKm, radiusKm);
}

const within = (d: string, start: string, end: string) => d >= start && d <= end;

export const DROUGHT_START = '2026-09-01';

export const EVENT_DEFS: EventDef[] = [
  {
    id: 'east-drought-2026',
    kind: 'drought',
    title: 'Late rains and drought in eastern Santa Cruz',
    region: 'San Julián, Cuatro Cañadas and the eastern expansion frontier',
    start: DROUGHT_START,
    end: '2026-11-06',
    baseSeverity: 'severe',
    center: [-62.55, -17.1],
    affectedAt: 0.25,
    footprint(lng, lat) {
      // Strongest around San Julián, fading south toward Pailón and west toward the Río Grande.
      const east = clamp((lng + 62.92) / 0.25, 0, 1);
      return east * radial([-62.55, -17.1], 25, 90)(lng, lat);
    },
    effect(d, I) {
      if (!within(d, DROUGHT_START, '2026-11-06')) return null;
      const k = I * ramp(daysBetween(DROUGHT_START, d), 0, 12);
      return { rainMult: 1 - 0.9 * k, tmaxAdd: 1.2 * k, tminAdd: -0.4 * k };
    },
  },
  {
    id: 'hail-okinawa-2026',
    kind: 'hail',
    title: 'Hailstorm near Okinawa',
    region: 'Okinawa Uno colony area',
    start: '2026-10-21',
    end: '2026-10-21',
    baseSeverity: 'severe',
    center: [-62.85, -17.18],
    affectedAt: 0.25,
    footprint: radial([-62.85, -17.18], 3, 8),
    effect(d, I) {
      if (d !== '2026-10-21') return null;
      return { rainAdd: 38 * I, tmaxAdd: -4 * I, hail: 0.55 * I };
    },
  },
  {
    id: 'heatwave-sep-2026',
    kind: 'heat',
    title: 'Early-spring heatwave',
    region: 'Santa Cruz lowlands',
    start: '2026-09-19',
    end: '2026-09-27',
    baseSeverity: 'moderate',
    center: [-62.9, -17.3],
    affectedAt: 0.5,
    footprint: radial([-62.9, -17.3], 120, 250),
    effect(d, I) {
      if (!within(d, '2026-09-19', '2026-09-27')) return null;
      const f = Math.sin((Math.PI * (daysBetween('2026-09-19', d) + 0.5)) / 9);
      return { tmaxAdd: 4.5 * f * I, tminAdd: 2 * f * I, rainMult: 1 - 0.7 * I };
    },
  },
  {
    id: 'frost-jul-2026',
    kind: 'frost',
    title: 'Cold front (surazo) frost in the south',
    region: 'Pailón and the southern Río Grande fields',
    start: '2026-07-08',
    end: '2026-07-11',
    baseSeverity: 'severe',
    center: [-62.74, -17.72],
    affectedAt: 0.3,
    footprint: radial([-62.74, -17.72], 15, 45),
    effect(d, I) {
      if (!within(d, '2026-07-08', '2026-07-11')) return null;
      const day = daysBetween('2026-07-08', d);
      const tmaxAdd = [-6, -10, -9, -6][day] * I;
      const capTarget = [Infinity, -1.0, -2.6, 0.4][day];
      const tminCap = capTarget === Infinity ? Infinity : capTarget + (1 - I) * 7;
      return { tmaxAdd, tminCap, rainAdd: day === 0 ? 6 * I : 0 };
    },
  },
  {
    id: 'flood-mar-2026',
    kind: 'flood',
    title: 'Extreme rain and flooding between Montero and Mineros',
    region: 'Montero – Mineros (Piraí river basin)',
    start: '2026-03-02',
    end: '2026-03-04',
    baseSeverity: 'extreme',
    center: [-63.27, -17.21],
    affectedAt: 0.3,
    footprint: radial([-63.27, -17.21], 8, 22),
    effect(d, I) {
      if (!within(d, '2026-03-02', '2026-03-04')) return null;
      return { rainAdd: [62, 98, 48][daysBetween('2026-03-02', d)] * I };
    },
  },
];

/** An event bound to one farm location. */
export interface BoundEvent {
  def: EventDef;
  intensity: number;
}

export function bindEvents(defs: EventDef[], lng: number, lat: number, scale: Record<string, number> = {}): BoundEvent[] {
  return defs
    .map((def) => ({ def, intensity: clamp(def.footprint(lng, lat) * (scale[def.id] ?? 1), 0, 1.5) }))
    .filter((b) => b.intensity > 0.001);
}

/** Combined effect of all bound events on a day. */
export function combinedEffect(bound: BoundEvent[], dateISO: string): DayEffect | null {
  let out: DayEffect | null = null;
  for (const b of bound) {
    const e = b.def.effect(dateISO, b.intensity);
    if (!e) continue;
    out ??= { ...NO_EFFECT };
    if (e.rainMult !== undefined) out.rainMult *= Math.max(0, e.rainMult);
    out.rainAdd += e.rainAdd ?? 0;
    out.tmaxAdd += e.tmaxAdd ?? 0;
    out.tminAdd += e.tminAdd ?? 0;
    out.tminCap = Math.min(out.tminCap, e.tminCap ?? Infinity);
    out.hail = Math.max(out.hail, e.hail ?? 0);
  }
  return out;
}

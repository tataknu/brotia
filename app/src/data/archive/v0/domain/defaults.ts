import type { Farm, Thresholds, Zone } from './types';

export const DEFAULT_THRESHOLDS: Thresholds = {
  ndviAnomalyZ: -1.5,
  rainDeficitPct: 40,
  dryDays: 21,
  frostC: 0,
  heatC: 35,
  soilMoisturePctile: 20,
  flood72hMm: 120,
};

/** Human labels + units for each threshold, for forms and explanations. */
export const THRESHOLD_META: Record<keyof Thresholds, { label: string; unit: string; hint: string; min: number; max: number; step: number }> = {
  ndviAnomalyZ: { label: 'Vegetation anomaly', unit: 'z', hint: 'Flag when NDVI falls this many standard deviations below the field’s own normal for the date', min: -4, max: 0, step: 0.1 },
  rainDeficitPct: { label: 'Rain deficit', unit: '%', hint: 'Flag when 30–60-day rain is this much below the field’s normal', min: 0, max: 100, step: 5 },
  dryDays: { label: 'Dry spell', unit: 'days', hint: 'Consecutive days with less than 1 mm of rain', min: 5, max: 60, step: 1 },
  frostC: { label: 'Frost', unit: '°C', hint: 'Minimum temperature at or below this value', min: -10, max: 5, step: 0.5 },
  heatC: { label: 'Heat', unit: '°C', hint: 'Maximum temperature at or above this value', min: 28, max: 45, step: 0.5 },
  soilMoisturePctile: { label: 'Dry soil', unit: 'pctile', hint: 'Soil moisture below this percentile of the field’s own history', min: 1, max: 50, step: 1 },
  flood72hMm: { label: 'Flood rain', unit: 'mm / 72 h', hint: 'Rain in 72 hours at or above this value', min: 40, max: 400, step: 10 },
};

export const ZONE_COLORS = ['#2E7A55', '#3A6EA5', '#C07A2C', '#7A5AA6', '#5F8F3E', '#A5463F'] as const;

let zoneCounter = 0;
function zoneId(): string {
  zoneCounter += 1;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : String(Date.now());
  return `zone-${rnd}-${zoneCounter}`;
}

export function makeDefaultZone(name: string, opts?: { id?: string; color?: string }): Zone {
  return {
    id: opts?.id ?? zoneId(),
    name,
    color: opts?.color ?? ZONE_COLORS[0],
    baselineYears: 5,
    // Summer (main soy season) critical window in the Santa Cruz lowlands.
    stressWindow: { start: '12-15', end: '03-15' },
    irrigated: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
  };
}

/** Zone thresholds with the farm's per-field overrides applied on top. */
export function effectiveThresholds(farm: Pick<Farm, 'overrides'>, zone: Pick<Zone, 'thresholds'>): Thresholds {
  const out: Thresholds = { ...zone.thresholds };
  const ov = farm.overrides ?? {};
  for (const k of Object.keys(ov) as (keyof Thresholds)[]) {
    const v = ov[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Pure helpers for the Zones & baselines step (no React; tested in node). */
import type { CropType, Farm, Thresholds, Zone } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { addDays, monthDay } from '@/domain/dates';

const MD_RE = /^(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function isValidMonthDay(s: string): boolean {
  const m = MD_RE.exec(s);
  if (!m) return false;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[Math.min(12, Math.max(1, month)) - 1];
}

export function toMonthDay(month: number, day: number): string {
  const m = Math.min(12, Math.max(1, Math.round(month)));
  const d = Math.min(daysInMonth(m), Math.max(1, Math.round(day)));
  return `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** '12-15' -> 'Dec 15'. */
export function monthDayLabel(md: string): string {
  if (!isValidMonthDay(md)) return md;
  const [m, d] = md.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/**
 * Suggested critical window for a crop: roughly flowering to grain fill, i.e. 40%..75% of the season
 * after the typical sowing day. A fixed non-leap anchor year keeps the result stable.
 */
export function suggestStressWindow(crop: CropType): { start: string; end: string } {
  const info = CROPS[crop];
  const sow = `2025-${info.typicalSowMonthDay}`;
  return {
    start: monthDay(addDays(sow, Math.round(info.seasonDays * 0.4))),
    end: monthDay(addDays(sow, Math.round(info.seasonDays * 0.75))),
  };
}

/** Crop covering the most area among the zone's farms (falls back to all farms), or null without farms. */
export function dominantCrop(farms: Pick<Farm, 'crop' | 'areaHa' | 'zoneId'>[], zoneId?: string): CropType | null {
  const pick = (list: typeof farms) => {
    const byCrop = new Map<CropType, number>();
    for (const f of list) byCrop.set(f.crop, (byCrop.get(f.crop) ?? 0) + (f.areaHa || 0) + 1e-6);
    let best: CropType | null = null;
    let bestArea = -1;
    for (const [crop, area] of byCrop) {
      if (area > bestArea) {
        best = crop;
        bestArea = area;
      }
    }
    return best;
  };
  const inZone = zoneId ? farms.filter((f) => f.zoneId === zoneId) : farms;
  return pick(inZone) ?? pick(farms);
}

/** Sets (value: number) or clears (value: undefined) one override. Returns undefined when nothing is left. */
export function withOverride(
  overrides: Partial<Thresholds> | undefined,
  key: keyof Thresholds,
  value: number | undefined,
): Partial<Thresholds> | undefined {
  const next: Partial<Thresholds> = { ...(overrides ?? {}) };
  if (value === undefined || !Number.isFinite(value)) delete next[key];
  else next[key] = value;
  return Object.keys(next).length ? next : undefined;
}

export function overrideCount(farm: Pick<Farm, 'overrides'>): number {
  return Object.values(farm.overrides ?? {}).filter((v) => typeof v === 'number' && Number.isFinite(v)).length;
}

export function isOverridden(farm: Pick<Farm, 'overrides'>, key: keyof Thresholds): boolean {
  const v = farm.overrides?.[key];
  return typeof v === 'number' && Number.isFinite(v);
}

/** Clamps a value to [min, max] and snaps it to `step` (from THRESHOLD_META), avoiding float noise. */
export function clampToMeta(value: number, meta: { min: number; max: number; step: number }): number {
  const clamped = Math.min(meta.max, Math.max(meta.min, value));
  const decimals = (String(meta.step).split('.')[1] ?? '').length;
  return Number(clamped.toFixed(decimals));
}

/** Farm counts per zone id. */
export function farmsPerZone(farms: Pick<Farm, 'zoneId'>[], zones: Pick<Zone, 'id'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const z of zones) out[z.id] = 0;
  for (const f of farms) out[f.zoneId] = (out[f.zoneId] ?? 0) + 1;
  return out;
}

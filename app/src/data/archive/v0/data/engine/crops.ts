/**
 * Crop calendar: campaigns (sowing date + season length) and the green-canopy curve.
 * Santa Cruz has two campaigns: summer (soy/maize/rice sown Oct–Dec, harvested Feb–Apr) and winter
 * (sorghum, wheat, chia, sunflower sown Feb–May). Many fields grow a second crop in the other campaign.
 */
import type { CropType, Farm } from '@/domain/types';
import { CROPS } from '@/domain/types';
import { addDays, daysBetween, monthDay } from '@/domain/dates';
import { hashString } from './rng';

export const PEAK_NDVI: Record<CropType, number> = {
  soy: 0.85,
  maize: 0.86,
  wheat: 0.78,
  sorghum: 0.8,
  sunflower: 0.76,
  rice: 0.84,
  sugarcane: 0.82,
  quinoa: 0.7,
  potato: 0.78,
  chia: 0.75,
};

export interface Campaign {
  crop: CropType;
  /** Scheduled sowing date (actual sowing may be delayed when soil is too dry). */
  sow: string;
  seasonDays: number;
  peak: number;
  primary: boolean;
  perennial: boolean;
}

export type Stage = 'fallow' | 'waiting' | 'establishment' | 'vegetative' | 'flowering' | 'grainfill' | 'maturity';

const WINTER_SECONDARY: CropType[] = ['sorghum', 'wheat', 'chia', 'sunflower'];

function isSummerSowing(md: string): boolean {
  const m = Number(md.slice(0, 2));
  return m >= 9 || m <= 1;
}

export function primarySowMonthDay(farm: Pick<Farm, 'crop' | 'sowingDate'>): string {
  return farm.sowingDate ? monthDay(farm.sowingDate) : CROPS[farm.crop].typicalSowMonthDay;
}

/** All campaigns that may touch [fromIso, toIso], sorted by sowing date. Same calendar for every run. */
export function campaignPlan(farm: Pick<Farm, 'id' | 'crop' | 'sowingDate'>, fromIso: string, toIso: string): Campaign[] {
  const info = CROPS[farm.crop];
  const perennial = info.seasonDays >= 300;
  const md = primarySowMonthDay(farm);
  const h = hashString(`rotation|${farm.id}`);
  const hasSecondary = !perennial && h % 100 < 65;
  const secondaryWinter = WINTER_SECONDARY[(h >>> 8) % WINTER_SECONDARY.length];
  const y0 = Number(fromIso.slice(0, 4)) - 1;
  const y1 = Number(toIso.slice(0, 4)) + 1;
  const primaries: Campaign[] = [];
  for (let y = y0; y <= y1; y++) {
    let sow = `${y}-${md === '02-29' ? '02-28' : md}`;
    if (farm.sowingDate && farm.sowingDate.slice(0, 4) === String(y)) sow = farm.sowingDate.slice(0, 10);
    primaries.push({ crop: farm.crop, sow, seasonDays: perennial ? 365 : info.seasonDays, peak: PEAK_NDVI[farm.crop], primary: true, perennial });
  }
  const out: Campaign[] = [...primaries];
  if (hasSecondary) {
    const summerPrimary = isSummerSowing(md);
    for (let i = 0; i < primaries.length - 1; i++) {
      const p = primaries[i];
      const gapStart = addDays(p.sow, p.seasonDays + 20);
      const gapEnd = addDays(primaries[i + 1].sow, -10);
      let crop: CropType;
      let sow: string;
      if (summerPrimary) {
        crop = secondaryWinter;
        sow = gapStart;
      } else {
        crop = 'soy';
        const y = Number(gapStart.slice(0, 4));
        sow = `${y}-10-10` >= gapStart ? `${y}-10-10` : `${y + 1}-10-10`;
      }
      const len = Math.min(CROPS[crop].seasonDays, daysBetween(sow, gapEnd));
      if (len >= 90) out.push({ crop, sow, seasonDays: len, peak: PEAK_NDVI[crop] * 0.85, primary: false, perennial: false });
    }
  }
  return out.filter((c) => addDays(c.sow, c.seasonDays) >= addDays(fromIso, -30) && c.sow <= toIso).sort((a, b) => a.sow.localeCompare(b.sow));
}

/** Green canopy fraction 0..1 for `x` days after (effective) sowing of a season of `len` days. */
export function greenFraction(x: number, len: number, perennial: boolean): number {
  if (x < 0) return perennial ? 0.3 : 0;
  if (perennial) {
    // Ratoon regrowth after harvest, ripening (drying) late in the cycle.
    const p = x / len;
    if (p < 0.5) return 0.3 + 0.7 / (1 + Math.exp(-10 * (p / 0.5 - 0.45)));
    if (p < 0.8) return 1;
    return Math.max(0.45, 1 - ((p - 0.8) / 0.2) * 0.5);
  }
  if (x >= len) return 0;
  const emerge = 8;
  if (x < emerge) return 0;
  const peakAt = 0.45 * len;
  if (x < peakAt) {
    const p = (x - emerge) / (peakAt - emerge);
    const s = (v: number) => 1 / (1 + Math.exp(-10 * (v - 0.5)));
    return (s(p) - s(0)) / (s(1) - s(0));
  }
  if (x < 0.7 * len) return 1;
  const p = (x - 0.7 * len) / (0.3 * len);
  return Math.max(0, 1 - Math.pow(p, 1.5));
}

export function stageOf(x: number, len: number): Stage {
  if (x < 0 || x >= len) return 'fallow';
  if (x < 21) return 'establishment';
  if (x < 0.45 * len) return 'vegetative';
  if (x < 0.62 * len) return 'flowering';
  if (x < 0.88 * len) return 'grainfill';
  return 'maturity';
}

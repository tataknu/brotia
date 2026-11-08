import type { Crop, Peril } from '@/domain/types';
import { CROP_META } from '@/domain/constants';

/** Chart series colors (match --chart-N in src/index.css). Use in this order for multi-series charts. */
export const CHART_COLORS = ['#1F6B43', '#3A6EA5', '#C07A2C', '#7A5AA6', '#5F8F3E', '#A5463F'] as const;
export const chartColor = (i: number): string => CHART_COLORS[i % CHART_COLORS.length];

/** Semantic colors for charts and map layers (BrotIA palette, docs/design/v1.1-ui-spec.md). */
export const SEMANTIC = {
  brand: '#1F6B43',
  brandSoft: '#E9F3EC',
  accent: '#2FA05A',
  ink: '#0E1914',
  muted: '#6A766F',
  line: '#E4EBE6',
  surface: '#F6F8F7',
  faint: '#E4EBE6',
  /** Fill for the field's own baseline band (p10..p90). */
  baselineBand: '#1F6B43',
  baselineBandOpacity: 0.12,
  baselineMean: '#6A766F',
  danger: '#D0533A',
  warn: '#E8933A',
} as const;

/**
 * Risk ramp: the logo's soil row, low risk → high risk. Use it for tiers and score scales only.
 * Index 0 = #1F6B43 (lowest) … 6 = #9E2F3A (highest).
 */
export const RISK_RAMP = ['#1F6B43', '#2FA05A', '#8CC63F', '#E3C93B', '#E8933A', '#D0533A', '#9E2F3A'] as const;

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Continuous risk score 0–100 → colour across RISK_RAMP (linear between the 7 stops).
 * Non-finite scores return the muted grey.
 */
export function riskColor(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return SEMANTIC.muted;
  const t = (Math.min(100, Math.max(0, score)) / 100) * (RISK_RAMP.length - 1);
  const i = Math.min(RISK_RAMP.length - 2, Math.floor(t));
  const f = t - i;
  const a = hex(RISK_RAMP[i]);
  const b = hex(RISK_RAMP[i + 1]);
  return `#${a.map((v, k) => toHex(v + (b[k] - v) * f)).join('').toUpperCase()}`;
}

/**
 * Tier colors. fg = the ramp colour (dots, bars, map fills); bg = soft fill; ink = text on bg (>= 4.5:1).
 * normal = #2FA05A, watch = #E8933A, high = #D0533A.
 */
export const TIER_COLORS = {
  normal: { fg: '#2FA05A', bg: '#E9F3EC', ink: '#0E2A23' },
  watch: { fg: '#E8933A', bg: '#FDF1E4', ink: '#8A4E0F' },
  high: { fg: '#D0533A', bg: '#FBECE8', ink: '#9E2F3A' },
} as const;

/** Peril colours for stacked bars / legends (10 v1 perils). */
export const PERIL_COLORS: Record<Peril, string> = {
  frost: '#7A5AA6',
  heat: '#A5463F',
  harvest_rain: '#3A6EA5',
  water: '#C07A2C',
  chill: '#4E7C83',
  fire: '#D0533A',
  flood: '#2F5C8C',
  declared_emergency: '#A86A12',
  abandonment: '#6A766F',
  vigour: '#1F6B43',
};

/** Risk component colours (C, D, G). */
export const COMPONENT_COLORS = { climate: '#3A6EA5', disaster: '#D0533A', geography: '#8A6B4E' } as const;

/** Water stress ladder colours. */
export const STRESS_COLORS = { none: '#2FA05A', mild: '#C07A2C', moderate: '#E8933A', severe: '#D0533A', unknown: '#6A766F' } as const;

/** Crop colours (same as CROP_META / fixtures/crops.json). */
export const CROP_COLORS: Record<Crop, string> = Object.fromEntries(
  (Object.keys(CROP_META) as Crop[]).map((c) => [c, CROP_META[c].color]),
) as Record<Crop, string>;

/** Default NDVI legend (CONTRACT §E.12, rdylgn). Prefer ImageryTimeline.legend when available. */
export const NDVI_STOPS: [number, string][] = [
  [0, '#a50026'],
  [0.2, '#f46d43'],
  [0.4, '#fee08b'],
  [0.6, '#a6d96a'],
  [0.8, '#1a9850'],
  [1, '#006837'],
];

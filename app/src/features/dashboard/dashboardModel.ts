/**
 * Pure view-model shared by the portfolio report's panels (no React). Every number here is read from the service's
 * PortfolioAssessment / FarmAssessment; nothing is re-computed (trust rule). Unit-tested in node.
 */
import { CROP_META } from '@/domain/constants';
import { daysBetween } from '@/domain/dates';
import type { ClimateEvent, CreditAction, Crop, Installment, Portfolio, PortfolioAssessment, Tier, WaterStatus } from '@/domain/types';

/* ───────────────────────── KPIs ───────────────────────── */

export interface Kpis {
  total: number;
  stressed: number;
  /** stressed / total, 0..1; null when total is 0. */
  stressedShare: number | null;
  high: number;
  watch: number;
  farms: number;
  farmsByTier: Record<Tier, number>;
  actions: number;
}

export function kpis(a: PortfolioAssessment): Kpis {
  const watch = a.exposureByTier.watch ?? 0;
  const high = a.exposureByTier.high ?? 0;
  const stressed = watch + high;
  const farms = (a.farmsByTier.normal ?? 0) + (a.farmsByTier.watch ?? 0) + (a.farmsByTier.high ?? 0);
  return {
    total: a.totalExposure,
    stressed,
    stressedShare: a.totalExposure > 0 ? stressed / a.totalExposure : null,
    high,
    watch,
    farms,
    farmsByTier: { normal: a.farmsByTier.normal ?? 0, watch: a.farmsByTier.watch ?? 0, high: a.farmsByTier.high ?? 0 },
    actions: a.creditActions.length,
  };
}

/* ───────────────────────── exposure bars ───────────────────────── */

export interface ExposureRow {
  key: string;
  label: string;
  /** Dot colour (crop colour); null for zones without a single crop. */
  color: string | null;
  farms: number;
  total: number;
  stressed: number;
  /** total − stressed, never negative. */
  unstressed: number;
}

const byTotal = (a: ExposureRow, b: ExposureRow) => b.total - a.total || b.stressed - a.stressed || a.label.localeCompare(b.label);

export function cropRows(a: PortfolioAssessment): ExposureRow[] {
  return a.byCrop
    .map((s) => ({
      key: s.crop,
      label: CROP_META[s.crop as Crop]?.label ?? s.crop,
      color: CROP_META[s.crop as Crop]?.color ?? null,
      farms: s.farms,
      total: s.exposure,
      stressed: s.stressedExposure,
      unstressed: Math.max(0, s.exposure - s.stressedExposure),
    }))
    .sort(byTotal);
}

/** Largest row total (bar scale), at least 1 to avoid dividing by zero. */
export const scaleMax = (rows: ExposureRow[]): number => Math.max(1, ...rows.map((r) => r.total));

/* ───────────────────────── installments and water lookups ───────────────────────── */

export interface InstallmentInfo {
  dueDate: string;
  amount: number;
  /** Days from asOf to the due date. */
  days: number;
  /** Due within 60 days (the default credit-rule horizon). */
  soon: boolean;
}

export function installmentInfo(next: Installment | null | undefined, asOf: string): InstallmentInfo | null {
  if (!next) return null;
  const days = daysBetween(asOf, next.dueDate);
  return { dueDate: next.dueDate, amount: next.amount, days, soon: days >= 0 && days <= 60 };
}

/** 'in 23 days' / 'tomorrow' / 'today' / '3 days ago'. */
export function dueLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  if (days === -1) return 'yesterday';
  return `${-days} days ago`;
}

/**
 * Concurrency gate for per-row lookups: the row may start when fewer than `slots` rows above it are
 * still unsettled. Settled rows stay enabled (their result is cached).
 */
export function waterSlotsOpen(order: readonly string[], settled: ReadonlySet<string>, id: string, slots: number): boolean {
  const i = order.indexOf(id);
  if (i < 0) return false;
  if (settled.has(id)) return true;
  let pendingAbove = 0;
  for (let j = 0; j < i; j++) if (!settled.has(order[j])) pendingAbove++;
  return pendingAbove < slots;
}

/* ───────────────────────── water status ───────────────────────── */

export type WaterLevel = 'ok' | 'watch' | 'stress' | 'unknown';

export interface WaterSummary {
  level: WaterLevel;
  label: string;
  /** One line per rung that says something. */
  details: string[];
  decree: boolean;
}

const STRESS_TEXT = { none: 'no stress', mild: 'mild stress', moderate: 'moderate stress', severe: 'severe stress', unknown: 'stress unknown' } as const;

/**
 * Collapses the water ladder (CONTRACT §E.11) into one icon state for the watchlist. Display only: the
 * service's risk already scores water; this never changes a number.
 */
export function waterSummary(w: WaterStatus): WaterSummary {
  const details: string[] = [];
  details.push(`Irrigated: ${w.irrigated.value === 'yes' ? 'yes' : w.irrigated.value === 'no' ? 'no' : 'unknown'}`);
  if (w.supply.decreeActive) details.push(`Water-scarcity decree active${w.supply.decreeUntil ? ` until ${w.supply.decreeUntil}` : ''}`);
  if (w.supply.snowmeltPctOfNormal !== null && w.supply.snowmeltPctOfNormal !== undefined) details.push(`Snowmelt forecast ${Math.round(w.supply.snowmeltPctOfNormal)}% of normal`);
  details.push(`Canopy moisture: ${STRESS_TEXT[w.stress.level]}`);
  if (w.abandonment.flag) details.push(`Irrigation may have stopped (${w.abandonment.confidence} confidence)`);

  let level: WaterLevel;
  let label: string;
  if (w.abandonment.flag) {
    level = 'stress';
    label = 'Irrigation may have stopped';
  } else if (w.stress.level === 'severe' || w.stress.level === 'moderate') {
    level = 'stress';
    label = `Water: ${STRESS_TEXT[w.stress.level]}`;
  } else if (w.supply.decreeActive || w.stress.level === 'mild' || (w.supply.snowmeltPctOfNormal ?? 100) < 70) {
    level = 'watch';
    label = w.supply.decreeActive ? 'Water supply at risk (decree)' : w.stress.level === 'mild' ? 'Water: mild stress' : 'Water supply at risk (low snowmelt)';
  } else if (w.stress.level === 'none') {
    level = 'ok';
    label = 'Water: no stress';
  } else {
    level = 'unknown';
    label = 'Water status unknown';
  }
  return { level, label, details, decree: w.supply.decreeActive };
}

/* ───────────────────────── events ───────────────────────── */

export type EventSort = 'exposure' | 'recent';

export const EVIDENCE_LABELS: Record<ClimateEvent['evidenceKind'], string> = {
  observed_footprint: 'Observed footprint',
  official_declaration: 'Official declaration',
  own_signal: 'Own signal',
  narrative: 'Report',
};

export const EVIDENCE_HINTS: Record<ClimateEvent['evidenceKind'], string> = {
  observed_footprint: 'A mapped burned or flooded area from satellite data.',
  official_declaration: 'A government decree or emergency declaration.',
  own_signal: 'Detected by this tool from raw signals (e.g. fire hotspots); not an official footprint.',
  narrative: 'A report or activation without a mapped footprint.',
};

export function sortEvents(events: readonly ClimateEvent[], mode: EventSort): ClimateEvent[] {
  const recent = (a: ClimateEvent, b: ClimateEvent) => b.start.localeCompare(a.start) || a.id.localeCompare(b.id);
  return [...events].sort(mode === 'recent' ? recent : (a, b) => b.affectedExposure - a.affectedExposure || recent(a, b));
}

/** Active on asOf: started and not ended. */
export function eventActive(e: Pick<ClimateEvent, 'start' | 'end'>, asOf: string): boolean {
  return e.start <= asOf && (e.end === null || e.end === undefined || e.end >= asOf);
}

/* ───────────────────────── credit actions ───────────────────────── */

export const ACTION_ORDER: Record<CreditAction, number> = { restructure_review: 0, high: 1, field_visit: 2, watch: 3 };

export interface ActionRow {
  farmId: string;
  farmName: string;
  crop: Crop | null;
  exposure: number;
  ruleId: string;
  action: CreditAction;
  message: string;
  nextInstallment: Installment | null;
}

/** Fired credit actions, most serious first, then by exposure. */
export function actionRows(a: PortfolioAssessment, portfolio: Pick<Portfolio, 'farms'>): ActionRow[] {
  const ranked = new Map(a.ranked.map((r) => [r.farmId, r]));
  return a.creditActions
    .map((c) => {
      const r = ranked.get(c.farmId);
      return {
        farmId: c.farmId,
        farmName: r?.name ?? portfolio.farms.find((f) => f.id === c.farmId)?.name ?? c.farmId,
        crop: r?.crop ?? portfolio.farms.find((f) => f.id === c.farmId)?.crop ?? null,
        exposure: r?.exposure ?? 0,
        ruleId: c.ruleId,
        action: c.action,
        message: c.message,
        nextInstallment: r?.nextInstallment ?? null,
      };
    })
    .sort((x, y) => (ACTION_ORDER[x.action] ?? 9) - (ACTION_ORDER[y.action] ?? 9) || y.exposure - x.exposure || x.farmName.localeCompare(y.farmName));
}

export function actionCounts(rows: readonly ActionRow[]): Partial<Record<CreditAction, number>> {
  const out: Partial<Record<CreditAction, number>> = {};
  for (const r of rows) out[r.action] = (out[r.action] ?? 0) + 1;
  return out;
}

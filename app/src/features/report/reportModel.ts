/**
 * Pure view-model for the portfolio report (no React). Every input number is read from the service's
 * PortfolioAssessment or the portfolio's own loan schedules; the only arithmetic here is the finance-table
 * identities (share of portfolio, weighted risk = share × score, totals) and counting. Unit-tested in node.
 */
import { CROP_META, TIER_ORDER } from '@/domain/constants';
import { addDays, daysBetween } from '@/domain/dates';
import type { ClimateEvent, CreditAction, Crop, Farm, Installment, Loan, Peril, Portfolio, PortfolioAssessment, RankedFarm, Tier, Zone } from '@/domain/types';
import { ACTION_ORDER, type WaterLevel } from '@/features/dashboard/dashboardModel';

/* ───────────────────────── tabs ───────────────────────── */

/** Report tabs, synced to `?tab=`. Header and KPI strip stay above them. */
export const REPORT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'payments', label: 'Payments' },
  { id: 'exposures', label: 'Exposures' },
  { id: 'risks', label: 'Risks' },
  { id: 'demographics', label: 'Demographics' },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]['id'];
export const DEFAULT_REPORT_TAB: ReportTab = 'overview';
export const REPORT_TAB_PREFIX = 'report';

/* ───────────────────────── table rows ───────────────────────── */

export interface ReportRow {
  farmId: string;
  name: string;
  crop: Crop;
  stage: string;
  zoneId: string;
  headline: string;
  /** (b) Outstanding principal on asOf (RankedFarm.exposure). */
  outstanding: number;
  /** (c) outstanding / total outstanding, 0..1; null when the portfolio has no outstanding. */
  share: number | null;
  /** (d) Risk score 0..100. */
  score: number;
  tier: Tier;
  /** (e) = (c) × (d), in score points; null when share is null. Unrounded. */
  weighted: number | null;
  nextInstallment: Installment | null;
  /** Fired credit actions on this farm, most serious first. */
  actions: CreditAction[];
  /** 1-based position in the service ranking (score desc, ties exposure desc). */
  rank: number;
}

export interface ReportTotals {
  farms: number;
  /** Σ (b). */
  outstanding: number;
  /** Σ (c): 1 when there is outstanding, else null. */
  share: number | null;
  /** Σ (e) = Σ(outstanding × score) / Σ outstanding: the exposure-weighted portfolio risk; null without outstanding. */
  weightedRisk: number | null;
  actions: number;
}

/**
 * One row per ranked farm. The share denominator is the sum of the ranked exposures, so the (c) column sums to
 * exactly 100 %; it equals PortfolioAssessment.totalExposure (one ranked entry per farm, CONTRACT §B).
 */
export function reportRows(a: Pick<PortfolioAssessment, 'ranked' | 'creditActions'>): ReportRow[] {
  const total = a.ranked.reduce((s, r) => s + r.exposure, 0);
  const actions = new Map<string, CreditAction[]>();
  for (const c of a.creditActions) actions.set(c.farmId, [...(actions.get(c.farmId) ?? []), c.action]);
  return a.ranked.map((r: RankedFarm, i) => {
    const share = total > 0 ? r.exposure / total : null;
    return {
      farmId: r.farmId,
      name: r.name,
      crop: r.crop,
      stage: r.stage.label,
      zoneId: r.zoneId,
      headline: r.headline,
      outstanding: r.exposure,
      share,
      score: r.score,
      tier: r.tier,
      weighted: share === null ? null : share * r.score,
      nextInstallment: r.nextInstallment,
      actions: [...(actions.get(r.farmId) ?? [])].sort((x, y) => (ACTION_ORDER[x] ?? 9) - (ACTION_ORDER[y] ?? 9)),
      rank: i + 1,
    };
  });
}

export function reportTotals(rows: readonly ReportRow[]): ReportTotals {
  const outstanding = rows.reduce((s, r) => s + r.outstanding, 0);
  const has = outstanding > 0;
  const weightedRisk = has ? rows.reduce((s, r) => s + (r.weighted ?? 0), 0) : null;
  return {
    farms: rows.length,
    outstanding,
    share: has ? 1 : null,
    weightedRisk,
    actions: rows.reduce((s, r) => s + r.actions.length, 0),
  };
}

/* ───────────────────────── sorting ───────────────────────── */

export type SortKey = 'rank' | 'farm' | 'outstanding' | 'share' | 'score' | 'weighted' | 'installment' | 'action';
export type SortDir = 'asc' | 'desc';
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** Default: the service ranking (score desc, ties exposure desc). */
export const DEFAULT_SORT: SortState = { key: 'rank', dir: 'asc' };

/** First click on a column: names and dates ascending, amounts and scores descending. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  rank: 'asc',
  farm: 'asc',
  outstanding: 'desc',
  share: 'desc',
  score: 'desc',
  weighted: 'desc',
  installment: 'asc',
  action: 'asc',
};

export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

const NONE = Number.POSITIVE_INFINITY;

/** Sort value; rows without a value (no installment, no action) always go last. */
function value(r: ReportRow, key: SortKey): number | string {
  switch (key) {
    case 'rank':
      return r.rank;
    case 'farm':
      return r.name.toLocaleLowerCase();
    case 'outstanding':
      return r.outstanding;
    case 'share':
      return r.share ?? -1;
    case 'score':
      return r.score;
    case 'weighted':
      return r.weighted ?? -1;
    case 'installment':
      return r.nextInstallment?.dueDate ?? '';
    case 'action':
      return r.actions.length ? (ACTION_ORDER[r.actions[0]] ?? 9) : NONE;
  }
}

function missing(r: ReportRow, key: SortKey): boolean {
  return (key === 'installment' && !r.nextInstallment) || (key === 'action' && r.actions.length === 0);
}

export function sortRows(rows: readonly ReportRow[], sort: SortState): ReportRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    const mx = missing(x, sort.key);
    const my = missing(y, sort.key);
    if (mx !== my) return mx ? 1 : -1;
    const vx = value(x, sort.key);
    const vy = value(y, sort.key);
    const c = typeof vx === 'string' && typeof vy === 'string' ? vx.localeCompare(vy) : (vx as number) - (vy as number);
    return sign * c || x.rank - y.rank;
  });
}

/* ───────────────────────── incidents (last 24 h) ───────────────────────── */

export interface Incident {
  kind: 'event' | 'credit_rule';
  id: string;
  /** 'YYYY-MM-DD' the incident is dated. */
  date: string;
  title: string;
  detail: string;
  farmIds: string[];
  /** Outstanding touched (event affectedExposure, or the farm's outstanding for a credit rule). */
  exposure: number;
  event?: ClimateEvent;
  action?: CreditAction;
}

/**
 * True when `date` falls within `hours` before the as-of. Contract dates are day-resolution ('YYYY-MM-DD'), so a
 * 24 h window holds the as-of day and the day before (an event dated yesterday may be a few hours old). Dates
 * after the as-of are outside.
 */
export function withinWindow(date: string, asOf: string, hours = 24): boolean {
  const back = daysBetween(date, asOf);
  return back >= 0 && back <= Math.ceil(hours / 24);
}

export interface IncidentOptions {
  /** Window length before the as-of (default 24). */
  hours?: number;
  /**
   * 'affecting' (default): only events with at least one affected farm. PortfolioAssessment.events covers the
   * farms' bbox + 25 km, so on a fire-season day it holds dozens of hotspot detections that touch no farm; counting
   * them would drown the incidents that matter. 'all': every event in the list.
   */
  events?: 'affecting' | 'all';
}

type IncidentInput = Pick<PortfolioAssessment, 'asOf' | 'events' | 'creditActions' | 'ranked'>;

/**
 * Events that started inside the window (by default only those touching a farm), and credit-rule triggers. Credit
 * rules have no date of their own: the service evaluates them on the as-of, so every fired action in this
 * assessment is dated the as-of.
 */
export function incidents(a: IncidentInput, opts: IncidentOptions = {}): Incident[] {
  const hours = opts.hours ?? 24;
  const byId = new Map(a.ranked.map((r) => [r.farmId, r]));
  const events: Incident[] = a.events
    .filter((e) => withinWindow(e.start, a.asOf, hours) && (opts.events === 'all' || e.affectedFarmIds.length > 0))
    .map((e) => ({
      kind: 'event',
      id: e.id,
      date: e.start.slice(0, 10),
      title: e.title,
      detail: e.affectedFarmIds.length
        ? `${e.region} · affects ${e.affectedFarmIds.map((id) => byId.get(id)?.name ?? id).join(', ')}`
        : e.region,
      farmIds: e.affectedFarmIds,
      exposure: e.affectedExposure,
      event: e,
    }));
  const rules: Incident[] = a.creditActions.map((c) => ({
      kind: 'credit_rule',
      id: `${c.farmId}:${c.ruleId}`,
      date: a.asOf,
      title: byId.get(c.farmId)?.name ?? c.farmId,
      detail: c.message,
      farmIds: [c.farmId],
      exposure: byId.get(c.farmId)?.exposure ?? 0,
      action: c.action,
    }));
  return [...events, ...rules].sort((x, y) => y.date.localeCompare(x.date) || y.exposure - x.exposure || x.id.localeCompare(y.id));
}

/** Events inside the window that touch no farm (shown as context next to the incidents count). */
export function nearbyEventCount(a: Pick<PortfolioAssessment, 'asOf' | 'events'>, hours = 24): number {
  return a.events.filter((e) => withinWindow(e.start, a.asOf, hours) && e.affectedFarmIds.length === 0).length;
}

/* ───────────────────────── charts (tier mix, score bins, installments) ───────────────────────── */

export interface TierSlice {
  tier: Tier;
  farms: number;
  exposure: number;
  /** exposure / total, 0..1; null when total is 0. */
  share: number | null;
}

/** Tier mix, most serious first (from exposureByTier / farmsByTier). */
export function tierMix(a: Pick<PortfolioAssessment, 'exposureByTier' | 'farmsByTier'>): TierSlice[] {
  const total = (a.exposureByTier.normal ?? 0) + (a.exposureByTier.watch ?? 0) + (a.exposureByTier.high ?? 0);
  return (['high', 'watch', 'normal'] as Tier[]).map((tier) => {
    const exposure = a.exposureByTier[tier] ?? 0;
    return { tier, farms: a.farmsByTier[tier] ?? 0, exposure, share: total > 0 ? exposure / total : null };
  });
}

export interface ScoreBin {
  /** Inclusive lower bound. */
  from: number;
  /** Exclusive upper bound (the last bin includes 100). */
  to: number;
  farms: number;
  exposure: number;
}

/** Risk-score histogram in fixed bins of `size` points over 0..100. */
export function scoreBins(rows: readonly Pick<ReportRow, 'score' | 'outstanding'>[], size = 10): ScoreBin[] {
  const n = Math.ceil(100 / size);
  const bins: ScoreBin[] = Array.from({ length: n }, (_, i) => ({ from: i * size, to: Math.min(100, (i + 1) * size), farms: 0, exposure: 0 }));
  for (const r of rows) {
    const i = Math.min(n - 1, Math.max(0, Math.floor(r.score / size)));
    bins[i].farms++;
    bins[i].exposure += r.outstanding;
  }
  return bins;
}

export interface InstallmentMonth {
  /** 'YYYY-MM' */
  month: string;
  total: number;
  byTier: Record<Tier, number>;
  count: number;
}

/** A loan's repayment plan; an empty plan behaves like a bullet at maturity (same as outstandingAt, CONTRACT §E.8). */
export const planOf = (loan: Loan): Installment[] => (loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }]);

/**
 * Scheduled installments due after the as-of, by calendar month for `months` months starting with the as-of's
 * month, split by the farm's current tier. Amounts come from the farms' own loan schedules.
 */
export function installmentsByMonth(
  portfolio: Pick<Portfolio, 'farms'>,
  tierOf: (farmId: string) => Tier | undefined,
  asOf: string,
  months = 6,
): InstallmentMonth[] {
  const [y, m] = asOf.slice(0, 7).split('-').map(Number);
  const keys = Array.from({ length: months }, (_, i) => {
    const t = y * 12 + (m - 1) + i;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
  });
  const out = new Map(keys.map((k) => [k, { month: k, total: 0, count: 0, byTier: { normal: 0, watch: 0, high: 0 } as Record<Tier, number> }]));
  for (const f of portfolio.farms) {
    const tier = tierOf(f.id) ?? 'normal';
    for (const inst of f.loan ? planOf(f.loan) : []) {
      if (inst.dueDate <= asOf) continue;
      const bucket = out.get(inst.dueDate.slice(0, 7));
      if (!bucket) continue;
      bucket.total += inst.amount;
      bucket.count++;
      bucket.byTier[tier] += inst.amount;
    }
  }
  return keys.map((k) => out.get(k)!);
}

export interface UpcomingInstallment {
  farmId: string;
  farmName: string;
  crop: Crop;
  dueDate: string;
  amount: number;
  /** Days from the as-of. */
  days: number;
  /** The farm's current tier and score (null when the farm is not in the assessment). */
  tier: Tier | null;
  score: number | null;
}

/**
 * Every installment due in (asOf, asOf + days], soonest first (ties: higher tier, then larger amount), with the
 * farm's current tier. Amounts come from the farms' own loan schedules.
 */
export function upcomingInstallments(
  portfolio: Pick<Portfolio, 'farms'>,
  ranked: readonly Pick<RankedFarm, 'farmId' | 'tier' | 'score'>[],
  asOf: string,
  days = 60,
): UpcomingInstallment[] {
  const until = addDays(asOf, days);
  const byId = new Map(ranked.map((r) => [r.farmId, r]));
  const out: UpcomingInstallment[] = [];
  for (const f of portfolio.farms) {
    if (!f.loan) continue;
    const r = byId.get(f.id);
    for (const i of planOf(f.loan)) {
      if (i.dueDate <= asOf || i.dueDate > until) continue;
      out.push({ farmId: f.id, farmName: f.name, crop: f.crop, dueDate: i.dueDate, amount: i.amount, days: daysBetween(asOf, i.dueDate), tier: r?.tier ?? null, score: r?.score ?? null });
    }
  }
  const t = (x: UpcomingInstallment) => (x.tier ? TIER_ORDER[x.tier] : -1);
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || t(b) - t(a) || b.amount - a.amount || a.farmName.localeCompare(b.farmName));
}

/* ───────────────────────── exposure split by tier ───────────────────────── */

export interface TieredRow {
  key: string;
  label: string;
  /** Identity dot (crop colour); null when the row has no single crop. */
  color: string | null;
  farms: number;
  total: number;
  byTier: Record<Tier, number>;
}

const emptyTiers = (): Record<Tier, number> => ({ normal: 0, watch: 0, high: 0 });

function groupByTier(
  ranked: readonly Pick<RankedFarm, 'farmId' | 'tier' | 'exposure'>[],
  keyOf: (farmId: string) => { key: string; label: string; color: string | null },
): TieredRow[] {
  const out = new Map<string, TieredRow>();
  for (const r of ranked) {
    const k = keyOf(r.farmId);
    const row = out.get(k.key) ?? { ...k, farms: 0, total: 0, byTier: emptyTiers() };
    row.farms++;
    row.total += r.exposure;
    row.byTier[r.tier] += r.exposure;
    out.set(k.key, row);
  }
  return [...out.values()].sort((a, b) => b.total - a.total || b.byTier.high - a.byTier.high || a.label.localeCompare(b.label));
}

/**
 * Outstanding by crop split by the farms' current tier (watch and high apart, so high reads red). Sums the
 * service's per-farm exposures; per-crop totals equal PortfolioAssessment.byCrop.
 */
export function exposureByCrop(a: Pick<PortfolioAssessment, 'ranked'>): TieredRow[] {
  const crop = new Map(a.ranked.map((r) => [r.farmId, r.crop]));
  return groupByTier(a.ranked, (id) => {
    const c = crop.get(id)!;
    return { key: c, label: CROP_META[c]?.label ?? c, color: CROP_META[c]?.color ?? null };
  });
}

/** Label of the row that gathers the farms whose zone is their own auto zone (one farm each). */
export const OWN_ZONES = 'Own zone (one farm each)';

/**
 * Outstanding by effective zone (RankedFarm.zoneId) split by tier. Shared zones are listed by name; the farms
 * that sit alone in their own auto zone are gathered in one row (a row per auto zone would repeat the farm list).
 * Per-zone totals equal PortfolioAssessment.byZone.
 */
export function exposureByZone(a: Pick<PortfolioAssessment, 'ranked'>, zones: readonly Pick<Zone, 'id' | 'name' | 'auto'>[]): TieredRow[] {
  const zoneOf = new Map(a.ranked.map((r) => [r.farmId, r.zoneId]));
  const byId = new Map(zones.map((z) => [z.id, z]));
  return groupByTier(a.ranked, (id) => zoneKey(zoneOf.get(id)!, byId));
}

function zoneKey(zoneId: string, byId: ReadonlyMap<string, Pick<Zone, 'id' | 'name' | 'auto'>>): { key: string; label: string; color: null } {
  const z = byId.get(zoneId);
  if (!z || z.auto || zoneId.startsWith('auto-')) return { key: '__own', label: OWN_ZONES, color: null };
  return { key: z.id, label: z.name || z.id, color: null };
}

/**
 * Chilean region of a farm, read from the CIREN fruit cadastre layer it was picked from (Farm.ciren.sourceLayer):
 * the cadastre publishes one layer per region. Same table as the service's ORCHARD_LAYERS
 * (service/app/sources/ciren/__init__.py). Farms without a cadastre reference have no recorded region.
 */
export const CIREN_LAYER_REGION: Readonly<Record<number, string>> = {
  55: 'Arica y Parinacota',
  56: 'Tarapacá',
  57: 'Atacama',
  58: 'Coquimbo',
  59: 'Valparaíso',
  60: 'Metropolitana',
  61: "O'Higgins",
  62: 'Maule',
  63: 'Ñuble',
  64: 'Biobío',
  65: 'La Araucanía',
  66: 'Los Ríos',
  67: 'Los Lagos',
  68: 'Aysén',
};

export const NO_REGION = 'No cadastre match';

/** Region name from the CIREN layer, or null when the farm has no cadastre reference (or an unknown layer). */
export function farmRegion(farm: Pick<Farm, 'ciren'>): string | null {
  const m = /CATASTRO_FRUTICOLA\/(\d+)/.exec(farm.ciren?.sourceLayer ?? '');
  return m ? (CIREN_LAYER_REGION[Number(m[1])] ?? null) : null;
}

/** Outstanding by region (CIREN cadastre layer) split by tier. Farms without a cadastre match are one row. */
export function exposureByRegion(a: Pick<PortfolioAssessment, 'ranked'>, farms: readonly Pick<Farm, 'id' | 'ciren'>[]): TieredRow[] {
  const region = new Map(farms.map((f) => [f.id, farmRegion(f)]));
  return groupByTier(a.ranked, (id) => {
    const r = region.get(id) ?? null;
    return { key: r ?? '__none', label: r ?? NO_REGION, color: null };
  });
}

/* ───────────────────────── demographics (who and what the book lends to) ───────────────────────── */

export interface CropProfile {
  crop: Crop;
  label: string;
  color: string;
  farms: number;
  /** Σ Farm.areaHa. */
  totalHa: number;
  /** Median Farm.areaHa (mean of the middle two for an even count). */
  medianHa: number;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Farms, total and median hectares per crop, from the portfolio's own farm records. Most farms first. */
export function cropProfile(farms: readonly Pick<Farm, 'crop' | 'areaHa'>[]): CropProfile[] {
  const by = new Map<Crop, number[]>();
  for (const f of farms) by.set(f.crop, [...(by.get(f.crop) ?? []), f.areaHa]);
  return [...by.entries()]
    .map(([crop, ha]) => ({
      crop,
      label: CROP_META[crop]?.label ?? crop,
      color: CROP_META[crop]?.color ?? '#6A766F',
      farms: ha.length,
      totalHa: ha.reduce((s, x) => s + x, 0),
      medianHa: median(ha),
    }))
    .sort((a, b) => b.farms - a.farms || b.totalHa - a.totalHa || a.label.localeCompare(b.label));
}

export interface CountRow {
  key: string;
  label: string;
  farms: number;
  /** Σ Farm.areaHa of these farms. */
  ha: number;
  /** Farm names, for tooltips and lists. */
  names: string[];
}

function countBy<T extends Pick<Farm, 'id' | 'name' | 'areaHa'>>(farms: readonly T[], keyOf: (f: T) => { key: string; label: string }): CountRow[] {
  const out = new Map<string, CountRow>();
  for (const f of farms) {
    const k = keyOf(f);
    const row = out.get(k.key) ?? { ...k, farms: 0, ha: 0, names: [] };
    row.farms++;
    row.ha += f.areaHa;
    row.names.push(f.name);
    out.set(k.key, row);
  }
  return [...out.values()].sort((a, b) => b.farms - a.farms || b.ha - a.ha || a.label.localeCompare(b.label));
}

/** Farms by region (CIREN cadastre layer); farms without a match are one row. */
export function farmsByRegion(farms: readonly Pick<Farm, 'id' | 'name' | 'areaHa' | 'ciren'>[]): CountRow[] {
  return countBy(farms, (f) => {
    const r = farmRegion(f);
    return { key: r ?? '__none', label: r ?? NO_REGION };
  });
}

/** Farms by effective zone (from the assessment when given, else Farm.zoneId); own auto zones are one row. */
export function farmsByZone(
  farms: readonly Pick<Farm, 'id' | 'name' | 'areaHa' | 'zoneId'>[],
  zones: readonly Pick<Zone, 'id' | 'name' | 'auto'>[],
  ranked: readonly Pick<RankedFarm, 'farmId' | 'zoneId'>[] = [],
): CountRow[] {
  const effective = new Map(ranked.map((r) => [r.farmId, r.zoneId]));
  const byId = new Map(zones.map((z) => [z.id, z]));
  return countBy(farms, (f) => {
    const k = zoneKey(effective.get(f.id) ?? f.zoneId, byId);
    return { key: k.key, label: k.label };
  });
}

export interface StageRow {
  label: string;
  farms: number;
  crops: Crop[];
}

/** Current growth stage mix (RankedFarm.stage, from the service's crop calendar). Stages of different crops that share a label are one row. */
export function stageMix(ranked: readonly Pick<RankedFarm, 'crop' | 'stage'>[]): StageRow[] {
  const out = new Map<string, StageRow>();
  for (const r of ranked) {
    const row = out.get(r.stage.label) ?? { label: r.stage.label, farms: 0, crops: [] };
    row.farms++;
    if (!row.crops.includes(r.crop)) row.crops.push(r.crop);
    out.set(r.stage.label, row);
  }
  return [...out.values()].sort((a, b) => b.farms - a.farms || a.label.localeCompare(b.label));
}

export interface RecordCoverage {
  farms: number;
  /** Farms with a CIREN cadastre reference. */
  cadastre: number;
  /** Farms whose lender declared irrigation (yes or no). */
  irrigationDeclared: number;
  /** Farms with a declared cover or net (yes or no). */
  coverDeclared: number;
  plantingYear: number;
}

/** How many farm records carry each optional field (so the page can say what is not recorded instead of guessing). */
export function recordCoverage(farms: readonly Pick<Farm, 'ciren' | 'irrigatedDeclared' | 'covered' | 'plantingYear'>[]): RecordCoverage {
  const has = (v: unknown) => v !== null && v !== undefined;
  return {
    farms: farms.length,
    cadastre: farms.filter((f) => has(f.ciren)).length,
    irrigationDeclared: farms.filter((f) => has(f.irrigatedDeclared)).length,
    coverDeclared: farms.filter((f) => has(f.covered)).length,
    plantingYear: farms.filter((f) => has(f.plantingYear)).length,
  };
}

/* ───────────────────────── per-farm lookups (water status, stress drivers) ───────────────────────── */

/**
 * What the report keeps from one farm's own assessment (POST /assess/farm): the water ladder collapsed to a level
 * and the score's top drivers. Display only: the portfolio score already includes both.
 */
export interface FarmProbe {
  water: WaterLevel;
  drivers: { peril: Peril; impact: number }[];
}

/**
 * Lookup results, tagged with the assessment fingerprint they belong to. A result for another fingerprint is
 * never shown, so a rule change starts from empty without a reset effect. (The v1.1 page cleared its maps in a
 * mount effect; React runs child effects first, so when the farm assessments were already cached, e.g. after
 * going back from a farm page, the rows reported their level and the parent then wiped it: "0 of 12 farms
 * checked" for good.)
 */
export interface ProbeState {
  fp: string;
  /** farmId → result; null = the lookup failed. Presence means the lookup settled. */
  results: ReadonlyMap<string, FarmProbe | null>;
}

export const emptyProbes = (fp = ''): ProbeState => ({ fp, results: new Map() });

/** Records one farm's result for fingerprint `fp` (drops results of any other fingerprint). */
export function recordProbe(state: ProbeState, fp: string, farmId: string, result: FarmProbe | null): ProbeState {
  const base = state.fp === fp ? state : emptyProbes(fp);
  if (base.results.has(farmId) && base.results.get(farmId) === result) return base;
  return { fp, results: new Map(base.results).set(farmId, result) };
}

/** The results that belong to `fp` (empty for another fingerprint). */
export const probesFor = (state: ProbeState, fp: string): ReadonlyMap<string, FarmProbe | null> => (state.fp === fp ? state.results : new Map());

export type WaterLevelCount = Record<WaterLevel, number>;

export interface WaterReport {
  counts: WaterLevelCount;
  /** Lookups that answered (including failed ones). */
  checked: number;
  /** Lookups that failed (counted as unknown). */
  failed: number;
  /** Farm ids per level, for the list under the chart. */
  farms: Record<WaterLevel, string[]>;
}

/** Counts water levels of the farms whose lookup has answered (null = the lookup failed → unknown). */
export function waterReport(results: ReadonlyMap<string, FarmProbe | null>): WaterReport {
  const counts: WaterLevelCount = { ok: 0, watch: 0, stress: 0, unknown: 0 };
  const farms: Record<WaterLevel, string[]> = { ok: [], watch: [], stress: [], unknown: [] };
  let failed = 0;
  for (const [id, r] of results) {
    const level = r?.water ?? 'unknown';
    if (!r) failed++;
    counts[level]++;
    farms[level].push(id);
  }
  return { counts, checked: results.size, failed, farms };
}

/** Backwards-compatible: counts from a farmId → level map (null = failed → unknown). */
export function waterCounts(levels: ReadonlyMap<string, WaterLevel | null>): WaterLevelCount {
  const c: WaterLevelCount = { ok: 0, watch: 0, stress: 0, unknown: 0 };
  for (const l of levels.values()) c[l ?? 'unknown']++;
  return c;
}

export interface DriverRow {
  peril: Peril;
  /** Farms whose score's first driver is this peril. */
  leading: number;
  /** Outstanding of those farms. */
  leadingExposure: number;
  /** Farms with this peril anywhere in their top drivers (impact > 0). */
  present: number;
}

/**
 * Stress drivers across the book: for each peril, the farms where it is the leading driver of the score (and
 * their outstanding), and the farms where it is among the top drivers. Read from each farm's own assessment
 * (Risk.drivers, top 5 by impact, impact > 0); counting only.
 */
export function driverSummary(results: ReadonlyMap<string, FarmProbe | null>, ranked: readonly Pick<RankedFarm, 'farmId' | 'exposure'>[]): DriverRow[] {
  const exposure = new Map(ranked.map((r) => [r.farmId, r.exposure]));
  const out = new Map<Peril, DriverRow>();
  const row = (p: Peril) => out.get(p) ?? { peril: p, leading: 0, leadingExposure: 0, present: 0 };
  for (const [id, r] of results) {
    if (!r) continue;
    const drivers = r.drivers.filter((d) => d.impact > 0);
    const seen = new Set<Peril>();
    drivers.forEach((d, i) => {
      const x = row(d.peril);
      if (i === 0) {
        x.leading++;
        x.leadingExposure += exposure.get(id) ?? 0;
      }
      if (!seen.has(d.peril)) {
        x.present++;
        seen.add(d.peril);
      }
      out.set(d.peril, x);
    });
  }
  return [...out.values()].sort((a, b) => b.leading - a.leading || b.leadingExposure - a.leadingExposure || b.present - a.present || a.peril.localeCompare(b.peril));
}

/** Most serious tier first (for chips and legends). */
export const TIERS_DESC: readonly Tier[] = ['high', 'watch', 'normal'];

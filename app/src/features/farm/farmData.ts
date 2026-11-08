/**
 * Pure helpers for the farm page (no React, no DOM; unit-tested against the contract fixtures).
 *
 * Trust rule: nothing here computes a metric. Scores, z values, severities, water status and the peer reading
 * come from the service (FarmAssessment). This module only shapes them for display: chart windows, stage
 * bands, per-stage rule thresholds (the lender's own effective rules, shown as reference lines), installment
 * markers, ladder rows and plain-language labels.
 */
import type {
  CropTemplate,
  Driver,
  FarmAssessment,
  Installment,
  Loan,
  PeerComparison,
  Portfolio,
  Farm,
  Provenance,
  SeriesPoint,
  StageBand,
  StressLevel,
  WaterStatus,
} from '@/domain/types';
import { addDays, addMonths, daysBetween, parseISODate, toISODate } from '@/domain/dates';
import { effectiveRulesForFarm, findTemplate, resolveFarmLeaf, type RuleLayer } from '@/domain/rules';
import { date, money, number, signed } from '@/shared/format';

/* ───────────────────────── window and stage bands ───────────────────────── */

export interface ChartWindow {
  /** First day shown (start of the 13-month window). */
  start: string;
  /** asOf: series end here. */
  asOf: string;
  /** Right edge of the axis: asOf, or a little past it to show an installment due soon. */
  end: string;
}

/** Days after asOf an upcoming installment still stretches the axis (so a lender sees it coming). */
export const INSTALLMENT_LOOKAHEAD_DAYS = 90;

/**
 * The 13-month window ending asOf (CONTRACT §E.13). Start = first stage band (already clipped to the window),
 * else asOf − 13 months. The axis is extended past asOf only to show an installment due within 90 days.
 */
export function chartWindow(a: Pick<FarmAssessment, 'asOf' | 'stageBands' | 'nextInstallment'>): ChartWindow {
  const fallback = addMonths(a.asOf, -13);
  const first = a.stageBands[0]?.start;
  const start = first && first < a.asOf ? first : fallback;
  let end = a.asOf;
  const next = a.nextInstallment?.dueDate;
  if (next && next > a.asOf && daysBetween(a.asOf, next) <= INSTALLMENT_LOOKAHEAD_DAYS) end = addDays(next, 7);
  return { start, asOf: a.asOf, end };
}

/** Distinct stage keys in band order, for a stable colour per stage. */
export function stageKeys(bands: readonly StageBand[]): string[] {
  const out: string[] = [];
  for (const b of bands) if (!out.includes(b.stage)) out.push(b.stage);
  return out;
}

/** Soft fills for stage bands (flat, no gradients), cycled by stage key order. */
export const STAGE_FILLS = ['#E6F1EB', '#E8EFF7', '#FBF1E1', '#F0EBF7', '#EEF3E6', '#F6E9E7'] as const;
export const STAGE_INKS = ['#1F5A3E', '#2F5C8C', '#8A5A12', '#5B3F86', '#4A6F2E', '#8E3A33'] as const;

export function stageColorIndex(bands: readonly StageBand[], stageKey: string): number {
  const i = stageKeys(bands).indexOf(stageKey);
  return (i < 0 ? 0 : i) % STAGE_FILLS.length;
}

export interface BandLayout {
  band: StageBand;
  /** Left edge and width, 0..1 of [start, end]. */
  left: number;
  width: number;
  colorIndex: number;
  /** true when `at` lies in this band. */
  current: boolean;
}

/** Positions stage bands on a [start, end] date axis (inclusive day ends), clipped. */
export function layoutStageBands(bands: readonly StageBand[], start: string, end: string, at?: string | null): BandLayout[] {
  const t0 = parseISODate(start);
  const t1 = parseISODate(addDays(end, 1));
  const span = Math.max(1, t1 - t0);
  const out: BandLayout[] = [];
  for (const band of bands) {
    const s = Math.max(t0, parseISODate(band.start));
    const e = Math.min(t1, parseISODate(addDays(band.end, 1)));
    if (e <= s) continue;
    out.push({
      band,
      left: (s - t0) / span,
      width: (e - s) / span,
      colorIndex: stageColorIndex(bands, band.stage),
      current: !!at && band.start <= at && at <= band.end,
    });
  }
  return out;
}

/** Fraction 0..1 of a date on [start, end] (clamped). */
export function datePosition(d: string, start: string, end: string): number {
  const t0 = parseISODate(start);
  const t1 = parseISODate(addDays(end, 1));
  return Math.min(1, Math.max(0, (parseISODate(d) - t0) / Math.max(1, t1 - t0)));
}

/** The band containing `d`, or null. */
export function bandAt(bands: readonly StageBand[], d: string): StageBand | null {
  return bands.find((b) => b.start <= d && d <= b.end) ?? null;
}

/* ───────────────────────── rule thresholds per stage ───────────────────────── */

export interface StageThresholdBand {
  start: string;
  end: string;
  stage: string;
  label: string;
  frostCriticalC: number | null;
  heatC: number | null;
  kc: number | null;
}

/**
 * The farm's effective thresholds (§E.2 layering) for every stage band, for reference lines on the charts.
 * Without templates (not loaded yet) the bands carry nulls; the caller falls back to the current drivers' normals.
 */
export function thresholdBands(
  bands: readonly StageBand[],
  portfolio: Portfolio,
  farm: Farm,
  templates: readonly CropTemplate[] | null | undefined,
): StageThresholdBand[] {
  const template = findTemplate(templates, farm.crop);
  const eff = template ? effectiveRulesForFarm(portfolio, template, farm) : null;
  return bands.map((b) => {
    const th = eff?.rules.stages[b.stage];
    return {
      start: b.start,
      end: b.end,
      stage: b.stage,
      label: b.label,
      frostCriticalC: th?.frostCriticalC ?? null,
      heatC: th?.heatC ?? null,
      kc: th?.kc ?? null,
    };
  });
}

/** Which layer set a farm leaf, for the "Custom" marker ('template' = default). */
export function leafLayer(portfolio: Portfolio, templates: readonly CropTemplate[] | null | undefined, farm: Farm, path: string): RuleLayer {
  return resolveFarmLeaf(portfolio, findTemplate(templates, farm.crop), farm, path).layer;
}

export const LAYER_LABELS: Record<RuleLayer, string> = {
  template: 'Crop default',
  crop: 'Custom for this portfolio',
  zone: 'Custom for this zone',
  farm: 'Custom for this farm',
};

/** Frost / heat reference values for the current stage, from the drivers (fallback when templates are missing). */
export function driverNormal(a: Pick<FarmAssessment, 'risk'>, metric: string): number | null {
  const all = [...a.risk.components.climate.drivers, ...a.risk.components.disaster.drivers];
  const d = all.find((x) => x.metric === metric);
  return typeof d?.normal === 'number' ? d.normal : null;
}

/* ───────────────────────── installments ───────────────────────── */

/** The loan's repayment plan (same plan as CONTRACT §E.8: no installments → bullet at maturity), sorted. */
export function repaymentPlan(loan: Loan | null | undefined): Installment[] {
  if (!loan) return [];
  const plan = loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }];
  return [...plan].sort((x, y) => x.dueDate.localeCompare(y.dueDate));
}

export function installmentsIn(plan: readonly Installment[], start: string, end: string): Installment[] {
  return plan.filter((i) => i.dueDate >= start && i.dueDate <= end);
}

/** "Due in 23 days" / "Due today" / "Overdue by 3 days". */
export function dueInLabel(asOf: string, dueDate: string): string {
  const n = daysBetween(asOf, dueDate);
  if (n === 0) return 'Due today';
  if (n < 0) return `Was due ${-n} ${-n === 1 ? 'day' : 'days'} ago`;
  return `Due in ${n} ${n === 1 ? 'day' : 'days'}`;
}

/* ───────────────────────── series shaping ───────────────────────── */

export interface TimeRow {
  t: number;
  date: string;
  value: number | null;
  p50: number | null;
  /** [p10, p90], or null when either end is missing (no baseline). */
  band: [number, number] | null;
  estimated: boolean;
}

export function toTimeRows(points: readonly SeriesPoint[]): TimeRow[] {
  return points.map((p) => ({
    t: parseISODate(p.date),
    date: p.date,
    value: p.value ?? null,
    p50: p.p50 ?? null,
    band: p.p10 !== null && p.p10 !== undefined && p.p90 !== null && p.p90 !== undefined ? [p.p10, p.p90] : null,
    estimated: !!p.estimated,
  }));
}

/** Latest non-null value with its baseline (for card captions). */
export function latestPoint(points: readonly SeriesPoint[]): SeriesPoint | null {
  for (let i = points.length - 1; i >= 0; i--) {
    const v = points[i].value;
    if (v !== null && v !== undefined && Number.isFinite(v)) return points[i];
  }
  return null;
}

export interface MonthRow {
  /** 'YYYY-MM-01' */
  month: string;
  /** Sum of observed daily values; null when the month has no observed day. */
  value: number | null;
  /** Sum of the daily-rate p50 (CONTRACT §E.6: sums of p50 are meaningful). null without a baseline. */
  normal: number | null;
  band: [number, number] | null;
  /** Days with a value / days in the series for that month. */
  daysObserved: number;
  days: number;
  /** The month is cut by the window (first or last month). */
  partial: boolean;
}

/**
 * Monthly rain totals from the daily precip series. The normal is the sum of the daily-rate p50 (and the band
 * the sums of p10/p90), as CONTRACT §E.6 expresses the 30-day baseline as a daily rate.
 */
export function monthlyTotals(points: readonly SeriesPoint[]): MonthRow[] {
  const by = new Map<string, SeriesPoint[]>();
  for (const p of points) {
    const m = `${p.date.slice(0, 7)}-01`;
    if (!by.has(m)) by.set(m, []);
    by.get(m)!.push(p);
  }
  const rows: MonthRow[] = [];
  for (const [month, pts] of by) {
    const vals = pts.filter((p) => p.value !== null && p.value !== undefined);
    const allBase = pts.every((p) => p.p50 !== null && p.p50 !== undefined);
    const allBand = pts.every((p) => p.p10 !== null && p.p10 !== undefined && p.p90 !== null && p.p90 !== undefined);
    const daysInMonth = daysBetween(month, addMonths(month, 1));
    const round1 = (n: number) => Math.round(n * 10) / 10;
    rows.push({
      month,
      value: vals.length ? round1(vals.reduce((s, p) => s + (p.value as number), 0)) : null,
      normal: allBase ? round1(pts.reduce((s, p) => s + (p.p50 as number), 0)) : null,
      band: allBand ? [round1(pts.reduce((s, p) => s + (p.p10 as number), 0)), round1(pts.reduce((s, p) => s + (p.p90 as number), 0))] : null,
      daysObserved: vals.length,
      days: pts.length,
      partial: pts.length < daysInMonth,
    });
  }
  return rows.sort((x, y) => x.month.localeCompare(y.month));
}

/** Month ticks (UTC ms) every `step` months inside [start, end]. */
export function monthTicks(start: string, end: string, step = 2): number[] {
  const out: number[] = [];
  let d = `${start.slice(0, 7)}-01`;
  if (d < start) d = addMonths(d, 1);
  while (d <= end) {
    out.push(parseISODate(d));
    d = addMonths(d, step);
  }
  return out;
}

export const msToISO = (t: number): string => toISODate(t);

/* ───────────────────────── risk ───────────────────────── */

/** Display text for a driver value (values can be numbers, strings, booleans or null). */
export function driverValue(v: Driver['value'], unit: string | null): string {
  if (v === null || v === undefined) return 'Not available';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v;
  const u = unit ?? '';
  if (u === 'z') return `${signed(v, 1)} sd`;
  if (u === '% of normal') return `${number(v, 0)} % of normal`;
  const digits = Number.isInteger(v) ? 0 : 1;
  return u ? `${signed(v, digits)} ${u}` : signed(v, digits);
}

/** Whether the final tier was raised above the score tier by a credit rule (§E.7). */
export function tierRaised(risk: FarmAssessment['risk']): boolean {
  const order = { normal: 0, watch: 1, high: 2 } as const;
  return order[risk.tier] > order[risk.scoreTier];
}

/* ───────────────────────── water ladder ───────────────────────── */

export type RungTone = 'ok' | 'watch' | 'alert' | 'unknown' | 'info';

export interface Rung {
  key: 'irrigated' | 'demand' | 'supply' | 'stress' | 'abandonment';
  step: number;
  question: string;
  tone: RungTone;
  /** Short status ("Yes", "Decree active", "Mild stress", …). */
  status: string;
  /** Value lines (numbers with units). */
  facts: { label: string; value: string }[];
  /** Plain-language explanation from the service, if any. */
  evidence: string | null;
  provenance: Provenance;
}

const STRESS_TONE: Record<StressLevel, RungTone> = { none: 'ok', mild: 'watch', moderate: 'watch', severe: 'alert', unknown: 'unknown' };
const STRESS_STATUS: Record<StressLevel, string> = {
  none: 'No stress',
  mild: 'Mild stress',
  moderate: 'Moderate stress',
  severe: 'Severe stress',
  unknown: 'Unknown',
};

const mm = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${number(n, n < 10 ? 1 : 0)} mm`);
const z = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${signed(n, 1, { plus: true })} sd`);

/** The 5 rungs of the water status ladder (CONTRACT §E.11), in order, with a status tone for each. */
export function waterRungs(w: WaterStatus): Rung[] {
  const irr = w.irrigated.value;
  const sup = w.supply;
  const snow = sup.snowmeltPctOfNormal ?? null;
  const supplyTone: RungTone = sup.decreeActive ? 'alert' : snow !== null && snow < 70 ? 'watch' : snow === null ? 'info' : 'ok';
  const supplyStatus = sup.decreeActive ? 'Scarcity decree active' : snow !== null && snow < 70 ? 'Low snowmelt' : 'No decree';
  const ab = w.abandonment;
  return [
    {
      key: 'irrigated',
      step: 1,
      question: 'Is it irrigated?',
      tone: irr === 'yes' ? 'ok' : irr === 'no' ? 'info' : 'unknown',
      status: irr === 'yes' ? 'Yes' : irr === 'no' ? 'No, rain-fed' : 'Unknown',
      facts: [],
      evidence: w.irrigated.evidence || null,
      provenance: w.irrigated.provenance,
    },
    {
      key: 'demand',
      step: 2,
      question: 'How much water does it need now?',
      tone: w.demand.need7dMm === null ? 'unknown' : 'info',
      status: w.demand.need7dMm === null ? 'Not available' : `${mm(w.demand.need7dMm)} in 7 days`,
      facts: [
        { label: 'Crop coefficient (Kc)', value: number(w.demand.kc, 2) },
        { label: 'Reference ET, last 7 days', value: mm(w.demand.eto7dMm) },
        { label: 'Crop need, last 7 days', value: mm(w.demand.need7dMm) },
        { label: 'Crop need, last 30 days', value: mm(w.demand.need30dMm) },
      ],
      evidence: null,
      provenance: w.demand.provenance,
    },
    {
      key: 'supply',
      step: 3,
      question: 'Can the basin supply it?',
      tone: supplyTone,
      status: supplyStatus,
      facts: [
        { label: 'Scarcity decree', value: sup.decreeActive ? `${sup.decreeId ?? 'Active'}${sup.decreeUntil ? `, until ${date(sup.decreeUntil)}` : ''}` : 'None active' },
        { label: 'Snowmelt forecast', value: snow === null ? 'No forecast for this basin' : `${number(snow, 0)} % of normal` },
        ...(sup.basin ? [{ label: 'Basin', value: sup.basin }] : []),
      ],
      evidence: null,
      provenance: sup.provenance,
    },
    {
      key: 'stress',
      step: 4,
      question: 'Is it getting enough?',
      tone: STRESS_TONE[w.stress.level],
      status: STRESS_STATUS[w.stress.level],
      facts: [
        { label: 'Canopy moisture (NDMI) vs its own normal', value: z(w.stress.ndmiZ) },
        { label: 'Versus zone peers', value: z(w.stress.ndmiPeerDelta) },
        {
          label: 'Canopy minus air temperature',
          value: w.stress.canopyMinusAirC === null || w.stress.canopyMinusAirC === undefined ? 'No clear Landsat pass' : `${signed(w.stress.canopyMinusAirC, 1, { plus: true })} °C`,
        },
      ],
      evidence: null,
      provenance: w.stress.provenance,
    },
    {
      key: 'abandonment',
      step: 5,
      question: 'Has irrigation stopped?',
      tone: ab.flag ? 'alert' : 'ok',
      status: ab.flag ? `Possible abandonment (${ab.confidence} confidence)` : `No sign (${ab.confidence} confidence)`,
      facts: [],
      evidence: ab.evidence || null,
      provenance: ab.provenance,
    },
  ];
}

/* ───────────────────────── peers ───────────────────────── */

export const PEER_READING: Record<PeerComparison['reading'], { title: string; text: string; tone: RungTone }> = {
  zone_wide: {
    title: 'The whole zone is below normal',
    text: 'Peers in the zone are down too, so this reads as weather rather than management.',
    tone: 'watch',
  },
  farm_specific: {
    title: 'Only this farm is below its peers',
    text: 'Same-crop orchards nearby look normal: check management or water supply on this farm.',
    tone: 'alert',
  },
  normal: {
    title: 'In line with its peers',
    text: 'This farm and the same-crop orchards in its zone are within their usual range.',
    tone: 'ok',
  },
  insufficient_peers: {
    title: 'Not enough peers to compare',
    text: 'Fewer than 3 same-crop CIREN orchards lie in the zone circle.',
    tone: 'unknown',
  },
};

/** Position 0..1 of a z value on the peer scale [−3, +2]. */
export const Z_MIN = -3;
export const Z_MAX = 2;
export function zPosition(v: number): number {
  return Math.min(1, Math.max(0, (v - Z_MIN) / (Z_MAX - Z_MIN)));
}

/* ───────────────────────── misc ───────────────────────── */

export function exposureLine(a: Pick<FarmAssessment, 'exposure' | 'nextInstallment' | 'asOf'>, currency: Portfolio['currency']): string {
  const next = a.nextInstallment;
  return next
    ? `${money(a.exposure, currency)} outstanding; next ${money(next.amount, currency)} on ${date(next.dueDate)}`
    : `${money(a.exposure, currency)} outstanding; no upcoming installment`;
}

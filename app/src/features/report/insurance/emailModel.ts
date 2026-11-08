/**
 * The insurance request dialog reads as an email draft from the lender to Suyana (ADR-0025, v1.2 layout). This module
 * turns the payload and the farm's assessment into that email: the subject line, two or three plain sentences, one
 * small supporting figure, and the "attachments" (the parts of the payload that is actually queued). Pure; no React.
 *
 * Trust rule: nothing here computes a risk metric. Wording comes from the farm Overview's verdict (features/farm/
 * overviewModel.ts, read-only), numbers from the payload or the assessment, and a figure is shown only when its data
 * exists (no padding, no invented history).
 */
import type { Driver, FarmAssessment, InsurancePeril, InsuranceRequestPayload, Installment, Peril, SeriesPoint, Tier } from '@/domain/types';
import { buildVerdict, type Verdict } from '@/features/farm/overviewModel';
import { PERIL_LABELS, date, hectares, money, number } from '@/shared/format';
import { INSURANCE_PERIL_LABELS } from './insuranceModel';

/* ───────────────────────── envelope ───────────────────────── */

/** Where the farm is, for the subject: "Coquimbo region" from the CIREN layer, else the country name. */
export function placeName(region: string | null | undefined, countryName: string): string {
  return region ? `${region} region` : countryName;
}

export function perilList(perils: readonly InsurancePeril[]): string {
  return perils.map((p) => INSURANCE_PERIL_LABELS[p]).join(', ');
}

/** "Cover request: Ovalle table grapes, 5.8 ha, Coquimbo region · Drought / water supply". */
export function subjectLine(p: Pick<InsuranceRequestPayload, 'farm' | 'perils'>, place: string): string {
  const head = `Cover request: ${p.farm.name}, ${hectares(p.farm.areaHa)}, ${place}`;
  return p.perils.length > 0 ? `${head} · ${perilList(p.perils)}` : head;
}

/* ───────────────────────── body ───────────────────────── */

const TIER_PHRASE: Record<Tier, string> = {
  high: 'rated high stress',
  watch: 'on watch',
  normal: 'rated normal',
};

/** The farm's plain-language verdict, exactly as the farm Overview words it; null without an assessment. */
export function farmVerdict(a: FarmAssessment | null | undefined, crop: InsuranceRequestPayload['farm']['crop']): Verdict | null {
  return a ? buildVerdict(a, crop) : null;
}

export interface EmailBody {
  /** Farm and risk in one sentence, then the Overview verdict (may be null while the assessment loads). */
  farm: string;
  verdict: string | null;
  loan: string;
  cover: string;
}

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function loanSentence(loan: InsuranceRequestPayload['loan'], asOf: string, next: Installment | null | undefined): string {
  if (!loan) return 'The farm has no loan with us.';
  const parts = [`${money(loan.outstanding, loan.currency)} is outstanding on ${date(asOf)}`];
  if (next) parts.push(`the next payment of ${money(next.amount, loan.currency)} is due ${date(next.dueDate)}`);
  parts.push(`it matures ${date(loan.maturityDate)}`);
  return `Our loan is ${money(loan.amount, loan.currency)}: ${listJoin(parts)}.`;
}

export function coverSentence(perils: readonly InsurancePeril[], uncovered: readonly Peril[]): string {
  const ask =
    perils.length > 0
      ? `We ask for a quote on parametric cover for ${listJoin(perils.map((p) => lowerFirst(INSURANCE_PERIL_LABELS[p])))}.`
      : 'Choose the perils to ask cover for.';
  if (uncovered.length === 0) return ask;
  const names = listJoin(uncovered.map((p) => lowerFirst(PERIL_LABELS[p] ?? p)));
  return `${ask} ${names.charAt(0).toUpperCase()}${names.slice(1)} also ${uncovered.length > 1 ? 'drive' : 'drives'} the risk here; none of the parametric perils addresses ${uncovered.length > 1 ? 'them' : 'it'}.`;
}

export function emailBody(p: InsuranceRequestPayload, place: string, opts: { verdict: Verdict | null; next: Installment | null | undefined }): EmailBody {
  const farm = `${p.farm.name} (${hectares(p.farm.areaHa)}, ${place}) is ${TIER_PHRASE[p.risk.tier]}, ${number(p.risk.score, 0)} of 100, as of ${date(p.risk.asOf)}.`;
  return {
    farm,
    verdict: opts.verdict?.text ?? null,
    loan: loanSentence(p.loan, p.risk.asOf, opts.next),
    cover: coverSentence(p.perils, p.uncoveredPerils),
  };
}

/* ───────────────────────── figure ───────────────────────── */

/** A band series needs at least this many observed values to be worth a figure; a daily series this many days. */
export const MIN_BAND_POINTS = 12;
export const MIN_DAILY_POINTS = 30;

export type FigureSpec =
  | {
      kind: 'band';
      variable: 'ndvi' | 'ndmi';
      points: SeriesPoint[];
      /** Short y label, e.g. 'NDVI'. */
      valueLabel: string;
      digits: number;
      caption: string;
      legend: string;
    }
  | {
      kind: 'daily';
      variable: 'tmin' | 'tmax' | 'precip';
      points: SeriesPoint[];
      unit: string;
      /** Damage or stress level from the driver, or null. */
      threshold: number | null;
      thresholdLabel: string | null;
      caption: string;
      legend: string;
    }
  | { kind: 'snowmelt'; pct: number; caption: string; legend: string }
  | {
      kind: 'components';
      parts: {
        key: 'climate' | 'disaster' | 'geography';
        letter: 'C' | 'D' | 'G';
        label: string;
        value: number;
      }[];
      caption: string;
      legend: string;
    };

export type FigureInput = Pick<FarmAssessment, 'asOf' | 'series' | 'water'> & {
  risk: Pick<FarmAssessment['risk'], 'drivers' | 'components'>;
};

/** "Sentinel-2 L2A, 10 m" from a provenance (the label before any parenthesis, then the resolution). */
export function sourceShort(prov: { sourceLabel: string; resolution: string } | undefined | null): string | null {
  if (!prov) return null;
  const label = prov.sourceLabel.split(' (')[0].trim();
  const res = prov.resolution && prov.resolution !== 'n/a' ? `, ${prov.resolution}` : '';
  return label ? `${label}${res}` : null;
}

/** "Oct 2025 – Nov 2026" over the points that carry a value. */
export function monthRange(points: readonly SeriesPoint[]): string {
  const v = points.filter((p) => p.value !== null && p.value !== undefined);
  if (v.length === 0) return '';
  const a = date(v[0].date, 'month');
  const b = date(v[v.length - 1].date, 'month');
  return a === b ? a : `${a} – ${b}`;
}

const valued = (pts: readonly SeriesPoint[] | undefined) => (pts ?? []).filter((p) => p.value !== null && p.value !== undefined);

/** The driver the figure supports: the farm's leading driver (largest impact > 0). */
export function leadingDriver(drivers: readonly Pick<Driver, 'peril' | 'metric' | 'impact' | 'component' | 'normal'>[]) {
  return [...drivers].filter((d) => d.impact > 0).sort((x, y) => y.impact - x.impact)[0] ?? null;
}

function bandFigure(a: FigureInput, variable: 'ndvi' | 'ndmi'): FigureSpec | null {
  const s = a.series[variable];
  if (!s) return null;
  const pts = s.points;
  if (valued(pts).length < MIN_BAND_POINTS) return null;
  const what = variable === 'ndvi' ? 'Canopy greenness (NDVI)' : 'Canopy moisture (NDMI)';
  const src = sourceShort(s.provenance);
  return {
    kind: 'band',
    variable,
    points: pts,
    valueLabel: variable.toUpperCase(),
    digits: 2,
    caption: `Fig. 1 · ${what} vs its usual range, ${monthRange(pts)}.${src ? ` ${src}.` : ''}`,
    legend: pts.some((p) => p.estimated)
      ? 'Line: this farm (dashed where gap-filled). Band: its usual range for the date. Grey line: its usual value.'
      : 'Line: this farm. Band: its usual range for the date. Grey line: its usual value.',
  };
}

function dailyFigure(a: FigureInput, d: Pick<Driver, 'peril' | 'normal' | 'component'>): FigureSpec | null {
  const variable = d.peril === 'frost' ? 'tmin' : d.peril === 'heat' ? 'tmax' : 'precip';
  const s = a.series[variable];
  if (!s || valued(s.points).length < MIN_DAILY_POINTS) return null;
  const pts = s.points;
  const threshold = variable !== 'precip' && typeof d.normal === 'number' && Number.isFinite(d.normal) ? d.normal : null;
  const what = variable === 'tmin' ? 'Daily low temperature' : variable === 'tmax' ? 'Daily high temperature' : 'Daily rain';
  const level = variable === 'tmin' ? 'frost damage level' : 'heat stress level';
  const src = sourceShort(s.provenance);
  return {
    kind: 'daily',
    variable,
    points: pts,
    unit: s.unit === 'index' ? '' : s.unit,
    threshold,
    thresholdLabel: threshold !== null ? `${level} ${number(threshold, 1)} ${s.unit}` : null,
    caption: `Fig. 1 · ${what}${threshold !== null ? ` vs the ${level}` : ''}, ${monthRange(pts)}.${src ? ` ${src}.` : ''}`,
    legend: threshold !== null ? `Line: this farm. Dashed: the ${level}.` : 'Bars: daily rain at the farm.',
  };
}

function componentsFigure(a: FigureInput): FigureSpec {
  const c = a.risk.components;
  return {
    kind: 'components',
    parts: [
      {
        key: 'climate',
        letter: 'C',
        label: 'Climate and water',
        value: c.climate.value,
      },
      {
        key: 'disaster',
        letter: 'D',
        label: 'Disasters',
        value: c.disaster.value,
      },
      {
        key: 'geography',
        letter: 'G',
        label: 'Geography',
        value: c.geography.value,
      },
    ],
    caption: `Fig. 1 · The three parts of the risk score on ${date(a.asOf)}, each from 0 (none) to 1 (severe). BrotIA risk model.`,
    legend: 'C: weather and water now. D: fires, floods and declared emergencies. G: the site and its history.',
  };
}

/**
 * The one figure that supports the request, chosen by the farm's leading driver:
 * - abandonment or vigour → NDVI over 13 months with its usual band;
 * - water or a declared (water-scarcity) emergency → NDMI with its band, or the snowmelt forecast vs normal;
 * - frost / heat → daily low / high with the damage or stress level; harvest rain → daily rain;
 * - anything else, or a series too short to draw → the C, D, G risk components.
 * Returns null only when the assessment is missing.
 */
export function pickFigure(a: FigureInput | null | undefined): FigureSpec | null {
  if (!a) return null;
  const lead = leadingDriver(a.risk.drivers);
  let fig: FigureSpec | null = null;
  switch (lead?.peril) {
    case 'abandonment':
    case 'vigour':
      fig = bandFigure(a, 'ndvi');
      break;
    case 'water':
    case 'declared_emergency': {
      fig = bandFigure(a, 'ndmi');
      const pct = a.water.supply.snowmeltPctOfNormal;
      if (!fig && pct != null && Number.isFinite(pct)) {
        const basin = a.water.supply.basin;
        fig = {
          kind: 'snowmelt',
          pct,
          caption: `Fig. 1 · Snowmelt forecast vs normal${basin ? ` for the ${basin} basin` : ''}, as of ${date(a.water.supply.provenance.observedAt ?? a.asOf)}. ${a.water.supply.provenance.sourceLabel}.`,
          legend: 'Bar: this season’s forecast. Line: the normal (100 %).',
        };
      }
      break;
    }
    case 'frost':
    case 'heat':
    case 'harvest_rain':
      if (lead.component === 'climate') fig = dailyFigure(a, lead);
      break;
    default:
      break;
  }
  return fig ?? componentsFigure(a);
}

/* ───────────────────────── attachments ───────────────────────── */

export interface Attachment {
  name: string;
  /** What it holds, in a few words. */
  holds: string;
  data: unknown;
}

/**
 * The parts of the payload that is queued, as named "files". Only what the payload carries: the farm block
 * (centroid and area, no outline: ADR-0025 sends no polygon), the loan, the risk block, and the whole request.
 */
export function attachments(p: InsuranceRequestPayload): Attachment[] {
  const out: Attachment[] = [{ name: 'farm.json', holds: 'crop, area, centroid, zone', data: p.farm }];
  if (p.loan)
    out.push({
      name: 'loan.json',
      holds: 'amount, outstanding, maturity',
      data: p.loan,
    });
  out.push({
    name: 'risk-assessment.json',
    holds: `score, tier, ${p.risk.drivers.length} driver${p.risk.drivers.length === 1 ? '' : 's'}`,
    data: p.risk,
  });
  out.push({
    name: 'request.json',
    holds: 'the whole request, as queued',
    data: p,
  });
  return out;
}

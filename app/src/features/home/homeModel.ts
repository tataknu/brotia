/**
 * Pure view-model for Home, the financial dashboard across every portfolio in the store (no React).
 *
 * Trust rules:
 * - Outstanding and risk come from the service's PortfolioAssessment (or the offline snapshot). When a
 *   portfolio has no assessment (loading, offline, unavailable), its outstanding comes from the local loan
 *   schedule (outstandingAt, CONTRACT §E.8, the same formula the service uses) and its risk is null.
 * - No history is invented: there is no stored risk history, so every risk number is "as of" its assessment.
 * - No FX in v1: amounts in different currencies are never added. Callers group by currency first.
 */
import { CROP_META, TIER_ORDER } from '@/domain/constants';
import { addDays, daysBetween } from '@/domain/dates';
import { outstandingAt } from '@/domain/schedule';
import type { Crop, Currency, Installment, Loan, Portfolio, PortfolioAssessment, Tier } from '@/domain/types';
import { incidents, nearbyEventCount, type Incident } from '@/features/report/reportModel';

/* ───────────────────────── colours (spec v1.1) ───────────────────────── */

import { RISK_RAMP, TIER_COLORS } from '@/shared/chartColors';

/** The logo's soil row, low → high risk (shared palette). */
export { RISK_RAMP };
/** Tier colours from the spec: normal, watch, high. */
export const TIER_FILL: Record<Tier, string> = { normal: TIER_COLORS.normal.fg, watch: TIER_COLORS.watch.fg, high: TIER_COLORS.high.fg };
/** Fill for outstanding without a risk score (no assessment yet). */
export const NO_SCORE_FILL = '#C9D3CD';

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** Continuous 0–100 score → colour across the risk ramp (linear between stops). null → NO_SCORE_FILL. */
export function rampColor(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return NO_SCORE_FILL;
  const t = (Math.min(100, Math.max(0, score)) / 100) * (RISK_RAMP.length - 1);
  const i = Math.min(RISK_RAMP.length - 2, Math.floor(t));
  const f = t - i;
  const a = hex(RISK_RAMP[i]);
  const b = hex(RISK_RAMP[i + 1]);
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

/* ───────────────────────── inputs ───────────────────────── */

/** One portfolio and its assessment, when there is one for this portfolio. */
export interface PortfolioEntry {
  portfolio: Portfolio;
  assessment: PortfolioAssessment | null;
}

/** One farm's slice of the book. */
export interface FarmRow {
  portfolioId: string;
  portfolioName: string;
  country: string;
  currency: Currency;
  farmId: string;
  farmName: string;
  crop: Crop;
  /** Outstanding principal: the service's exposure, or outstandingAt(loan, asOf) when not assessed. */
  outstanding: number;
  /** 0..100, null when the farm has no assessment. */
  score: number | null;
  tier: Tier | null;
  /** Where `outstanding` came from. */
  from: 'assessment' | 'schedule';
}

/** The assessment only counts when it is for this portfolio. */
export const assessmentOf = (e: PortfolioEntry): PortfolioAssessment | null =>
  e.assessment && e.assessment.portfolioId === e.portfolio.id ? e.assessment : null;

/** Farm rows of a portfolio. `fallbackAsOf` dates the local schedule when there is no assessment. */
export function farmRows(e: PortfolioEntry, fallbackAsOf: string): FarmRow[] {
  const a = assessmentOf(e);
  const ranked = new Map((a?.ranked ?? []).map((r) => [r.farmId, r]));
  const asOf = a?.asOf ?? fallbackAsOf;
  return e.portfolio.farms.map((f) => {
    const r = ranked.get(f.id);
    return {
      portfolioId: e.portfolio.id,
      portfolioName: e.portfolio.name || 'Untitled portfolio',
      country: e.portfolio.country,
      currency: e.portfolio.currency,
      farmId: f.id,
      farmName: f.name,
      crop: f.crop,
      outstanding: r ? r.exposure : f.loan ? outstandingAt(f.loan, asOf) : 0,
      score: r ? r.score : null,
      tier: r ? r.tier : null,
      from: r ? 'assessment' : 'schedule',
    };
  });
}

/* ───────────────────────── risk aggregates ───────────────────────── */

export interface WeightedRisk {
  /** Σ(outstanding × score) / Σ outstanding over farms with a score; null when that outstanding is 0. */
  score: number | null;
  /** Share of outstanding that has a score (0..1); null when there is no outstanding at all. */
  coverage: number | null;
}

/** Exposure-weighted risk score. Farms without a score are left out and reported through `coverage`. */
export function weightedRisk(rows: readonly Pick<FarmRow, 'outstanding' | 'score'>[]): WeightedRisk {
  let num = 0;
  let scored = 0;
  let total = 0;
  for (const r of rows) {
    total += r.outstanding;
    if (r.score === null) continue;
    num += r.outstanding * r.score;
    scored += r.outstanding;
  }
  return { score: scored > 0 ? num / scored : null, coverage: total > 0 ? scored / total : null };
}

export type TierMix = Record<Tier | 'unscored', number>;

/** Outstanding by tier (plus outstanding without a score). */
export function tierMix(rows: readonly Pick<FarmRow, 'outstanding' | 'tier'>[]): TierMix {
  const out: TierMix = { normal: 0, watch: 0, high: 0, unscored: 0 };
  for (const r of rows) out[r.tier ?? 'unscored'] += r.outstanding;
  return out;
}

/* ───────────────────────── allocation ───────────────────────── */

export type AllocationDim = 'portfolio' | 'country' | 'crop';

export interface Slice {
  key: string;
  label: string;
  farms: number;
  outstanding: number;
  /** outstanding / total of the rows passed in (0..1); 0 when the total is 0. */
  share: number;
  /** Exposure-weighted score of the slice. */
  risk: WeightedRisk;
  mix: TierMix;
}

const DIM_KEY: Record<AllocationDim, (r: FarmRow) => string> = {
  portfolio: (r) => r.portfolioId,
  country: (r) => r.country,
  crop: (r) => r.crop,
};

/**
 * Outstanding split by portfolio, country or crop, largest first. All rows must share one currency.
 * `label` names a key (portfolio name, country name); crops default to their English label.
 */
export function allocation(rows: readonly FarmRow[], dim: AllocationDim, label?: (key: string) => string): Slice[] {
  const groups = new Map<string, FarmRow[]>();
  for (const r of rows) {
    const k = DIM_KEY[dim](r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  const name = (k: string, g: FarmRow[]) =>
    label?.(k) ?? (dim === 'crop' ? (CROP_META[k as Crop]?.label ?? k) : dim === 'portfolio' ? g[0].portfolioName : k);
  return [...groups.entries()]
    .map(([k, g]) => {
      const outstanding = g.reduce((s, r) => s + r.outstanding, 0);
      return { key: k, label: name(k, g), farms: g.length, outstanding, share: total > 0 ? outstanding / total : 0, risk: weightedRisk(g), mix: tierMix(g) };
    })
    .sort((a, b) => b.outstanding - a.outstanding || a.label.localeCompare(b.label));
}

/* ───────────────────────── currencies ───────────────────────── */

/** Currencies present, the one with the most portfolios first (ties: USD first, then alphabetical). */
export function currenciesOf(portfolios: readonly Pick<Portfolio, 'currency'>[]): Currency[] {
  const n = new Map<Currency, number>();
  for (const p of portfolios) n.set(p.currency, (n.get(p.currency) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || (a[0] === 'USD' ? -1 : b[0] === 'USD' ? 1 : a[0].localeCompare(b[0]))).map(([c]) => c);
}

/* ───────────────────────── incidents (last 24 h) ───────────────────────── */

/** One incident with the portfolio it belongs to. */
export type HomeIncident = Incident & { portfolioId: string };

export interface Incidents {
  /** Every portfolio's incidents (events touching a farm + credit-rule triggers), newest first. */
  items: HomeIncident[];
  /** Of those, events. */
  events: number;
  /** Of those, credit-rule triggers. */
  triggers: number;
  total: number;
  /** Events in the window that touch no farm (context only, not counted). */
  nearby: number;
}

/**
 * Incidents in the last 24 h, summed across portfolios. The definition is the portfolio report's
 * (features/report/reportModel: incidents, nearbyEventCount), so Home and each report show the same numbers:
 * events touching at least one farm that started on the as-of day or the day before, plus every fired credit rule.
 */
export function incidentsLast24h(assessments: readonly PortfolioAssessment[]): Incidents {
  const items: HomeIncident[] = assessments.flatMap((a) => incidents(a).map((i) => ({ ...i, portfolioId: a.portfolioId })));
  items.sort((x, y) => y.date.localeCompare(x.date) || y.exposure - x.exposure || x.id.localeCompare(y.id));
  const events = items.filter((i) => i.kind === 'event').length;
  return {
    items,
    events,
    triggers: items.length - events,
    total: items.length,
    nearby: assessments.reduce((s, a) => s + nearbyEventCount(a), 0),
  };
}

/* ───────────────────────── KPIs ───────────────────────── */

export interface HomeKpis {
  outstanding: number;
  /** Outstanding at watch or high. */
  stressed: number;
  /** stressed / scored outstanding; null when nothing is scored. */
  stressedShare: number | null;
  portfolios: number;
  farms: number;
  creditActions: number;
  /** Farms with at least one credit action. */
  farmsWithActions: number;
  incidents: Incidents;
  /** Portfolios whose numbers come from an assessment. */
  assessed: number;
}

/** KPIs over entries of ONE currency. */
export function homeKpis(entries: readonly PortfolioEntry[], fallbackAsOf: string): HomeKpis {
  const rows = entries.flatMap((e) => farmRows(e, fallbackAsOf));
  const mix = tierMix(rows);
  const scored = mix.normal + mix.watch + mix.high;
  const assessments = entries.map(assessmentOf).filter((a): a is PortfolioAssessment => !!a);
  const actionFarms = new Set(assessments.flatMap((a) => a.creditActions.map((c) => `${a.portfolioId}/${c.farmId}`)));
  return {
    outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
    stressed: mix.watch + mix.high,
    stressedShare: scored > 0 ? (mix.watch + mix.high) / scored : null,
    portfolios: entries.length,
    farms: rows.length,
    creditActions: assessments.reduce((s, a) => s + a.creditActions.length, 0),
    farmsWithActions: actionFarms.size,
    incidents: incidentsLast24h(assessments),
    assessed: assessments.length,
  };
}

/* ───────────────────────── repayment schedule ───────────────────────── */

/** Same plan as outstandingAt / nextInstallment: an empty plan is a bullet at maturity. */
const planOf = (loan: Loan): Installment[] => (loan.installments.length ? loan.installments : [{ dueDate: loan.maturityDate, amount: loan.amount }]);

const monthEnd = (iso: string): string => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const nextMonthEnd = (iso: string): string => {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
};

export interface CurvePoint {
  /** 'YYYY-MM-DD': the as-of for the first point, then month ends. */
  date: string;
  /** Σ outstandingAt(loan, date): the scheduled outstanding (installments up to `date` treated as paid). */
  outstanding: number;
  /** Σ installments due in (previous point, date]. 0 for the first point. */
  due: number;
}

/**
 * Scheduled outstanding and repayments from the local loan schedules, from `asOf` to the last due date.
 * Forward-looking only: past points would read as a payment history, which does not exist.
 * Loans originated after asOf enter the curve at their origination date (disbursement).
 */
export function repaymentCurve(portfolios: readonly Pick<Portfolio, 'farms'>[], asOf: string): CurvePoint[] {
  const loans = portfolios.flatMap((p) => p.farms.map((f) => f.loan).filter((l): l is Loan => !!l));
  if (loans.length === 0) return [];
  const last = loans.reduce((m, l) => {
    // The plan's last due date (an empty plan is a bullet at maturity); outstanding is 0 after it.
    const end = planOf(l).reduce((x, i) => (i.dueDate > x ? i.dueDate : x), '');
    return end > m ? end : m;
  }, asOf);
  const outstanding = (d: string) => Math.round(loans.reduce((s, l) => s + outstandingAt(l, d), 0) * 100) / 100;
  const dueIn = (from: string, to: string) =>
    Math.round(loans.reduce((s, l) => s + planOf(l).filter((i) => i.dueDate > from && i.dueDate <= to).reduce((x, i) => x + i.amount, 0), 0) * 100) / 100;
  const points: CurvePoint[] = [{ date: asOf, outstanding: outstanding(asOf), due: 0 }];
  let prev = asOf;
  for (let end = monthEnd(asOf), i = 0; i < 600; end = nextMonthEnd(end), i++) {
    if (end > asOf) {
      points.push({ date: end, outstanding: outstanding(end), due: dueIn(prev, end) });
      prev = end;
    }
    if (end >= last) break;
  }
  return points;
}

/* ───────────────────────── payment schedule by tier ───────────────────────── */

/** A tier, or 'unscored' while the farm has no assessment (pending, offline, failed). */
export type TierKey = Tier | 'unscored';
export const TIER_KEYS: readonly TierKey[] = ['high', 'watch', 'normal', 'unscored'];

/** One installment of one farm, with the farm's current tier. */
export interface DuePayment {
  portfolioId: string;
  portfolioName: string;
  farmId: string;
  farmName: string;
  dueDate: string;
  amount: number;
  tier: Tier | null;
}

export interface ScheduleMonth {
  /** 'YYYY-MM'. */
  month: string;
  /** Window (from, to]: the first month starts after the as-of, later ones at the previous month end. */
  from: string;
  to: string;
  byTier: Record<TierKey, number>;
  total: number;
  /** Installments due in the month. */
  count: number;
  /** Every installment of the month, largest first. */
  payments: DuePayment[];
}

export interface PaymentSchedule {
  months: ScheduleMonth[];
  total: number;
  byTier: Record<TierKey, number>;
  count: number;
  /** Loans left out because their currency is not the group's (amounts are never converted). */
  otherCurrencyLoans: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const zeroTiers = (): Record<TierKey, number> => ({ normal: 0, watch: 0, high: 0, unscored: 0 });

/** Installments due in (from, to] of the loans in `currency`, with each farm's current tier. */
export function duePayments(entries: readonly PortfolioEntry[], from: string, to: string, currency: Currency): { payments: DuePayment[]; otherCurrencyLoans: number } {
  const payments: DuePayment[] = [];
  let otherCurrencyLoans = 0;
  for (const e of entries) {
    const ranked = new Map((assessmentOf(e)?.ranked ?? []).map((r) => [r.farmId, r]));
    for (const f of e.portfolio.farms) {
      if (!f.loan) continue;
      if ((f.loan.currency ?? e.portfolio.currency) !== currency) {
        otherCurrencyLoans++;
        continue;
      }
      for (const i of planOf(f.loan)) {
        if (i.dueDate <= from || i.dueDate > to) continue;
        payments.push({
          portfolioId: e.portfolio.id,
          portfolioName: e.portfolio.name || 'Untitled portfolio',
          farmId: f.id,
          farmName: f.name,
          dueDate: i.dueDate,
          amount: i.amount,
          tier: ranked.get(f.id)?.tier ?? null,
        });
      }
    }
  }
  payments.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.amount - a.amount || a.farmName.localeCompare(b.farmName));
  return { payments, otherCurrencyLoans };
}

/**
 * Scheduled installments per calendar month for `months` months from the as-of month, split by the farm's
 * CURRENT tier (there is no tier history: a payment due in March is coloured by today's tier). The first month
 * holds only what falls after the as-of. Payments already due are left out: they would read as a payment record.
 * Same plan rule as outstandingAt: an empty plan is one payment at maturity.
 */
export function paymentSchedule(entries: readonly PortfolioEntry[], asOf: string, months: number, currency: Currency): PaymentSchedule {
  const ends: string[] = [];
  for (let end = monthEnd(asOf); ends.length < months; end = nextMonthEnd(end)) ends.push(end);
  const last = ends[ends.length - 1] ?? asOf;
  const { payments, otherCurrencyLoans } = duePayments(entries, asOf, last, currency);
  let prev = asOf;
  const out: ScheduleMonth[] = ends.map((to) => {
    const from = prev;
    prev = to;
    const inMonth = payments.filter((p) => p.dueDate > from && p.dueDate <= to).sort((a, b) => b.amount - a.amount || a.farmName.localeCompare(b.farmName));
    const byTier = zeroTiers();
    for (const p of inMonth) byTier[p.tier ?? 'unscored'] += p.amount;
    for (const k of TIER_KEYS) byTier[k] = r2(byTier[k]);
    return { month: to.slice(0, 7), from, to, byTier, total: r2(inMonth.reduce((s, p) => s + p.amount, 0)), count: inMonth.length, payments: inMonth };
  });
  const byTier = zeroTiers();
  for (const m of out) for (const k of TIER_KEYS) byTier[k] = r2(byTier[k] + m.byTier[k]);
  return { months: out, total: r2(out.reduce((s, m) => s + m.total, 0)), byTier, count: payments.length, otherCurrencyLoans };
}

export interface DueSummary {
  amount: number;
  count: number;
  farms: number;
  /** Amount due from farms at watch or high. */
  stressed: number;
  /** Amount due from farms without a tier yet. */
  unscored: number;
  /** stressed / amount with a known tier; null when no due amount has a tier. */
  stressedShare: number | null;
}

/** What falls due in (asOf, asOf + days], and how much of it comes from farms at watch or high. */
export function dueWithin(entries: readonly PortfolioEntry[], asOf: string, days: number, currency: Currency): DueSummary {
  const { payments } = duePayments(entries, asOf, addDays(asOf, days), currency);
  const amount = r2(payments.reduce((s, p) => s + p.amount, 0));
  const stressed = r2(payments.filter((p) => p.tier === 'watch' || p.tier === 'high').reduce((s, p) => s + p.amount, 0));
  const unscored = r2(payments.filter((p) => !p.tier).reduce((s, p) => s + p.amount, 0));
  const scored = amount - unscored;
  return {
    amount,
    count: payments.length,
    farms: new Set(payments.map((p) => `${p.portfolioId}/${p.farmId}`)).size,
    stressed,
    unscored,
    stressedShare: scored > 0 ? stressed / scored : null,
  };
}

/* ───────────────────────── risk per portfolio ───────────────────────── */

export interface StressedFarm {
  farmId: string;
  farmName: string;
  tier: Tier;
  score: number;
  outstanding: number;
}

/** Farms at watch or high in one portfolio, largest outstanding first. */
export function stressedFarms(e: PortfolioEntry, fallbackAsOf: string, limit = 3): StressedFarm[] {
  return farmRows(e, fallbackAsOf)
    .filter((r): r is FarmRow & { tier: Tier; score: number } => (r.tier === 'watch' || r.tier === 'high') && r.score !== null)
    .sort((a, b) => b.outstanding - a.outstanding || b.score - a.score)
    .slice(0, limit)
    .map((r) => ({ farmId: r.farmId, farmName: r.farmName, tier: r.tier, score: r.score, outstanding: r.outstanding }));
}

/* ───────────────────────── upcoming installments ───────────────────────── */

export interface UpcomingInstallment {
  portfolioId: string;
  portfolioName: string;
  farmId: string;
  farmName: string;
  crop: Crop;
  dueDate: string;
  amount: number;
  currency: Currency;
  /** Days from asOf. */
  days: number;
  tier: Tier | null;
  score: number | null;
}

/** Every installment due in (asOf, asOf + days], soonest first, with the farm's current tier. */
export function upcomingInstallments(entries: readonly PortfolioEntry[], asOf: string, days = 60): UpcomingInstallment[] {
  const until = addDays(asOf, days);
  const out: UpcomingInstallment[] = [];
  for (const e of entries) {
    const ranked = new Map((assessmentOf(e)?.ranked ?? []).map((r) => [r.farmId, r]));
    for (const f of e.portfolio.farms) {
      if (!f.loan) continue;
      for (const i of planOf(f.loan)) {
        if (i.dueDate <= asOf || i.dueDate > until) continue;
        const r = ranked.get(f.id);
        out.push({
          portfolioId: e.portfolio.id,
          portfolioName: e.portfolio.name || 'Untitled portfolio',
          farmId: f.id,
          farmName: f.name,
          crop: f.crop,
          dueDate: i.dueDate,
          amount: i.amount,
          currency: f.loan.currency ?? e.portfolio.currency,
          days: daysBetween(asOf, i.dueDate),
          tier: r?.tier ?? null,
          score: r?.score ?? null,
        });
      }
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (b.tier ? TIER_ORDER[b.tier] : -1) - (a.tier ? TIER_ORDER[a.tier] : -1) || b.amount - a.amount);
}

/* ───────────────────────── portfolio table ───────────────────────── */

export interface PortfolioRow {
  id: string;
  name: string;
  /** Portfolio.code (v1.1), shown in mono before the name. */
  code?: string | null;
  country: string;
  currency: Currency;
  farms: number;
  outstanding: number;
  /** outstanding / total of the currency group. */
  share: number;
  risk: WeightedRisk;
  mix: TierMix;
  /** null when there is no assessment. */
  creditActions: number | null;
  asOf: string | null;
}

/** One row per portfolio (entries of ONE currency), largest outstanding first. */
export function portfolioRows(entries: readonly PortfolioEntry[], fallbackAsOf: string): PortfolioRow[] {
  const rows = entries.map((e) => {
    const fr = farmRows(e, fallbackAsOf);
    const a = assessmentOf(e);
    return {
      id: e.portfolio.id,
      name: e.portfolio.name || 'Untitled portfolio',
      code: e.portfolio.code ?? null,
      country: e.portfolio.country,
      currency: e.portfolio.currency,
      farms: fr.length,
      outstanding: fr.reduce((s, r) => s + r.outstanding, 0),
      share: 0,
      risk: weightedRisk(fr),
      mix: tierMix(fr),
      creditActions: a ? a.creditActions.length : null,
      asOf: a?.asOf ?? null,
    };
  });
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  for (const r of rows) r.share = total > 0 ? r.outstanding / total : 0;
  return rows.sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
}

/** Distinct as-of dates of the assessments, newest first. */
export function asOfDates(entries: readonly PortfolioEntry[]): string[] {
  return [...new Set(entries.map((e) => assessmentOf(e)?.asOf).filter((d): d is string => !!d))].sort().reverse();
}

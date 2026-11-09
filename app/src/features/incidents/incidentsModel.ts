/**
 * Pure view-model for the Incidents page and the sidebar badge (no React). The incident definition is the report's
 * (features/report/reportModel: incidents, nearbyEventCount; ADR-0024 D7), so the page, the report KPI and Home
 * show the same numbers:
 * - events that touch a farm and started inside the window before the assessment as-of;
 * - every credit rule that fired (rules have no date of their own; the service evaluates them on the as-of).
 * The 7- and 30-day windows are the same definition with a longer `hours`: withinWindow() keeps the as-of day and
 * the ceil(hours / 24) days before it, because contract dates are day-resolution.
 */
import type { CreditAction, Currency, Portfolio, PortfolioAssessment } from '@/domain/types';
import { incidents, nearbyEventCount, type Incident } from '@/features/report/reportModel';
import { splitActionMessage } from '@/features/farm/overviewModel';
import { paths } from '@/shell/paths';

/* ───────────────────────── windows and filters ───────────────────────── */

export const WINDOWS = [
  { id: '24h', label: '24 h', long: 'the last 24 h', hours: 24 },
  { id: '7d', label: '7 days', long: 'the last 7 days', hours: 24 * 7 },
  { id: '30d', label: '30 days', long: 'the last 30 days', hours: 24 * 30 },
] as const;

export type IncidentWindow = (typeof WINDOWS)[number]['id'];
export const DEFAULT_WINDOW: IncidentWindow = '24h';

export const windowHours = (w: IncidentWindow): number => WINDOWS.find((x) => x.id === w)!.hours;
export const windowLong = (w: IncidentWindow): string => WINDOWS.find((x) => x.id === w)!.long;

export type KindFilter = 'all' | Incident['kind'];
export const KIND_OPTIONS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All kinds' },
  { id: 'credit_rule', label: 'Credit rules' },
  { id: 'event', label: 'Events' },
];

export interface IncidentFilters {
  window: IncidentWindow;
  /** Portfolio id, or 'all'. */
  portfolio: string;
  kind: KindFilter;
}

export const DEFAULT_FILTERS: IncidentFilters = { window: DEFAULT_WINDOW, portfolio: 'all', kind: 'all' };

/** Filters from the URL (`?window=7d&portfolio=…&kind=event`); unknown values fall back to the defaults. */
export function parseFilters(params: URLSearchParams, portfolioIds: readonly string[]): IncidentFilters {
  const w = params.get('window');
  const p = params.get('portfolio');
  const k = params.get('kind');
  return {
    window: WINDOWS.some((x) => x.id === w) ? (w as IncidentWindow) : DEFAULT_WINDOW,
    portfolio: p && portfolioIds.includes(p) ? p : 'all',
    kind: KIND_OPTIONS.some((x) => x.id === k) ? (k as KindFilter) : 'all',
  };
}

/** The URL form of the filters: defaults are left out, so the plain `/incidents` is the default view. */
export function filtersToParams(f: IncidentFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.window !== DEFAULT_WINDOW) out.set('window', f.window);
  if (f.portfolio !== 'all') out.set('portfolio', f.portfolio);
  if (f.kind !== 'all') out.set('kind', f.kind);
  return out;
}

/* ───────────────────────── severity ───────────────────────── */

export type IncidentSeverity = 'critical' | 'warning' | 'event';

export const SEVERITY_GROUPS: { id: IncidentSeverity; label: string; hint: string }[] = [
  { id: 'critical', label: 'Critical', hint: 'Credit rules that ask for a restructuring review or a high-risk loan' },
  { id: 'warning', label: 'Warning', hint: 'Credit rules that ask for a field visit or a closer watch' },
  { id: 'event', label: 'Events', hint: 'Climate events that touch a farm' },
];

const CRITICAL: ReadonlySet<CreditAction> = new Set(['restructure_review', 'high']);
const ACTION_RANK: Record<CreditAction, number> = { restructure_review: 0, high: 1, field_visit: 2, watch: 3 };
const GROUP_RANK: Record<IncidentSeverity, number> = { critical: 0, warning: 1, event: 2 };

/** A fired restructure review or high is critical; a field visit or watch is a warning; events come after. */
export function severityOf(i: Pick<Incident, 'kind' | 'action'>): IncidentSeverity {
  if (i.kind === 'event') return 'event';
  return i.action && CRITICAL.has(i.action) ? 'critical' : 'warning';
}

/* ───────────────────────── rows ───────────────────────── */

export interface IncidentFarm {
  id: string;
  name: string;
}

export interface IncidentRow {
  /** Unique across portfolios: `${portfolioId}/${kind}/${id}` (the same event can touch two portfolios). */
  key: string;
  incident: Incident;
  severity: IncidentSeverity;
  portfolioId: string;
  portfolioName: string;
  /** Portfolio.code (v1.1), shown in mono before the name. */
  portfolioCode?: string | null;
  /** Exposure is in this currency; amounts are never added across portfolios. */
  currency: Currency;
  /** The assessment as-of the window is counted back from. */
  asOf: string;
  /** What happened, in plain words. */
  headline: string;
  /** One quieter line: the rule's next step, or the event's detail and region. */
  detail: string;
  farms: IncidentFarm[];
}

export interface PortfolioEntry {
  portfolio: Pick<Portfolio, 'id' | 'name' | 'code' | 'currency' | 'farms'>;
  /** null while loading, offline without a snapshot, or failed. */
  assessment: Pick<PortfolioAssessment, 'portfolioId' | 'asOf' | 'events' | 'creditActions' | 'ranked'> | null;
}

/**
 * 'Active fire detected near Romeral (3 VIIRS detections, max FRP 7.6 MW)' →
 * { headline: 'Active fire detected near Romeral', note: '3 VIIRS detections, max FRP 7.6 MW' }.
 * The sensor detail moves to the quieter line.
 */
export function plainEventTitle(title: string): { headline: string; note: string | null } {
  const m = title.trim().match(/^(.*\S)\s*\(([^()]*)\)$/);
  if (!m || !m[1]) return { headline: title.trim(), note: null };
  return { headline: m[1], note: m[2].trim() || null };
}

const capital = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function describe(i: Incident): { headline: string; detail: string } {
  if (i.kind === 'credit_rule' && i.action) {
    const { title, reason } = splitActionMessage({ ruleId: i.id, action: i.action, message: i.detail });
    return { headline: capital(reason), detail: title };
  }
  const { headline, note } = plainEventTitle(i.title);
  const region = i.event?.region ?? '';
  return { headline, detail: [note, region].filter(Boolean).join(' · ') };
}

/** Incidents of one portfolio's assessment in a window, as page rows. */
export function portfolioRows(e: PortfolioEntry, window: IncidentWindow): IncidentRow[] {
  const a = e.assessment;
  if (!a) return [];
  const names = new Map<string, string>(e.portfolio.farms.map((f) => [f.id, f.name]));
  for (const r of a.ranked) names.set(r.farmId, r.name);
  const portfolioName = e.portfolio.name || 'Untitled portfolio';
  return incidents(a, { hours: windowHours(window) }).map((i) => ({
    key: `${e.portfolio.id}/${i.kind}/${i.id}`,
    incident: i,
    severity: severityOf(i),
    portfolioId: e.portfolio.id,
    portfolioName,
    portfolioCode: e.portfolio.code ?? null,
    currency: e.portfolio.currency,
    asOf: a.asOf,
    ...describe(i),
    farms: i.farmIds.map((id) => ({ id, name: names.get(id) ?? id })),
  }));
}

/**
 * Order inside a group: the most serious action first, then newest, then the largest exposure (within one currency
 * only it is comparable, but it is a stable tiebreak), then portfolio and id.
 */
export function compareRows(x: IncidentRow, y: IncidentRow): number {
  const ax = x.incident.action ? ACTION_RANK[x.incident.action] : 9;
  const ay = y.incident.action ? ACTION_RANK[y.incident.action] : 9;
  return (
    GROUP_RANK[x.severity] - GROUP_RANK[y.severity] ||
    ax - ay ||
    y.incident.date.localeCompare(x.incident.date) ||
    y.incident.exposure - x.incident.exposure ||
    x.portfolioName.localeCompare(y.portfolioName) ||
    x.key.localeCompare(y.key)
  );
}

/** Every assessed portfolio's incidents in the window, sorted. Unassessed portfolios add nothing. */
export function allRows(entries: readonly PortfolioEntry[], window: IncidentWindow): IncidentRow[] {
  return entries.flatMap((e) => portfolioRows(e, window)).sort(compareRows);
}

export function applyFilters(rows: readonly IncidentRow[], f: Pick<IncidentFilters, 'portfolio' | 'kind'>): IncidentRow[] {
  return rows.filter((r) => (f.portfolio === 'all' || r.portfolioId === f.portfolio) && (f.kind === 'all' || r.incident.kind === f.kind));
}

export interface SeverityGroup {
  id: IncidentSeverity;
  label: string;
  hint: string;
  rows: IncidentRow[];
}

/** Non-empty groups in the order critical, warning, events; rows keep their order. */
export function groupBySeverity(rows: readonly IncidentRow[]): SeverityGroup[] {
  return SEVERITY_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.severity === g.id) })).filter((g) => g.rows.length > 0);
}

/**
 * Events in the window that touch no farm (context, not counted), over the selected portfolios. They are events, so
 * the count is 0 when only credit rules are shown.
 */
export function nearbyCount(entries: readonly PortfolioEntry[], f: IncidentFilters): number {
  if (f.kind === 'credit_rule') return 0;
  return entries
    .filter((e) => e.assessment && (f.portfolio === 'all' || e.portfolio.id === f.portfolio))
    .reduce((s, e) => s + nearbyEventCount(e.assessment!, windowHours(f.window)), 0);
}

/* ───────────────────────── sidebar badge ───────────────────────── */

export interface BadgeSummary {
  /** Incidents in the last 24 h across every assessed portfolio. */
  count: number;
  /** 'danger' when any of them is critical, 'warn' otherwise; null when there are none. */
  tone: 'danger' | 'warn' | null;
}

export function badgeSummary(entries: readonly PortfolioEntry[]): BadgeSummary {
  const rows = allRows(entries, DEFAULT_WINDOW);
  if (!rows.length) return { count: 0, tone: null };
  return { count: rows.length, tone: rows.some((r) => r.severity === 'critical') ? 'danger' : 'warn' };
}

/** Farm link for a row: events open the farm's Events tab, credit rules its Overview. */
export function farmHref(r: Pick<IncidentRow, 'portfolioId' | 'incident'>, farmId: string): string {
  const base = paths.farm(r.portfolioId, farmId);
  return r.incident.kind === 'event' ? `${base}?tab=events` : base;
}

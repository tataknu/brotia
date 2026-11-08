/**
 * Incidents (/incidents): one list across every portfolio in the store, grouped by severity.
 * The definition is the report's "Incidents (last 24 h)" (ADR-0024 D7; features/report/reportModel incidents()),
 * widened by the window filter (24 h, 7 days, 30 days). Assessments come from the shared cache (useAssessments, as
 * on Home); a portfolio that is loading, offline without a snapshot or failed adds no incidents and is listed in a
 * notice. Pure logic: ./incidentsModel.ts.
 */
import clsx from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, CircleCheck, CloudOff, Info, Loader2, Plus, RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useCrops } from '@/data/hooks';
import type { ClimateEvent, Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { Badge, EmptyState, Popover, PortfolioName, ProvenanceBadge, buttonClass, portfolioLabel, type BadgeTone } from '@/shared/ui';
import { CREDIT_ACTION_LABELS, PERIL_LABELS, date, money, number } from '@/shared/format';
import { useAssessments, type ProbeState } from '@/features/home/useAssessments';
import {
  KIND_OPTIONS,
  WINDOWS,
  allRows,
  applyFilters,
  farmHref,
  filtersToParams,
  groupBySeverity,
  nearbyCount,
  parseFilters,
  windowLong,
  type IncidentFilters,
  type IncidentRow,
  type IncidentSeverity,
  type PortfolioEntry,
} from './incidentsModel';

export function IncidentsPage() {
  const portfolios = useStore((s) => s.portfolios);
  const { states, probes } = useAssessments(portfolios);

  if (portfolios.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Header />
        <EmptyState
          className="mt-8"
          title="No portfolios yet"
          description="Create a portfolio or load the Chilean sample to follow its credit-rule triggers and climate events here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link to="/portfolios/new" className={buttonClass('primary', 'sm')}>
                <Plus size={16} /> New portfolio
              </Link>
              <Link to="/portfolios" className={buttonClass('secondary', 'sm')}>
                Portfolios
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {probes}
      <Incidents portfolios={portfolios} states={states} />
    </div>
  );
}

function Header({ right }: { right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Monitoring</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Incidents</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Credit rules that fired and climate events that touched a farm, across all your portfolios.</p>
      </div>
      {right}
    </div>
  );
}

function Incidents({ portfolios, states }: { portfolios: Portfolio[]; states: Record<string, ProbeState> }) {
  const [params, setParams] = useSearchParams();
  const ids = useMemo(() => portfolios.map((p) => p.id), [portfolios]);
  const filters = parseFilters(params, ids);
  const setFilters = (patch: Partial<IncidentFilters>) => setParams(filtersToParams({ ...filters, ...patch }), { replace: true });

  const entries: PortfolioEntry[] = portfolios.map((p) => ({ portfolio: p, assessment: states[p.id]?.assessment ?? null }));
  const rows = allRows(entries, filters.window);
  const shown = applyFilters(rows, filters);
  const groups = groupBySeverity(shown);
  const nearby = nearbyCount(entries, filters);
  const ruleNames = useRuleNames(portfolios);

  const scope = filters.portfolio === 'all' ? portfolios : portfolios.filter((p) => p.id === filters.portfolio);
  const scopeStates = scope.map((p) => states[p.id]);
  const assessed = scopeStates.filter((s) => s?.assessment).length;
  const loading = scopeStates.filter((s) => s?.status === 'loading').length;
  const snapshot = scopeStates.find((s) => s?.source === 'snapshot');
  const asOfs = [...new Set(scopeStates.map((s) => s?.assessment?.asOf).filter((d): d is string => !!d))].sort();
  const asOfLabel = asOfs.length > 1 ? `As of ${date(asOfs[0], 'short')}–${date(asOfs[asOfs.length - 1])}` : asOfs.length ? `As of ${date(asOfs[0])}` : null;
  const long = windowLong(filters.window);
  const counts = { critical: 0, warning: 0, event: 0 } as Record<IncidentSeverity, number>;
  for (const r of shown) counts[r.severity]++;

  return (
    <>
      <Header
        right={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted sm:justify-end">
            {loading > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={14} className="animate-spin" /> Assessing {loading} of {scope.length}
              </span>
            )}
            {asOfLabel && <span className="font-mono tabular-nums">{asOfLabel}</span>}
            {snapshot && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn-ink">
                <CloudOff size={12} /> Offline snapshot of {date(snapshot.snapshotDate)}
              </span>
            )}
          </div>
        }
      />

      <StatusNotices portfolios={scope} states={states} />

      {/* Filters */}
      <section aria-label="Filters" className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <Segmented label="Window" value={filters.window} options={WINDOWS.map((w) => ({ id: w.id, label: w.label }))} onChange={(window) => setFilters({ window })} />
        <Segmented label="Kind" value={filters.kind} options={KIND_OPTIONS} onChange={(kind) => setFilters({ kind })} />
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          Portfolio
          <select
            value={filters.portfolio}
            onChange={(e) => setFilters({ portfolio: e.target.value })}
            className="h-8 max-w-[16rem] rounded-card border border-line bg-white px-2 text-sm text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <option value="all">All portfolios ({portfolios.length})</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {portfolioLabel(p)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <p className="mt-3 max-w-4xl text-xs text-muted">
        {filters.window === '24h'
          ? "Events touching a farm that started on the assessment as-of day or the day before, and credit rules that fired at the as-of. Dates have no time of day, so 24 h holds yesterday too."
          : `The same rule over a longer window: events touching a farm that started on the as-of day or in the ${filters.window === '7d' ? '7' : '30'} days before, and credit rules that fired at the as-of.`}
      </p>

      {/* Counts */}
      {assessed > 0 && (
        <section aria-label="Incident counts" className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line sm:max-w-xl">
          <Count label="Critical" value={counts.critical} tone="danger" />
          <Count label="Warning" value={counts.warning} tone="warn" />
          <Count label="Events" value={counts.event} tone="info" />
        </section>
      )}

      <section aria-label={`Incidents in ${long}`} className="mt-4" data-testid="incidents-list">
        {assessed === 0 ? (
          loading > 0 ? (
            <div className="flex items-center gap-2 rounded-card border border-line px-5 py-8 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Assessing {scope.length === 1 ? 'the portfolio' : 'your portfolios'}…
            </div>
          ) : (
            <EmptyState icon={<CloudOff size={18} />} title="No assessment to read" description="Incidents come from each portfolio's assessment, and none could be read. See the notice above." />
          )
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<CircleCheck size={20} className="text-accent" />}
            title={`No incidents in ${long}`}
            description={
              filters.kind !== 'all' || filters.portfolio !== 'all'
                ? 'Nothing matches these filters. Widen the window or clear the filters to see more.'
                : 'No credit rule fired and no climate event touched a farm.'
            }
          />
        ) : (
          <IncidentTable groups={groups} ruleNames={ruleNames} states={states} />
        )}
        {assessed > 0 && nearby > 0 && (
          <p className="mt-3 text-xs text-muted" data-testid="incidents-nearby">
            <span className="font-mono tabular-nums">{number(nearby)}</span> nearby {nearby === 1 ? 'event' : 'events'} in the same window touched no farm and {nearby === 1 ? 'is' : 'are'} not counted. Each report lists them under Recent disasters in its Risks tab.
          </p>
        )}
      </section>
    </>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

function Segmented<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: readonly { id: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted">
      <span id={`seg-${label}`}>{label}</span>
      <div role="radiogroup" aria-labelledby={`seg-${label}`} className="inline-flex rounded-card border border-line p-0.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={o.id === value}
            onClick={() => onChange(o.id)}
            className={clsx(
              'rounded-[6px] px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              o.id === value ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const DOT = { danger: 'bg-danger', warn: 'bg-warn', info: 'bg-[#2F5C8C]' } as const;

function Count({ label, value, tone }: { label: string; value: number; tone: keyof typeof DOT }) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span aria-hidden className={clsx('h-2 w-2 shrink-0 rounded-[2px]', value > 0 ? DOT[tone] : 'bg-line')} />
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

const SEVERITY_TONE: Record<ClimateEvent['severity'], BadgeTone> = { extreme: 'danger', severe: 'warn', moderate: 'neutral' };

function SeverityChip({ r }: { r: IncidentRow }) {
  const i = r.incident;
  if (i.kind === 'credit_rule' && i.action) {
    return (
      <Badge tone={r.severity === 'critical' ? 'danger' : 'warn'} dot>
        {CREDIT_ACTION_LABELS[i.action]}
      </Badge>
    );
  }
  const e = i.event;
  return (
    <Badge tone={e ? SEVERITY_TONE[e.severity] : 'neutral'} dot>
      {e ? `${PERIL_LABELS[e.kind] ?? 'Event'} · ${e.severity}` : 'Event'}
    </Badge>
  );
}

const GROUP_DOT: Record<IncidentSeverity, string> = { critical: 'bg-danger', warning: 'bg-warn', event: 'bg-[#2F5C8C]' };

function IncidentTable({ groups, ruleNames, states }: { groups: ReturnType<typeof groupBySeverity>; ruleNames: ReadonlyMap<string, string>; states: Record<string, ProbeState> }) {
  const th = 'px-3 py-2 text-xs font-medium text-muted whitespace-nowrap text-left';
  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <caption className="sr-only">Incidents grouped by severity</caption>
          <thead className="bg-surface">
            <tr>
              <th scope="col" className={`${th} pl-5`}>Severity</th>
              <th scope="col" className={th}>What happened</th>
              <th scope="col" className={th}>Farm</th>
              <th scope="col" className={th}>Portfolio</th>
              <th scope="col" className={`${th} text-right`}>Exposure</th>
              <th scope="col" className={th}>Date</th>
              <th scope="col" className={`${th} pr-5`}>Source</th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.id} aria-label={g.label}>
              <tr className="border-t border-line">
                <th scope="colgroup" colSpan={7} className="bg-white px-5 pb-1.5 pt-3 text-left">
                  <span className="flex items-baseline gap-2">
                    <span aria-hidden className={clsx('h-2 w-2 shrink-0 self-center rounded-[2px]', GROUP_DOT[g.id])} />
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink">{g.label}</span>
                    <span className="font-mono text-xs tabular-nums text-muted">{g.rows.length}</span>
                    <span className="hidden text-xs font-normal text-muted sm:inline">· {g.hint}</span>
                  </span>
                </th>
              </tr>
              {g.rows.map((r, n) => (
                <tr key={r.key} className={clsx('border-t border-line/70 align-top', n % 2 ? 'bg-surface/60' : '')} data-testid="incident-row" data-severity={r.severity}>
                  <td className="whitespace-nowrap py-2.5 pl-5 pr-3">
                    <SeverityChip r={r} />
                  </td>
                  <td className="max-w-[26rem] px-3 py-2.5">
                    <p className="font-medium text-ink">{r.headline}</p>
                    {r.detail && (
                      <p className="mt-0.5 text-xs text-muted">
                        {r.incident.kind === 'credit_rule' && <ArrowRight size={11} className="mr-1 inline align-[-1px]" aria-label="Next step:" />}
                        {r.detail}
                      </p>
                    )}
                  </td>
                  <td className="max-w-[14rem] px-3 py-2.5">
                    {r.farms.length ? (
                      <ul className="space-y-0.5">
                        {r.farms.map((f) => (
                          <li key={f.id}>
                            <Link to={farmHref(r, f.id)} className="inline-flex max-w-full items-center gap-1 text-brand hover:underline focus:outline-none focus-visible:underline" title={r.incident.kind === 'event' ? 'Open the farm’s Events tab' : 'Open the farm overview'}>
                              <span className="truncate">{f.name}</span>
                              <ArrowRight size={12} className="shrink-0" aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted">–</span>
                    )}
                  </td>
                  <td className="max-w-[12rem] px-3 py-2.5">
                    <Link to={`/portfolios/${r.portfolioId}`} className="block truncate text-ink hover:text-brand focus:outline-none focus-visible:underline">
                      <PortfolioName name={r.portfolioName} code={r.portfolioCode} />
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-ink">{r.incident.exposure > 0 ? money(r.incident.exposure, r.currency) : '–'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span className="font-mono tabular-nums text-ink">{date(r.incident.date, 'short')}</span>
                    <span className="block text-xs text-muted">{r.incident.kind === 'credit_rule' ? 'checked at as-of' : r.incident.date === r.asOf ? 'as-of day' : 'started'}</span>
                  </td>
                  <td className="py-2.5 pl-3 pr-5">
                    {r.incident.kind === 'event' ? (
                      <ProvenanceBadge provenance={r.incident.event?.provenance} title={`Source: ${r.incident.event?.source ?? 'event'}`} />
                    ) : (
                      <RuleSource r={r} name={ruleNames.get(r.incident.id.split(':').slice(1).join(':')) ?? null} state={states[r.portfolioId]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

/**
 * Source of a credit-rule incident. Fired rules carry no Provenance of their own (FiredCreditAction is rule id,
 * action and message), so this panel says what is known: the rule, who set it, and when and from where the
 * service evaluated it. Nothing is invented.
 */
function RuleSource({ r, name, state }: { r: IncidentRow; name: string | null; state: ProbeState | undefined }) {
  const ruleId = r.incident.id.split(':').slice(1).join(':');
  const offline = state?.source === 'snapshot';
  return (
    <Popover
      label={`Source: credit rule ${name ?? ruleId}`}
      trigger={
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-white px-2 py-0.5 text-xs text-muted hover:bg-surface hover:text-ink">
          <ShieldAlert size={14} className="shrink-0" />
          <span className="truncate">Credit rule</span>
        </span>
      }
    >
      <div className="space-y-3">
        <p className="font-semibold text-ink">Where this incident comes from</p>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1.5">
          <dt className="text-muted">Rule</dt>
          <dd className="min-w-0 break-words text-ink">{name ?? ruleId}</dd>
          <dt className="text-muted">Action</dt>
          <dd className="text-ink">{r.incident.action ? CREDIT_ACTION_LABELS[r.incident.action] : '–'}</dd>
          <dt className="text-muted">Evaluated</dt>
          <dd className="text-ink">By the service, on the assessment as-of {date(r.asOf)}</dd>
          <dt className="text-muted">Data</dt>
          <dd className="text-ink">{offline ? `Offline snapshot of ${date(state?.snapshotDate)}` : 'Live service'}</dd>
        </dl>
        <p className="rounded-card bg-surface px-3 py-2 text-muted">{r.incident.detail}</p>
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Info size={12} className="mt-0.5 shrink-0" /> A credit rule has no date of its own; it is dated the as-of it was checked on.
        </p>
        <p className="font-mono text-xs text-muted">{ruleId}</p>
      </div>
    </Popover>
  );
}

/** Rule id → name, from the portfolios' own rules and the crop templates (templates need the live service). */
function useRuleNames(portfolios: readonly Portfolio[]): ReadonlyMap<string, string> {
  const { data: crops } = useCrops();
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const t of crops ?? []) for (const r of t.creditRules) m.set(r.id, r.name);
    for (const p of portfolios) for (const r of p.creditRules) m.set(r.id, r.name);
    return m;
  }, [crops, portfolios]);
}

/** Portfolios that are not assessed: why, and that they add no incidents. */
function StatusNotices({ portfolios, states }: { portfolios: Portfolio[]; states: Record<string, ProbeState> }) {
  const problems = portfolios.filter((p) => ['unavailable', 'error'].includes(states[p.id]?.status));
  if (!problems.length) return null;
  return (
    <div className="mt-4 rounded-card border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-ink">
      <div className="flex items-start gap-2">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0">
          <p>
            {problems.length === 1
              ? 'Incidents are missing for 1 portfolio: its assessment could not be read.'
              : `Incidents are missing for ${problems.length} portfolios: their assessments could not be read.`}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {problems.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-2">
                <span className="font-medium text-ink"><PortfolioName name={p.name} code={p.code} /></span>
                <span>{states[p.id].reason ?? 'Assessment failed'}</span>
                {states[p.id].refetch && (
                  <button type="button" onClick={() => states[p.id].refetch?.()} className="inline-flex items-center gap-1 rounded text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                    <RefreshCw size={12} /> Retry
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

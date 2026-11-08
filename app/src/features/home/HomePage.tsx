/**
 * Home: portfolio overview for a lender. First what falls due and from how risky a farm (the payment schedule,
 * stacked by each farm's current tier), then the risk of each portfolio, then allocation and the portfolio table.
 *
 * The payment schedule comes from the local loan schedules, so it renders at once; tiers fill in when each
 * portfolio's assessment arrives ("Tier pending" meanwhile). A portfolio that is loading, offline or unavailable
 * keeps its outstanding (from the loan schedule) and shows no risk. There is no risk history, so every risk number
 * is labelled "as of" its assessment date, and a payment due later is coloured by TODAY's tier.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, CloudOff, Loader2, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { useCountries } from '@/data/hooks';
import { TIMEOUTS } from '@/data/http';
import { tierOf } from '@/domain/constants';
import { todayUTC } from '@/domain/dates';
import type { Currency, Portfolio } from '@/domain/types';
import { useStore } from '@/state/store';
import { EmptyState, PortfolioName, TierBadge, buttonClass, portfolioLabel } from '@/shared/ui';
import { CREDIT_ACTION_LABELS, TIER_LABELS, date, money, number, pct } from '@/shared/format';
import { countryInfo } from '@/features/portfolios/portfolioModel';
import { dueLabel } from '@/features/dashboard/dashboardModel';
import {
  allocation,
  asOfDates,
  currenciesOf,
  dueWithin,
  farmRows,
  homeKpis,
  paymentSchedule,
  portfolioRows,
  stressedFarms,
  upcomingInstallments,
  weightedRisk,
  TIER_FILL,
  type PortfolioEntry,
  type PortfolioRow,
} from './homeModel';
import { AllocationBar, MixBar, PaymentScheduleChart, RiskScaleLegend, ScoreGauge, ScoreText, TierDot, TierLegend } from './HomeCharts';
import { useAssessments, type ProbeState } from './useAssessments';

export function HomePage() {
  const portfolios = useStore((s) => s.portfolios);
  const { states, probes } = useAssessments(portfolios);
  const currencies = useMemo(() => currenciesOf(portfolios), [portfolios]);
  const [picked, setPicked] = useState<Currency | null>(null);
  const currency = picked && currencies.includes(picked) ? picked : (currencies[0] ?? 'USD');

  if (portfolios.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Header />
        <EmptyState
          className="mt-8"
          title="No portfolios yet"
          description="Create a portfolio or load the Chilean sample to see the payments coming due and the climate risk behind them."
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
      <Dashboard portfolios={portfolios} states={states} currency={currency} currencies={currencies} onCurrency={setPicked} />
    </div>
  );
}

function Header({ right }: { right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Home</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Portfolio overview</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Payments coming due across your portfolios, and the climate risk of the farms behind them.</p>
      </div>
      {right}
    </div>
  );
}

type Horizon = 6 | 12 | 24;
/** After this long, a running assessment gets a "still assessing" note (a cold first assessment takes minutes). */
export const SLOW_AFTER_MS = 15_000;

function Dashboard({
  portfolios,
  states,
  currency,
  currencies,
  onCurrency,
}: {
  portfolios: Portfolio[];
  states: Record<string, ProbeState>;
  currency: Currency;
  currencies: Currency[];
  onCurrency: (c: Currency) => void;
}) {
  const { data: countries } = useCountries();
  const today = todayUTC();
  const [horizon, setHorizon] = useState<Horizon>(12);
  const group = useMemo(() => portfolios.filter((p) => p.currency === currency), [portfolios, currency]);
  const entries: PortfolioEntry[] = useMemo(() => group.map((p) => ({ portfolio: p, assessment: states[p.id]?.assessment ?? null })), [group, states]);
  const asOfs = useMemo(() => asOfDates(entries), [entries]);
  const asOf = asOfs[0] ?? today;
  const rows = useMemo(() => entries.flatMap((e) => farmRows(e, today)), [entries, today]);
  const k = useMemo(() => homeKpis(entries, today), [entries, today]);
  const due90 = useMemo(() => dueWithin(entries, asOf, 90, currency), [entries, asOf, currency]);
  const schedule = useMemo(() => paymentSchedule(entries, asOf, horizon, currency), [entries, asOf, horizon, currency]);
  const countryName = (code: string) => countryInfo(code, countries).name;
  const names = useMemo(() => new Map(group.map((p) => [p.id, portfolioLabel(p)])), [group]);
  const byPortfolio = useMemo(() => allocation(rows, 'portfolio'), [rows]);
  const byCountry = useMemo(() => allocation(rows, 'country', (c) => countryInfo(c, countries).name), [rows, countries]);
  const byCrop = useMemo(() => allocation(rows, 'crop'), [rows]);
  const pRows = useMemo(() => portfolioRows(entries, today), [entries, today]);
  const upcoming = useMemo(() => upcomingInstallments(entries, asOf, 60).filter((i) => i.currency === currency), [entries, asOf, currency]);
  const overall = useMemo(() => weightedRisk(rows), [rows]);
  const groupStates = group.map((p) => states[p.id]);
  const loading = groupStates.filter((s) => s?.status === 'loading').length;
  const pending = loading > 0 ? 'Tier pending' : 'Not assessed';
  const snapshot = groupStates.find((s) => s?.source === 'snapshot');
  const asOfLabel = asOfs.length > 1 ? `Risk as of ${date(asOfs[asOfs.length - 1], 'short')}–${date(asOfs[0])}` : asOfs.length ? `Risk as of ${date(asOfs[0])}` : null;

  return (
    <>
      <Header
        right={
          <div className="flex flex-col items-start gap-2 sm:items-end">
            {currencies.length > 1 && <CurrencySwitch value={currency} options={currencies} onChange={onCurrency} />}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {loading > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 size={14} className="animate-spin" /> Assessing {loading} of {group.length}
                </span>
              )}
              {asOfLabel && <span className="font-mono tabular-nums">{asOfLabel}</span>}
              {snapshot && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2 py-0.5 font-medium text-warn-ink">
                  <CloudOff size={12} /> Offline snapshot of {date(snapshot.snapshotDate)}
                </span>
              )}
            </div>
          </div>
        }
      />

      {currencies.length > 1 && (
        <p className="mt-3 text-xs text-muted">
          Amounts are not converted between currencies. Showing the {group.length} {group.length === 1 ? 'portfolio' : 'portfolios'} in {currency}; switch currency to see the others.
        </p>
      )}

      <SlowNotice portfolios={group} states={states} />
      <StatusNotices portfolios={group} states={states} />

      {/* KPI strip: what falls due first, then the book */}
      <section aria-label="Key figures" className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Due in next 90 days"
          value={money(due90.amount, currency)}
          sub={due90.count ? `${due90.count} ${due90.count === 1 ? 'installment' : 'installments'} · ${due90.farms} ${due90.farms === 1 ? 'farm' : 'farms'}` : 'Nothing scheduled'}
        />
        <Kpi
          label="Due at watch or high"
          value={due90.stressedShare === null ? '–' : money(due90.stressed, currency)}
          tone={due90.stressed > 0 ? 'warn' : undefined}
          sub={
            due90.stressedShare === null
              ? due90.amount === 0
                ? 'Nothing due in 90 days'
                : pending
              : `${pct(due90.stressedShare, 1)} of the 90-day amount${due90.unscored > 0 ? ' with a tier' : ''}`
          }
        />
        <Kpi label="Total outstanding" value={money(k.outstanding, currency)} sub={`${k.portfolios} ${k.portfolios === 1 ? 'portfolio' : 'portfolios'} · ${k.farms} farms`} />
        <Kpi
          label="Credit actions open"
          value={k.assessed ? number(k.creditActions) : '–'}
          tone={k.creditActions > 0 ? 'danger' : undefined}
          sub={k.assessed ? `on ${k.farmsWithActions} ${k.farmsWithActions === 1 ? 'farm' : 'farms'}` : loading ? 'Assessing…' : 'Needs an assessment'}
        />
        <IncidentsKpi k={k} names={names} loading={loading > 0} className="col-span-2 sm:col-span-1" />
      </section>

      {/* Hero: payment schedule */}
      <section aria-labelledby="pay-h" className="mt-6 rounded-card border border-line bg-white">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="pay-h" className="text-base font-semibold text-ink">
              Payment schedule
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted">
              Installments due each month from the loan schedules, coloured by each farm's current tier{asOfs.length ? ` (as of ${date(asOf)})` : ''}. Scheduled, not observed payments.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {currencies.length > 1 && <CurrencySwitch value={currency} options={currencies} onChange={onCurrency} label="Payment schedule currency" />}
            <Segmented<Horizon>
              label="Months shown"
              value={horizon}
              onChange={setHorizon}
              options={[
                [6, '6 mo'],
                [12, '12 mo'],
                [24, '24 mo'],
              ]}
            />
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-line px-5 py-3 sm:flex sm:flex-wrap">
          <Figure label={`Due in the next ${horizon} months`} value={money(schedule.total, currency)} sub={`${schedule.count} ${schedule.count === 1 ? 'installment' : 'installments'}`} />
          <Figure
            label="Of which at watch or high"
            value={schedule.byTier.watch + schedule.byTier.high + schedule.byTier.normal > 0 ? money(schedule.byTier.watch + schedule.byTier.high, currency) : '–'}
            sub={
              schedule.byTier.watch + schedule.byTier.high + schedule.byTier.normal > 0
                ? `${pct((schedule.byTier.watch + schedule.byTier.high) / (schedule.byTier.watch + schedule.byTier.high + schedule.byTier.normal), 1)} of the amount with a tier`
                : pending
            }
            dot={schedule.byTier.watch + schedule.byTier.high > 0 ? TIER_FILL.watch : undefined}
          />
          <Figure label="Outstanding today" value={money(k.outstanding, currency)} sub={k.outstanding > 0 ? `${pct(Math.min(1, schedule.total / k.outstanding))} falls due in this window` : undefined} />
        </dl>
        <div className="p-5">
          {schedule.total > 0 ? (
            <PaymentScheduleChart schedule={schedule} currency={currency} pending={pending} />
          ) : (
            <p className="py-10 text-center text-sm text-muted">{group.some((p) => p.farms.some((f) => f.loan)) ? `No installment due in the next ${horizon} months.` : 'No loans entered yet.'}</p>
          )}
          {loading > 0 && schedule.byTier.unscored > 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" /> Amounts are complete; the tier colours fill in when the assessment arrives.
            </p>
          )}
          {schedule.otherCurrencyLoans > 0 && (
            <p className="mt-2 text-xs text-muted">
              {schedule.otherCurrencyLoans} {schedule.otherCurrencyLoans === 1 ? 'loan is' : 'loans are'} in another currency and not shown (no conversion).
            </p>
          )}
        </div>
        <div className="border-t border-line">
          <h3 className="px-5 pb-2 pt-4 text-sm font-semibold text-ink">Installments in the next 60 days</h3>
          <UpcomingTable items={upcoming} currency={currency} pending={pending} />
        </div>
      </section>

      {/* Second: risk per portfolio */}
      <section aria-labelledby="risk-h" className="mt-6 rounded-card border border-line bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id="risk-h" className="text-base font-semibold text-ink">
              Risk per portfolio
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Exposure-weighted risk score, 0–100 (watch from 35, high from 60), and how the outstanding splits by tier
              {asOfs.length > 0 ? `, as of ${date(asOf)}` : ''}.
            </p>
          </div>
          {pRows.length > 1 && (
            <span className="text-xs text-muted">
              All {currency} portfolios <ScoreText score={overall.score} />
            </span>
          )}
        </div>
        <ul className="divide-y divide-line">
          {pRows.map((r) => {
            const e = entries.find((x) => x.portfolio.id === r.id)!;
            return (
              <li key={r.id}>
                <PortfolioRisk row={r} entry={e} state={states[r.id]} asOf={asOf} currency={currency} countryName={countryName} />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Allocation, collapsed */}
      <details className="group mt-6 rounded-card border border-line bg-white">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-card px-5 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <ChevronRight size={16} aria-hidden className="text-muted transition-transform group-open:rotate-90" />
            <h2 className="text-base font-semibold text-ink">Allocation</h2>
          </span>
          <span className="text-sm text-muted">Outstanding by portfolio, country and crop, coloured by weighted risk</span>
        </summary>
        <div className="border-t border-line">
          <div className="flex justify-end px-5 pt-4">
            <RiskScaleLegend />
          </div>
          <div className="grid gap-6 p-5 md:grid-cols-3">
            <AllocationBar title="By portfolio" slices={byPortfolio} currency={currency} />
            <AllocationBar title="By country" slices={byCountry} currency={currency} />
            <AllocationBar title="By crop" slices={byCrop} currency={currency} />
          </div>
        </div>
      </details>

      {/* Portfolio table */}
      <section aria-labelledby="pf-h" className="mt-6 rounded-card border border-line bg-white">
        <div className="border-b border-line px-5 py-4">
          <h2 id="pf-h" className="text-base font-semibold text-ink">
            Portfolios
          </h2>
          <p className="mt-0.5 text-sm text-muted">Outstanding, share of the {currency} book and risk, as of each portfolio's assessment.</p>
          <p className="mt-1 text-xs text-muted lg:hidden">Scroll the table sideways for all columns.</p>
        </div>
        <PortfolioTable rows={pRows} states={states} currency={currency} countryName={countryName} overall={overall.score} />
      </section>
    </>
  );
}

/** One rich row per portfolio: score gauge, tier mix of outstanding, the numbers, the largest farms at risk. */
function PortfolioRisk({
  row: r,
  entry,
  state,
  asOf,
  currency,
  countryName,
}: {
  row: PortfolioRow;
  entry: PortfolioEntry;
  state: ProbeState | undefined;
  asOf: string;
  currency: Currency;
  countryName: (c: string) => string;
}) {
  const stressed = r.mix.watch + r.mix.high;
  const scored = r.mix.normal + stressed;
  const due = dueWithin([entry], asOf, 90, currency);
  const top = stressedFarms(entry, asOf, 3);
  const pending = state?.status === 'loading' ? 'Tier pending' : 'Not assessed';
  const band = r.risk.score === null ? null : tierOf(r.risk.score);
  const label = 'text-xs text-muted';
  return (
    <article aria-label={r.name} className="px-5 py-5">
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,15rem)]">
        <div className="min-w-0">
          <Link to={`/portfolios/${r.id}`} className="block truncate text-base font-semibold text-ink hover:text-brand focus:outline-none focus-visible:underline">
            <PortfolioName name={r.name} code={r.code} />
          </Link>
          <div className="mt-0.5 text-sm text-muted">
            {countryName(r.country)} · {r.farms} {r.farms === 1 ? 'farm' : 'farms'} · {currency}
          </div>
          <div className="mt-1">
            <RowStatus s={state} />
            {r.asOf && state?.source !== 'snapshot' && <span className="text-xs text-muted">Risk as of {date(r.asOf)}</span>}
          </div>
          <Link
            to={`/portfolios/${r.id}`}
            className="mt-3 inline-flex items-center gap-1 rounded text-sm font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Open report <ArrowRight size={14} />
          </Link>
        </div>

        <div className="min-w-0">
          <div className={label}>Weighted risk score</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-ink">{r.risk.score === null ? '–' : number(r.risk.score, 1)}</span>
            {band ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-ink">
                <TierDot tier={band} /> {TIER_LABELS[band]}
              </span>
            ) : (
              <span className="text-sm text-muted">{pending}</span>
            )}
          </div>
          <div className="mt-2">
            <ScoreGauge score={r.risk.score} />
          </div>
          {r.risk.coverage !== null && r.risk.coverage < 1 && r.risk.score !== null && <div className="text-xs text-muted">Covers {pct(r.risk.coverage)} of outstanding</div>}
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className={label}>Outstanding by tier</span>
            <span className="font-mono text-sm tabular-nums text-ink">{money(r.outstanding, currency)}</span>
          </div>
          <MixBar mix={r.mix} total={r.outstanding} pending={pending} className="mt-2 h-3 w-full" />
          <div className="mt-2">
            <TierLegend keys={(['normal', 'watch', 'high', 'unscored'] as const).filter((t) => r.mix[t] > 0)} pending={pending} amounts={r.mix} currency={currency} />
          </div>
        </div>

        <dl className="grid min-w-0 grid-cols-3 gap-x-4 gap-y-3 md:col-span-2 xl:col-span-1 xl:grid-cols-1">
          <div>
            <dt className={label}>At watch or high</dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">
              {scored > 0 ? money(stressed, currency) : '–'}
              {scored > 0 && <span className="block text-xs font-normal text-muted xl:ml-1.5 xl:inline xl:text-sm">{pct(stressed / scored, 1)} of assessed</span>}
            </dd>
          </div>
          <div>
            <dt className={label}>Credit actions</dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">{r.creditActions === null ? '–' : r.creditActions}</dd>
          </div>
          <div>
            <dt className={label}>Due in 90 days</dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink">{money(due.amount, currency)}</dd>
          </div>
        </dl>
      </div>
      {top.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-sm">
          <span className={label}>Largest at watch or high</span>
          {top.map((f) => (
            <Link
              key={f.farmId}
              to={`/portfolios/${r.id}/farms/${f.farmId}`}
              className="inline-flex min-w-0 items-center gap-1.5 rounded text-ink hover:text-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <TierDot tier={f.tier} />
              <span className="max-w-[14rem] truncate">{f.farmName}</span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {money(f.outstanding, currency, { compact: true })} · {number(f.score, 1)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

/** One figure in the payment card's summary row. */
function Figure({ label, value, sub, dot }: { label: string; value: string; sub?: string; dot?: string }) {
  return (
    <div className="min-w-0 sm:pr-6">
      <dt className="flex items-center gap-1.5 text-xs text-muted">
        {dot && <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: dot }} />}
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-ink">{value}</dd>
      {sub && <dd className="text-xs text-muted">{sub}</dd>}
    </div>
  );
}

function Segmented<T extends number | string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-card border border-line p-0.5">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={`rounded-[6px] px-3 py-1 font-mono text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${v === value ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-ink'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const fmtElapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

/** A cold first assessment can take minutes: say so, and say what is already complete. */
function SlowNotice({ portfolios, states }: { portfolios: Portfolio[]; states: Record<string, ProbeState> }) {
  const waiting = portfolios.filter((p) => states[p.id]?.status === 'loading' && states[p.id]?.since !== null);
  const [now, setNow] = useState(() => Date.now());
  const active = waiting.length > 0;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const oldest = Math.min(...waiting.map((p) => states[p.id].since ?? now));
  if (!active || now - oldest < SLOW_AFTER_MS) return null;
  return (
    <div role="status" className="mt-4 rounded-card border border-line bg-surface px-4 py-3 text-sm text-ink">
      <p className="flex items-start gap-2">
        <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-muted" />
        <span>
          Still assessing {waiting.length === 1 ? (waiting[0].name || 'Untitled portfolio') : `${waiting.length} portfolios`} ({fmtElapsed(now - oldest)}). A first assessment can take a few
          minutes; after {Math.round(TIMEOUTS.assess / 60_000)} minutes it stops and offers a retry. The payment schedule and outstanding below come from the loan schedules and are complete; tiers, credit actions and
          incidents fill in when it arrives.
        </span>
      </p>
    </div>
  );
}

/* ───────────────────────── pieces ───────────────────────── */

/** Tone marks the label with a small square; the number stays in ink (amber text on white is too faint). */
const TONE = { warn: 'bg-warn', danger: 'bg-danger' } as const;
const TIER_SHORT = { normal: 'Normal', watch: 'Watch', high: 'High' } as const;

function Kpi({ label, value, sub, tone, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: keyof typeof TONE; className?: string }) {
  return (
    <div className={`min-w-0 bg-white p-4 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {tone && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-[2px] ${TONE[tone]}`} />}
        {label}
      </div>
      <div className="mt-1.5 truncate font-mono text-xl font-semibold tabular-nums text-ink sm:text-2xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function IncidentsKpi({ k, names, loading, className }: { k: ReturnType<typeof homeKpis>; names: ReadonlyMap<string, string>; loading?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const inc = k.incidents;
  return (
    <div className={`relative min-w-0 bg-white ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!k.assessed}
        className="h-full w-full p-4 text-left hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 disabled:cursor-default disabled:hover:bg-white"
      >
        <div className="flex items-center justify-between text-xs text-muted">
          <span className="flex items-center gap-1.5">
            {inc.total > 0 && <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px] bg-danger" />}
            Incidents (last 24 h)
          </span>
          {k.assessed > 0 && <ChevronDown size={14} className={open ? 'rotate-180' : ''} aria-hidden />}
        </div>
        <div className="mt-1.5 font-mono text-xl font-semibold tabular-nums text-ink sm:text-2xl">{k.assessed ? number(inc.total) : '–'}</div>
        <div className="mt-1 text-xs text-muted">
          {k.assessed ? (
            <>
              {inc.events} {inc.events === 1 ? 'event' : 'events'} · {inc.triggers} rule {inc.triggers === 1 ? 'trigger' : 'triggers'}
              {inc.nearby > 0 && <span className="block">+{inc.nearby} nearby {inc.nearby === 1 ? 'event' : 'events'} touching no farm</span>}
            </>
          ) : loading ? (
            'Assessing…'
          ) : (
            'Needs an assessment'
          )}
        </div>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-[min(24rem,calc(100vw-2rem))] overflow-auto rounded-card border border-line bg-white p-3 text-xs shadow-panel">
          <p className="text-muted">Events touching a farm that started on the as-of day or the day before, and credit rules that fired at the as-of.</p>
          {inc.items.length ? (
            <ul className="mt-2 divide-y divide-line">
              {inc.items.map((i) => (
                <li key={`${i.portfolioId}/${i.kind}/${i.id}`} className="py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-ink">{i.title}</span>
                    <span className="shrink-0 font-mono tabular-nums text-muted">{date(i.date, 'short')}</span>
                  </div>
                  <div className="text-muted">
                    {i.kind === 'credit_rule' && i.action ? `${CREDIT_ACTION_LABELS[i.action]}: ` : ''}
                    {i.detail}
                  </div>
                  <Link to={`/portfolios/${i.portfolioId}`} className="text-brand hover:underline focus:outline-none focus-visible:underline">
                    {names.get(i.portfolioId) ?? i.portfolioId}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-ink">No incidents.</p>
          )}
          {inc.nearby > 0 && (
            <p className="mt-2 text-muted">
              {inc.nearby} more {inc.nearby === 1 ? 'event' : 'events'} in the area touched no farm.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CurrencySwitch({ value, options, onChange, label = 'Currency' }: { value: Currency; options: Currency[]; onChange: (c: Currency) => void; label?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-card border border-line p-0.5">
      {options.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          onClick={() => onChange(c)}
          className={`rounded-[6px] px-3 py-1 font-mono text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${c === value ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:text-ink'}`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

/** Portfolios that are not (yet) assessed: why, and what is shown instead. */
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
              ? 'Risk is missing for 1 portfolio. Its outstanding comes from the loan schedule; its risk shows as “–”.'
              : `Risk is missing for ${problems.length} portfolios. Their outstanding comes from the loan schedules; their risk shows as “–”.`}
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

function RowStatus({ s }: { s: ProbeState | undefined }) {
  if (!s) return null;
  if (s.status === 'loading')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Loader2 size={12} className="animate-spin" /> Assessing…
      </span>
    );
  if (s.status === 'no_farms') return <span className="text-xs text-muted">No farms yet</span>;
  if (s.status === 'unavailable') return <span className="inline-flex items-center gap-1 text-xs text-warn"><CloudOff size={12} /> Risk needs the live service</span>;
  if (s.status === 'error') return <span className="text-xs text-danger">Assessment failed</span>;
  if (s.source === 'snapshot') return <span className="text-xs text-warn">Offline snapshot of {date(s.snapshotDate)}</span>;
  return null;
}

function PortfolioTable({
  rows,
  states,
  currency,
  countryName,
  overall,
}: {
  rows: PortfolioRow[];
  states: Record<string, ProbeState>;
  currency: Currency;
  countryName: (c: string) => string;
  overall: number | null;
}) {
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  const farms = rows.reduce((s, r) => s + r.farms, 0);
  const actions = rows.every((r) => r.creditActions === null) ? null : rows.reduce((s, r) => s + (r.creditActions ?? 0), 0);
  const th = 'px-3 py-2 text-xs font-medium text-muted whitespace-nowrap';
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <caption className="sr-only">Portfolios in {currency}</caption>
        <thead className="bg-surface">
          <tr>
            <th scope="col" className={`${th} pl-5 text-left`}>Portfolio</th>
            <th scope="col" className={`${th} text-left`}>Country</th>
            <th scope="col" className={`${th} text-right`}>Farms</th>
            <th scope="col" className={`${th} text-right`}>Outstanding</th>
            <th scope="col" className={`${th} text-right`}>% of total</th>
            <th scope="col" className={`${th} text-right`}>Weighted risk</th>
            <th scope="col" className={`${th} text-left`}>Tier mix</th>
            <th scope="col" className={`${th} text-right`}>Credit actions</th>
            <th scope="col" className={`${th} pr-5 text-right`}>
              <span className="sr-only">Report</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={`border-t border-line ${i % 2 ? 'bg-surface/60' : ''}`}>
              <th scope="row" className="max-w-[16rem] py-2.5 pl-5 pr-3 text-left font-normal">
                <Link to={`/portfolios/${r.id}`} className="block truncate font-medium text-ink hover:text-brand focus:outline-none focus-visible:underline">
                  {r.name}
                </Link>
                <RowStatus s={states[r.id]} />
              </th>
              <td className="whitespace-nowrap px-3 py-2.5 text-ink">{countryName(r.country)}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.farms}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums text-ink">{money(r.outstanding, currency)}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted">{pct(r.share, 1)}</td>
              <td className="px-3 py-2.5 text-right">
                <ScoreText score={r.risk.score} />
              </td>
              <td className="px-3 py-2.5">
                <MixBar mix={r.mix} total={r.outstanding} />
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{r.creditActions === null ? '–' : r.creditActions}</td>
              <td className="py-2.5 pl-3 pr-5 text-right">
                <Link to={`/portfolios/${r.id}`} className="inline-flex items-center gap-1 whitespace-nowrap rounded text-xs font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                  Report <ArrowRight size={12} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-[3px] border-double border-brand font-semibold">
            <th scope="row" className="py-2.5 pl-5 pr-3 text-left text-xs uppercase tracking-wide text-ink">
              Total
            </th>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{farms}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{money(total, currency)}</td>
            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{pct(total > 0 ? 1 : 0, 1)}</td>
            <td className="px-3 py-2.5 text-right">
              <ScoreText score={overall} />
            </td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{actions ?? '–'}</td>
            <td className="pr-5" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function UpcomingTable({ items, currency, pending }: { items: ReturnType<typeof upcomingInstallments>; currency: Currency; pending: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <p className="px-5 pb-4 text-sm text-muted">No installments due in the next 60 days.</p>;
  const shown = all ? items : items.slice(0, 8);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  const th = 'px-3 py-2 text-xs font-medium text-muted whitespace-nowrap';
  return (
    <>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Installments due in the next 60 days</caption>
          <thead className="bg-surface">
            <tr>
              <th scope="col" className={`${th} pl-5 text-left`}>Farm</th>
              <th scope="col" className={`${th} hidden text-left md:table-cell`}>Portfolio</th>
              <th scope="col" className={`${th} text-left`}>Due</th>
              <th scope="col" className={`${th} pr-5 text-right sm:pr-3`}>Amount</th>
              <th scope="col" className={`${th} hidden pr-5 text-left sm:table-cell`}>Tier</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i, n) => (
              <tr key={`${i.portfolioId}/${i.farmId}/${i.dueDate}`} className={`border-t border-line ${n % 2 ? 'bg-surface/60' : ''}`}>
                <th scope="row" className="max-w-[9rem] py-2 pl-5 pr-3 text-left font-normal sm:max-w-[18rem]">
                  <Link to={`/portfolios/${i.portfolioId}/farms/${i.farmId}`} className="flex min-w-0 items-center gap-1.5 text-ink hover:text-brand focus:outline-none focus-visible:underline">
                    <TierDot tier={i.tier} className="sm:hidden" />
                    <span className="truncate">{i.farmName}</span>
                  </Link>
                  <span className="sr-only sm:hidden">{i.tier ? `${TIER_SHORT[i.tier]} tier` : pending}</span>
                  <span className="block truncate text-xs text-muted md:hidden">{i.portfolioName}</span>
                </th>
                <td className="hidden max-w-[14rem] truncate px-3 py-2 text-muted md:table-cell">{i.portfolioName}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="font-mono tabular-nums text-ink">{date(i.dueDate, 'short')}</span>
                  <span className="block text-xs text-muted sm:ml-2 sm:inline">{dueLabel(i.days)}</span>
                </td>
                <td className="whitespace-nowrap py-2 pl-3 pr-5 text-right font-mono tabular-nums text-ink sm:pr-3">{money(i.amount, currency)}</td>
                <td className="hidden py-2 pl-3 pr-5 sm:table-cell">{i.tier ? <TierBadge tier={i.tier} /> : <span className="text-xs text-muted">{pending}</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line">
              <th scope="row" className="py-2 pl-5 pr-3 text-left text-xs font-medium text-muted">
                {items.length} {items.length === 1 ? 'installment' : 'installments'}
              </th>
              <td className="hidden md:table-cell" />
              <td />
              <td className="whitespace-nowrap py-2 pl-3 pr-5 text-right font-mono font-semibold tabular-nums text-ink sm:pr-3">{money(sum, currency)}</td>
              <td className="hidden pr-5 sm:table-cell" />
            </tr>
          </tfoot>
        </table>
      </div>
      {items.length > 8 && (
        <div className="border-t border-line px-5 py-2">
          <button type="button" onClick={() => setAll((a) => !a)} className="rounded text-xs font-medium text-brand hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            {all ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        </div>
      )}
    </>
  );
}

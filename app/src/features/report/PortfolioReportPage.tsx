/**
 * Portfolio report (one per portfolio, route /portfolios/:portfolioId). POST /assess/portfolio → a header and a KPI
 * strip with "Incidents (last 24 h)" that stay visible, then tabs synced to `?tab=`:
 *   Overview      the finance table (farm, outstanding, % of portfolio, risk score, weighted risk, TOTAL), with the
 *                 Insurance column: requests queued for Suyana in BrotIA's outbox (ADR-0025);
 *   Payments      next installments (6 or 12 months), installments due in 60 days, credit actions;
 *   Exposures     outstanding by tier, crop, zone and region, split by tier;
 *   Risks         risk score distribution, water status, stress drivers, recent disasters;
 *   Demographics  farms by crop (area), region, zone and growth stage, and the farms map.
 * Every number comes from the service (or the offline snapshot, labelled) or the portfolio's own loan schedules
 * and farm records. The four chart tabs are lazy-loaded.
 */
import { Suspense, lazy, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bot, CloudOff, History, Loader2, RefreshCw } from 'lucide-react';
import { assessmentFingerprint } from '@/data/api';
import { useCountries, usePortfolioAssessment } from '@/data/hooks';
import type { PortfolioAssessment } from '@/domain/types';
import { usePortfolio, useStore } from '@/state/store';
import { Button, DataTierPill, EmptyState, PortfolioName, TabPanel, Tabs, buttonClass, useTabParam } from '@/shared/ui';
import { date } from '@/shared/format';
import { countryInfo } from '@/features/portfolios/portfolioModel';
import { waterSlotsOpen } from '@/features/dashboard/dashboardModel';
import { WaterStatusIcon } from '@/features/dashboard/WaterStatusIcon';
import {
  DEFAULT_REPORT_TAB,
  DEFAULT_SORT,
  REPORT_TABS,
  REPORT_TAB_PREFIX,
  emptyProbes,
  incidents as incidentList,
  nearbyEventCount,
  nextSort,
  probesFor,
  recordProbe,
  reportRows,
  reportTotals,
  sortRows,
  type FarmProbe,
  type ProbeState,
  type SortKey,
  type SortState,
} from './reportModel';
import { ReportTable } from './ReportTable';
import { IncidentsList, KpiStrip } from './ReportKpis';
import { FarmProbes } from './FarmProbes';
import { AssessmentError, AssessmentLoading, SourcePill, Warnings } from './parts';
import { useInsuranceColumn } from './insurance/useInsuranceColumn';
import { paths } from '@/shell/paths';

const PaymentsTab = lazy(() => import('./tabs/PaymentsTab'));
const ExposuresTab = lazy(() => import('./tabs/ExposuresTab'));
const RisksTab = lazy(() => import('./tabs/RisksTab'));
const DemographicsTab = lazy(() => import('./tabs/DemographicsTab'));

/** Per-farm lookups (one farm assessment each) run two at a time, top of the table first. */
const WATER_SLOTS = 2;

function TabSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-busy>
      {[0, 1].map((k) => (
        <div key={k} className="h-[320px] animate-pulse rounded-card bg-surface" />
      ))}
    </div>
  );
}

export function PortfolioReportPage() {
  const { portfolioId } = useParams();
  const navigate = useNavigate();
  const portfolio = usePortfolio(portfolioId);
  const openAgent = useStore((s) => s.openAgent);
  const { data: countries } = useCountries();
  const { data: a, source, snapshotDate, error, loading, refetch } = usePortfolioAssessment(portfolio);
  const [tab, setTab] = useTabParam(REPORT_TABS, DEFAULT_REPORT_TAB);
  const [hoverFarm, setHoverFarm] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [showIncidents, setShowIncidents] = useState(false);
  const fingerprint = useMemo(() => (portfolio ? assessmentFingerprint(portfolio) : ''), [portfolio]);

  // After a rule edit the request key changes and the new assessment takes a while: keep showing the last
  // one for this portfolio, clearly labelled as from before the change, instead of blanking the page.
  const lastGood = useRef<{ a: PortfolioAssessment; source: typeof source; snapshotDate: string | null } | null>(null);
  if (a && portfolio && a.portfolioId === portfolio.id) lastGood.current = { a, source, snapshotDate };
  const current = a && portfolio && a.portfolioId === portfolio.id ? a : undefined;
  const previous = !current && portfolio && lastGood.current?.a.portfolioId === portfolio.id ? lastGood.current : null;
  const assessment: PortfolioAssessment | undefined = current ?? previous?.a;
  const shownSource = current ? source : previous?.source;
  const shownSnapshotDate = current ? snapshotDate : (previous?.snapshotDate ?? null);

  const rows = useMemo(() => (assessment ? reportRows(assessment) : []), [assessment]);
  const totals = useMemo(() => reportTotals(rows), [rows]);
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const incidents = useMemo(() => (assessment ? incidentList(assessment) : []), [assessment]);
  const nearby = useMemo(() => (assessment ? nearbyEventCount(assessment) : 0), [assessment]);

  // Per-farm lookups (water status, stress drivers): display only, the service's score already includes both.
  // Results are tagged with the fingerprint, so a rule change starts from empty without a reset effect.
  const [probeState, setProbeState] = useState<ProbeState>(() => emptyProbes());
  const probes = useMemo(() => probesFor(probeState, fingerprint), [probeState, fingerprint]);
  const settled = useMemo(() => new Set(probes.keys()), [probes]);
  const onProbe = useCallback((id: string, r: FarmProbe | null) => setProbeState((s) => recordProbe(s, fingerprint, id, r)), [fingerprint]);
  const order = useMemo(() => sorted.map((r) => r.farmId), [sorted]);
  const waterEnabled = !loading && !!current;
  const lookups: 'waiting' | 'checking' | 'done' = !waterEnabled ? 'waiting' : probes.size < rows.length ? 'checking' : 'done';
  const insurance = useInsuranceColumn({ portfolio, rows: sorted, asOf: assessment?.asOf, countries });

  if (!portfolio) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <EmptyState
          title="Portfolio not found"
          description="It may have been deleted, or it lives in another browser. Portfolios are stored in this browser only."
          action={
            <Link to={paths.portfolios} className={buttonClass('primary', 'sm')}>
              Back to portfolios
            </Link>
          }
        />
      </div>
    );
  }

  const country = countryInfo(portfolio.country, countries);
  const openFarm = (id: string) => navigate(paths.farm(portfolio.id, id));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Portfolio report</p>
          <h1 className="mt-1 truncate text-2xl font-semibold text-ink">
            <PortfolioName name={portfolio.name} code={portfolio.code} />
          </h1>
          <dl className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted">Lender</dt>
              <dd className="text-ink">{portfolio.lender || '–'}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-muted">Country</dt>
              <dd className="inline-flex items-center gap-1.5 text-ink">
                {country.flag && <span aria-hidden>{country.flag}</span>}
                {country.name}
                <DataTierPill tier={country.dataTier} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Currency</dt>
              <dd className="font-mono text-ink">{assessment?.currency ?? portfolio.currency}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Data as of</dt>
              <dd className="font-mono text-ink">{assessment ? date(assessment.asOf) : '–'}</dd>
            </div>
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SourcePill source={shownSource} snapshotDate={shownSnapshotDate} asOf={assessment?.asOf} loading={loading} />
          <Button variant="secondary" size="sm" icon={<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />} disabled={loading || portfolio.farms.length === 0} onClick={refetch}>
            Refresh
          </Button>
          <Button size="sm" icon={<Bot size={16} />} onClick={() => openAgent({ portfolioId: portfolio.id, zoneId: null, farmId: null })}>
            Ask the farming agent
          </Button>
        </div>
      </header>

      {portfolio.farms.length === 0 ? (
        <EmptyState
          className="mt-6"
          title="No farms in this portfolio"
          description="Add farms with loans to see their climate stress and exposure."
          action={
            <Button size="sm" onClick={() => navigate(paths.newPortfolio)}>
              New portfolio
            </Button>
          }
        />
      ) : (
        <>
          {error && !current && <AssessmentError error={error} onRetry={refetch} />}
          {!assessment && !error && <AssessmentLoading farms={portfolio.farms.length} />}
          {previous && (
            <div role="status" className="mt-4 flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 text-sm text-ink">
              {loading ? <Loader2 size={16} className="shrink-0 animate-spin text-brand" /> : <History size={16} className="shrink-0 text-muted" />}
              {loading
                ? 'Recomputing with your latest rule changes. The numbers below are from before the change.'
                : 'The numbers below are from before your latest rule change.'}
            </div>
          )}
          {assessment?.warnings[0]?.startsWith('Offline: computed with the exported rules') && (
            <div role="status" className="mt-4 flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 text-sm text-ink">
              <CloudOff size={16} className="shrink-0 text-warn" />
              {assessment.warnings[0]}
            </div>
          )}

          {assessment && (
            <div className="mt-5">
              <KpiStrip a={assessment} totals={totals} incidents={incidents} nearby={nearby} open={showIncidents} onToggle={() => setShowIncidents((v) => !v)} />
              {showIncidents && <IncidentsList portfolioId={portfolio.id} incidents={incidents} nearby={nearby} asOf={assessment.asOf} currency={assessment.currency} />}
            </div>
          )}

          <div className="mt-6 border-b border-line">
            <Tabs tabs={REPORT_TABS} tab={tab} onSelect={setTab} idPrefix={REPORT_TAB_PREFIX} label="Report sections" />
          </div>
          <TabPanel tab={tab} idPrefix={REPORT_TAB_PREFIX} className="pt-5">
            {!assessment ? (
              <p className="rounded-card border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
                {error ? 'This section fills in when the assessment is available.' : 'This section fills in when the assessment arrives.'}
              </p>
            ) : tab === 'overview' ? (
              <section aria-labelledby="report-table-title">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="report-table-title" className="text-base font-semibold text-ink">
                    Farms and loans
                  </h2>
                  <p className="text-xs text-muted">Outstanding on {date(assessment.asOf)}, in {assessment.currency}. Select a farm to open it.</p>
                </div>
                <ReportTable
                  portfolioId={portfolio.id}
                  rows={sorted}
                  totals={totals}
                  currency={assessment.currency}
                  asOf={assessment.asOf}
                  sort={sort}
                  onSort={(key: SortKey) => setSort((s) => nextSort(s, key))}
                  onOpen={openFarm}
                  hoverFarmId={hoverFarm}
                  onHoverFarm={setHoverFarm}
                  renderWater={(r) => (
                    <WaterStatusIcon portfolio={portfolio} fingerprint={fingerprint} farmId={r.farmId} enabled={waterEnabled && waterSlotsOpen(order, settled, r.farmId, WATER_SLOTS)} />
                  )}
                  insurance={insurance.column}
                />
                {insurance.modal}
              </section>
            ) : (
              <Suspense fallback={<TabSkeleton />}>
                {tab === 'payments' && <PaymentsTab portfolio={portfolio} assessment={assessment} />}
                {tab === 'exposures' && <ExposuresTab portfolio={portfolio} assessment={assessment} />}
                {tab === 'risks' && <RisksTab portfolio={portfolio} assessment={assessment} probes={probes} lookups={lookups} />}
                {tab === 'demographics' && (
                  <DemographicsTab portfolio={portfolio} assessment={assessment} hoverFarmId={hoverFarm} onHoverFarm={setHoverFarm} onOpenFarm={openFarm} />
                )}
              </Suspense>
            )}
          </TabPanel>

          {assessment && assessment.warnings.length > 0 && <Warnings warnings={assessment.warnings} />}
          <FarmProbes portfolio={portfolio} fingerprint={fingerprint} order={order} settled={settled} enabled={waterEnabled} slots={WATER_SLOTS} onResult={onProbe} />
        </>
      )}
    </div>
  );
}

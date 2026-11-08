/**
 * Farm page (v1.1): a compact header that stays visible, then tabs synced to `?tab=`:
 * Overview | Imagery | Water | Risk | Rules | Events.
 * Data: POST /assess/farm (risk, water, peers, series) and POST /imagery/farm (time-lapse), via the data hooks.
 * Nothing here computes a metric (trust rule); thresholds on the charts are the farm's effective rules.
 * The heavy tabs (imagery map and charts) are lazy-loaded.
 */
import { Suspense, lazy, useCallback, useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Leaf } from 'lucide-react';
import { useCrops, useFarmAssessment, useFarmImagery } from '@/data/hooks';
import { usePortfolio, useStore } from '@/state/store';
import { EmptyState, TabPanel, Tabs, buttonClass } from '@/shared/ui';
import { chartWindow, driverNormal, repaymentPlan, thresholdBands } from './farmData';
import { FarmHeader } from './FarmHeader';
import { useFarmTab } from './FarmTabBar';
import { FARM_TABS, FARM_TAB_PREFIX } from './tabModel';
import { OverviewTab } from './OverviewTab';
import { RiskCard } from './RiskCard';
import { PeersCard, WaterLadderCard } from './WaterPeersCards';
import { RulesTab } from './RulesTab';
import { EventsTab } from './EventsTab';
import { ErrorPanel, Skeleton } from './parts';

const ImageryCard = lazy(() => import('./ImageryViewer').then((m) => ({ default: m.ImageryCard })));
const SeriesSection = lazy(() => import('./FarmCharts').then((m) => ({ default: m.SeriesSection })));

function ChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2" aria-busy>
      {Array.from({ length: 4 }, (_, k) => (
        <Skeleton key={k} className="h-[300px]" />
      ))}
    </div>
  );
}

export function FarmPage() {
  const { portfolioId, farmId } = useParams();
  const portfolio = usePortfolio(portfolioId);
  const farm = portfolio?.farms.find((f) => f.id === farmId);
  const openAgent = useStore((s) => s.openAgent);
  const crops = useCrops();
  const q = useFarmAssessment(portfolio, farm?.id);
  // Start the time-lapse early (the first request can take a while); the Imagery tab reads the same cached query.
  const img = useFarmImagery(portfolio, farm?.id, { sr: true });
  const a = q.data;
  const [tab, setTab] = useFarmTab();

  const win = useMemo(() => (a ? chartWindow(a) : null), [a]);
  const thresholds = useMemo(() => (a && portfolio && farm ? thresholdBands(a.stageBands, portfolio, farm, crops.data) : []), [a, portfolio, farm, crops.data]);
  const plan = useMemo(() => repaymentPlan(farm?.loan), [farm?.loan]);

  const askFarm = useCallback(() => {
    if (portfolio && farm) openAgent({ portfolioId: portfolio.id, farmId: farm.id, zoneId: null });
  }, [openAgent, portfolio, farm]);
  const askZone = useCallback(
    (zoneId: string) => {
      if (portfolio) openAgent({ portfolioId: portfolio.id, zoneId, farmId: null });
    },
    [openAgent, portfolio],
  );

  if (!portfolio) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <EmptyState
          icon={<Leaf size={18} />}
          title="Portfolio not found"
          description="This portfolio is not saved in this browser. Load the sample portfolio or create a new one."
          action={
            <Link to="/portfolios" className={buttonClass('primary', 'sm')}>
              Go to portfolios
            </Link>
          }
        />
      </div>
    );
  }
  if (!farm) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-10">
        <EmptyState
          icon={<Leaf size={18} />}
          title="Farm not found"
          description={`“${portfolio.name}” has no farm with this id. It may have been removed.`}
          action={
            <Link to={`/portfolios/${portfolio.id}`} className={buttonClass('primary', 'sm')}>
              Back to the portfolio
            </Link>
          }
        />
      </div>
    );
  }

  const waiting = !q.error;
  let content: ReactNode;
  switch (tab) {
    case 'overview':
      content = <OverviewTab portfolio={portfolio} farm={farm} assessment={a} imagery={img.data} imagerySource={img.source} onSelectTab={setTab} />;
      break;
    case 'imagery':
      content = (
        <Suspense fallback={<Skeleton className="h-[640px]" />}>
          <ImageryCard portfolio={portfolio} farm={farm} bands={a?.stageBands ?? []} />
        </Suspense>
      );
      break;
    case 'water':
      content = a ? (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <WaterLadderCard water={a.water} supplyAsOf={a.dataAsOf.water_supply} />
          <PeersCard peers={a.peers} />
        </div>
      ) : (
        waiting && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-busy>
            <Skeleton className="h-[420px]" />
            <Skeleton className="h-[240px]" />
          </div>
        )
      );
      break;
    case 'risk':
      content = a ? (
        <div className="space-y-6">
          <RiskCard risk={a.risk} />
          {win && (
            <Suspense fallback={<ChartsSkeleton />}>
              <SeriesSection
                assessment={a}
                win={win}
                thresholds={thresholds}
                installments={plan}
                currency={portfolio.currency}
                fallbackFrost={driverNormal(a, 'tmin_7d_min')}
                fallbackHeat={driverNormal(a, 'tmax_7d_max')}
              />
            </Suspense>
          )}
        </div>
      ) : (
        waiting && (
          <div className="space-y-6" aria-busy>
            <Skeleton className="h-[480px]" />
            <ChartsSkeleton />
          </div>
        )
      );
      break;
    case 'rules':
      content = <RulesTab portfolio={portfolio} farm={farm} assessment={a} />;
      break;
    case 'events':
      content = <EventsTab portfolio={portfolio} farm={farm} assessment={a} />;
      break;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      {/* Sticky from md up; on phones the tall header scrolls away with the page. */}
      <div className="-mx-4 border-b border-line bg-white px-4 pt-4 sm:-mx-6 sm:px-6 md:sticky md:top-0 md:z-30">
        <FarmHeader
          portfolio={portfolio}
          farm={farm}
          assessment={a}
          source={q.source}
          snapshotDate={q.snapshotDate}
          loading={q.loading && !a}
          onAskFarm={askFarm}
          onAskZone={askZone}
        />
        <div className="mt-3">
          <Tabs tabs={FARM_TABS} tab={tab} onSelect={setTab} idPrefix={FARM_TAB_PREFIX} label="Farm sections" />
        </div>
      </div>

      <div className="space-y-6 py-6">
        {q.error && !a && <ErrorPanel error={q.error} onRetry={q.refetch} what="Assessment" />}
        {q.error && a && <ErrorPanel error={q.error} onRetry={q.refetch} what="Refreshing the assessment" />}

        <TabPanel tab={tab} idPrefix={FARM_TAB_PREFIX}>
          {content}
        </TabPanel>

        <p className="pb-4 text-xs text-muted">
          Stage windows, thresholds and weights are approximate expert defaults (crop templates). Every value links to its source; values the
          service could not obtain are shown as not available, never filled in.
        </p>
      </div>
    </div>
  );
}

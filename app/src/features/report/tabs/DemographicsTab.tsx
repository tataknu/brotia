/**
 * Report tab "Demographics": who and what the book lends to, from the farm records and the assessment only:
 * farms by crop with total and median area, farms by region (CIREN cadastre layer) and by zone, the current
 * growth stage mix, which optional fields are recorded, and the farms map by tier with the zone circles.
 * Lazy-loaded by the report page; the map is lazy-loaded again (Leaflet needs `window`).
 */
import { Suspense, lazy, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { Portfolio, PortfolioAssessment } from '@/domain/types';
import { NO_REGION, OWN_ZONES, cropProfile, farmsByRegion, farmsByZone, recordCoverage, stageMix } from '../reportModel';
import { CountBars, CropProfileTable, RecordsNote, StageMixChart } from '../ReportCharts';
import { MapLegend } from '../parts';

const DashboardMap = lazy(() => import('@/features/dashboard/DashboardMap'));

export default function DemographicsTab({
  portfolio,
  assessment: a,
  hoverFarmId,
  onHoverFarm,
  onOpenFarm,
}: {
  portfolio: Portfolio;
  assessment: PortfolioAssessment;
  hoverFarmId: string | null;
  onHoverFarm: (id: string | null) => void;
  onOpenFarm: (id: string) => void;
}) {
  const crops = useMemo(() => cropProfile(portfolio.farms), [portfolio.farms]);
  const regions = useMemo(() => farmsByRegion(portfolio.farms), [portfolio.farms]);
  const zones = useMemo(() => farmsByZone(portfolio.farms, portfolio.zones, a.ranked), [portfolio, a.ranked]);
  const stages = useMemo(() => stageMix(a.ranked), [a.ranked]);
  const coverage = useMemo(() => recordCoverage(portfolio.farms), [portfolio.farms]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <CropProfileTable rows={crops} />
        <StageMixChart rows={stages} asOf={a.asOf} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <CountBars
          title="Farms by region"
          subtitle="From the CIREN fruit cadastre layer each farm was picked from"
          rows={regions}
          note={regions.some((r) => r.label === NO_REGION) ? `${NO_REGION}: no cadastre reference, so no region is recorded.` : undefined}
        />
        <CountBars
          title="Farms by zone"
          subtitle="35 km² zones; farms in a shared zone share its rules"
          rows={zones}
          note={zones.some((z) => z.label === OWN_ZONES) ? `${OWN_ZONES}: not grouped with other farms.` : undefined}
        />
        <RecordsNote c={coverage} />
      </div>
      <section aria-label="Farms map by tier" className="relative h-[480px] overflow-hidden rounded-card border border-line">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-2 bg-surface text-sm text-muted">
              <Loader2 size={16} className="animate-spin" />
              Loading the map…
            </div>
          }
        >
          <DashboardMap portfolio={portfolio} ranked={a.ranked} selectedFarmId={hoverFarmId} onHoverFarm={onHoverFarm} onSelectFarm={onOpenFarm} />
        </Suspense>
        <MapLegend />
      </section>
    </div>
  );
}

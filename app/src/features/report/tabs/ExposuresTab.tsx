/**
 * Report tab "Exposures": outstanding by tier, by crop, by zone and by region, each split by the farms' current
 * tier (high red, watch amber, normal green). Sums of the service's per-farm exposures only.
 * Lazy-loaded by the report page.
 */
import { useMemo } from 'react';
import type { Portfolio, PortfolioAssessment } from '@/domain/types';
import { NO_REGION, OWN_ZONES, exposureByCrop, exposureByRegion, exposureByZone, tierMix } from '../reportModel';
import { TierMixChart, TieredBarsChart } from '../ReportCharts';

export default function ExposuresTab({ portfolio, assessment: a }: { portfolio: Portfolio; assessment: PortfolioAssessment }) {
  const crops = useMemo(() => exposureByCrop(a), [a]);
  const zones = useMemo(() => exposureByZone(a, portfolio.zones), [a, portfolio.zones]);
  const regions = useMemo(() => exposureByRegion(a, portfolio.farms), [a, portfolio.farms]);
  return (
    <div className="space-y-4">
      <TierMixChart slices={tierMix(a)} currency={a.currency} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <TieredBarsChart title="Exposure by crop" subtitle="Outstanding per crop, split by tier" rows={crops} currency={a.currency} />
        <TieredBarsChart
          title="Exposure by zone"
          subtitle="Outstanding per 35 km² zone, split by tier"
          rows={zones}
          currency={a.currency}
          note={zones.some((z) => z.label === OWN_ZONES) ? `${OWN_ZONES}: farms not grouped with others; each has its own zone around it.` : undefined}
        />
        <TieredBarsChart
          title="Exposure by region"
          subtitle="Outstanding per region, from the CIREN fruit cadastre layer each farm was picked from"
          rows={regions}
          currency={a.currency}
          note={regions.some((r) => r.label === NO_REGION) ? `${NO_REGION}: the farm has no cadastre reference, so no region is recorded.` : undefined}
        />
      </div>
    </div>
  );
}

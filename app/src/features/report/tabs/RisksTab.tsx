/**
 * Report tab "Risks": risk score distribution, water status counts and stress drivers (both read from each farm's
 * own assessment by the page's farm lookups), and recent disasters around the portfolio.
 * Lazy-loaded by the report page.
 */
import { useMemo } from 'react';
import type { Portfolio, PortfolioAssessment } from '@/domain/types';
import { EventsPanel } from '@/features/dashboard/EventsPanel';
import { driverSummary, reportRows, scoreBins, waterReport, type FarmProbe } from '../reportModel';
import { DriversChart, ScoreDistributionChart, WaterChart } from '../ReportCharts';

export default function RisksTab({
  portfolio,
  assessment: a,
  probes,
  lookups,
}: {
  portfolio: Portfolio;
  assessment: PortfolioAssessment;
  /** Per-farm lookup results for the current assessment (farmId → result; null = failed). */
  probes: ReadonlyMap<string, FarmProbe | null>;
  /** 'waiting' while the assessment is not current; otherwise whether every farm answered. */
  lookups: 'waiting' | 'checking' | 'done';
}) {
  const rows = useMemo(() => reportRows(a), [a]);
  const water = useMemo(() => waterReport(probes), [probes]);
  const drivers = useMemo(() => driverSummary(probes, a.ranked), [probes, a.ranked]);
  const names = useMemo(() => new Map(a.ranked.map((r) => [r.farmId, r.name])), [a.ranked]);
  const read = [...probes.values()].filter(Boolean).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <ScoreDistributionChart bins={scoreBins(rows)} />
        <WaterChart report={water} farms={rows.length} names={names} state={lookups} />
      </div>
      <DriversChart rows={drivers} checked={read} farms={rows.length} currency={a.currency} state={lookups} />
      <EventsPanel events={a.events} portfolio={portfolio} asOf={a.asOf} currency={a.currency} />
    </div>
  );
}

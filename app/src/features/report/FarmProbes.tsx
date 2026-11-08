/**
 * Per-farm lookups behind the report's water status and stress drivers. PortfolioAssessment has neither, so each
 * farm's own assessment (POST /assess/farm) is read, at most `slots` at a time, top of the table first. Mounted by
 * the page whatever tab is open (the table's water icons share the same cache keys, so nothing is fetched twice,
 * and the farm page reuses the results). Renders nothing.
 */
import { useEffect, useMemo } from 'react';
import { assessFarm } from '@/data/api';
import { farmAssessmentKey, useQuery } from '@/data/hooks';
import type { FarmAssessment, Portfolio } from '@/domain/types';
import { waterSlotsOpen, waterSummary } from '@/features/dashboard/dashboardModel';
import type { FarmProbe as Probe } from './reportModel';

function FarmProbe({
  portfolio,
  fingerprint,
  farmId,
  enabled,
  onResult,
}: {
  portfolio: Portfolio;
  fingerprint: string;
  farmId: string;
  enabled: boolean;
  onResult: (farmId: string, result: Probe | null) => void;
}) {
  const key = enabled ? farmAssessmentKey(farmId, undefined, fingerprint) : null;
  const { data, loading, error } = useQuery<FarmAssessment>(key, () => assessFarm(portfolio, farmId));
  const settled = !!key && !loading && (!!data || !!error);
  const probe = useMemo<Probe | null>(
    () => (data ? { water: waterSummary(data.water).level, drivers: data.risk.drivers.map((d) => ({ peril: d.peril, impact: d.impact })) } : null),
    [data],
  );
  // onResult changes with the fingerprint, so a cached answer is re-reported after a rule change (no reset effect).
  useEffect(() => {
    if (settled) onResult(farmId, probe);
  }, [settled, probe, farmId, onResult]);
  return null;
}

export function FarmProbes({
  portfolio,
  fingerprint,
  order,
  settled,
  enabled,
  slots,
  onResult,
}: {
  portfolio: Portfolio;
  fingerprint: string;
  /** Farm ids, top of the table first. */
  order: readonly string[];
  settled: ReadonlySet<string>;
  /** False while the portfolio assessment is loading or not current. */
  enabled: boolean;
  slots: number;
  onResult: (farmId: string, result: Probe | null) => void;
}) {
  return (
    <>
      {order.map((id) => (
        <FarmProbe key={id} portfolio={portfolio} fingerprint={fingerprint} farmId={id} enabled={enabled && waterSlotsOpen(order, settled, id, slots)} onResult={onResult} />
      ))}
    </>
  );
}

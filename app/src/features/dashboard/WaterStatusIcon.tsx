/**
 * Water-status icon of the report table. PortfolioAssessment has no water summary per farm, so this reads the farm's
 * own assessment (POST /assess/farm). The report enables at most two rows at a time (`enabled`), so the
 * service is not hit with every farm at once and nothing new starts after the report unmounts. The cache
 * key matches useFarmAssessment's, so opening the farm page reuses the result. Display only: the water
 * ladder is already in the service's risk score.
 */
import clsx from 'clsx';
import { useEffect } from 'react';
import { Droplet, DropletOff, FileWarning, HelpCircle, Loader2 } from 'lucide-react';
import { assessFarm } from '@/data/api';
import { farmAssessmentKey, useQuery } from '@/data/hooks';
import type { FarmAssessment, Portfolio } from '@/domain/types';
import { Popover, ProvenanceBadge } from '@/shared/ui';
import { waterSummary, type WaterLevel } from './dashboardModel';

const TONE: Record<WaterLevel, string> = {
  ok: 'text-brand',
  watch: 'text-warn',
  stress: 'text-danger',
  unknown: 'text-muted',
};

export function WaterStatusIcon({
  portfolio,
  fingerprint,
  farmId,
  asOf,
  enabled,
  onSettled,
  onLevel,
}: {
  portfolio: Portfolio;
  /** assessmentFingerprint(portfolio), computed once by the page. */
  fingerprint: string;
  farmId: string;
  asOf?: string | null;
  enabled: boolean;
  /** Called once the lookup has an answer or an error (frees a slot for the next row). */
  onSettled?: (farmId: string) => void;
  /** Called with the summarised water level once known (null when the lookup failed). */
  onLevel?: (farmId: string, level: WaterLevel | null) => void;
}) {
  const key = enabled ? farmAssessmentKey(farmId, asOf, fingerprint) : null;
  const { data, loading, error } = useQuery<FarmAssessment>(key, () => assessFarm(portfolio, farmId, asOf));
  const settled = !!key && !loading && (!!data || !!error);
  useEffect(() => {
    if (settled) onSettled?.(farmId);
  }, [settled, farmId, onSettled]);
  const level = data ? waterSummary(data.water).level : error ? null : undefined;
  useEffect(() => {
    if (settled && level !== undefined) onLevel?.(farmId, level);
  }, [settled, level, farmId, onLevel]);

  if (!enabled || (loading && !data)) {
    return (
      <span className="inline-flex text-muted" title={enabled ? 'Loading water status…' : 'Water status queued'} aria-label="Loading water status">
        <Loader2 size={16} className={enabled ? 'animate-spin' : 'opacity-40'} />
      </span>
    );
  }
  if (!data) {
    return (
      <span className="inline-flex text-muted" title={error ? `Water status unavailable: ${error.message}` : 'Water status unavailable'} aria-label="Water status unavailable">
        <HelpCircle size={16} />
      </span>
    );
  }
  const w = data.water;
  const s = waterSummary(w);
  const Icon = s.level === 'unknown' ? HelpCircle : w.abandonment.flag ? DropletOff : Droplet;
  return (
    <Popover
      label={s.label}
      trigger={
        <span className={clsx('inline-flex items-center gap-0.5 p-0.5', TONE[s.level])}>
          <Icon size={16} />
          {s.decree && <FileWarning size={14} />}
        </span>
      }
    >
      <div className="space-y-2">
        <p className="font-semibold text-ink">{s.label}</p>
        <ul className="space-y-1 text-sm text-ink">
          {s.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          <ProvenanceBadge provenance={w.supply.provenance} title="Water supply" />
          <ProvenanceBadge provenance={w.stress.provenance} title="Canopy moisture (NDMI)" />
        </div>
        <p className="text-xs text-muted">The farm page shows the full water ladder.</p>
      </div>
    </Popover>
  );
}

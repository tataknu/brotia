/**
 * "Offline snapshot of <date>" banner (CONTRACT §C). Renders nothing in live mode.
 * Shows a different message when the service is down and no snapshot has been exported.
 */
import { CloudOff, RefreshCw } from 'lucide-react';
import { snapshotPortfolios } from '@/data/api';
import { useConnection } from '@/data/hooks';
import { date } from '@/shared/format';

export function OfflineBanner() {
  const { mode, manifest, recheck } = useConnection();
  if (mode !== 'snapshot') return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-warn/30 bg-warn-soft px-4 py-2 text-sm text-warn-ink sm:px-6">
      <CloudOff size={16} className="shrink-0" />
      <span className="min-w-0 flex-1">
        {manifest
          ? `Offline snapshot of ${date(manifest.asOf)}. The service is unreachable; numbers are from the exported snapshot of ${snapshotPortfolios(manifest).map((e) => `“${e.portfolioName}”`).join(' and ')}. Edits and the farming agent need the live service.`
          : 'The service is unreachable and no offline snapshot has been exported. Start the service to see assessments.'}
      </span>
      <button type="button" onClick={recheck} className="inline-flex shrink-0 items-center gap-1 rounded-card px-2 py-1 font-medium hover:bg-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-warn/40">
        <RefreshCw size={14} />
        Retry
      </button>
    </div>
  );
}

/** Small header pill: "Live data" / "Offline snapshot of Nov 7, 2026" / "Connecting…". */
export function ConnectionPill() {
  const { mode, manifest } = useConnection();
  const cls = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium';
  if (mode === 'live')
    return (
      <span className={`${cls} bg-brand-soft text-brand-ink`}>
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Live data
      </span>
    );
  if (mode === 'snapshot')
    return (
      <span className={`${cls} bg-warn-soft text-warn-ink`}>
        <span className="h-1.5 w-1.5 rounded-full bg-warn" />
        {manifest ? `Offline snapshot of ${date(manifest.asOf)}` : 'Offline'}
      </span>
    );
  return <span className={`${cls} bg-surface text-muted`}>Connecting…</span>;
}

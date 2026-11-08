/**
 * Report states and small pieces: the source pill (live / offline snapshot), the assessing and error states, the
 * data warnings, the map legend, the tier chip and the chart card used by the tabs.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, CloudOff, Loader2, Radio, RefreshCw, TriangleAlert } from 'lucide-react';
import { ApiRequestError, NetworkError, UnavailableError } from '@/data/api';
import type { Tier } from '@/domain/types';
import { Button } from '@/shared/ui';
import { TIER_COLORS } from '@/shared/chartColors';
import { TIER_LABELS, date } from '@/shared/format';

export function SourcePill({ source, snapshotDate, asOf, loading }: { source: 'live' | 'snapshot' | undefined; snapshotDate: string | null; asOf: string | undefined; loading: boolean }) {
  const cls = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium';
  if (!source)
    return loading ? (
      <span className={`${cls} bg-surface text-muted`}>
        <Loader2 size={14} className="animate-spin" />
        Assessing…
      </span>
    ) : null;
  if (source === 'snapshot')
    return (
      <span className={`${cls} bg-warn-soft text-warn-ink`} title="The service is unreachable: numbers come from the exported snapshot.">
        <CloudOff size={14} />
        Offline snapshot of {date(snapshotDate)}
      </span>
    );
  return (
    <span className={`${cls} bg-brand-soft text-brand-ink`}>
      <Radio size={14} className="text-accent" />
      Live
      {loading && <Loader2 size={14} className="animate-spin" />}
    </span>
  );
}

export function AssessmentLoading({ farms }: { farms: number }) {
  return (
    <div role="status" className="mt-5 flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm text-muted">
      <Loader2 size={16} className="shrink-0 animate-spin text-brand" />
      <span>
        Assessing {farms} {farms === 1 ? 'farm' : 'farms'}: weather, water, imagery and disasters. A cold first run of a new portfolio can take several minutes; results are cached.
      </span>
    </div>
  );
}

export function AssessmentError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const unavailable = error instanceof UnavailableError;
  const timedOut = error instanceof NetworkError && error.timedOut;
  const title = unavailable
    ? error.reason
    : timedOut
      ? 'The service is still computing this assessment'
      : error instanceof ApiRequestError
        ? `The service could not assess this portfolio (${error.code})`
        : 'The assessment failed';
  const detail = unavailable
    ? 'The offline snapshot only covers the exported portfolio, unchanged. Start the service to assess this one.'
    : timedOut
      ? 'A cold first run fetches weather, water, imagery and disaster data for every farm and can take several minutes. The service caches what it fetched, so a retry is usually much faster.'
      : error instanceof ApiRequestError
        ? error.detail
        : error.message;
  return (
    <div role="alert" className="mt-5 flex items-start gap-3 rounded-card border border-warn/30 bg-warn-soft px-4 py-3 text-sm">
      {unavailable ? <CloudOff size={16} className="mt-0.5 shrink-0 text-warn" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-warn-ink">{title}</p>
        <p className="mt-0.5 break-words text-ink">{detail}</p>
      </div>
      <Button variant="secondary" size="sm" icon={<RefreshCw size={16} />} onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

export function Warnings({ warnings }: { warnings: string[] }) {
  return (
    <details className="group mt-6 rounded-card border border-line bg-white px-4 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-card text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
        <TriangleAlert size={16} className="text-warn" />
        {warnings.length} data {warnings.length === 1 ? 'warning' : 'warnings'}: sources that were down, stale or estimated
      </summary>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-ink">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </details>
  );
}

export function MapLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-card border border-line bg-white/95 px-3 py-2 text-xs text-ink">
      <div className="flex flex-wrap items-center gap-3">
        {(['high', 'watch', 'normal'] as Tier[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: TIER_COLORS[t].fg }} />
            {TIER_LABELS[t]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-muted">
          <span className="h-2.5 w-2.5 rounded-full border border-dashed border-muted" />
          35 km² zone
        </span>
      </div>
    </div>
  );
}

/** Tier chip: a ramp dot and the tier label, coloured text on the soft tier fill. */
export function TierChip({ tier }: { tier: Tier }) {
  const c = TIER_COLORS[tier];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-medium" style={{ background: c.bg, color: c.ink }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.fg }} aria-hidden />
      {TIER_LABELS[tier]}
    </span>
  );
}

/** Card for a report chart or list that has a tab of its own room (title, subtitle, optional actions). */
export function ChartCard({ title, subtitle, actions, children, className = '' }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`flex min-w-0 flex-col rounded-card border border-line bg-white ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className="min-h-0 flex-1 px-5 pb-5">{children}</div>
    </section>
  );
}

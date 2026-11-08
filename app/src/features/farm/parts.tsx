/** Small building blocks shared by the farm page cards. */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, CloudOff, Info, OctagonAlert, RefreshCw } from 'lucide-react';
import type { StageBand } from '@/domain/types';
import { ApiRequestError, ContractError, NetworkError, UnavailableError } from '@/data/api';
import { date } from '@/shared/format';
import { STAGE_FILLS, STAGE_INKS, datePosition, layoutStageBands, type RungTone } from './farmData';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-card bg-surface', className)} />;
}

/** Plain-language message for an API/data error (never a stack trace). */
export function errorMessage(error: Error): { title: string; detail: string; offline: boolean } {
  if (error instanceof UnavailableError) return { title: 'Not available offline', detail: error.reason, offline: true };
  if (error instanceof ApiRequestError) {
    if (error.code === 'not_found') return { title: 'The service does not know this farm', detail: error.detail, offline: false };
    return { title: 'The service could not answer', detail: error.detail || error.message, offline: false };
  }
  if (error instanceof NetworkError)
    return {
      title: error.timedOut ? 'The service took too long' : 'The service is unreachable',
      detail: error.timedOut ? 'The first request for a farm can take a while; try again in a moment.' : error.message,
      offline: !error.timedOut,
    };
  if (error instanceof ContractError) return { title: 'Unexpected response from the service', detail: error.message, offline: false };
  return { title: 'Something went wrong', detail: error.message, offline: false };
}

export function ErrorPanel({ error, onRetry, what, className }: { error: Error; onRetry?: () => void; what: string; className?: string }) {
  const m = errorMessage(error);
  const Icon = m.offline ? CloudOff : AlertTriangle;
  return (
    <div role="alert" className={clsx('flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 text-sm', className)}>
      <Icon size={18} className={clsx('mt-0.5 shrink-0', m.offline ? 'text-warn' : 'text-danger')} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">
          {what}: {m.title.toLowerCase()}
        </p>
        <p className="mt-0.5 break-words text-muted">{m.detail}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex shrink-0 items-center gap-1 rounded-card px-2 py-1 font-medium text-ink hover:bg-white">
          <RefreshCw size={14} />
          Retry
        </button>
      )}
    </div>
  );
}

export const TONE_TEXT: Record<RungTone, string> = {
  ok: 'text-brand',
  watch: 'text-warn',
  alert: 'text-danger',
  unknown: 'text-muted',
  info: 'text-[#2F5C8C]',
};

export const TONE_BG: Record<RungTone, string> = {
  ok: 'bg-brand-soft',
  watch: 'bg-warn-soft',
  alert: 'bg-danger-soft',
  unknown: 'bg-surface',
  info: 'bg-[#E8EFF7]',
};

export function ToneIcon({ tone, size = 16, className }: { tone: RungTone; size?: number; className?: string }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'watch' ? AlertTriangle : tone === 'alert' ? OctagonAlert : tone === 'info' ? Info : CircleHelp;
  return <Icon size={size} className={clsx('shrink-0', TONE_TEXT[tone], className)} aria-hidden />;
}

/**
 * Horizontal strip of stage bands on a date axis [start, end], with an optional marker (today or the selected
 * frame). Positioned by date so it lines up with a date slider of the same width.
 */
export function StageStrip({
  bands,
  start,
  end,
  marker,
  markerLabel,
  compact,
  className,
}: {
  bands: readonly StageBand[];
  start: string;
  end: string;
  marker?: string | null;
  markerLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const lay = layoutStageBands(bands, start, end, marker);
  return (
    <div className={clsx('relative w-full', className)}>
      <div className={clsx('relative w-full overflow-hidden rounded-card border border-line', compact ? 'h-5' : 'h-7')}>
        {lay.map((b) => (
          <div
            key={`${b.band.stage}-${b.band.start}`}
            title={`${b.band.label}: ${date(b.band.start)} – ${date(b.band.end)} (approximate)`}
            className={clsx('absolute inset-y-0 flex items-center overflow-hidden border-r border-white px-1.5', b.current && 'font-semibold')}
            style={{ left: `${b.left * 100}%`, width: `${b.width * 100}%`, backgroundColor: STAGE_FILLS[b.colorIndex], color: STAGE_INKS[b.colorIndex] }}
          >
            <span className={clsx('truncate', compact ? 'text-[11px]' : 'text-xs')}>{b.band.label}</span>
          </div>
        ))}
        {marker && (
          <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${datePosition(marker, start, end) * 100}% - 1px)` }} aria-label={markerLabel} />
        )}
      </div>
    </div>
  );
}

/** Section heading inside a card. */
export function SubHeading({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-ink">{children}</h4>
      {aside}
    </div>
  );
}

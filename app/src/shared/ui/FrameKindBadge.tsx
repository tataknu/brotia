/**
 * Imagery frame labels (CONTRACT §E.12, trust rule):
 * Observed · Interpolated (n days from a clear image) · AI-enhanced · Resampled, not AI.
 *
 * <FrameKindBadge frame={frame} />            kind badge, plus the SR badge when showSr and frame.srKind
 * <FrameKindBadge kind="ai" />                 a single explicit badge
 */
import clsx from 'clsx';
import { Satellite, Sparkles, Waves, Grid2x2 } from 'lucide-react';
import type { ImageryFrame } from '@/domain/types';
import { frameConfidence, frameKindLabel, srLabel, type FrameKind } from '@/shared/labels';

const STYLE: Record<FrameKind, string> = {
  observed: 'bg-brand-soft text-brand-ink',
  interpolated: 'bg-[#E8EFF7] text-[#2F5C8C]',
  ai: 'bg-[#F0EBF7] text-[#5B3F86]',
  resampled: 'bg-surface text-muted',
};

const ICON: Record<FrameKind, typeof Satellite> = { observed: Satellite, interpolated: Waves, ai: Sparkles, resampled: Grid2x2 };

function One({ kind, label, title }: { kind: FrameKind; label: string; title?: string }) {
  const Icon = ICON[kind];
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STYLE[kind])}>
      <Icon size={14} className="shrink-0" />
      {label}
    </span>
  );
}

export function FrameKindBadge({
  frame,
  kind,
  showSr = true,
  className,
}: {
  frame?: Pick<ImageryFrame, 'kind' | 'daysToClear' | 'srKind' | 'srModel'>;
  kind?: FrameKind;
  /** Also show the AI-enhanced / Resampled badge when the frame has SR (default true). */
  showSr?: boolean;
  className?: string;
}) {
  if (kind) {
    const label = kind === 'observed' ? 'Observed' : kind === 'interpolated' ? 'Interpolated' : (srLabel(kind === 'ai' ? 'ai' : 'resampled') as string);
    return (
      <span className={className}>
        <One kind={kind} label={label} />
      </span>
    );
  }
  if (!frame) return null;
  const sr = showSr ? srLabel(frame.srKind) : null;
  const conf = frame.kind === 'interpolated' ? frameConfidence(frame.daysToClear) : null;
  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-1.5', className)}>
      <One kind={frame.kind} label={frameKindLabel(frame)} title={conf ? `Confidence: ${conf}` : 'A clear Sentinel-2 acquisition on this date'} />
      {sr && (
        <One
          kind={frame.srKind === 'ai' ? 'ai' : 'resampled'}
          label={sr}
          title={frame.srKind === 'ai' ? `Display only. Model: ${frame.srModel ?? 'unknown'}. Metrics use native 10 m pixels.` : 'Plain resampling for display, not AI.'}
        />
      )}
    </span>
  );
}

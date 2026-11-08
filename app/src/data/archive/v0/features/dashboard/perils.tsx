/** Peril icons and severity visuals shared by the dashboard and farm pages. */
import clsx from 'clsx';
import { CloudHail, CloudRain, Leaf, Snowflake, Sun, ThermometerSun, type LucideIcon } from 'lucide-react';
import type { ClimateEvent, Peril } from '@/domain/types';
import { PERIL_COLORS } from '@/shared/chartColors';
import { Badge, type BadgeTone } from '@/shared/ui';

export const PERIL_ICONS: Record<Peril | 'vegetation', LucideIcon> = {
  drought: Sun,
  flood: CloudRain,
  frost: Snowflake,
  hail: CloudHail,
  heat: ThermometerSun,
  vegetation: Leaf,
};

export function PerilIcon({ peril, size = 16, className }: { peril: Peril | 'vegetation'; size?: number; className?: string }) {
  const Icon = PERIL_ICONS[peril];
  const color = PERIL_COLORS[peril];
  return (
    <span className={clsx('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full', className)} style={{ backgroundColor: `${color}1A`, color }}>
      <Icon size={size} aria-hidden />
    </span>
  );
}

const SEVERITY_TONE: Record<ClimateEvent['severity'], BadgeTone> = { moderate: 'neutral', severe: 'warn', extreme: 'danger' };
const SEVERITY_LABEL: Record<ClimateEvent['severity'], string> = { moderate: 'Moderate', severe: 'Severe', extreme: 'Extreme' };

export function SeverityPill({ severity }: { severity: ClimateEvent['severity'] }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

/** Thin horizontal bar for a 0..1 (or 0..100 with max) value. */
export function MeterBar({ value, max = 1, color, className, label }: { value: number; max?: number; color: string; className?: string; label?: string }) {
  const w = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-surface', className)} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className="h-full rounded-full" style={{ width: `${(w * 100).toFixed(1)}%`, backgroundColor: color }} />
    </div>
  );
}

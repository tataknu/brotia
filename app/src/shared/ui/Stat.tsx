import clsx from 'clsx';
import type { ReactNode } from 'react';

export type StatTone = 'neutral' | 'brand' | 'warn' | 'danger';
const TONE_TEXT: Record<StatTone, string> = { neutral: 'text-ink', brand: 'text-brand', warn: 'text-warn-ink', danger: 'text-danger-ink' };

/** KPI tile: hairline box, small muted label, the value in IBM Plex Mono with tabular figures. */
export function Stat({ label, value, sub, tone = 'neutral', icon, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: StatTone; icon?: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-card border border-line bg-white p-4', className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <div className={clsx('mt-1.5 font-mono text-2xl font-semibold tracking-tight tabular-nums', TONE_TEXT[tone])}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

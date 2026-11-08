import clsx from 'clsx';
import { CalendarClock } from 'lucide-react';
import { date } from '@/shared/format';

/**
 * "Data as of Nov 6, 2026" for one signal (CONTRACT §E.13: each signal reports its own latest date).
 * Pass `label` to name the signal ("Weather data as of …"). null → "No data".
 */
export function DataAsOf({ value, label, className }: { value: string | null | undefined; label?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-xs text-muted tabular-nums', className)}>
      <CalendarClock size={14} className="shrink-0" />
      {value ? `${label ? `${label} as of` : 'Data as of'} ${date(value)}` : `${label ?? 'Data'}: no data`}
    </span>
  );
}

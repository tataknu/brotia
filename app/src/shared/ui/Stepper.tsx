import clsx from 'clsx';
import { Check } from 'lucide-react';

export interface StepperProps {
  steps: string[];
  current: number;
  /** Highest step index the user may jump to (inclusive). Defaults to `current`. */
  maxReachable?: number;
  onSelect?: (index: number) => void;
  className?: string;
}

export function Stepper({ steps, current, maxReachable = current, onSelect, className }: StepperProps) {
  return (
    <ol className={clsx('flex flex-wrap items-center gap-x-2 gap-y-2', className)}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= maxReachable && !!onSelect;
        return (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onSelect?.(i)}
              aria-current={active ? 'step' : undefined}
              className={clsx(
                'flex items-center gap-2 rounded-card px-2 py-1 text-sm transition-colors',
                reachable && !active && 'hover:bg-surface',
                !reachable && 'cursor-default',
              )}
            >
              <span
                className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  active && 'border-brand bg-brand text-white',
                  done && 'border-brand bg-brand-soft text-brand-ink',
                  !active && !done && 'border-line bg-white text-muted',
                )}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
              <span className={clsx('whitespace-nowrap', active ? 'font-semibold text-ink' : done ? 'text-ink' : 'text-muted')}>{label}</span>
            </button>
            {i < steps.length - 1 && <span className="hidden h-px w-6 bg-line sm:block" />}
          </li>
        );
      })}
    </ol>
  );
}

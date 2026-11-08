/** Small form controls shared by the Zones, Credit and Review steps. */
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Input, Select } from '@/shared/ui';
import { MONTHS, daysInMonth, isValidMonthDay, toMonthDay } from './zoneLogic';

/**
 * Number input that keeps the typed text locally and only reports finite values inside [min, max].
 * Half-typed values ("-", "1.") never reach the store. Re-syncs when the value changes from outside.
 */
export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  id,
  className,
  invalid,
  ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  className?: string;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const n = Number(text);
  const outOfRange = text.trim() === '' || !Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max);
  return (
    <Input
      id={id}
      type="number"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      min={min}
      max={max}
      step={step}
      invalid={invalid || outOfRange}
      className={clsx('tabular-nums', className)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        setText(String(value));
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onCommit(v);
      }}
    />
  );
}

/** Accessible on/off switch. */
export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        checked ? 'border-brand bg-brand' : 'border-line bg-surface',
      )}
    >
      <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow-panel transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

const MONTH_OPTIONS = MONTHS.map((m, i) => ({ value: String(i + 1), label: m.slice(0, 3) }));

/** 'MM-DD' editor: month select + day select. */
export function MonthDayInput({ value, onChange, label }: { value: string; onChange: (md: string) => void; label: string }) {
  const [m, d] = isValidMonthDay(value) ? value.split('-').map(Number) : [1, 1];
  const dayOptions = Array.from({ length: daysInMonth(m) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  return (
    <div className="flex gap-2" role="group" aria-label={label}>
      <Select aria-label={`${label} month`} className="flex-1" options={MONTH_OPTIONS} value={String(m)} onChange={(e) => onChange(toMonthDay(Number(e.target.value), d))} />
      <Select aria-label={`${label} day`} className="w-20" options={dayOptions} value={String(Math.min(d, daysInMonth(m)))} onChange={(e) => onChange(toMonthDay(m, Number(e.target.value)))} />
    </div>
  );
}

/** Small form controls shared by the wizard steps (no leaflet). */
import clsx from 'clsx';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Badge, Input } from '@/shared/ui';
import { isMonthDay, parseNumberInput } from './parse';

/**
 * Number input that commits on blur or Enter (one audited change per edit, not per keystroke).
 * Half-typed or out-of-range values never commit; Escape restores the current value.
 */
export function CommitNumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  id,
  className,
  ariaLabel,
  disabled,
  placeholder,
  allowEmpty,
}: {
  value: number | null | undefined;
  /** Called with the parsed value (null only when allowEmpty and the field was cleared). */
  onCommit: (v: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const shown = value === null || value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(shown);
  }, [shown]);
  const parsed = parseNumberInput(text, { min, max });
  const invalid = text.trim() === '' ? !allowEmpty : parsed === null;

  const commit = () => {
    if (text.trim() === '') {
      if (allowEmpty && shown !== '') onCommit(null);
      else setText(shown);
      return;
    }
    if (parsed === null) {
      setText(shown);
      return;
    }
    if (parsed !== value) onCommit(parsed);
  };

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
      disabled={disabled}
      placeholder={placeholder}
      invalid={invalid}
      className={clsx('tabular-nums', className)}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(shown);
          focused.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

/** 'MM-DD' text input that commits on blur when valid. */
export function MonthDayInput({ value, onCommit, ariaLabel, disabled }: { value: string; onCommit: (v: string) => void; ariaLabel: string; disabled?: boolean }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const ok = isMonthDay(text);
  return (
    <Input
      aria-label={ariaLabel}
      value={text}
      placeholder="MM-DD"
      maxLength={5}
      disabled={disabled}
      invalid={!ok}
      className="w-[5.5rem] tabular-nums"
      onFocus={() => (focused.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (ok && text !== value) onCommit(text);
        else setText(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Accessible on/off switch. */
export function Toggle({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:opacity-50',
        checked ? 'border-brand bg-brand' : 'border-line bg-surface',
      )}
    >
      <span className={clsx('inline-block h-4 w-4 rounded-full bg-white shadow-panel transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  title?: string;
}

/** Segmented control (single choice). */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  size = 'md',
}: {
  value: V;
  options: SegmentOption<V>[];
  onChange: (v: V) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-card border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-[6px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
            size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            o.value === value ? 'bg-white text-ink shadow-panel' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Custom" marker with a reset button (reset = audited change with newValue null). */
export function CustomMarker({ onReset, inheritedText, resetLabel = 'Reset to inherited value' }: { onReset: () => void; inheritedText?: ReactNode; resetLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone="info">Custom</Badge>
      {inheritedText && <span className="text-xs text-muted">{inheritedText}</span>}
      <button
        type="button"
        onClick={onReset}
        title={resetLabel}
        aria-label={resetLabel}
        className="rounded-card p-1 text-muted hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <RotateCcw size={14} />
      </button>
    </span>
  );
}

import clsx from 'clsx';
import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  /** Render-prop receives the generated id to set on the control (for label association). */
  children: ReactNode | ((id: string) => ReactNode);
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={clsx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {typeof children === 'function' ? children(id) : children}
      {error ? <p className="text-xs text-danger-ink">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

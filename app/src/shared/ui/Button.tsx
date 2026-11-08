import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover border border-brand hover:border-brand-hover',
  secondary: 'border border-line bg-white text-ink hover:bg-surface',
  ghost: 'border border-transparent text-muted hover:bg-surface hover:text-ink',
  danger: 'border border-danger-ink bg-danger-ink text-white hover:opacity-90',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon element placed before the label (lucide, size 16). */
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex items-center justify-center rounded-card font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

/** Class strings for links styled as buttons (e.g. react-router <Link>). */
export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string) =>
  clsx(
    'inline-flex items-center justify-center rounded-card font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );

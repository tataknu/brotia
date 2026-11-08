import clsx from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /** Right side of the header (buttons, badges). */
  actions?: ReactNode;
  /** Remove body padding (e.g. for tables and maps). */
  flush?: boolean;
}

/** Header: when the actions do not fit beside the title (min 16rem), they wrap onto their own line. */
export function Card({ title, subtitle, actions, flush, className, children, ...rest }: CardProps) {
  const hasHeader = title || subtitle || actions;
  return (
    <div className={clsx('rounded-card border border-line bg-white', className)} {...rest}>
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-[1_1_16rem]">
            {title && <h3 className="text-[15px] font-semibold leading-6 text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={clsx(!flush && 'p-5')}>{children}</div>
    </div>
  );
}

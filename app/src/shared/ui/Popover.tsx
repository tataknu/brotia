import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Click-to-open popover rendered in a portal (z-[1100], above Leaflet), anchored under its trigger.
 * Closes on outside click and Escape.
 */
export function Popover({
  trigger,
  children,
  label,
  className,
  panelClassName,
  align = 'start',
}: {
  /** Trigger content (rendered inside a button). */
  trigger: ReactNode;
  children: ReactNode;
  /** Accessible name of the trigger button. */
  label: string;
  className?: string;
  panelClassName?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const width = panel.current?.offsetWidth ?? 288;
    const left = align === 'end' ? r.right - width : r.left;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={clsx('inline-flex items-center rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30', className)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={clsx('fixed z-[1100] w-72 rounded-card border border-line bg-white p-4 text-sm text-ink shadow-[0_1px_2px_rgba(20,26,23,0.06),0_8px_24px_rgba(20,26,23,0.12)]', panelClassName)}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}

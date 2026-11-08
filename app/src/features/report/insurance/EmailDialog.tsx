/**
 * Dialog shell for the insurance email: a pinned header (title row and the envelope), a body that scrolls, and a pinned
 * footer (the honest line and Send). Local to this feature because the shared Modal pins only a text title.
 * Same behaviour as the shared Modal: portal to <body>, z-index 1100 (above Leaflet), Escape closes, focus moves in and
 * back out. On a phone it opens as a sheet from the bottom.
 */
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function EmailDialog({
  title,
  heading,
  envelope,
  footer,
  onClose,
  scrollKey,
  children,
}: {
  /** Accessible name of the dialog. */
  title: string;
  /** Visible title row content. */
  heading: ReactNode;
  envelope: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** When it changes (e.g. compose → queued), the body scrolls back to the top. */
  scrollKey?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
  }, [scrollKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-end justify-center sm:items-center sm:p-4">
      <div className="fixed inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-0.75rem)] w-full max-w-3xl flex-col rounded-t-card border border-line bg-white shadow-panel outline-none sm:max-h-[calc(100vh-2rem)] sm:rounded-card"
      >
        <div className="shrink-0 border-b border-line">
          <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-3 sm:px-6">
            <div className="min-w-0 truncate text-xs font-medium uppercase tracking-wide text-muted">{heading}</div>
            <button
              className="-mr-1.5 rounded-card p-1.5 text-muted hover:bg-surface hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-4 pb-3 sm:px-6">{envelope}</div>
        </div>
        <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>
        <div className="shrink-0 border-t border-line px-4 py-3 sm:px-6">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

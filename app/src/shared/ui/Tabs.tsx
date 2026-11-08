/**
 * Tab bar synced to a search param (`?tab=` by default), WAI-ARIA tabs pattern with automatic activation:
 * Left/Right arrows move and select (wrapping), Home/End jump to the first/last tab, and only the selected tab
 * is in the Tab order. Used by the farm page and the portfolio report, so both look and behave the same.
 *
 *   const TABS = [{ id: 'overview', label: 'Overview' }, { id: 'risk', label: 'Risk' }] as const;
 *   const [tab, setTab] = useTabParam(TABS, 'overview');
 *   <Tabs tabs={TABS} tab={tab} onSelect={setTab} idPrefix="farm" label="Farm sections" />
 *   <TabPanel tab={tab} idPrefix="farm">…</TabPanel>
 */
import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';

export interface TabDef<T extends string = string> {
  id: T;
  label: string;
}

/* ───────────────────────── pure helpers (node-tested through the farm and report tests) ───────────────────────── */

/** The tab named by a param value (trimmed, case-insensitive); unknown or missing values fall back to `fallback`. */
export function parseTabParam<T extends string>(tabs: readonly TabDef<T>[], value: string | null | undefined, fallback: T): T {
  const v = (value ?? '').trim().toLowerCase();
  return tabs.find((t) => t.id === v)?.id ?? fallback;
}

/** Tab reached from `current` by a key of the WAI-ARIA tabs pattern, or null for any other key. */
export function tabForKeyIn<T extends string>(tabs: readonly TabDef<T>[], current: T, key: string): T | null {
  const i = Math.max(0, tabs.findIndex((t) => t.id === current));
  const n = tabs.length;
  if (n === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return tabs[(i + 1) % n].id;
    case 'ArrowLeft':
      return tabs[(i - 1 + n) % n].id;
    case 'Home':
      return tabs[0].id;
    case 'End':
      return tabs[n - 1].id;
    default:
      return null;
  }
}

export const tabElementId = (prefix: string, t: string) => `${prefix}-tab-${t}`;
export const tabPanelId = (prefix: string, t: string) => `${prefix}-panel-${t}`;

/* ───────────────────────── hook ───────────────────────── */

/**
 * The selected tab from the search param and a setter that keeps the other params and replaces the history
 * entry (switching tabs does not grow the back stack).
 */
export function useTabParam<T extends string>(tabs: readonly TabDef<T>[], fallback: T, param = 'tab'): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const tab = parseTabParam(tabs, params.get(param), fallback);
  const select = useCallback(
    (t: T) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(param, t);
          return next;
        },
        { replace: true },
      ),
    [setParams, param],
  );
  return [tab, select];
}

/* ───────────────────────── components ───────────────────────── */

export function Tabs<T extends string>({
  tabs,
  tab,
  onSelect,
  idPrefix,
  label,
  badges,
  className,
}: {
  tabs: readonly TabDef<T>[];
  tab: T;
  onSelect: (t: T) => void;
  /** Prefix of the tab and panel element ids: `<prefix>-tab-<id>`, `<prefix>-panel-<id>`. */
  idPrefix: string;
  /** Accessible name of the tab list. */
  label: string;
  badges?: Partial<Record<T, ReactNode>>;
  className?: string;
}) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = tabForKeyIn(tabs, tab, e.key);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={clsx('-mb-px flex overflow-x-auto sm:gap-1', className)}>
      {tabs.map((t) => {
        const selected = t.id === tab;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            id={tabElementId(idPrefix, t.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(t.id)}
            className={clsx(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium transition-colors sm:px-3 focus:outline-none focus-visible:rounded-t-card focus-visible:ring-2 focus-visible:ring-brand/30',
              selected ? 'border-brand text-ink' : 'border-transparent text-muted hover:border-line hover:text-ink',
            )}
          >
            {t.label}
            {badges?.[t.id]}
          </button>
        );
      })}
    </div>
  );
}

/** Panel of the selected tab (only the selected panel is rendered). */
export function TabPanel({ tab, idPrefix, children, className }: { tab: string; idPrefix: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idPrefix, tab)}
      aria-labelledby={tabElementId(idPrefix, tab)}
      tabIndex={0}
      className={clsx('focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30', className)}
    >
      {children}
    </div>
  );
}

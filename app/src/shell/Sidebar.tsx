/**
 * Shell navigation (docs/design/v1.1-ui-spec.md, Layout).
 * - variant 'rail': the desktop sidebar. 240 px with labels from 1024 px (lg), icons only from 640 px (sm) to 1024 px.
 * - variant 'drawer': the same content, always with labels, inside the mobile drawer (< 640 px).
 * Top to bottom: logo; Home, Incidents (24 h count badge, v1.4), Portfolios (+ one sub-item per stored portfolio), New portfolio; Farming agent toggle;
 * connection pill and data-as-of at the bottom.
 */
import clsx from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Bot, BriefcaseBusiness, House, Plus, Siren } from 'lucide-react';
import { useConnection } from '@/data/hooks';
import { todayUTC } from '@/domain/dates';
import { useStore } from '@/state/store';
import { BrotiaLogo } from '@/shared/brand/BrotiaLogo';
import { ConnectionPill, DataAsOf, PortfolioName, portfolioLabel } from '@/shared/ui';
import { date } from '@/shared/format';
import { sortPortfolios } from '@/features/portfolios/portfolioModel';
import { useIncidentBadge } from '@/features/incidents/useIncidentBadge';
import { routeContext } from './routeContext';

export type NavVariant = 'rail' | 'drawer';

/** Shared item look. Active = brand-soft background, brand icon. */
const itemClass = (active: boolean, variant: NavVariant) =>
  clsx(
    'group flex h-9 items-center gap-3 rounded-card px-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
    variant === 'rail' && 'max-lg:justify-center max-lg:px-0',
    active ? 'bg-brand-soft font-medium text-brand-ink' : 'text-muted hover:bg-surface hover:text-ink',
  );

const iconClass = (active: boolean) => clsx('shrink-0', active ? 'text-brand' : 'text-muted group-hover:text-ink');

/** Label that hides in the icon rail (sm..lg) but always shows in the drawer. */
function Label({ variant, children }: { variant: NavVariant; children: ReactNode }) {
  return <span className={clsx('min-w-0 truncate', variant === 'rail' && 'hidden lg:inline')}>{children}</span>;
}

/** Date the numbers on screen refer to: the snapshot's as-of offline, today (the contract's default asOf) live. */
export function useDataAsOf(): string | null {
  const { mode, manifest } = useConnection();
  if (mode === 'snapshot') return manifest?.asOf ?? null;
  if (mode === 'live') return todayUTC();
  return null;
}

/** Compact connection status for the icon rail and the mobile top bar: a dot with an accessible label. */
export function ConnectionDot({ className }: { className?: string }) {
  const { mode, manifest } = useConnection();
  const label = mode === 'live' ? 'Live data' : mode === 'snapshot' ? (manifest ? `Offline snapshot of ${date(manifest.asOf)}` : 'Offline') : 'Connecting…';
  return (
    <span title={label} className={clsx('inline-flex h-6 w-6 items-center justify-center', className)}>
      <span className={clsx('h-2 w-2 rounded-full', mode === 'live' ? 'bg-accent' : mode === 'snapshot' ? 'bg-warn' : 'bg-line')} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function SidebarNav({ variant, onNavigate, onToggleAgent }: { variant: NavVariant; onNavigate?: () => void; onToggleAgent: () => void }) {
  const { pathname } = useLocation();
  const portfolios = useStore((s) => s.portfolios);
  const agentOpen = useStore((s) => s.agentPanel.open);
  const sorted = useMemo(() => sortPortfolios(portfolios), [portfolios]);
  const ctx = routeContext(pathname);
  const asOf = useDataAsOf();
  const full = variant === 'drawer';

  const onPortfolios = pathname === '/portfolios';
  const onNew = pathname === '/portfolios/new';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={clsx('flex h-16 shrink-0 items-center px-5', !full && 'max-lg:justify-center max-lg:px-0')}>
        <Link
          to="/"
          onClick={onNavigate}
          aria-label="BrotIA home"
          className="rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
        >
          <BrotiaLogo size={26} animate wordmarkClassName={full ? undefined : 'hidden lg:flex'} />
        </Link>
      </div>

      <nav aria-label="Main" className={clsx('min-h-0 flex-1 overflow-y-auto px-3 pb-3', !full && 'max-lg:px-2')}>
        <ul className="space-y-0.5">
          <li>
            <NavLink to="/" end onClick={onNavigate} aria-label="Home" title="Home" className={({ isActive }) => itemClass(isActive, variant)}>
              {({ isActive }) => (
                <>
                  <House size={18} className={iconClass(isActive)} />
                  <Label variant={variant}>Home</Label>
                </>
              )}
            </NavLink>
          </li>
          <li>
            <IncidentsItem variant={variant} onNavigate={onNavigate} />
          </li>
          <li>
            <Link to="/portfolios" onClick={onNavigate} aria-label="Portfolios" title="Portfolios" aria-current={onPortfolios ? 'page' : undefined} className={itemClass(onPortfolios, variant)}>
              <BriefcaseBusiness size={18} className={iconClass(onPortfolios || !!ctx.portfolioId)} />
              <Label variant={variant}>Portfolios</Label>
              {sorted.length > 0 && <span className={clsx('ml-auto font-mono text-xs text-muted', !full && 'hidden lg:inline')}>{sorted.length}</span>}
            </Link>
            {sorted.length > 0 && (
              <ul className={clsx('mb-1 ml-[21px] mt-0.5 space-y-0.5 border-l border-line pl-2', !full && 'hidden lg:block')} aria-label="Your portfolios">
                {sorted.map((p) => {
                  const active = ctx.portfolioId === p.id;
                  return (
                    <li key={p.id}>
                      <Link
                        to={`/portfolios/${p.id}`}
                        onClick={onNavigate}
                        aria-current={active && !ctx.farmId ? 'page' : undefined}
                        title={portfolioLabel(p)}
                        className={clsx(
                          'block truncate rounded-card px-2.5 py-1.5 text-[13px] leading-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
                          active ? 'bg-brand-soft font-medium text-brand-ink' : 'text-muted hover:bg-surface hover:text-ink',
                        )}
                      >
                        <PortfolioName name={p.name} code={p.code} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
          <li>
            <Link to="/portfolios/new" onClick={onNavigate} aria-label="New portfolio" title="New portfolio" aria-current={onNew ? 'page' : undefined} className={itemClass(onNew, variant)}>
              <Plus size={18} className={iconClass(onNew)} />
              <Label variant={variant}>New portfolio</Label>
            </Link>
          </li>
        </ul>

        <div className="my-3 border-t border-line" />

        <button
          type="button"
          onClick={onToggleAgent}
          aria-pressed={agentOpen}
          aria-label="Farming agent"
          title={ctx.portfolioId ? 'Farming agent: ask about this portfolio' : 'Farming agent'}
          className={clsx(itemClass(agentOpen, variant), 'w-full')}
        >
          <Bot size={18} className={iconClass(agentOpen)} />
          <Label variant={variant}>Farming agent</Label>
        </button>
      </nav>

      <div className={clsx('shrink-0 border-t border-line px-5 py-4', !full && 'max-lg:flex max-lg:justify-center max-lg:px-0')}>
        <div className={clsx('flex flex-col items-start gap-2', !full && 'hidden lg:flex')}>
          <ConnectionPill />
          {asOf && <DataAsOf value={asOf} />}
        </div>
        {!full && <ConnectionDot className="lg:hidden" />}
      </div>
    </div>
  );
}

/**
 * Incidents nav item. The badge counts incidents in the last 24 h across every portfolio (same definition as the
 * report KPI and Home, ADR-0024 D7); it shows only when the count is above 0, danger when any incident is critical
 * (a restructure review or high fired), warn otherwise. In the icon rail it shrinks to a dot on the icon.
 */
function IncidentsItem({ variant, onNavigate }: { variant: NavVariant; onNavigate?: () => void }) {
  const { count, tone, probes } = useIncidentBadge();
  const full = variant === 'drawer';
  const label = count > 0 ? `Incidents, ${count} in the last 24 h` : 'Incidents';
  return (
    <>
      {probes}
      <NavLink to="/incidents" onClick={onNavigate} aria-label={label} title={label} className={({ isActive }) => itemClass(isActive, variant)}>
        {({ isActive }) => (
          <>
            <span className="relative inline-flex shrink-0">
              <Siren size={18} className={iconClass(isActive)} />
              {count > 0 && (
                <span
                  aria-hidden
                  className={clsx('absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-white', tone === 'danger' ? 'bg-danger' : 'bg-warn', full ? 'hidden' : 'lg:hidden')}
                />
              )}
            </span>
            <Label variant={variant}>Incidents</Label>
            {count > 0 && (
              <span
                data-testid="incidents-badge"
                data-tone={tone}
                aria-hidden
                className={clsx(
                  'ml-auto min-w-[1.25rem] rounded-full px-1.5 text-center font-mono text-xs font-semibold leading-5 tabular-nums',
                  tone === 'danger' ? 'bg-danger-soft text-danger-ink' : 'bg-warn-soft text-warn-ink',
                  !full && 'hidden lg:inline',
                )}
              >
                {count}
              </span>
            )}
          </>
        )}
      </NavLink>
    </>
  );
}

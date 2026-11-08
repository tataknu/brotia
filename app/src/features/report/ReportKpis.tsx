/**
 * KPI strip of the report: total outstanding, exposure-weighted portfolio risk, exposure at watch or high, and
 * "Incidents (last 24 h)" (events and credit-rule triggers dated within 24 h of the as-of). The incidents tile is
 * a button that reveals the list.
 */
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Flame, ShieldAlert } from 'lucide-react';
import type { Currency, PortfolioAssessment } from '@/domain/types';
import { riskColor } from '@/shared/chartColors';
import { CREDIT_ACTION_LABELS, PERIL_LABELS, date, money, number, pct } from '@/shared/format';
import { kpis } from '@/features/dashboard/dashboardModel';
import type { Incident, ReportTotals } from './reportModel';

const num = 'font-mono tabular-nums';

function Tile({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={clsx('rounded-card border border-line bg-white px-4 py-3', className)}>
      <p className="text-xs text-muted">{label}</p>
      <p className={clsx('mt-1 text-xl font-semibold text-ink', num)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function KpiStrip({
  a,
  totals,
  incidents,
  nearby,
  open,
  onToggle,
}: {
  a: PortfolioAssessment;
  totals: ReportTotals;
  incidents: Incident[];
  nearby: number;
  open: boolean;
  onToggle: () => void;
}) {
  const k = kpis(a);
  const events = incidents.filter((i) => i.kind === 'event').length;
  const rules = incidents.length - events;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Total outstanding" value={money(totals.outstanding, a.currency)} sub={`${totals.farms} ${totals.farms === 1 ? 'farm' : 'farms'} on ${date(a.asOf)}`} />
      <Tile
        label="Portfolio risk (exposure-weighted)"
        value={
          <span className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: riskColor(totals.weightedRisk) }} aria-hidden />
            {totals.weightedRisk === null ? '–' : number(totals.weightedRisk, 1)}
          </span>
        }
        sub="Sum of (e) in the table, 0–100"
      />
      <Tile
        label="Exposure at watch or high"
        value={money(k.stressed, a.currency)}
        sub={k.stressedShare === null ? '–' : `${pct(k.stressedShare, 1)} of the portfolio`}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="report-incidents"
        className={clsx(
          'rounded-card border px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          open ? 'border-brand bg-brand-soft' : 'border-line bg-white hover:border-brand/50 hover:bg-surface',
        )}
      >
        <span className="flex items-center justify-between gap-2 text-xs text-muted">
          Incidents (last 24 h)
          <ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} aria-hidden />
        </span>
        <span className={clsx('mt-1 block text-xl font-semibold', incidents.length > 0 ? 'text-danger-ink' : 'text-ink', num)}>{incidents.length}</span>
        <span className="mt-0.5 block text-xs text-muted">
          <span className={num}>{events}</span> {events === 1 ? 'event' : 'events'} on farms · <span className={num}>{rules}</span> credit {rules === 1 ? 'rule' : 'rules'} triggered
        </span>
      </button>
    </div>
  );
}

export function IncidentsList({ portfolioId, incidents, nearby, asOf, currency }: { portfolioId: string; incidents: Incident[]; nearby: number; asOf: string; currency: Currency }) {
  return (
    <section id="report-incidents" aria-label="Incidents in the last 24 hours" className="mt-3 rounded-card border border-line bg-white">
      <p className="border-b border-line px-4 py-2 text-xs text-muted">
        Events touching a farm that started, and credit rules that fired, within 24 h of the assessment as-of, {date(asOf)}. Credit rules are checked on the as-of.
        {nearby > 0 && (
          <>
            {' '}
            <span className={num}>{nearby}</span> more {nearby === 1 ? 'event' : 'events'} within 25 km touched no farm; they are under Recent disasters in the Risks tab.
          </>
        )}
      </p>
      {incidents.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted">No incident in the last 24 h.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {incidents.map((i) => (
            <li key={`${i.kind}:${i.id}`} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <span className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded', i.kind === 'event' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn-ink')} aria-hidden>
                {i.kind === 'event' ? <Flame size={13} /> : <ShieldAlert size={13} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-ink">
                  <span className="text-xs text-muted">{i.kind === 'event' ? (i.event ? PERIL_LABELS[i.event.kind] ?? 'Event' : 'Event') : (i.action ? CREDIT_ACTION_LABELS[i.action] : 'Credit rule')}</span>
                  {i.kind === 'credit_rule' ? (
                    <Link to={`/portfolios/${portfolioId}/farms/${i.farmIds[0]}`} className="font-medium hover:text-brand">
                      {i.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{i.title}</span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted">{i.detail}</p>
              </div>
              <div className="shrink-0 text-right text-xs">
                <p className={clsx('text-ink', num)}>{i.exposure > 0 ? money(i.exposure, currency) : '–'}</p>
                <p className={clsx('text-muted', num)}>{date(i.date, 'short')}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

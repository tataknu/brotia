/**
 * Recent disasters touching the portfolio (PortfolioAssessment.events: bbox of the farms + 25 km, 13 months,
 * affected farms and exposure filled by the service). Each event says what kind of evidence it is:
 * observed footprint, official declaration, own signal or report. Sort: most exposure or most recent.
 */
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { CloudRain, FileWarning, Flame, Snowflake, Sun, TriangleAlert, Waves, type LucideIcon } from 'lucide-react';
import type { ClimateEvent, Currency, Peril, Portfolio } from '@/domain/types';
import { Badge, ProvenanceBadge, type BadgeTone } from '@/shared/ui';
import { PERIL_LABELS, date, money } from '@/shared/format';
import { EVIDENCE_HINTS, EVIDENCE_LABELS, eventActive, sortEvents, type EventSort } from './dashboardModel';

const KIND_ICON: Partial<Record<Peril, LucideIcon>> = {
  fire: Flame,
  flood: Waves,
  declared_emergency: FileWarning,
  frost: Snowflake,
  heat: Sun,
  harvest_rain: CloudRain,
};

const EVIDENCE_TONE: Record<ClimateEvent['evidenceKind'], BadgeTone> = {
  observed_footprint: 'brand',
  official_declaration: 'info',
  own_signal: 'warn',
  narrative: 'neutral',
};

const SEVERITY_TONE: Record<ClimateEvent['severity'], BadgeTone> = { moderate: 'warn', severe: 'danger', extreme: 'danger' };

const INITIAL = 6;

export function EventsPanel({ events, portfolio, asOf, currency }: { events: readonly ClimateEvent[]; portfolio: Portfolio; asOf: string; currency: Currency }) {
  const [mode, setMode] = useState<EventSort>('exposure');
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => sortEvents(events, mode), [events, mode]);
  const shown = all ? sorted : sorted.slice(0, INITIAL);
  const farmName = (id: string) => portfolio.farms.find((f) => f.id === id)?.name ?? id;

  return (
    <div className="rounded-card border border-line bg-white shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">Recent disasters{portfolio.country === 'CL' ? ' in Chile' : ''}</h3>
          <p className="mt-0.5 text-sm text-muted">Fires, floods and official declarations within 25 km of your farms, last 13 months.</p>
        </div>
        <div className="inline-flex shrink-0 rounded-card border border-line p-0.5 text-sm" role="group" aria-label="Sort disasters">
          {(
            [
              ['exposure', 'Most exposure'],
              ['recent', 'Most recent'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
              className={clsx('rounded-[6px] px-2.5 py-1', mode === k ? 'bg-brand-soft font-medium text-brand-ink' : 'text-muted hover:text-ink')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">
          No fires, floods or declarations touch this portfolio&apos;s area in the last 13 months. If a provider was down, the warnings below say so.
        </p>
      ) : (
        <ul className="divide-y divide-line/70">
          {shown.map((e) => {
            const Icon = KIND_ICON[e.kind] ?? TriangleAlert;
            const active = eventActive(e, asOf);
            return (
              <li key={e.id} className="flex gap-3 px-5 py-3">
                <span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card', e.kind === 'fire' ? 'bg-danger-soft text-danger' : 'bg-surface text-muted')}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 font-medium text-ink">{e.title}</p>
                    <p className="shrink-0 text-right text-sm tabular-nums">
                      {e.affectedExposure > 0 ? (
                        <span className="font-medium text-ink">{money(e.affectedExposure, currency)}</span>
                      ) : (
                        <span className="text-muted">No farm affected</span>
                      )}
                    </p>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {PERIL_LABELS[e.kind] ?? e.kind} · {e.region} · {date(e.start)}
                    {e.end ? (e.end !== e.start ? ` to ${date(e.end)}` : '') : ' · ongoing'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span title={EVIDENCE_HINTS[e.evidenceKind]}>
                      <Badge tone={EVIDENCE_TONE[e.evidenceKind]}>{EVIDENCE_LABELS[e.evidenceKind]}</Badge>
                    </span>
                    <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity.charAt(0).toUpperCase() + e.severity.slice(1)}</Badge>
                    {active && <Badge tone="warn" dot>Active now</Badge>}
                    <ProvenanceBadge provenance={e.provenance} title={e.source} />
                  </div>
                  {e.affectedFarmIds.length > 0 && (
                    <p className="mt-1.5 text-xs text-muted">
                      Affects {e.affectedFarmIds.length === 1 ? 'farm' : `${e.affectedFarmIds.length} farms`}: {e.affectedFarmIds.map(farmName).join(', ')}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sorted.length > INITIAL && (
        <div className="border-t border-line px-5 py-2">
          <button type="button" className="text-sm font-medium text-brand hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${sorted.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

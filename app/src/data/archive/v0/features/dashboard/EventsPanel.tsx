import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Siren } from 'lucide-react';
import type { ClimateEvent, Currency } from '@/domain/types';
import { date, money, PERIL_LABELS } from '@/shared/format';
import { Card, EmptyState } from '@/shared/ui';
import { PerilIcon, SeverityPill } from './perils';

type EventOrder = 'exposure' | 'recent';

const ORDER_OPTIONS: { value: EventOrder; label: string }[] = [
  { value: 'exposure', label: 'Most exposure' },
  { value: 'recent', label: 'Most recent' },
];

const SEVERITY_RANK: Record<ClimateEvent['severity'], number> = { moderate: 0, severe: 1, extreme: 2 };

/** Impact on the book first (exposure, farms hit, severity), or newest first. */
function sortEvents(events: ClimateEvent[], order: EventOrder): ClimateEvent[] {
  const recent = (a: ClimateEvent, b: ClimateEvent) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start);
  return [...events].sort((a, b) =>
    order === 'recent'
      ? recent(a, b)
      : b.affectedExposure - a.affectedExposure ||
        b.affectedFarmIds.length - a.affectedFarmIds.length ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        recent(a, b),
  );
}

export function EventsPanel({
  events,
  currency,
  selectedId,
  onSelect,
  className,
}: {
  events: ClimateEvent[];
  currency: Currency;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}) {
  const [order, setOrder] = useState<EventOrder>('exposure');
  const sorted = useMemo(() => sortEvents(events, order), [events, order]);
  return (
    <Card
      title="Recent climate disasters"
      subtitle="Events that hit farms in this book, ranked by the exposure they touched. Select one to see the affected farms on the map."
      flush
      className={clsx('flex flex-col', className)}
      actions={
        events.length > 1 ? (
          <div role="group" aria-label="Sort events" className="inline-flex rounded-card border border-line bg-surface p-0.5 text-sm">
            {ORDER_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={order === o.value}
                onClick={() => setOrder(o.value)}
                className={clsx(
                  'rounded-[6px] px-2.5 py-1 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
                  order === o.value ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      {events.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<Siren size={18} />} title="No recent events" description="No drought, flood, frost, hail or heat events touched these farms in the last 24 months." />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((e) => {
            const active = e.id === selectedId;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(active ? null : e.id)}
                  className={clsx(
                    'flex w-full gap-3 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/30',
                    active ? 'bg-brand-soft/60' : 'hover:bg-surface',
                  )}
                >
                  <PerilIcon peril={e.kind} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-ink">{e.title}</p>
                      <SeverityPill severity={e.severity} />
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      {PERIL_LABELS[e.kind]} · {e.region} · {date(e.start, e.start.slice(0, 4) === e.end.slice(0, 4) ? 'short' : 'long')} – {date(e.end)}
                    </p>
                    <p className="mt-1.5 text-sm text-ink">{e.description}</p>
                    {e.affectedFarmIds.length === 0 ? (
                      <p className="mt-2 text-sm text-muted">Nearby, no farms in this book hit</p>
                    ) : (
                      <p className="mt-2 text-sm text-muted">
                        <span className="font-medium tabular-nums text-ink">{e.affectedFarmIds.length}</span> {e.affectedFarmIds.length === 1 ? 'farm' : 'farms'} affected ·{' '}
                        <span className="font-medium tabular-nums text-ink">{money(e.affectedExposure, currency)}</span> exposure
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

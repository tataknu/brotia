/**
 * Events tab: fires, floods and official declarations touching the farm's 35 km² zone over the last 13 months
 * (GET /events for the zone's bounding box; the offline snapshot answers for the exported portfolio).
 */
import { useMemo } from 'react';
import clsx from 'clsx';
import { CloudRain, FileWarning, Flame, Snowflake, Sun, TriangleAlert, Waves, type LucideIcon } from 'lucide-react';
import type { FarmAssessment, Farm, Peril, Portfolio, Zone } from '@/domain/types';
import { ZONE_RADIUS_M } from '@/domain/constants';
import { useEvents } from '@/data/hooks';
import { PERIL_LABELS, date } from '@/shared/format';
import { Badge, Card, DataAsOf, ProvenanceBadge, type BadgeTone } from '@/shared/ui';
import { EVIDENCE_HINTS, EVIDENCE_LABELS, eventActive, eventsForZone, zoneBBox } from './farmEvents';
import { ErrorPanel, Skeleton } from './parts';

const KIND_ICON: Partial<Record<Peril, LucideIcon>> = {
  fire: Flame,
  flood: Waves,
  declared_emergency: FileWarning,
  frost: Snowflake,
  heat: Sun,
  harvest_rain: CloudRain,
};

const EVIDENCE_TONE: Record<string, BadgeTone> = {
  observed_footprint: 'brand',
  official_declaration: 'info',
  own_signal: 'warn',
  narrative: 'neutral',
};

const SEVERITY_TONE: Record<string, BadgeTone> = { moderate: 'warn', severe: 'danger', extreme: 'danger' };

export function EventsTab({ portfolio, farm, assessment }: { portfolio: Portfolio; farm: Farm; assessment: FarmAssessment | undefined }) {
  const zoneId = assessment?.zoneId ?? farm.zoneId;
  const zone: Pick<Zone, 'center' | 'radiusM'> = useMemo(
    () => portfolio.zones.find((z) => z.id === zoneId) ?? { center: farm.centroid, radiusM: ZONE_RADIUS_M },
    [portfolio.zones, zoneId, farm.centroid],
  );
  const bbox = useMemo(() => zoneBBox(zone), [zone]);
  const q = useEvents(bbox, { portfolioId: portfolio.id });
  const events = useMemo(() => (q.data ? eventsForZone(q.data, zone, farm.id) : []), [q.data, zone, farm.id]);
  const asOf = assessment?.asOf ?? null;

  return (
    <Card
      title="Events in the farm's zone"
      subtitle="Fires, floods and official declarations whose area overlaps the farm's 35 km² zone (by bounding box), last 13 months."
      actions={assessment && <DataAsOf value={assessment.dataAsOf.events} label="Events" />}
      flush
    >
      {q.error && !q.data ? (
        <div className="p-5">
          <ErrorPanel error={q.error} onRetry={q.refetch} what="Events" />
        </div>
      ) : !q.data ? (
        <div className="space-y-2 p-5" aria-busy>
          {Array.from({ length: 3 }, (_, k) => (
            <Skeleton key={k} className="h-16" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No fires, floods or declarations touch this zone in the last 13 months.</p>
      ) : (
        <ul className="divide-y divide-line">
          {events.map((e) => {
            const Icon = KIND_ICON[e.kind] ?? TriangleAlert;
            const active = asOf ? eventActive(e, asOf) : false;
            return (
              <li key={e.id} className="flex gap-3 px-5 py-3">
                <span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-card', e.kind === 'fire' ? 'bg-danger-soft text-danger' : 'bg-surface text-muted')}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{e.title}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {PERIL_LABELS[e.kind] ?? e.kind} · {e.region} · <span className="font-mono tabular-nums">{date(e.start)}</span>
                    {e.end ? e.end !== e.start ? <> to <span className="font-mono tabular-nums">{date(e.end)}</span></> : '' : ' · ongoing'}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span title={EVIDENCE_HINTS[e.evidenceKind]}>
                      <Badge tone={EVIDENCE_TONE[e.evidenceKind]}>{EVIDENCE_LABELS[e.evidenceKind]}</Badge>
                    </span>
                    <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity.charAt(0).toUpperCase() + e.severity.slice(1)}</Badge>
                    {active && (
                      <Badge tone="warn" dot>
                        Active now
                      </Badge>
                    )}
                    {e.affectedFarmIds.includes(farm.id) && <Badge tone="danger">Affects this farm</Badge>}
                    <ProvenanceBadge provenance={e.provenance} title={e.source} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

import { Fragment, useMemo } from 'react';
import { CircleMarker, Polygon, Tooltip } from 'react-leaflet';
import type { Farm, FarmAssessment, Tier } from '@/domain/types';
import { CROPS, TIERS } from '@/domain/types';
import { BaseMap, farmsFeatureCollection, toLatLngs } from '@/shared/map';
import { TIER_COLORS } from '@/shared/chartColors';
import { TIER_LABELS } from '@/shared/format';

export interface DashboardMapProps {
  farms: Farm[];
  assessments: Map<string, FarmAssessment>;
  /** When set, these farms are emphasised and the rest are dimmed. */
  highlightedIds: Set<string> | null;
  onFarmClick: (farmId: string) => void;
}

function styleFor(tier: Tier, state: 'normal' | 'on' | 'dim') {
  const c = TIER_COLORS[tier].fg;
  if (state === 'on') return { color: '#FFFFFF', weight: 3, fillColor: c, fillOpacity: 0.65, opacity: 1 };
  if (state === 'dim') return { color: c, weight: 1, fillColor: c, fillOpacity: 0.12, opacity: 0.5 };
  return { color: c, weight: 2, fillColor: c, fillOpacity: 0.4, opacity: 1 };
}

export function DashboardMap({ farms, assessments, highlightedIds, onFarmClick }: DashboardMapProps) {
  const fitTo = useMemo(() => farmsFeatureCollection(farms), [farms]);
  return (
    <div className="relative h-full w-full">
      <BaseMap fitTo={fitTo} fitPadding={40}>
        {farms.map((f) => {
          const a = assessments.get(f.id);
          const tier: Tier = a?.tier ?? 'normal';
          const state = highlightedIds ? (highlightedIds.has(f.id) ? 'on' : 'dim') : 'normal';
          const tip = (
            <Tooltip sticky direction="top" offset={[0, -8]}>
              <div className="max-w-[260px] whitespace-normal py-0.5 text-ink">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TIER_COLORS[tier].fg }} />
                  <span className="font-semibold">{f.name}</span>
                </div>
                <div className="mt-0.5 text-muted">
                  {CROPS[f.crop]?.label ?? f.crop} · {TIER_LABELS[tier]}
                  {a ? ` · score ${a.score}` : ''}
                </div>
                {a?.headline && <div className="mt-1 text-ink">{a.headline}</div>}
              </div>
            </Tooltip>
          );
          const handlers = { click: () => onFarmClick(f.id) };
          const style = styleFor(tier, state);
          return (
            <Fragment key={f.id}>
              <Polygon positions={toLatLngs(f.polygon)} pathOptions={style} eventHandlers={handlers}>
                {tip}
              </Polygon>
              {/* Centroid marker keeps small fields visible and clickable at portfolio zoom. */}
              <CircleMarker
                center={[f.centroid[1], f.centroid[0]]}
                radius={state === 'on' ? 8 : 6}
                pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: TIER_COLORS[tier].fg, fillOpacity: state === 'dim' ? 0.35 : 1, opacity: state === 'dim' ? 0.5 : 1 }}
                eventHandlers={handlers}
              >
                {tip}
              </CircleMarker>
            </Fragment>
          );
        })}
      </BaseMap>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-card border border-line bg-white/95 px-3 py-2 text-sm shadow-panel">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {TIERS.map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-ink">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: TIER_COLORS[t].fg }} />
              {TIER_LABELS[t]}
            </span>
          ))}
        </div>
        {highlightedIds && <p className="mt-1 text-muted">Outlined: farms hit by the selected event</p>}
      </div>
    </div>
  );
}

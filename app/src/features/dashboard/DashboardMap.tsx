/**
 * Portfolio map: farm polygons coloured by risk tier, and the 35 km² zone circles. Lazy-loaded by
 * the portfolio report (Leaflet needs `window` at import time). Click a farm to open its page.
 */
import { useMemo } from 'react';
import { CircleMarker, Polygon, Tooltip } from 'react-leaflet';
import { activeZones, zoneColor } from '@/domain/rules';
import type { Portfolio, RankedFarm } from '@/domain/types';
import { BaseMap, ZoneCircle, farmsFeatureCollection, toLatLngs, toLeaflet } from '@/shared/map';
import { TIER_COLORS } from '@/shared/chartColors';
import { TIER_LABELS, number } from '@/shared/format';

const UNASSESSED = '#9AA59F';

export default function DashboardMap({
  portfolio,
  ranked,
  selectedFarmId,
  onSelectFarm,
  onHoverFarm,
}: {
  portfolio: Portfolio;
  ranked: readonly RankedFarm[] | undefined;
  selectedFarmId: string | null;
  onSelectFarm: (farmId: string) => void;
  onHoverFarm?: (farmId: string | null) => void;
}) {
  const byId = useMemo(() => new Map((ranked ?? []).map((r) => [r.farmId, r])), [ranked]);
  const fit = useMemo(() => farmsFeatureCollection(portfolio.farms), [portfolio.farms]);
  const zones = useMemo(() => activeZones(portfolio), [portfolio]);

  return (
    <BaseMap className="h-full w-full" fitTo={fit} fitPadding={40}>
      {zones.map((z) => (
        <ZoneCircle key={z.id} zone={z} color={zoneColor(portfolio, z)} interactive={false} label={null} />
      ))}
      {portfolio.farms.map((f) => {
        const r = byId.get(f.id);
        const color = r ? TIER_COLORS[r.tier].fg : UNASSESSED;
        const selected = f.id === selectedFarmId;
        const handlers = {
          click: () => onSelectFarm(f.id),
          mouseover: () => onHoverFarm?.(f.id),
          mouseout: () => onHoverFarm?.(null),
        };
        const tip = (
          <Tooltip direction="top" sticky>
            <span className="font-medium">{f.name}</span>
            <br />
            {r ? `${TIER_LABELS[r.tier]} · score ${number(r.score, 1)}` : 'Not assessed yet'}
          </Tooltip>
        );
        return [
          // Orchards are a few hectares: the marker keeps them visible when the map shows all of Chile.
          <CircleMarker
            key={`m:${f.id}:${r?.tier ?? 'none'}:${selected}`}
            center={toLeaflet(f.centroid)}
            radius={selected ? 9 : 7}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: color, fillOpacity: 1 }}
            eventHandlers={handlers}
          >
            {tip}
          </CircleMarker>,
          <Polygon
            key={`${f.id}:${r?.tier ?? 'none'}:${selected}`}
            positions={toLatLngs(f.polygon)}
            pathOptions={{ color: selected ? '#ffffff' : color, weight: selected ? 3 : 2, fillColor: color, fillOpacity: selected ? 0.75 : 0.55 }}
            eventHandlers={handlers}
          >
            {tip}
          </Polygon>,
        ];
      })}
    </BaseMap>
  );
}

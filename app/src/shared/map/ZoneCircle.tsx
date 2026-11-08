/**
 * Zone circles (35 km², CONTRACT §E.4). Zone.center is contract [lng, lat]; flipped for Leaflet here.
 * Auto zones (a farm's own zone) are drawn dashed and lighter; shared zones solid.
 *
 *   <ZoneCircle zone={z} color={zoneColor(portfolio, z)} selected={z.id === sel} onClick={() => select(z.id)} />
 *   <ZonesLayer portfolio={portfolio} selectedId={sel} onSelect={select} />   // activeZones() only
 */
import { useMemo } from 'react';
import { Circle, Tooltip } from 'react-leaflet';
import { activeZones, zoneColor } from '@/domain/rules';
import type { Portfolio, Zone } from '@/domain/types';
import { toLeaflet } from './tiles';

export function ZoneCircle({
  zone,
  color = '#1F6B43',
  selected,
  onClick,
  label,
  interactive = true,
}: {
  zone: Zone;
  color?: string;
  selected?: boolean;
  onClick?: (zone: Zone) => void;
  /** Tooltip text; default the zone name. Pass null for none. */
  label?: string | null;
  interactive?: boolean;
}) {
  const center = useMemo(() => toLeaflet(zone.center), [zone.center]);
  return (
    <Circle
      center={center}
      radius={zone.radiusM}
      interactive={interactive}
      pathOptions={{
        color,
        weight: selected ? 3 : zone.auto ? 1.5 : 2,
        opacity: selected ? 1 : 0.9,
        dashArray: zone.auto ? '6 6' : undefined,
        fillColor: color,
        fillOpacity: selected ? 0.16 : zone.auto ? 0.04 : 0.08,
      }}
      eventHandlers={onClick ? { click: () => onClick(zone) } : undefined}
    >
      {label !== null && (
        <Tooltip direction="top" sticky>
          {label ?? zone.name}
        </Tooltip>
      )}
    </Circle>
  );
}

export function ZonesLayer({
  portfolio,
  selectedId,
  onSelect,
  all = false,
}: {
  portfolio: Portfolio;
  selectedId?: string | null;
  onSelect?: (zone: Zone) => void;
  /** true = every zone, including auto zones no farm currently uses. Default: activeZones(). */
  all?: boolean;
}) {
  const zones = useMemo(() => (all ? portfolio.zones : activeZones(portfolio)), [portfolio, all]);
  return (
    <>
      {zones.map((z) => (
        <ZoneCircle key={z.id} zone={z} color={zoneColor(portfolio, z)} selected={z.id === selectedId} onClick={onSelect} />
      ))}
    </>
  );
}

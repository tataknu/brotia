/**
 * Small satellite map of the farm and its 35 km² zone for the Overview tab.
 * Lazy-loaded (default export): Leaflet needs `window` at import time.
 */
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { Polygon, useMap } from 'react-leaflet';
import type { Farm, Zone } from '@/domain/types';
import { BaseMap, ZoneCircle, toLatLngs, toLeaflet } from '@/shared/map';

/** Fits the view to the zone circle (or the farm when the zone is unknown), once per farm. */
function Fit({ farm, zone }: { farm: Farm; zone: Zone | undefined }) {
  const map = useMap();
  const key = `${farm.id}:${zone?.id ?? ''}`;
  useEffect(() => {
    const b = zone ? L.latLng(toLeaflet(zone.center)).toBounds(zone.radiusM * 2) : L.latLngBounds(toLatLngs(farm.polygon));
    if (b.isValid()) map.fitBounds(b, { padding: [12, 12], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

export default function FarmMiniMap({ farm, zone, zoneColor }: { farm: Farm; zone: Zone | undefined; zoneColor: string }) {
  const outline = useMemo(() => toLatLngs(farm.polygon), [farm.polygon]);
  return (
    <BaseMap className="h-full w-full" scrollWheelZoom={false}>
      <Fit farm={farm} zone={zone} />
      {zone && <ZoneCircle zone={zone} color={zoneColor} interactive={false} label={null} />}
      <Polygon positions={outline} pathOptions={{ color: '#FFFFFF', weight: 2, fillColor: '#2FA05A', fillOpacity: 0.35 }} />
    </BaseMap>
  );
}

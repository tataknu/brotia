import { useMemo } from 'react';
import type { FeatureCollection, Polygon as GeoPolygon } from 'geojson';
import { Polygon } from 'react-leaflet';
import type { Farm, Tier } from '@/domain/types';
import { BaseMap, toLatLngs } from '@/shared/map';
import { TIER_COLORS } from '@/shared/chartColors';

export function FarmMiniMap({ farm, tier }: { farm: Farm; tier: Tier }) {
  const fitTo = useMemo<FeatureCollection<GeoPolygon>>(() => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: farm.polygon }] }), [farm.polygon]);
  const c = TIER_COLORS[tier].fg;
  return (
    <BaseMap fitTo={fitTo} fitPadding={24} scrollWheelZoom={false}>
      <Polygon positions={toLatLngs(farm.polygon)} pathOptions={{ color: '#FFFFFF', weight: 2.5, fillColor: c, fillOpacity: 0.3 }} />
    </BaseMap>
  );
}

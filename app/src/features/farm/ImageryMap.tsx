/**
 * The map part of the imagery viewer. Lazy-loaded (default export): Leaflet needs `window` at import time,
 * so it must stay out of the server-rendered smoke test and the initial bundle.
 */
import { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { ImageOverlay, Polygon, useMap } from 'react-leaflet';
import type { Polygon as GeoPolygon } from '@/domain/types';
import { BaseMap, toLatLngs } from '@/shared/map';

/** Fits the map to the image box once per farm, closer than BaseMap's default (farms are a few hundred metres). */
function FitBox({ bounds }: { bounds: [[number, number], [number, number]] }) {
  const map = useMap();
  const key = bounds.flat().join(',');
  useEffect(() => {
    const b = L.latLngBounds(bounds);
    if (b.isValid()) map.fitBounds(b, { padding: [24, 24], maxZoom: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

export default function ImageryMap({
  bounds,
  polygon,
  url,
  pixelated,
  onError,
  onLoad,
}: {
  bounds: [[number, number], [number, number]];
  polygon: GeoPolygon;
  /** Resolved image URL, or null to show only the base map and the outline. */
  url: string | null;
  pixelated: boolean;
  onError: (url: string) => void;
  onLoad: (url: string) => void;
}) {
  const outline = useMemo(() => toLatLngs(polygon), [polygon]);
  return (
    <BaseMap labels={false} className="h-full w-full">
      <FitBox bounds={bounds} />
      {url && (
        <ImageOverlay
          // className is fixed at creation: remount when switching between native (pixelated) and enhanced.
          key={pixelated ? 'native' : 'enhanced'}
          url={url}
          bounds={bounds}
          className={pixelated ? 'pixelated' : undefined}
          eventHandlers={{ error: () => onError(url), load: () => onLoad(url) }}
        />
      )}
      <Polygon positions={outline} pathOptions={{ color: '#ffffff', weight: 2, fill: false, dashArray: '4 3' }} />
    </BaseMap>
  );
}

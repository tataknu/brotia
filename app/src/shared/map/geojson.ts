import type { FeatureCollection, Polygon } from 'geojson';
import type { Farm } from '@/domain/types';

/** GeoJSON polygon (lng,lat) -> Leaflet positions [lat,lng][] (outer ring, closing point dropped). */
export function toLatLngs(polygon: Polygon): [number, number][] {
  const ring = polygon.coordinates[0] ?? [];
  const pts = ring.map(([lng, lat]) => [lat, lng] as [number, number]);
  if (pts.length > 1) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  return pts;
}

/** All farm polygons as a FeatureCollection (handy for BaseMap fitTo). Returns null when empty. */
export function farmsFeatureCollection(farms: Pick<Farm, 'id' | 'polygon'>[]): FeatureCollection<Polygon> | null {
  if (farms.length === 0) return null;
  return { type: 'FeatureCollection', features: farms.map((f) => ({ type: 'Feature', id: f.id, properties: { id: f.id }, geometry: f.polygon })) };
}

import area from '@turf/area';
import centroid from '@turf/centroid';
import type { Polygon } from 'geojson';

/** Polygon area in hectares (rounded to 0.1 ha). */
export function polygonAreaHa(polygon: Polygon): number {
  const m2 = area({ type: 'Feature', properties: {}, geometry: polygon });
  return Math.round((m2 / 10_000) * 10) / 10;
}

/** Polygon centroid as [lng, lat]. */
export function polygonCentroid(polygon: Polygon): [number, number] {
  const c = centroid({ type: 'Feature', properties: {}, geometry: polygon });
  const [lng, lat] = c.geometry.coordinates;
  return [lng, lat];
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres between two [lng, lat] points (haversine). */
export function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

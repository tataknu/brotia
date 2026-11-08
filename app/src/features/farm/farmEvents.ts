/** Events tab helpers (pure, node-tested): which events touch the farm's zone, and the labels to show. */
import type { ClimateEvent, Geometry, Zone } from '@/domain/types';
import type { BBox } from '@/data/api';

const KM_PER_DEG_LAT = 111.32;

/** Bounding box [minLng, minLat, maxLng, maxLat] of a zone circle (center [lng, lat], radius in metres). */
export function zoneBBox(zone: Pick<Zone, 'center' | 'radiusM'>): BBox {
  const [lng, lat] = zone.center;
  const dLat = zone.radiusM / 1000 / KM_PER_DEG_LAT;
  const dLng = zone.radiusM / 1000 / (KM_PER_DEG_LAT * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/** Bounding box of any GeoJSON geometry, or null when it has no coordinates. */
export function geometryBBox(g: Geometry | null | undefined): BBox | null {
  if (!g) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      minX = Math.min(minX, c[0]);
      maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]);
      maxY = Math.max(maxY, c[1]);
      return;
    }
    for (const x of c) walk(x);
  };
  if (g.type === 'GeometryCollection') for (const sub of g.geometries) walk((sub as { coordinates?: unknown }).coordinates);
  else walk(g.coordinates);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

export const bboxIntersects = (a: BBox, b: BBox): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

/**
 * Events touching the zone: the service already filters GET /events by bbox, but the offline snapshot answers with
 * the whole portfolio's events, so filter again here. Events without geometry are kept only when the service
 * listed this farm as affected. Newest first.
 */
export function eventsForZone(events: readonly ClimateEvent[], zone: Pick<Zone, 'center' | 'radiusM'>, farmId: string): ClimateEvent[] {
  const box = zoneBBox(zone);
  return events
    .filter((e) => {
      if (e.affectedFarmIds.includes(farmId)) return true;
      const g = geometryBBox(e.geometry);
      return g !== null && bboxIntersects(g, box);
    })
    .sort((x, y) => y.start.localeCompare(x.start) || x.id.localeCompare(y.id));
}

/** Active on asOf: started and not ended. */
export function eventActive(e: Pick<ClimateEvent, 'start' | 'end'>, asOf: string): boolean {
  return e.start <= asOf && (e.end === null || e.end === undefined || e.end >= asOf);
}

export const EVIDENCE_LABELS: Record<ClimateEvent['evidenceKind'], string> = {
  observed_footprint: 'Observed footprint',
  official_declaration: 'Official declaration',
  own_signal: 'Own signal',
  narrative: 'Report',
};

export const EVIDENCE_HINTS: Record<ClimateEvent['evidenceKind'], string> = {
  observed_footprint: 'A mapped burned or flooded area from satellite data.',
  official_declaration: 'A government decree or emergency declaration.',
  own_signal: 'Detected by this tool from raw signals (e.g. fire hotspots); not an official footprint.',
  narrative: 'A report or activation without a mapped footprint.',
};

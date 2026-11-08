/** Pure zone helpers for the Zones & rules step (node-tested). */
import type { FeatureCollection, Polygon } from 'geojson';
import { activeZones, effectiveZoneId, farmsInZone } from '@/domain/rules';
import { autoZoneId } from '@/domain/constants';
import type { Farm, Portfolio, Zone } from '@/domain/types';
import { countLeaves } from './rulesModel';

/** Circle area in km² for a radius in metres (1 decimal). */
export function zoneAreaKm2(radiusM: number): number {
  return Math.round((Math.PI * radiusM * radiusM) / 1e5) / 10;
}

export const RADIUS_LIMITS = { min: 500, max: 20000, step: 50 } as const;

/** Square polygon bounding a circle of radiusM around [lng, lat] (for map fitting). */
export function circleBounds(center: [number, number], radiusM: number): Polygon {
  const [lng, lat] = center;
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng - dLng, lat - dLat],
        [lng + dLng, lat - dLat],
        [lng + dLng, lat + dLat],
        [lng - dLng, lat + dLat],
        [lng - dLng, lat - dLat],
      ],
    ],
  };
}

/** Geometry covering every active zone circle (null when there are none). */
export function zonesFitGeo(p: Portfolio, n = 0): FeatureCollection<Polygon> | null {
  const zones = activeZones(p);
  if (zones.length === 0) return null;
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => ({ type: 'Feature', properties: { id: z.id, n }, geometry: circleBounds(z.center, z.radiusM) })),
  };
}

/** Geometry covering one zone circle (for map fitting). */
export function zoneFitGeo(z: Pick<Zone, 'id' | 'center' | 'radiusM'>, n = 0): FeatureCollection<Polygon> {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: z.id, n }, geometry: circleBounds(z.center, z.radiusM) }] };
}

export interface ZoneRow {
  zone: Zone;
  farms: Farm[];
  /** Number of agronomic values overridden in this zone (all crops). */
  overrides: number;
  /** Auto zone whose farm currently sits inside a shared zone (its settings are not used). */
  unused: boolean;
  /** For an unused auto zone: the shared zone that captures its farm. */
  capturedBy: Zone | null;
}

/** Zones for the list: shared zones first (by name), then auto zones in farm order. */
export function zoneRows(p: Portfolio): ZoneRow[] {
  const shared = p.zones.filter((z) => !z.auto).sort((a, b) => a.name.localeCompare(b.name));
  const auto = p.farms.map((f) => p.zones.find((z) => z.id === autoZoneId(f.id))).filter((z): z is Zone => !!z);
  return [...shared, ...auto].map((zone) => {
    const farms = farmsInZone(p, zone.id);
    let capturedBy: Zone | null = null;
    if (zone.auto) {
      const farm = p.farms.find((f) => autoZoneId(f.id) === zone.id);
      const eff = farm ? effectiveZoneId(p, farm) : zone.id;
      if (eff !== zone.id) capturedBy = p.zones.find((z) => z.id === eff) ?? null;
    }
    return { zone, farms, overrides: countLeaves(zone.overrides), unused: !!capturedBy, capturedBy };
  });
}

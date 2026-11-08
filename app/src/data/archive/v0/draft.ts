/**
 * Pure draft reducers used by the store (kept pure so they are unit-testable in node).
 */
import type { Polygon } from 'geojson';
import type { Farm, Loan, Portfolio, Zone } from '@/domain/types';
import { ZONE_COLORS, makeDefaultZone } from '@/domain/defaults';
import { polygonAreaHa, polygonCentroid } from '@/domain/geo';
import { newId } from './ids';

export function emptyDraft(): Portfolio {
  return {
    id: newId('pf'),
    name: '',
    lender: '',
    currency: 'USD',
    createdAt: new Date().toISOString(),
    zones: [makeDefaultZone('Default zone', { id: newId('zone') })],
    farms: [],
  };
}

/** Lowest unused 'Farm N' name (trimmed, case-insensitive comparison). */
export function nextFarmName(farms: Pick<Farm, 'name'>[]): string {
  const taken = new Set(farms.map((f) => f.name.trim().toLowerCase()));
  let n = 1;
  while (taken.has(`farm ${n}`)) n++;
  return `Farm ${n}`;
}

export function withFarmAdded(d: Portfolio, polygon: Polygon, id = newId('farm')): Portfolio {
  const farm: Farm = {
    id,
    name: nextFarmName(d.farms),
    crop: 'soy',
    polygon,
    areaHa: polygonAreaHa(polygon),
    centroid: polygonCentroid(polygon),
    zoneId: d.zones[0]?.id ?? '',
  };
  return { ...d, farms: [...d.farms, farm] };
}

export function withFarmUpdated(d: Portfolio, id: string, patch: Partial<Omit<Farm, 'id'>>): Portfolio {
  return {
    ...d,
    farms: d.farms.map((f) => {
      if (f.id !== id) return f;
      const next: Farm = { ...f, ...patch, id: f.id };
      if (patch.polygon) {
        next.areaHa = polygonAreaHa(patch.polygon);
        next.centroid = polygonCentroid(patch.polygon);
      }
      return next;
    }),
  };
}

export function withFarmRemoved(d: Portfolio, id: string): Portfolio {
  return { ...d, farms: d.farms.filter((f) => f.id !== id) };
}

export function withZoneAdded(d: Portfolio, name: string, id = newId('zone')): Portfolio {
  const color = ZONE_COLORS[d.zones.length % ZONE_COLORS.length];
  const zone: Zone = makeDefaultZone(name, { id, color });
  return { ...d, zones: [...d.zones, zone] };
}

export function withZoneUpdated(d: Portfolio, id: string, patch: Partial<Omit<Zone, 'id'>>): Portfolio {
  return { ...d, zones: d.zones.map((z) => (z.id === id ? { ...z, ...patch, id: z.id } : z)) };
}

/** Removes a zone and reassigns its farms to the first remaining zone. The last zone cannot be removed. */
export function withZoneRemoved(d: Portfolio, id: string): Portfolio {
  if (d.zones.length <= 1 || !d.zones.some((z) => z.id === id)) return d;
  const zones = d.zones.filter((z) => z.id !== id);
  const fallback = zones[0].id;
  return { ...d, zones, farms: d.farms.map((f) => (f.zoneId === id ? { ...f, zoneId: fallback } : f)) };
}

export function withLoan(d: Portfolio, farmId: string, loan: Loan | undefined): Portfolio {
  return { ...d, farms: d.farms.map((f) => (f.id === farmId ? { ...f, loan } : f)) };
}

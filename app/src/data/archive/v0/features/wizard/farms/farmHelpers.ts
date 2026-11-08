/** Pure helpers for the Farms step (no leaflet / DOM imports, so they run in node tests). */
import type { Polygon } from 'geojson';
import type { Farm } from '@/domain/types';
import { number } from '@/shared/format';

/** Lowest "Farm N" name (N >= 1) that no other farm uses. `excludeId` ignores that farm's own name. */
export function uniqueFarmName(farms: Pick<Farm, 'id' | 'name'>[], excludeId?: string): string {
  const taken = new Set(farms.filter((f) => f.id !== excludeId).map((f) => f.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `Farm ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** True when another farm (not `id`) already uses this name (case-insensitive, trimmed). */
export function isNameTaken(farms: Pick<Farm, 'id' | 'name'>[], id: string, name: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  return farms.some((f) => f.id !== id && f.name.trim().toLowerCase() === key);
}

/** Area with exactly one decimal, e.g. 1,234.5 ha. */
export function areaLabel(ha: number): string {
  return `${number(ha, 1)} ha`;
}

/** Sum of farm areas in hectares (rounded to 0.1). */
export function totalAreaHa(farms: Pick<Farm, 'areaHa'>[]): number {
  return Math.round(farms.reduce((s, f) => s + (Number.isFinite(f.areaHa) ? f.areaHa : 0), 0) * 10) / 10;
}

/**
 * Normalizes a geometry from a drawn or edited Leaflet layer into a closed single-ring GeoJSON Polygon.
 * Returns null when the geometry is not a usable polygon (fewer than 3 distinct corners).
 */
export function normalizeDrawnPolygon(geometry: { type: string; coordinates?: unknown } | null | undefined): Polygon | null {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return null;
  const ring = (geometry.coordinates as number[][][])[0];
  if (!Array.isArray(ring)) return null;
  const pts = ring.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]);
  if (pts.length > 1) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  if (pts.length < 3) return null;
  return { type: 'Polygon', coordinates: [[...pts, [pts[0][0], pts[0][1]]]] };
}

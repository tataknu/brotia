/** Pure helpers for the Farms step (no leaflet / DOM imports, so they run in node tests). */
import type { Polygon } from 'geojson';
import type { CirenOrchardProperties, Crop, CropTemplate, Farm } from '@/domain/types';
import { CROP_META } from '@/domain/constants';
import { number } from '@/shared/format';
import type { NewFarmInput } from '@/state/portfolio';

/** Lowest "Farm N" name (N >= 1) that no other farm uses. `excludeId` ignores that farm's own name. */
export function uniqueFarmName(farms: Pick<Farm, 'id' | 'name'>[], excludeId?: string, base = 'Farm'): string {
  const taken = new Set(farms.filter((f) => f.id !== excludeId).map((f) => f.name.trim().toLowerCase()));
  if (base !== 'Farm' && !taken.has(base.trim().toLowerCase())) return base.trim();
  for (let n = base === 'Farm' ? 1 : 2; ; n++) {
    const name = `${base} ${n}`;
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

/** 'REQUÍNOA' → 'Requínoa', 'SAN FERNANDO' → 'San Fernando'. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (w.trim() && w !== '-' ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join('');
}

/** Planting year bounds for the input. */
export function plantingYearRange(today: string): { min: number; max: number } {
  return { min: 1950, max: Number(today.slice(0, 4)) + 1 };
}

/* ───────────────────────── CIREN cadastre ───────────────────────── */

export type CirenPick =
  | { kind: 'add'; input: NewFarmInput }
  | { kind: 'exists'; farmId: string }
  | { kind: 'unsupported'; message: string };

/**
 * What clicking a CIREN orchard does: add it as a farm (crop and CIREN reference prefilled), select the farm
 * that already uses it, or explain why it cannot be added (a species outside the six v1 crops).
 */
export function cirenPick(
  feature: { geometry: Polygon; properties: CirenOrchardProperties },
  farms: Pick<Farm, 'id' | 'name' | 'ciren'>[],
): CirenPick {
  const p = feature.properties;
  const existing = farms.find((f) => f.ciren && f.ciren.objectId === p.objectId && f.ciren.sourceLayer === p.sourceLayer);
  if (existing) return { kind: 'exists', farmId: existing.id };
  if (!p.crop) {
    return {
      kind: 'unsupported',
      message: `${titleCase(p.especie)} (CIREN ${p.objectId}) is not one of the six crops this version monitors.`,
    };
  }
  const polygon = normalizeDrawnPolygon(feature.geometry);
  if (!polygon) return { kind: 'unsupported', message: `CIREN ${p.objectId} has no usable polygon.` };
  const base = `${p.comuna ? `${titleCase(p.comuna)} ` : ''}${CROP_META[p.crop].label.toLowerCase()}`;
  const name = uniqueFarmName(farms, undefined, base.charAt(0).toUpperCase() + base.slice(1));
  return {
    kind: 'add',
    input: {
      polygon,
      crop: p.crop,
      name,
      ciren: { especie: p.especie, variedad: null, sourceLayer: p.sourceLayer, objectId: p.objectId },
    },
  };
}

/** Soft hint when a farm's covered flag is not declared and its crop is often under covers or nets. */
export function coverHint(crop: Crop, covered: boolean | null | undefined, template: CropTemplate | undefined): string | null {
  if (covered !== null && covered !== undefined) return null;
  if (template?.coverLikelihood === 'often')
    return `${CROP_META[crop].label} orchards are often under covers or nets, which changes what the satellite sees. Say whether this one is.`;
  if (template?.coverLikelihood === 'sometimes') return `Some ${CROP_META[crop].label.toLowerCase()} orchards are under covers or nets.`;
  return null;
}

/** Tri-state value for a nullable boolean control. */
export type TriState = 'unset' | 'yes' | 'no';
export const toTri = (v: boolean | null | undefined): TriState => (v === true ? 'yes' : v === false ? 'no' : 'unset');
export const fromTri = (t: TriState): boolean | null => (t === 'yes' ? true : t === 'no' ? false : null);

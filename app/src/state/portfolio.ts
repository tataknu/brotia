/**
 * Pure portfolio reducers used by the store (unit-tested in node). Every reducer that touches farms or
 * zones ends with syncZones(), so Farm.zoneId always follows the §E.4 rule and every farm has its auto zone.
 */
import type { Polygon } from 'geojson';
import { DEFAULT_COUNTRY, autoZoneId, slugify } from '@/domain/constants';
import { polygonAreaHa, polygonCentroid } from '@/domain/geo';
import { makeSharedZone, syncZones } from '@/domain/rules';
import type { CirenRef, Crop, Currency, Farm, Loan, Portfolio, Zone } from '@/domain/types';
import { newId } from './ids';

export function emptyPortfolio(id: string, opts?: { country?: string; currency?: Currency; now?: Date }): Portfolio {
  return {
    schemaVersion: 1,
    id,
    name: '',
    lender: '',
    country: opts?.country ?? DEFAULT_COUNTRY,
    currency: opts?.currency ?? 'USD',
    createdAt: (opts?.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    zones: [],
    farms: [],
    creditRules: [],
    cropOverrides: {},
    audit: [],
  };
}

export type PortfolioMeta = Partial<Pick<Portfolio, 'name' | 'lender' | 'country' | 'currency'>>;

/** Updates name/lender/country/currency. A currency change re-labels every loan (no FX in v1). */
export function withMeta(p: Portfolio, patch: PortfolioMeta): Portfolio {
  const next = { ...p, ...patch };
  if (patch.currency && patch.currency !== p.currency) {
    next.farms = p.farms.map((f) => (f.loan ? { ...f, loan: { ...f.loan, currency: patch.currency! } } : f));
  }
  return next;
}

/** Lowest unused 'Farm N' name (case-insensitive). */
export function nextFarmName(farms: Pick<Farm, 'name'>[]): string {
  const taken = new Set(farms.map((f) => f.name.trim().toLowerCase()));
  let n = 1;
  while (taken.has(`farm ${n}`)) n++;
  return `Farm ${n}`;
}

/** A slug id [a-z0-9-]+ unique among the portfolio's farms (and not colliding with zone ids). */
export function uniqueFarmId(p: Pick<Portfolio, 'farms' | 'zones'>, base: string): string {
  const root = slugify(base);
  const taken = new Set([...p.farms.map((f) => f.id), ...p.zones.filter((z) => !z.auto).map((z) => z.id)]);
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n++;
  return `${root}-${n}`;
}

export interface NewFarmInput {
  polygon: Polygon;
  crop?: Crop;
  name?: string;
  /** Optional explicit id (slugified and made unique). Default: from the name. */
  id?: string;
  ciren?: CirenRef | null;
  covered?: boolean | null;
  irrigatedDeclared?: boolean | null;
  plantingYear?: number | null;
  loan?: Loan | null;
}

/** Adds a farm (areaHa + centroid computed, auto zone created, zone rule applied). Returns [portfolio, farmId]. */
export function withFarmAdded(p: Portfolio, input: NewFarmInput): [Portfolio, string] {
  const name = input.name?.trim() || nextFarmName(p.farms);
  const id = uniqueFarmId(p, input.id ?? name);
  const centroid = polygonCentroid(input.polygon);
  const farm: Farm = {
    id,
    name,
    crop: input.crop ?? 'cherry',
    polygon: input.polygon,
    areaHa: polygonAreaHa(input.polygon),
    centroid,
    zoneId: autoZoneId(id),
    covered: input.covered ?? null,
    irrigatedDeclared: input.irrigatedDeclared ?? null,
    plantingYear: input.plantingYear ?? null,
    ciren: input.ciren ?? null,
    overrides: {},
    creditRuleOverrides: {},
    loan: input.loan ? { ...input.loan, currency: p.currency } : null,
  };
  return [syncZones({ ...p, farms: [...p.farms, farm] }), id];
}

export type FarmPatch = Partial<Omit<Farm, 'id' | 'areaHa' | 'centroid' | 'zoneId'>>;

/**
 * Patches a farm. A new polygon recomputes areaHa, centroid and the zone. Rule edits (overrides,
 * creditRuleOverrides, covered, irrigatedDeclared) should go through applyRuleChange to be audited.
 */
export function withFarmUpdated(p: Portfolio, id: string, patch: FarmPatch): Portfolio {
  let touched = false;
  const farms = p.farms.map((f) => {
    if (f.id !== id) return f;
    touched = true;
    const next: Farm = { ...f, ...patch, id: f.id };
    if (patch.polygon) {
      next.areaHa = polygonAreaHa(patch.polygon);
      next.centroid = polygonCentroid(patch.polygon);
    }
    if (patch.loan) next.loan = { ...patch.loan, currency: p.currency };
    return next;
  });
  if (!touched) return p;
  const next = { ...p, farms };
  // Keep the auto zone's display name in step with a renamed farm.
  if (patch.name) next.zones = p.zones.map((z) => (z.id === autoZoneId(id) && z.auto ? { ...z, name: `${patch.name} (own zone)` } : z));
  return syncZones(next);
}

/** Removes a farm and its auto zone. The audit trail keeps its history. */
export function withFarmRemoved(p: Portfolio, id: string): Portfolio {
  if (!p.farms.some((f) => f.id === id)) return p;
  return syncZones({ ...p, farms: p.farms.filter((f) => f.id !== id) });
}

/** Sets or clears a farm's loan. The loan currency follows the portfolio. */
export function withLoan(p: Portfolio, farmId: string, loan: Loan | null): Portfolio {
  return {
    ...p,
    farms: p.farms.map((f) => (f.id === farmId ? { ...f, loan: loan ? { ...loan, currency: p.currency } : null } : f)),
  };
}

/** Adds a shared 35 km² zone centred at [lng, lat]. Farms whose centroid falls inside move to it. */
export function withSharedZoneAdded(p: Portfolio, center: [number, number], opts?: { id?: string; name?: string; color?: string | null }): [Portfolio, string] {
  const id = opts?.id ?? newId('zone');
  const sharedCount = p.zones.filter((z) => !z.auto).length;
  const zone = makeSharedZone(id, opts?.name?.trim() || `Shared zone ${sharedCount + 1}`, center, opts?.color);
  return [syncZones({ ...p, zones: [...p.zones, zone] }), id];
}

export type ZonePatch = Partial<Pick<Zone, 'name' | 'center' | 'radiusM' | 'color'>>;

/**
 * Renames, recolours, moves or resizes a zone. Auto zones follow their farm: their centre and radius
 * cannot be changed. Override edits go through applyRuleChange (audited).
 */
export function withZoneUpdated(p: Portfolio, zoneId: string, patch: ZonePatch): Portfolio {
  const zone = p.zones.find((z) => z.id === zoneId);
  if (!zone) return p;
  const allowed: ZonePatch = zone.auto ? { name: patch.name, color: patch.color } : patch;
  const clean = Object.fromEntries(Object.entries(allowed).filter(([, v]) => v !== undefined)) as ZonePatch;
  return syncZones({ ...p, zones: p.zones.map((z) => (z.id === zoneId ? { ...z, ...clean, id: z.id } : z)) });
}

/** Removes a shared zone; its farms fall back to the next containing shared zone or their own auto zone. */
export function withZoneRemoved(p: Portfolio, zoneId: string): Portfolio {
  const zone = p.zones.find((z) => z.id === zoneId);
  if (!zone || zone.auto) return p;
  return syncZones({ ...p, zones: p.zones.filter((z) => z.id !== zoneId) });
}

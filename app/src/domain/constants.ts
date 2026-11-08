/**
 * v1 domain constants (app foundation). Values mirror CONTRACT.md §E and fixtures/crops.json.
 * Crop templates themselves come from GET /crops (or the offline snapshot); CROP_META is only the
 * static label/colour table the UI needs before templates load.
 */
import type { Country, Crop, Currency, Peril, RiskWeights, Tier } from './types';

/** 35 km² circle: √(35 000 000 / π) = 3337.8 m (CONTRACT §E.4). */
export const ZONE_RADIUS_M = 3338;
export const ZONE_AREA_KM2 = 35;

/** Auto zone id for a farm (CONTRACT §0 Ids). */
export const autoZoneId = (farmId: string): string => `auto-${farmId}`;
export const isAutoZoneId = (zoneId: string): boolean => zoneId.startsWith('auto-');

/** Default risk weights (ADR-0013 D6). */
export const DEFAULT_WEIGHTS: RiskWeights = { a: 0.65, b: 0.35, c: 0.3 };

/** normal < 35 ≤ watch < 60 ≤ high (CONTRACT §E.1). */
export const TIER_CUTOFFS = { watch: 35, high: 60 } as const;
export const TIER_ORDER: Record<Tier, number> = { normal: 0, watch: 1, high: 2 };

export function tierOf(score: number): Tier {
  if (score >= TIER_CUTOFFS.high) return 'high';
  if (score >= TIER_CUTOFFS.watch) return 'watch';
  return 'normal';
}

export function maxTier(a: Tier, b: Tier): Tier {
  return TIER_ORDER[a] >= TIER_ORDER[b] ? a : b;
}

/** Static crop labels and colours (same colours as fixtures/crops.json). */
export const CROP_META: Record<Crop, { label: string; labelEs: string; color: string; evergreen: boolean }> = {
  cherry: { label: 'Cherry', labelEs: 'Cerezo', color: '#A5463F', evergreen: false },
  blueberry: { label: 'Blueberry', labelEs: 'Arándano', color: '#3A5BA5', evergreen: false },
  avocado: { label: 'Avocado (Hass)', labelEs: 'Palto', color: '#5F8F3E', evergreen: true },
  walnut: { label: 'Walnut', labelEs: 'Nogal', color: '#8A6B4E', evergreen: false },
  hazelnut: { label: 'European hazelnut', labelEs: 'Avellano europeo', color: '#B89B3E', evergreen: false },
  table_grape: { label: 'Table grape', labelEs: 'Uva de mesa', color: '#7A5AA6', evergreen: false },
};

/** Which risk component each peril feeds (CONTRACT §A Peril). Geography drivers reuse frost, fire, water. */
export const PERIL_COMPONENT: Record<Peril, 'climate' | 'disaster'> = {
  frost: 'climate',
  heat: 'climate',
  harvest_rain: 'climate',
  water: 'climate',
  chill: 'climate',
  vigour: 'climate',
  abandonment: 'climate',
  fire: 'disaster',
  flood: 'disaster',
  declared_emergency: 'disaster',
};

export const CURRENCIES: Currency[] = ['USD', 'CLP'];

/** Default country of a new portfolio. */
export const DEFAULT_COUNTRY = 'CL';

/** Default map view: central Chile. [lng, lat] (contract order). Leaflet needs [lat, lng]; see shared/map/tiles.ts. */
export const DEFAULT_MAP_CENTER_LNGLAT: [number, number] = [-71.3, -34.6];
export const DEFAULT_MAP_ZOOM = 8;

/** Farm ids are slugs [a-z0-9-]+ (CONTRACT §0). */
export const FARM_ID_RE = /^[a-z0-9-]+$/;

/** Turns any name into a contract-valid slug ('Requínoa cherries' → 'requinoa-cherries'). */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'farm'
  );
}

/**
 * Static copy of GET /countries (fixtures/countries.json), used only until the service or the snapshot
 * answers, so the country picker never blocks. Reference data, not measurements.
 */
export const COUNTRIES_FALLBACK: Country[] = [
  { code: 'AR', name: 'Argentina', nameEs: 'Argentina', dataTier: 'standard', comingLater: false, center: [-64.0, -34.0], zoom: 4, defaultCurrency: 'USD' },
  { code: 'BO', name: 'Bolivia', nameEs: 'Bolivia', dataTier: 'standard', comingLater: false, center: [-64.7, -16.7], zoom: 5, defaultCurrency: 'USD' },
  { code: 'BR', name: 'Brazil', nameEs: 'Brasil', dataTier: 'standard', comingLater: false, center: [-51.9, -14.2], zoom: 4, defaultCurrency: 'USD' },
  { code: 'CL', name: 'Chile', nameEs: 'Chile', dataTier: 'enhanced', comingLater: false, center: [-71.0, -33.5], zoom: 6, defaultCurrency: 'CLP' },
  { code: 'CO', name: 'Colombia', nameEs: 'Colombia', dataTier: 'standard', comingLater: false, center: [-74.3, 4.6], zoom: 5, defaultCurrency: 'USD' },
  { code: 'EC', name: 'Ecuador', nameEs: 'Ecuador', dataTier: 'standard', comingLater: false, center: [-78.2, -1.8], zoom: 6, defaultCurrency: 'USD' },
  { code: 'GY', name: 'Guyana', nameEs: 'Guyana', dataTier: 'standard', comingLater: false, center: [-58.9, 4.9], zoom: 6, defaultCurrency: 'USD' },
  { code: 'PY', name: 'Paraguay', nameEs: 'Paraguay', dataTier: 'standard', comingLater: false, center: [-58.4, -23.4], zoom: 6, defaultCurrency: 'USD' },
  { code: 'PE', name: 'Peru', nameEs: 'Perú', dataTier: 'standard', comingLater: false, center: [-75.0, -9.2], zoom: 5, defaultCurrency: 'USD' },
  { code: 'SR', name: 'Suriname', nameEs: 'Surinam', dataTier: 'standard', comingLater: false, center: [-56.0, 3.9], zoom: 7, defaultCurrency: 'USD' },
  { code: 'UY', name: 'Uruguay', nameEs: 'Uruguay', dataTier: 'standard', comingLater: false, center: [-55.8, -32.5], zoom: 6, defaultCurrency: 'USD' },
  { code: 'VE', name: 'Venezuela', nameEs: 'Venezuela', dataTier: 'standard', comingLater: false, center: [-66.6, 6.4], zoom: 5, defaultCurrency: 'USD' },
  { code: 'GLOBAL', name: 'Global', nameEs: 'Global', dataTier: 'standard', comingLater: true, center: [0.0, 0.0], zoom: 2, defaultCurrency: 'USD' },
];

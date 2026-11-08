/**
 * Pure helpers for the report's Insurance column (v1.1, ADR-0025): which perils to request by default, the payload
 * BrotIA queues for Suyana, and the latest request per farm. No React. Every value in the payload is copied from the
 * portfolio, the service's portfolio assessment or the farm's own assessment; nothing is computed here.
 */
import { INSURANCE_PERILS } from '@/domain/types';
import type { Driver, Farm, InsurancePeril, InsuranceRequest, InsuranceRequestPayload, Peril, Portfolio, Zone } from '@/domain/types';
import type { ReportRow } from '../reportModel';

/** The insurer the outbox addresses. There is no live integration (ADR-0025). */
export const PARTNER = {
  id: 'suyana',
  name: 'Suyana',
  logo: '/partners/suyana.svg',
} as const;

/** Honest copy, used verbatim (ADR-0025 D4). */
export const COPY = {
  beforeSend: "BrotIA will queue this request for Suyana. Suyana's integration is not live yet; your team forwards it.",
  queued: (id: string) => `Request queued · ID ${id} · not yet sent to Suyana.`,
  needsLive: 'Needs the live service',
} as const;

/** Checkbox labels for the requestable perils, in INSURANCE_PERILS order. */
export const INSURANCE_PERIL_LABELS: Record<InsurancePeril, string> = {
  frost: 'Frost',
  water: 'Drought / water supply',
  harvest_rain: 'Excess rain',
  fire: 'Fire',
};

/** Drivers shown and sent: the first 3 of the service's ranked list (impact desc). */
export const TOP_DRIVERS = 3;
export const NOTE_MAX = 1000;

export function isInsurablePeril(p: Peril): p is InsurancePeril {
  return (INSURANCE_PERILS as Peril[]).includes(p);
}

export interface TopDriver {
  peril: Peril;
  text: string;
  /** Driver.metric, e.g. 'decree_active'; used only to suggest a peril, not sent. */
  metric?: string;
}

export function topDrivers(drivers: readonly Pick<Driver, 'peril' | 'text' | 'impact' | 'metric'>[]): TopDriver[] {
  return drivers
    .filter((d) => d.impact > 0)
    .slice(0, TOP_DRIVERS)
    .map((d) => ({ peril: d.peril, text: d.text, metric: d.metric }));
}

/**
 * The requestable peril a driver points to, or null. A declared emergency in v1 is always a DGA water-scarcity
 * decree (metric 'decree_active', CONTRACT §E.5), so it suggests drought / water supply.
 */
export function suggestedPeril(d: Pick<TopDriver, 'peril' | 'metric'>): InsurancePeril | null {
  if (isInsurablePeril(d.peril)) return d.peril;
  if (d.peril === 'declared_emergency' && d.metric === 'decree_active') return 'water';
  return null;
}

/** Default checked perils: those the top drivers point to, in INSURANCE_PERILS order. */
export function defaultPerils(top: readonly Pick<TopDriver, 'peril' | 'metric'>[]): InsurancePeril[] {
  const set = new Set(top.map(suggestedPeril));
  return INSURANCE_PERILS.filter((p) => set.has(p));
}

/** Top-driver perils that point to no requestable peril (e.g. abandonment), once each, in driver order. */
export function uncoveredPerils(top: readonly Pick<TopDriver, 'peril' | 'metric'>[]): Peril[] {
  const out: Peril[] = [];
  for (const d of top) if (!suggestedPeril(d) && !out.includes(d.peril)) out.push(d.peril);
  return out;
}

/** Toggle one peril, keeping INSURANCE_PERILS order. */
export function togglePeril(current: readonly InsurancePeril[], p: InsurancePeril): InsurancePeril[] {
  const set = new Set(current);
  if (set.has(p)) set.delete(p);
  else set.add(p);
  return INSURANCE_PERILS.filter((x) => set.has(x));
}

export const OWN_ZONE = 'Own zone (35 km² around the farm)';

export function zoneName(zoneId: string, zones: readonly Pick<Zone, 'id' | 'name' | 'auto'>[]): string {
  const z = zones.find((x) => x.id === zoneId);
  return z && !z.auto ? z.name : OWN_ZONE;
}

export interface PayloadInput {
  portfolio: Pick<Portfolio, 'lender' | 'name' | 'country' | 'zones'>;
  farm: Pick<Farm, 'name' | 'crop' | 'areaHa' | 'centroid' | 'loan'>;
  row: Pick<ReportRow, 'zoneId' | 'outstanding' | 'score' | 'tier'>;
  asOf: string;
  drivers: TopDriver[];
  perils: InsurancePeril[];
  note: string;
}

/** The read-only summary the modal shows and the request carries. */
export function buildPayload({ portfolio, farm, row, asOf, drivers, perils, note }: PayloadInput): InsuranceRequestPayload {
  const trimmed = note.trim().slice(0, NOTE_MAX);
  return {
    partner: 'suyana',
    lender: portfolio.lender,
    portfolioName: portfolio.name,
    farm: {
      name: farm.name,
      crop: farm.crop,
      areaHa: farm.areaHa,
      centroid: farm.centroid,
      country: portfolio.country,
      zoneId: row.zoneId,
      zoneName: zoneName(row.zoneId, portfolio.zones),
    },
    loan: farm.loan
      ? {
          currency: farm.loan.currency,
          amount: farm.loan.amount,
          outstanding: row.outstanding,
          maturityDate: farm.loan.maturityDate,
        }
      : null,
    risk: {
      asOf,
      score: row.score,
      tier: row.tier,
      drivers: drivers.slice(0, TOP_DRIVERS).map(({ peril, text }) => ({ peril, text })),
    },
    perils: [...perils],
    uncoveredPerils: uncoveredPerils(drivers),
    note: trimmed || null,
  };
}

/** Latest request per farm (by createdAt, then id). */
export function latestByFarm(requests: readonly InsuranceRequest[]): Map<string, InsuranceRequest> {
  const out = new Map<string, InsuranceRequest>();
  for (const r of requests) {
    const prev = out.get(r.farmId);
    if (!prev || r.createdAt > prev.createdAt || (r.createdAt === prev.createdAt && r.id > prev.id)) out.set(r.farmId, r);
  }
  return out;
}

/** Merge requests queued in this session with the listed ones (the list may not have refetched yet). */
export function mergeRequests(listed: readonly InsuranceRequest[] | undefined, local: readonly InsuranceRequest[]): InsuranceRequest[] {
  const seen = new Set<string>();
  const out: InsuranceRequest[] = [];
  for (const r of [...local, ...(listed ?? [])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** Display coordinates: "lat, lng" with 5 decimals (about 1 m), from a [lng, lat] centroid. */
export function latLng([lng, lat]: readonly [number, number]): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Calendar day of a UTC timestamp in the viewer's time zone, 'YYYY-MM-DD' (for the "Requested · <date>" label). */
export function localDay(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return timestamp.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

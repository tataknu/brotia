/** Portfolio-level views: aggregation, recent climate disasters, tier-change alerts. */
import type { Alert, ClimateEvent, CropType, Farm, Portfolio, PortfolioAssessment, Tier, Zone } from '@/domain/types';
import { makeDefaultZone } from '@/domain/defaults';
import { daysBetween } from '@/domain/dates';
import { outstandingAt } from '@/domain/schedule';
import { assessFarmFull } from './assess';
import { distanceKm, EVENT_DEFS, type EventDef } from './events';
import { AS_OF, getModel, SERIES_START, type EngineOptions } from './model';
import { fmt0, fmt1, fmt2, shortDate } from './text';

const FALLBACK_ZONE: Zone = makeDefaultZone('Default', { id: 'zone-fallback' });

export function zoneFor(p: Portfolio, farm: Farm): Zone {
  return p.zones.find((z) => z.id === farm.zoneId) ?? p.zones[0] ?? FALLBACK_ZONE;
}

const PA_CACHE = new WeakMap<Portfolio, PortfolioAssessment>();

export function assessPortfolioImpl(p: Portfolio, opts?: EngineOptions): PortfolioAssessment {
  const cached = opts ? undefined : PA_CACHE.get(p);
  if (cached) return cached;
  const assessments = p.farms.map((f) => assessFarmFull(f, zoneFor(p, f), opts).assessment);
  const farmById = new Map(p.farms.map((f) => [f.id, f]));
  const exposureByTier: Record<Tier, number> = { normal: 0, watch: 0, high: 0 };
  const farmsByTier: Record<Tier, number> = { normal: 0, watch: 0, high: 0 };
  const crop = new Map<CropType, { exposure: number; stressedExposure: number }>();
  const zone = new Map<string, { exposure: number; stressedExposure: number }>();
  let totalExposure = 0;
  for (const a of assessments) {
    const f = farmById.get(a.farmId)!;
    totalExposure += a.exposure;
    exposureByTier[a.tier] += a.exposure;
    farmsByTier[a.tier] += 1;
    const stressed = a.tier === 'normal' ? 0 : a.exposure;
    const c = crop.get(f.crop) ?? { exposure: 0, stressedExposure: 0 };
    c.exposure += a.exposure;
    c.stressedExposure += stressed;
    crop.set(f.crop, c);
    const zid = zoneFor(p, f).id;
    const z = zone.get(zid) ?? { exposure: 0, stressedExposure: 0 };
    z.exposure += a.exposure;
    z.stressedExposure += stressed;
    zone.set(zid, z);
  }
  const ranked = [...assessments].sort((a, b) => b.score - a.score || b.exposure - a.exposure);
  const out: PortfolioAssessment = {
    asOf: AS_OF,
    totalExposure: Math.round(totalExposure * 100) / 100,
    exposureByTier,
    farmsByTier,
    ranked,
    byCrop: [...crop.entries()].map(([c, v]) => ({ crop: c, ...v })).sort((a, b) => b.exposure - a.exposure),
    byZone: [...zone.entries()].map(([zoneId, v]) => ({ zoneId, ...v })).sort((a, b) => b.exposure - a.exposure),
  };
  if (!opts) PA_CACHE.set(p, out);
  return out;
}

// ---------------------------------------------------------------- climate events

const SEVERITY_RANK = { moderate: 0, severe: 1, extreme: 2 } as const;
type Sev = ClimateEvent['severity'];
const sevFromRank = (r: number): Sev => (r >= 2 ? 'extreme' : r >= 1 ? 'severe' : 'moderate');

function describe(def: EventDef, farms: Farm[], p: Portfolio): { description: string; severity: Sev } {
  if (farms.length === 0) {
    return { description: `${def.title} hit ${def.region}. No fields in this portfolio were inside the affected area.`, severity: def.baseSeverity };
  }
  const models = farms.map((f) => getModel(f, zoneFor(p, f)));
  const i0 = Math.max(0, daysBetween(SERIES_START, def.start));
  const i1 = Math.min(models[0].dates.length - 1, daysBetween(SERIES_START, def.end));
  const nTxt = `${farms.length} ${farms.length === 1 ? 'field' : 'fields'} in this portfolio`;
  switch (def.kind) {
    case 'drought': {
      let act = 0;
      let norm = 0;
      for (const m of models) {
        for (let i = i0; i <= i1; i++) {
          act += m.actual.precip[i];
          norm += m.bands.precip.mean[i];
        }
      }
      act /= models.length;
      norm /= models.length;
      const pct = norm > 0 ? (100 * act) / norm : 100;
      const severity: Sev = pct < 30 ? 'extreme' : pct < 55 ? 'severe' : 'moderate';
      return {
        severity,
        description: `Since ${shortDate(def.start)} the rainy season has failed to start: ${nTxt} received ${fmt0(act)} mm on average, ${fmt0(pct)}% of the ${fmt0(norm)} mm they normally get. Soils are drying out and summer sowing is being delayed.`,
      };
    }
    case 'heat': {
      let peak = -Infinity;
      let excessSum = 0;
      let count = 0;
      for (const m of models) {
        for (let i = i0; i <= i1; i++) {
          peak = Math.max(peak, m.actual.tmax[i]);
          excessSum += m.actual.tmax[i] - m.bands.tmax.mean[i];
          count += 1;
        }
      }
      const excess = count ? excessSum / count : 0;
      const severity: Sev = peak >= 40 ? 'extreme' : peak >= 38 ? 'severe' : 'moderate';
      return {
        severity,
        description: `Highs reached ${fmt1(peak)} °C across ${nTxt}, with daytime temperatures averaging ${fmt1(excess)} °C above normal for late September for nine days. The heat sped up soil drying ahead of the summer campaign.`,
      };
    }
    case 'frost': {
      let minT = Infinity;
      let nights = 0;
      for (const m of models) {
        for (let i = i0; i <= i1; i++) {
          minT = Math.min(minT, m.actual.tmin[i]);
          if (m.actual.tmin[i] <= 0) nights += 1;
        }
      }
      const severity: Sev = minT <= -2 ? 'severe' : 'moderate';
      return {
        severity,
        description: `A strong cold front (surazo) brought ${nights} frost ${nights === 1 ? 'night' : 'field-nights'} to ${nTxt}, with lows of ${fmt1(minT)} °C. Winter crops that were still green lost leaf area.`,
      };
    }
    case 'flood': {
      let max72 = 0;
      for (const m of models) {
        for (let i = Math.max(2, i0); i <= Math.min(m.dates.length - 1, i1 + 2); i++) {
          max72 = Math.max(max72, m.actual.precip[i] + m.actual.precip[i - 1] + m.actual.precip[i - 2]);
        }
      }
      const severity: Sev = max72 >= 180 ? 'extreme' : max72 >= 120 ? 'severe' : 'moderate';
      return {
        severity,
        description: `Up to ${fmt0(max72)} mm of rain fell in 72 hours on ${nTxt}, waterlogging low-lying fields close to harvest.`,
      };
    }
    case 'hail': {
      let drop = 0;
      for (const m of models) {
        if (i0 >= 1 && i0 + 1 < m.dates.length) drop = Math.max(drop, m.actual.ndvi[i0 - 1] - m.actual.ndvi[i0 + 1]);
      }
      const severity: Sev = drop >= 0.2 ? 'severe' : 'moderate';
      return {
        severity,
        description: `A convective storm with hail crossed ${nTxt} on ${shortDate(def.start)}. Crop greenness fell by up to ${fmt2(drop)} NDVI within days, a sign of leaf and stem damage.`,
      };
    }
  }
}

export function climateEventsImpl(p: Portfolio, opts?: EngineOptions): ClimateEvent[] {
  if (p.farms.length === 0) return [];
  const defs = opts?.events ?? EVENT_DEFS;
  const pa = assessPortfolioImpl(p, opts);
  const exposureOf = new Map(pa.ranked.map((a) => [a.farmId, a.exposure]));
  const out: ClimateEvent[] = [];
  for (const def of defs) {
    const scale = opts?.eventScale?.[def.id] ?? 1;
    const affected = p.farms.filter((f) => def.footprint(f.centroid[0], f.centroid[1]) * scale >= def.affectedAt);
    const regional = def.kind === 'drought' || def.kind === 'heat';
    const near = p.farms.some((f) => distanceKm(f.centroid, def.center) <= 150);
    if (affected.length === 0 && !(regional && near)) continue;
    const { description, severity } = describe(def, affected, p);
    out.push({
      id: `evt-${def.id}`,
      kind: def.kind,
      title: def.title,
      region: def.region,
      start: def.start,
      end: def.end,
      severity: affected.length ? severity : sevFromRank(Math.min(SEVERITY_RANK[def.baseSeverity], 1)),
      description,
      affectedFarmIds: affected.map((f) => f.id),
      affectedExposure: Math.round(affected.reduce((s, f) => s + (exposureOf.get(f.id) ?? (f.loan ? outstandingAt(f.loan, AS_OF) : 0)), 0) * 100) / 100,
    });
  }
  // Keep the six events with the most impact on this book (exposure, then farms hit, then severity, then recency),
  // and return them newest first. The dashboard can re-sort by exposure.
  const byImpact = [...out].sort(
    (a, b) =>
      b.affectedExposure - a.affectedExposure ||
      b.affectedFarmIds.length - a.affectedFarmIds.length ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.end.localeCompare(a.end),
  );
  return byImpact.slice(0, 6).sort((a, b) => b.end.localeCompare(a.end) || b.start.localeCompare(a.start));
}

// ---------------------------------------------------------------- alerts

const TIER_RANK: Record<Tier, number> = { normal: 0, watch: 1, high: 2 };

export function alertsImpl(p: Portfolio, opts?: EngineOptions): Alert[] {
  const out: Alert[] = [];
  for (const f of p.farms) {
    const { weekly } = assessFarmFull(f, zoneFor(p, f), opts);
    for (let i = 1; i < weekly.length; i++) {
      const from = weekly[i - 1].tier;
      const to = weekly[i].tier;
      if (from === to) continue;
      const top = weekly[i].drivers[0];
      const worse = TIER_RANK[to] > TIER_RANK[from];
      const reason = top
        ? worse
          ? top.text
          : `${to === 'normal' ? 'Back to normal' : 'Easing'} (score ${weekly[i].score}): ${top.text.charAt(0).toLowerCase()}${top.text.slice(1)}`
        : 'Conditions changed relative to this field’s normal';
      out.push({ id: `alert-${f.id}-${weekly[i].date}`, farmId: f.id, date: weekly[i].date, fromTier: from, toTier: to, reason });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.farmId.localeCompare(b.farmId));
}

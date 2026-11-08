import { describe, expect, it } from 'vitest';
import type { Farm, Portfolio } from '@/domain/types';
import { makeDefaultZone } from '@/domain/defaults';
import { outstandingAt, installmentsTotal } from '@/domain/schedule';
import { AS_OF, SERIES_START, assessFarm, assessPortfolio, getAlerts, getClimateEvents, getFarmSeries, makeSamplePortfolio } from '../api';
import { assessFarmFull, clearAssessCache } from './assess';
import { clearModelCache } from './model';
import { fieldPolygon } from './sample';
import { polygonAreaHa, polygonCentroid } from '@/domain/geo';

const p = makeSamplePortfolio();
const zoneOf = (f: Farm) => p.zones.find((z) => z.id === f.zoneId)!;
const farm = (id: string) => p.farms.find((f) => f.id === id)!;

describe('determinism', () => {
  it('rebuilds identical series and assessments from a fresh, structurally equal farm', () => {
    const f = farm('farm-lote7');
    const s1 = getFarmSeries(f, zoneOf(f));
    const a1 = assessFarm(f, zoneOf(f));
    clearModelCache();
    clearAssessCache();
    const copy: Farm = JSON.parse(JSON.stringify(f));
    expect(getFarmSeries(copy, zoneOf(f))).toEqual(s1);
    expect(assessFarm(copy, zoneOf(f))).toEqual(a1);
    expect(makeSamplePortfolio()).toEqual(p);
  });

  it('recomputes when the crop changes (memo keyed on inputs, not only the id)', () => {
    const f = farm('farm-warnes-sur');
    const a = getFarmSeries(f, zoneOf(f));
    const b = getFarmSeries({ ...f, crop: 'sorghum', sowingDate: '2026-02-15' }, zoneOf(f));
    expect(b.ndvi).not.toEqual(a.ndvi);
  });
});

describe('series', () => {
  const f = farm('farm-brecha8');
  const s = getFarmSeries(f, zoneOf(f));

  it('covers AS_OF minus 24 months to AS_OF', () => {
    for (const key of ['eto', 'precip', 'soilMoisture', 'tmax', 'tmin'] as const) {
      expect(s[key][0].date).toBe(SERIES_START);
      expect(s[key].at(-1)!.date).toBe(AS_OF);
      expect(s[key]).toHaveLength(731);
    }
    expect(s.ndvi).toHaveLength(147);
    expect(s.ndmi.map((x) => x.date)).toEqual(s.ndvi.map((x) => x.date));
    expect(s.ndvi[0].date).toBe(SERIES_START);
  });

  it('has realistic ranges and ~25-35% cloudy satellite passes', () => {
    const cloudy = s.ndvi.filter((x) => x.value === null).length / s.ndvi.length;
    expect(cloudy).toBeGreaterThan(0.15);
    expect(cloudy).toBeLessThan(0.45);
    for (const x of s.soilMoisture) expect(x.value!).toBeGreaterThanOrEqual(0.11), expect(x.value!).toBeLessThanOrEqual(0.4);
    for (const x of s.ndvi) if (x.value !== null) expect(x.value).toBeGreaterThan(0.05), expect(x.value).toBeLessThan(0.95);
    const eto = s.eto.map((x) => x.value!);
    expect(Math.min(...eto)).toBeGreaterThan(1);
    expect(Math.max(...eto)).toBeLessThan(9);
    const meanEto = eto.reduce((a, b) => a + b, 0) / eto.length;
    expect(meanEto).toBeGreaterThan(3);
    expect(meanEto).toBeLessThan(6);
    const peakNdvi = Math.max(...s.ndvi.map((x) => x.value ?? 0));
    expect(peakNdvi).toBeGreaterThan(0.7);
    for (const key of ['ndvi', 'eto', 'precip', 'soilMoisture', 'tmax', 'tmin'] as const) {
      for (const x of s[key]) {
        expect(x.p10).toBeLessThanOrEqual(x.mean + 1e-9);
        expect(x.mean).toBeLessThanOrEqual(x.p90 + 1e-9);
      }
    }
  });

  it('follows Santa Cruz seasonality (wet summer, dry winter)', () => {
    const sumMonth = (ym: string) => s.precip.filter((x) => x.date.startsWith(ym)).reduce((a, x) => a + x.mean, 0);
    expect(sumMonth('2025-01')).toBeGreaterThan(3 * sumMonth('2025-07'));
    const tmaxMonth = (ym: string) => {
      const xs = s.tmax.filter((x) => x.date.startsWith(ym));
      return xs.reduce((a, x) => a + x.mean, 0) / xs.length;
    };
    expect(tmaxMonth('2025-10')).toBeGreaterThan(tmaxMonth('2025-06') + 3);
  });

  it('keeps unstressed farms mostly inside their own baseline band', () => {
    const pa = assessPortfolio(p);
    const normal = pa.ranked.filter((a) => a.tier === 'normal');
    expect(normal.length).toBeGreaterThan(0);
    for (const a of normal) {
      const f2 = farm(a.farmId);
      const s2 = getFarmSeries(f2, zoneOf(f2));
      for (const key of ['soilMoisture', 'tmax', 'tmin', 'ndvi'] as const) {
        const pts = s2[key].filter((x) => x.value !== null);
        const inside = pts.filter((x) => x.value! >= x.p10 - 1e-9 && x.value! <= x.p90 + 1e-9).length / pts.length;
        expect(inside, `${a.farmId} ${key}`).toBeGreaterThan(0.6);
      }
    }
  });
});

describe('sample portfolio', () => {
  it('has ~12 realistic farms, 2-3 zones and mixed loans', () => {
    expect(p.farms.length).toBeGreaterThanOrEqual(10);
    expect(p.zones.length).toBeGreaterThanOrEqual(2);
    expect(p.zones.length).toBeLessThanOrEqual(3);
    expect(new Set(p.farms.map((f) => f.loan!.scheduleType)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(p.farms.map((f) => f.crop)).size).toBeGreaterThanOrEqual(5);
    for (const f of p.farms) {
      expect(f.areaHa).toBeGreaterThan(70);
      expect(f.areaHa).toBeLessThan(1250);
      expect(f.loan!.amount).toBeGreaterThanOrEqual(20_000);
      expect(f.loan!.amount).toBeLessThanOrEqual(400_000);
      expect(installmentsTotal(f.loan!.installments)).toBeCloseTo(f.loan!.amount, 2);
      expect(p.zones.some((z) => z.id === f.zoneId)).toBe(true);
      const ring = f.polygon.coordinates[0];
      expect(ring[0]).toEqual(ring.at(-1));
      // Santa Cruz soy belt bounding box.
      expect(f.centroid[0]).toBeGreaterThan(-63.5);
      expect(f.centroid[0]).toBeLessThan(-62.2);
      expect(f.centroid[1]).toBeGreaterThan(-17.9);
      expect(f.centroid[1]).toBeLessThan(-16.7);
    }
  });

  it('mixes tiers roughly 50% normal / 30% watch / 20% high', () => {
    const { farmsByTier } = assessPortfolio(p);
    expect(farmsByTier.normal).toBeGreaterThanOrEqual(5);
    expect(farmsByTier.normal).toBeLessThanOrEqual(7);
    expect(farmsByTier.watch).toBeGreaterThanOrEqual(2);
    expect(farmsByTier.high).toBeGreaterThanOrEqual(2);
    expect(farmsByTier.high).toBeLessThanOrEqual(4);
  });
});

describe('assessment', () => {
  const pa = assessPortfolio(p);

  it('scores rise monotonically with injected drought severity', () => {
    for (const id of ['farm-lote7', 'farm-brecha8', 'farm-tajibos']) {
      const f = farm(id);
      const scores = [0, 0.25, 0.5, 0.75, 1].map((s) => assessFarmFull(f, zoneOf(f), { eventScale: { 'east-drought-2026': s } }).assessment.score);
      for (let i = 1; i < scores.length; i++) expect(scores[i], `${id} ${scores.join(',')}`).toBeGreaterThanOrEqual(scores[i - 1]);
      expect(scores[4] - scores[0]).toBeGreaterThan(20);
    }
  });

  it('is consistent with the loan schedule', () => {
    let total = 0;
    for (const a of pa.ranked) {
      const f = farm(a.farmId);
      expect(a.exposure).toBeCloseTo(outstandingAt(f.loan!, AS_OF), 2);
      total += a.exposure;
      if (a.nextInstallment) expect(a.nextInstallment.dueDate > AS_OF).toBe(true);
      if (a.tier === 'normal') expect(a.installmentsInStress).toBe(0);
    }
    expect(pa.totalExposure).toBeCloseTo(total, 2);
    expect(pa.exposureByTier.normal + pa.exposureByTier.watch + pa.exposureByTier.high).toBeCloseTo(total, 2);
    expect(pa.byCrop.reduce((s, c) => s + c.exposure, 0)).toBeCloseTo(total, 2);
    expect(pa.byZone.reduce((s, c) => s + c.exposure, 0)).toBeCloseTo(total, 2);
  });

  it('explains itself in plain language, against the field’s own normal', () => {
    for (const a of pa.ranked) {
      expect(a.trend).toHaveLength(26);
      expect(a.trend.at(-1)!.date).toBe(AS_OF);
      expect(a.trend.at(-1)!.score).toBe(a.score);
      expect(a.headline.endsWith('.')).toBe(true);
      expect(/\.\s/.test(a.headline.slice(0, -1))).toBe(false);
      for (let i = 1; i < a.drivers.length; i++) expect(a.drivers[i - 1].severity).toBeGreaterThanOrEqual(a.drivers[i].severity);
      if (a.tier !== 'normal') {
        expect(a.drivers[0].severity).toBeGreaterThan(0.3);
        expect(a.drivers.some((d) => /normal|typical/.test(d.text))).toBe(true);
      }
    }
  });

  it('shows stress building up before AS_OF on high-tier farms', () => {
    for (const a of pa.ranked.filter((x) => x.tier === 'high')) {
      const earlier = Math.min(...a.trend.slice(12, 20).map((t) => t.score));
      expect(a.score - earlier, a.farmId).toBeGreaterThan(25);
    }
  });

  it('handles a user-drawn farm without a loan and with a missing zone', () => {
    const polygon = fieldPolygon('user-1', [-63.0, -17.4], [1.2, 1.0], 0);
    const f: Farm = { id: 'user-1', name: 'Drawn', crop: 'soy', polygon, areaHa: polygonAreaHa(polygon), centroid: polygonCentroid(polygon), zoneId: 'nope' };
    const port: Portfolio = { id: 'x', name: 'x', lender: 'x', currency: 'USD', createdAt: AS_OF, zones: [makeDefaultZone('Z', { id: 'z1' })], farms: [f] };
    const r = assessPortfolio(port);
    expect(r.ranked[0].exposure).toBe(0);
    expect(r.ranked[0].nextInstallment).toBeNull();
    expect(r.byZone[0].zoneId).toBe('z1');
    expect(Array.isArray(getClimateEvents(port))).toBe(true);
    expect(getClimateEvents({ ...port, farms: [] })).toEqual([]);
    expect(getAlerts({ ...port, farms: [] })).toEqual([]);
  });
});

describe('climate events and alerts', () => {
  const pa = assessPortfolio(p);
  const exp = new Map(pa.ranked.map((a) => [a.farmId, a.exposure]));

  it('lists 3-6 recent disasters, newest first, with affected exposure', () => {
    const ev = getClimateEvents(p);
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.length).toBeLessThanOrEqual(6);
    for (let i = 1; i < ev.length; i++) expect(ev[i - 1].end >= ev[i].end).toBe(true);
    for (const e of ev) {
      expect(e.affectedExposure).toBeCloseTo(e.affectedFarmIds.reduce((s, id) => s + (exp.get(id) ?? 0), 0), 2);
      expect(e.start <= e.end).toBe(true);
      expect(e.end <= AS_OF).toBe(true);
    }
    expect(new Set(ev.map((e) => e.kind))).toEqual(new Set(['drought', 'hail', 'heat', 'frost', 'flood']));
    const drought = ev.find((e) => e.kind === 'drought')!;
    expect(drought.affectedFarmIds).toContain('farm-tajibos');
    expect(drought.affectedFarmIds).not.toContain('farm-mineros-norte');
  });

  it('derives tier-change alerts, newest first', () => {
    const al = getAlerts(p);
    expect(al.length).toBeGreaterThan(3);
    for (let i = 1; i < al.length; i++) expect(al[i - 1].date >= al[i].date).toBe(true);
    for (const x of al) {
      expect(x.fromTier).not.toBe(x.toTier);
      expect(x.reason.length).toBeGreaterThan(10);
    }
    expect(al.some((x) => x.farmId === 'farm-tajibos' && x.toTier === 'high')).toBe(true);
  });
});

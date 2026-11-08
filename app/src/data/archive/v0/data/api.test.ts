import { describe, expect, it } from 'vitest';
import { AS_OF, aggregate, assessFarm, assessPortfolio, getFarmSeries, makeSamplePortfolio } from './api';

describe('data api contract shape', () => {
  const p = makeSamplePortfolio();
  const zone = p.zones[0];
  const farm = p.farms[0];

  it('series cover 24 months up to AS_OF', () => {
    const s = getFarmSeries(farm, zone);
    expect(s.precip[0].date).toBe('2024-11-06');
    expect(s.precip.at(-1)!.date).toBe(AS_OF);
    expect(s.ndvi.length).toBeGreaterThan(140);
    expect(s.ndvi.length).toBeLessThan(150);
  });

  it('is deterministic', () => {
    expect(getFarmSeries(farm, zone)).toEqual(getFarmSeries(farm, zone));
    expect(assessFarm(farm, zone)).toEqual(assessFarm(farm, zone));
  });

  it('assessment has 26 weekly trend points and portfolio ranks by score', () => {
    const a = assessFarm(farm, zone);
    expect(a.trend).toHaveLength(26);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
    const pa = assessPortfolio(p);
    expect(pa.ranked).toHaveLength(p.farms.length);
    for (let i = 1; i < pa.ranked.length; i++) expect(pa.ranked[i - 1].score).toBeGreaterThanOrEqual(pa.ranked[i].score);
  });

  it('aggregate by month sums values', () => {
    const pts = [
      { date: '2026-01-01', value: 1, mean: 1, p10: 0, p90: 2 },
      { date: '2026-01-20', value: null, mean: 1, p10: 0, p90: 2 },
      { date: '2026-02-03', value: 4, mean: 2, p10: 1, p90: 3 },
    ];
    const m = aggregate(pts, 'month', 'sum');
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ date: '2026-01-01', value: 1, mean: 2 });
    expect(aggregate(pts, 'week', 'mean')[0].date).toBe('2025-12-29');
  });
});

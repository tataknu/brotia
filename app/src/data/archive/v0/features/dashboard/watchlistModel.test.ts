import { describe, expect, it } from 'vitest';
import type { FarmAssessment, Portfolio } from '@/domain/types';
import { makeDefaultZone } from '@/domain/defaults';
import { buildRows, filterAndSort, portfolioExposure, share, DEFAULT_WATCH_FILTER } from './watchlistModel';

const poly = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const zA = makeDefaultZone('A', { id: 'zA' });
const zB = makeDefaultZone('B', { id: 'zB' });
const loan = (amount: number) => ({ originationDate: '2026-01-01', maturityDate: '2027-01-01', amount, currency: 'USD' as const, scheduleType: 'bullet' as const, installments: [{ dueDate: '2027-01-01', amount }] });

const portfolio: Portfolio = {
  id: 'p',
  name: 'P',
  lender: 'L',
  currency: 'USD',
  createdAt: '2026-11-01',
  zones: [zA, zB],
  farms: [
    { id: 'f1', name: 'One', crop: 'soy', polygon: poly, areaHa: 10, centroid: [0, 0], zoneId: 'zA', loan: loan(100) },
    { id: 'f2', name: 'Two', crop: 'maize', polygon: poly, areaHa: 20, centroid: [0, 0], zoneId: 'zB', loan: loan(300) },
    { id: 'f3', name: 'Three', crop: 'soy', polygon: poly, areaHa: 30, centroid: [0, 0], zoneId: 'zB' },
  ],
};

const a = (farmId: string, score: number, tier: FarmAssessment['tier'], exposure: number): FarmAssessment => ({
  farmId,
  score,
  tier,
  headline: '',
  drivers: [],
  perils: { drought: 0, flood: 0, frost: 0, hail: 0, heat: 0 },
  trend: [],
  exposure,
  nextInstallment: null,
  installmentsInStress: 0,
  inStressWindow: false,
});

const ranked = [a('f1', 80, 'high', 100), a('f3', 50, 'watch', 0), a('ghost', 40, 'watch', 5), a('f2', 10, 'normal', 300)];

describe('watchlist', () => {
  it('joins rows, skips unknown farms and ranks 1..n', () => {
    const rows = buildRows(portfolio, ranked);
    expect(rows.map((r) => [r.rank, r.farm.id, r.zone?.id])).toEqual([
      [1, 'f1', 'zA'],
      [2, 'f3', 'zB'],
      [3, 'f2', 'zB'],
    ]);
  });

  it('filters by tier, crop and zone', () => {
    const rows = buildRows(portfolio, ranked);
    expect(filterAndSort(rows, { ...DEFAULT_WATCH_FILTER, crop: 'soy' }).map((r) => r.farm.id)).toEqual(['f1', 'f3']);
    expect(filterAndSort(rows, { ...DEFAULT_WATCH_FILTER, zoneId: 'zB', tier: 'normal' }).map((r) => r.farm.id)).toEqual(['f2']);
  });

  it('sorts by exposure desc', () => {
    const rows = buildRows(portfolio, ranked);
    expect(filterAndSort(rows, { ...DEFAULT_WATCH_FILTER, sortBy: 'exposure' }).map((r) => r.farm.id)).toEqual(['f2', 'f1', 'f3']);
  });

  it('sums outstanding exposure and guards shares', () => {
    expect(portfolioExposure(portfolio, '2026-11-06')).toBe(400);
    expect(portfolioExposure(portfolio, '2025-01-01')).toBe(0);
    expect(share(1, 0)).toBe(0);
    expect(share(1, 4)).toBe(0.25);
  });
});

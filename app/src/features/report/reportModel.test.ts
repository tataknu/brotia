import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { ClimateEvent, Portfolio, PortfolioAssessment, RankedFarm, Tier } from '@/domain/types';

const scoreTier = (score: number): Tier => (score >= 60 ? 'high' : score >= 35 ? 'watch' : 'normal');
import {
  DEFAULT_SORT,
  incidents,
  installmentsByMonth,
  nearbyEventCount,
  nextSort,
  reportRows,
  reportTotals,
  scoreBins,
  sortRows,
  tierMix,
  withinWindow,
  CIREN_LAYER_REGION,
  DEFAULT_REPORT_TAB,
  NO_REGION,
  OWN_ZONES,
  REPORT_TABS,
  cropProfile,
  driverSummary,
  emptyProbes,
  exposureByCrop,
  exposureByRegion,
  exposureByZone,
  farmRegion,
  farmsByRegion,
  farmsByZone,
  median,
  planOf,
  probesFor,
  recordCoverage,
  recordProbe,
  stageMix,
  upcomingInstallments,
  waterReport,
  type FarmProbe,
} from './reportModel';
import { parseTabParam, tabForKeyIn } from '@/shared/ui/Tabs';

const a = loadFixture<PortfolioAssessment>('assessment-portfolio.json');
const portfolio = loadFixture<Portfolio>('portfolio-sample.json');

const farm = (id: string, score: number, exposure: number, extra: Partial<RankedFarm> = {}): RankedFarm => ({
  farmId: id,
  name: id.toUpperCase(),
  crop: 'cherry',
  zoneId: `auto-${id}`,
  score,
  tier: scoreTier(score),
  exposure,
  headline: '',
  stage: { key: 'bloom', label: 'Bloom' },
  nextInstallment: null,
  ...extra,
});

// Service order: score desc, ties exposure desc.
const synth = {
  ranked: [
    farm('c', 72, 100_000, { nextInstallment: { dueDate: '2027-03-01', amount: 10 } }),
    farm('a', 40, 300_000, { nextInstallment: { dueDate: '2026-12-01', amount: 10 } }),
    farm('b', 10, 600_000),
  ],
  creditActions: [
    { farmId: 'a', ruleId: 'r1', action: 'watch' as const, message: 'm1' },
    { farmId: 'c', ruleId: 'r2', action: 'field_visit' as const, message: 'm2' },
    { farmId: 'c', ruleId: 'r3', action: 'restructure_review' as const, message: 'm3' },
  ],
};

describe('report rows and totals', () => {
  const rows = reportRows(synth);
  const t = reportTotals(rows);

  it('computes the share of portfolio (c) and weighted risk (e) = (c)×(d)', () => {
    expect(rows.map((r) => r.share)).toEqual([0.1, 0.3, 0.6]);
    expect(rows[0].weighted).toBeCloseTo(7.2, 10);
    expect(rows[1].weighted).toBeCloseTo(12, 10);
    expect(rows[2].weighted).toBeCloseTo(6, 10);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('totals outstanding, 100 % and the exposure-weighted risk', () => {
    expect(t.outstanding).toBe(1_000_000);
    expect(t.share).toBe(1);
    // Σ(e) = (72·100k + 40·300k + 10·600k) / 1M = 25.2
    expect(t.weightedRisk).toBeCloseTo(25.2, 10);
    expect(t.weightedRisk).toBeCloseTo(rows.reduce((s, r) => s + r.outstanding * r.score, 0) / t.outstanding, 10);
    expect(t.actions).toBe(3);
  });

  it('orders a farm’s credit actions most serious first', () => {
    expect(rows[0].actions).toEqual(['restructure_review', 'field_visit']);
    expect(rows[2].actions).toEqual([]);
  });

  it('gives null shares and risk when nothing is outstanding', () => {
    const z = reportRows({ ranked: [farm('x', 50, 0), farm('y', 20, 0)], creditActions: [] });
    expect(z.map((r) => [r.share, r.weighted])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(reportTotals(z)).toMatchObject({ outstanding: 0, share: null, weightedRisk: null });
  });

  it('matches the service total on the contract fixture', () => {
    const fr = reportRows(a);
    const ft = reportTotals(fr);
    expect(ft.outstanding).toBe(a.totalExposure);
    expect(fr.reduce((s, r) => s + (r.share ?? 0), 0)).toBeCloseTo(1, 12);
    // (58.6·120k + 13.4·120k) / 240k = 36
    expect(ft.weightedRisk).toBeCloseTo(36, 10);
  });
});

describe('sorting', () => {
  const rows = reportRows(synth);
  const ids = (key: Parameters<typeof nextSort>[1], dir: 'asc' | 'desc') => sortRows(rows, { key, dir }).map((r) => r.farmId);

  it('defaults to the service ranking', () => {
    expect(sortRows(rows, DEFAULT_SORT).map((r) => r.farmId)).toEqual(['c', 'a', 'b']);
  });
  it('sorts by every column in both directions', () => {
    expect(ids('outstanding', 'desc')).toEqual(['b', 'a', 'c']);
    expect(ids('outstanding', 'asc')).toEqual(['c', 'a', 'b']);
    expect(ids('share', 'desc')).toEqual(['b', 'a', 'c']);
    expect(ids('score', 'asc')).toEqual(['b', 'a', 'c']);
    expect(ids('weighted', 'desc')).toEqual(['a', 'c', 'b']);
    expect(ids('farm', 'asc')).toEqual(['a', 'b', 'c']);
    expect(ids('farm', 'desc')).toEqual(['c', 'b', 'a']);
  });
  it('keeps rows without an installment or action last in both directions', () => {
    expect(ids('installment', 'asc')).toEqual(['a', 'c', 'b']);
    expect(ids('installment', 'desc')).toEqual(['c', 'a', 'b']);
    expect(ids('action', 'asc')).toEqual(['c', 'a', 'b']);
    expect(ids('action', 'desc')).toEqual(['a', 'c', 'b']);
  });
  it('does not change the totals', () => {
    expect(reportTotals(sortRows(rows, { key: 'farm', dir: 'desc' }))).toEqual(reportTotals(rows));
  });
  it('toggles direction on the same column and starts amounts descending', () => {
    expect(nextSort(DEFAULT_SORT, 'outstanding')).toEqual({ key: 'outstanding', dir: 'desc' });
    expect(nextSort({ key: 'outstanding', dir: 'desc' }, 'outstanding')).toEqual({ key: 'outstanding', dir: 'asc' });
    expect(nextSort({ key: 'outstanding', dir: 'desc' }, 'farm')).toEqual({ key: 'farm', dir: 'asc' });
  });
});

describe('incidents in the last 24 h', () => {
  it('keeps the as-of day and the day before, never the future', () => {
    expect(withinWindow('2026-11-07', '2026-11-07')).toBe(true);
    expect(withinWindow('2026-11-06', '2026-11-07')).toBe(true);
    expect(withinWindow('2026-11-05', '2026-11-07')).toBe(false);
    expect(withinWindow('2026-11-08', '2026-11-07')).toBe(false);
    expect(withinWindow('2026-11-06T22:00:00Z', '2026-11-07')).toBe(true);
    expect(withinWindow('2026-11-04', '2026-11-07', 72)).toBe(true);
  });

  const ev = (id: string, start: string, exposure = 0): ClimateEvent => ({
    ...(a.events[0] as ClimateEvent),
    id,
    start,
    title: id,
    affectedExposure: exposure,
    affectedFarmIds: exposure > 0 ? ['a'] : [],
  });

  it('lists recent events and every fired credit rule, dated the as-of', () => {
    const list = incidents({
      asOf: '2026-11-07',
      ranked: synth.ranked,
      creditActions: synth.creditActions,
      events: [ev('old', '2026-11-01'), ev('yesterday', '2026-11-06', 5), ev('today', '2026-11-07', 9)],
    });
    expect(list.filter((i) => i.kind === 'event').map((i) => i.id)).toEqual(['today', 'yesterday']);
    expect(list.find((i) => i.id === 'today')).toMatchObject({ farmIds: ['a'], detail: expect.stringContaining('affects A') });
    const rules = list.filter((i) => i.kind === 'credit_rule');
    expect(rules).toHaveLength(3);
    expect(rules.every((i) => i.date === '2026-11-07')).toBe(true);
    expect(rules.find((i) => i.id === 'c:r3')).toMatchObject({ title: 'C', exposure: 100_000, action: 'restructure_review' });
    // newest first, then most exposure
    expect(list[0].date).toBe('2026-11-07');
    expect(list[list.length - 1].id).toBe('yesterday');
  });

  it('leaves out events that touch no farm unless asked, and counts them as nearby', () => {
    const input = {
      asOf: '2026-11-07',
      ranked: synth.ranked,
      creditActions: [],
      events: [ev('hit', '2026-11-07', 9), ev('nearby', '2026-11-07'), ev('old-nearby', '2026-10-01')],
    };
    expect(incidents(input).map((i) => i.id)).toEqual(['hit']);
    expect(incidents(input, { events: 'all' }).map((i) => i.id)).toEqual(['hit', 'nearby']);
    expect(nearbyEventCount(input)).toBe(1);
  });

  it('counts the fixture: an old decree is not an incident, its credit rule is', () => {
    const list = incidents(a);
    expect(list.map((i) => i.kind)).toEqual(['credit_rule']);
    expect(list[0].farmIds).toEqual(['cl-ovalle-table-grape']);
  });
});

describe('charts', () => {
  it('reads the tier mix from the assessment', () => {
    expect(tierMix(a)).toEqual([
      { tier: 'high', farms: 0, exposure: 0, share: 0 },
      { tier: 'watch', farms: 1, exposure: 120000, share: 0.5 },
      { tier: 'normal', farms: 1, exposure: 120000, share: 0.5 },
    ]);
    expect(tierMix({ exposureByTier: { normal: 0, watch: 0, high: 0 }, farmsByTier: { normal: 1, watch: 0, high: 0 } })[2].share).toBeNull();
  });

  it('bins risk scores in tens, 100 in the last bin', () => {
    const bins = scoreBins([
      { score: 0, outstanding: 1 },
      { score: 9.9, outstanding: 2 },
      { score: 10, outstanding: 4 },
      { score: 100, outstanding: 8 },
    ]);
    expect(bins).toHaveLength(10);
    expect(bins[0]).toEqual({ from: 0, to: 10, farms: 2, exposure: 3 });
    expect(bins[1].farms).toBe(1);
    expect(bins[9]).toEqual({ from: 90, to: 100, farms: 1, exposure: 8 });
    expect(bins.reduce((s, b) => s + b.farms, 0)).toBe(4);
  });

  it('groups scheduled installments after the as-of by month and tier', () => {
    const tier = (id: string) => a.ranked.find((r) => r.farmId === id)?.tier;
    const months = installmentsByMonth(portfolio, tier, a.asOf, 6);
    expect(months.map((m) => m.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    // Fixture next installments: 30k on 2026-11-30 (watch), 60k on 2027-01-31 (normal).
    expect(months[0].byTier.watch).toBe(30000);
    expect(months[2].byTier.normal).toBeGreaterThanOrEqual(60000);
    const all = portfolio.farms.flatMap((f) => f.loan?.installments ?? []).filter((i) => i.dueDate > a.asOf && i.dueDate < '2027-05-01');
    expect(months.reduce((s, m) => s + m.total, 0)).toBeCloseTo(all.reduce((s, i) => s + i.amount, 0), 6);
  });

});

/** The exported 12-farm offline snapshot (real service output), for reconciliation checks. */
const snap = <T,>(name: string): T => JSON.parse(readFileSync(fileURLToPath(new URL(`../../../public/snapshot/${name}`, import.meta.url)), 'utf8')) as T;
const big = snap<PortfolioAssessment>('assessment-portfolio.json');
const bigPortfolio = snap<Portfolio>('portfolio.json');

describe('report tabs', () => {
  it('has five tabs, Overview first and default', () => {
    expect(REPORT_TABS.map((t) => t.id)).toEqual(['overview', 'payments', 'exposures', 'risks', 'demographics']);
    expect(DEFAULT_REPORT_TAB).toBe('overview');
    expect(parseTabParam(REPORT_TABS, 'Risks', DEFAULT_REPORT_TAB)).toBe('risks');
    expect(parseTabParam(REPORT_TABS, 'nope', DEFAULT_REPORT_TAB)).toBe('overview');
    expect(parseTabParam(REPORT_TABS, null, DEFAULT_REPORT_TAB)).toBe('overview');
    expect(tabForKeyIn(REPORT_TABS, 'overview', 'ArrowLeft')).toBe('demographics');
    expect(tabForKeyIn(REPORT_TABS, 'demographics', 'ArrowRight')).toBe('overview');
    expect(tabForKeyIn(REPORT_TABS, 'risks', 'Home')).toBe('overview');
    expect(tabForKeyIn(REPORT_TABS, 'payments', 'End')).toBe('demographics');
  });
});

describe('payments', () => {
  it('treats an empty plan as a bullet at maturity (same as outstandingAt)', () => {
    const loan = { originationDate: '2026-01-01', maturityDate: '2027-01-15', amount: 500, currency: 'USD' as const, scheduleType: 'bullet' as const, installments: [] };
    expect(planOf(loan)).toEqual([{ dueDate: '2027-01-15', amount: 500 }]);
    const p = { farms: [{ ...portfolio.farms[0], id: 'x', loan }] };
    expect(installmentsByMonth(p, () => 'high', '2026-11-07', 6)[2]).toMatchObject({ month: '2027-01', total: 500, count: 1, byTier: { high: 500 } });
  });

  it('switches between 6 and 12 months', () => {
    const tier = (id: string) => a.ranked.find((r) => r.farmId === id)?.tier;
    const twelve = installmentsByMonth(portfolio, tier, a.asOf, 12);
    expect(twelve).toHaveLength(12);
    expect(twelve[11].month).toBe('2027-10');
    // 2027-05-31 (Ovalle, watch) is outside 6 months, inside 12.
    expect(twelve[6].byTier.watch).toBe(30000);
  });

  it('lists installments due in the next 60 days, soonest first, with the current tier', () => {
    const rows = upcomingInstallments(bigPortfolio, big.ranked, big.asOf, 60);
    expect(rows.map((r) => [r.farmId, r.dueDate])).toEqual([
      ['cl-ovalle-table-grape', '2026-11-30'],
      ['cl-los-angeles-blueberry', '2026-12-01'],
      ['cl-copiapo-table-grape', '2027-01-01'],
    ]);
    expect(rows[0]).toMatchObject({ days: 23, tier: big.ranked.find((r) => r.farmId === 'cl-ovalle-table-grape')!.tier });
    expect(rows.every((r) => r.amount > 0)).toBe(true);
    // The window is (asOf, asOf + 60]: nothing on the as-of itself.
    expect(upcomingInstallments({ farms: [{ ...portfolio.farms[0], loan: { ...portfolio.farms[0].loan!, installments: [{ dueDate: big.asOf, amount: 1 }] } }] }, [], big.asOf)).toEqual([]);
  });
});

describe('exposures split by tier', () => {
  const sum = (t: Record<Tier, number>) => t.normal + t.watch + t.high;

  it('by crop: totals equal the service byCrop, watch + high equal its stressed exposure', () => {
    const rows = exposureByCrop(big);
    expect(rows).toHaveLength(big.byCrop.length);
    for (const c of big.byCrop) {
      const r = rows.find((x) => x.key === c.crop)!;
      expect(r.total).toBeCloseTo(c.exposure, 6);
      expect(r.farms).toBe(c.farms);
      expect(r.byTier.watch + r.byTier.high).toBeCloseTo(c.stressedExposure, 6);
      expect(sum(r.byTier)).toBeCloseTo(r.total, 6);
    }
    // High and watch stay apart (so high can read red).
    expect(exposureByCrop(a).find((r) => r.key === 'table_grape')!.byTier).toEqual({ normal: 0, watch: 120000, high: 0 });
  });

  it('by zone: shared zones by name, own zones in one row; totals equal byZone', () => {
    const rows = exposureByZone(big, bigPortfolio.zones);
    const requinoa = rows.find((r) => r.key === 'zone-requinoa')!;
    expect(requinoa.label).toBe('Requínoa valley');
    expect(requinoa.total).toBeCloseTo(big.byZone.find((z) => z.zoneId === 'zone-requinoa')!.exposure, 6);
    const own = rows.find((r) => r.label === OWN_ZONES)!;
    const ownZones = big.byZone.filter((z) => z.zoneId.startsWith('auto-'));
    expect(own.farms).toBe(ownZones.reduce((s, z) => s + z.farms, 0));
    expect(own.total).toBeCloseTo(ownZones.reduce((s, z) => s + z.exposure, 0), 6);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBeCloseTo(big.totalExposure, 6);
  });

  it('by region: from the CIREN cadastre layer; no reference → no region', () => {
    expect(farmRegion({ ciren: { especie: 'X', sourceLayer: 'CATASTRO_FRUTICOLA/61', objectId: 1 } })).toBe("O'Higgins");
    expect(farmRegion({ ciren: null })).toBeNull();
    expect(farmRegion({ ciren: { especie: 'X', sourceLayer: 'CATASTRO_FRUTICOLA/99', objectId: 1 } })).toBeNull();
    expect(Object.keys(CIREN_LAYER_REGION)).toHaveLength(14);
    const rows = exposureByRegion(big, bigPortfolio.farms);
    expect(rows.reduce((s, r) => s + r.farms, 0)).toBe(12);
    expect(rows.find((r) => r.label === "O'Higgins")!.farms).toBe(2);
    const hand = exposureByRegion(a, portfolio.farms.map((f) => ({ ...f, ciren: null })));
    expect(hand.map((r) => r.label)).toEqual([NO_REGION]);
  });
});

describe('demographics', () => {
  it('farms, total and median hectares per crop', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    const rows = cropProfile(bigPortfolio.farms);
    expect(rows.reduce((s, r) => s + r.farms, 0)).toBe(12);
    const avocado = rows.find((r) => r.crop === 'avocado')!;
    const ha = bigPortfolio.farms.filter((f) => f.crop === 'avocado').map((f) => f.areaHa);
    expect(avocado.totalHa).toBeCloseTo(ha[0] + ha[1], 6);
    expect(avocado.medianHa).toBeCloseTo((ha[0] + ha[1]) / 2, 6);
  });

  it('farms by region and by zone, with area', () => {
    const regions = farmsByRegion(bigPortfolio.farms);
    expect(regions.reduce((s, r) => s + r.farms, 0)).toBe(12);
    expect(regions.find((r) => r.label === 'Biobío')!.names).toHaveLength(2);
    const zones = farmsByZone(bigPortfolio.farms, bigPortfolio.zones, big.ranked);
    expect(zones.find((z) => z.label === 'Los Ángeles east')!.farms).toBe(2);
    expect(zones.reduce((s, z) => s + z.farms, 0)).toBe(12);
  });

  it('growth stage mix from the assessment', () => {
    const rows = stageMix(big.ranked);
    expect(rows.reduce((s, r) => s + r.farms, 0)).toBe(12);
    expect(stageMix(a.ranked)).toEqual([
      { label: 'Bloom', farms: 1, crops: ['table_grape'] },
      { label: 'Fruit set and growth', farms: 1, crops: ['cherry'] },
    ]);
  });

  it('says which optional fields are recorded', () => {
    expect(recordCoverage(portfolio.farms)).toEqual({ farms: 2, cadastre: 2, irrigationDeclared: 1, coverDeclared: 0, plantingYear: 0 });
  });
});

describe('per-farm lookups (water status, stress drivers)', () => {
  const ok: FarmProbe = { water: 'ok', drivers: [{ peril: 'frost', impact: 0.3 }, { peril: 'water', impact: 0.1 }] };
  const dry: FarmProbe = { water: 'stress', drivers: [{ peril: 'water', impact: 0.5 }, { peril: 'abandonment', impact: 0.2 }] };

  it('keeps results tagged with their fingerprint: a late report is never wiped, another fingerprint starts empty', () => {
    // The v1.1 bug: cached rows reported first, then the page cleared its maps in a mount effect.
    let s = emptyProbes();
    s = recordProbe(s, 'fp1', 'a', ok);
    s = recordProbe(s, 'fp1', 'b', dry);
    expect(probesFor(s, 'fp1').size).toBe(2);
    expect(recordProbe(s, 'fp1', 'a', ok)).toBe(s);
    expect(probesFor(s, 'fp2').size).toBe(0);
    s = recordProbe(s, 'fp2', 'a', null);
    expect([...probesFor(s, 'fp2').entries()]).toEqual([['a', null]]);
    expect(probesFor(s, 'fp1').size).toBe(0);
  });

  it('counts water levels; failed lookups are unknown and counted apart', () => {
    const r = waterReport(new Map<string, FarmProbe | null>([['a', ok], ['b', dry], ['c', null], ['d', ok]]));
    expect(r.counts).toEqual({ ok: 2, watch: 0, stress: 1, unknown: 1 });
    expect(r).toMatchObject({ checked: 4, failed: 1 });
    expect(r.farms.stress).toEqual(['b']);
  });

  it('summarises the leading and top drivers with the outstanding they lead on', () => {
    const rows = driverSummary(
      new Map<string, FarmProbe | null>([['a', ok], ['b', dry], ['c', null], ['d', { water: 'ok', drivers: [{ peril: 'water', impact: 0 }] }]]),
      [
        { farmId: 'a', exposure: 100 },
        { farmId: 'b', exposure: 300 },
      ],
    );
    expect(rows).toEqual([
      { peril: 'water', leading: 1, leadingExposure: 300, present: 2 },
      { peril: 'frost', leading: 1, leadingExposure: 100, present: 1 },
      { peril: 'abandonment', leading: 0, leadingExposure: 0, present: 1 },
    ]);
  });
});

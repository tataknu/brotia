import { describe, expect, it } from 'vitest';
import type { CropTemplate, FarmAssessment, Portfolio, SeriesPoint } from '@/domain/types';
import { FarmAssessmentSchema } from '@/domain/schemas';
import { loadFixture } from '@/shared/testing/fixtures';
import {
  bandAt,
  chartWindow,
  datePosition,
  driverNormal,
  driverValue,
  dueInLabel,
  layoutStageBands,
  leafLayer,
  monthlyTotals,
  PEER_READING,
  repaymentPlan,
  stageColorIndex,
  thresholdBands,
  tierRaised,
  toTimeRows,
  waterRungs,
  zPosition,
} from './farmData';

const assessment = FarmAssessmentSchema.parse(loadFixture('assessment-farm-cl-ovalle-table-grape.json')) as FarmAssessment;
const portfolio = loadFixture<Portfolio>('portfolio-sample.json');
const crops = loadFixture<CropTemplate[]>('crops.json');
const ovalle = portfolio.farms.find((f) => f.id === 'cl-ovalle-table-grape')!;
const requinoa = portfolio.farms.find((f) => f.id === 'cl-requinoa-cherry')!;

describe('chartWindow', () => {
  it('starts at the first stage band and stretches to a near installment', () => {
    const w = chartWindow(assessment);
    expect(w.start).toBe('2025-10-07');
    expect(w.asOf).toBe('2026-11-07');
    // next installment 2026-11-30 is within 90 days → axis runs a week past it
    expect(w.end).toBe('2026-12-07');
  });
  it('falls back to asOf − 13 months and ends at asOf without a near installment', () => {
    const w = chartWindow({ asOf: '2026-11-07', stageBands: [], nextInstallment: { dueDate: '2027-06-01', amount: 1 } });
    expect(w.start).toBe('2025-10-07');
    expect(w.end).toBe('2026-11-07');
  });
});

describe('stage bands', () => {
  it('lays bands out left to right, covering the window, with the current band marked', () => {
    const w = chartWindow(assessment);
    const lay = layoutStageBands(assessment.stageBands, w.start, w.asOf, w.asOf);
    expect(lay).toHaveLength(6);
    expect(lay[0].left).toBe(0);
    const total = lay.reduce((s, b) => s + b.width, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(lay.filter((b) => b.current).map((b) => b.band.stage)).toEqual(['bloom']);
    expect(lay[5].current).toBe(true);
    // same stage key → same colour
    expect(lay[0].colorIndex).toBe(lay[5].colorIndex);
    expect(stageColorIndex(assessment.stageBands, 'harvest')).toBe(2);
  });
  it('finds the band of a date and positions dates', () => {
    expect(bandAt(assessment.stageBands, '2026-06-15')?.stage).toBe('dormancy');
    expect(bandAt(assessment.stageBands, '2024-01-01')).toBeNull();
    expect(datePosition('2025-10-07', '2025-10-07', '2026-11-07')).toBe(0);
    expect(datePosition('2030-01-01', '2025-10-07', '2026-11-07')).toBe(1);
  });
});

describe('thresholdBands', () => {
  it('reads the effective per-stage thresholds (farm override wins)', () => {
    const bands = [{ stage: 'bloom', label: 'Bloom', start: '2026-09-15', end: '2026-10-20' }];
    const t = thresholdBands(bands, portfolio, requinoa, crops);
    // Requínoa has a farm override bloom.frostCriticalC = −2.0 (fixture audit)
    expect(t[0].frostCriticalC).toBe(-2.0);
    expect(leafLayer(portfolio, crops, requinoa, 'rules.stages.bloom.frostCriticalC')).toBe('farm');
    expect(leafLayer(portfolio, crops, ovalle, 'rules.stages.bloom.frostCriticalC')).toBe('template');
  });
  it('matches the current-stage driver normals of the fixture for Ovalle', () => {
    const t = thresholdBands(assessment.stageBands, portfolio, ovalle, crops);
    const bloom = t[t.length - 1];
    expect(bloom.stage).toBe('bloom');
    expect(bloom.frostCriticalC).toBe(driverNormal(assessment, 'tmin_7d_min'));
    expect(bloom.heatC).toBe(driverNormal(assessment, 'tmax_7d_max'));
  });
  it('returns nulls when templates are not loaded yet', () => {
    const t = thresholdBands(assessment.stageBands, portfolio, ovalle, undefined);
    expect(t.every((b) => b.frostCriticalC === null && b.heatC === null)).toBe(true);
  });
});

describe('installments', () => {
  it('uses the loan plan, sorted, or a bullet at maturity', () => {
    expect(repaymentPlan(ovalle.loan).map((i) => i.dueDate)[0]).toBe('2025-11-30');
    expect(repaymentPlan({ ...ovalle.loan!, installments: [] })).toEqual([{ dueDate: ovalle.loan!.maturityDate, amount: ovalle.loan!.amount }]);
    expect(repaymentPlan(null)).toEqual([]);
  });
  it('labels the due date', () => {
    expect(dueInLabel('2026-11-07', '2026-11-30')).toBe('Due in 23 days');
    expect(dueInLabel('2026-11-07', '2026-11-08')).toBe('Due in 1 day');
    expect(dueInLabel('2026-11-07', '2026-11-07')).toBe('Due today');
  });
});

describe('series shaping', () => {
  it('keeps nulls and builds the p10–p90 band only when both ends exist', () => {
    const pts: SeriesPoint[] = [
      { date: '2026-11-01', value: 0.4, p10: 0.3, p50: 0.45, p90: 0.55, estimated: false },
      { date: '2026-11-06', value: null, p10: null, p50: null, p90: null, estimated: null },
    ];
    const rows = toTimeRows(pts);
    expect(rows[0].band).toEqual([0.3, 0.55]);
    expect(rows[1].band).toBeNull();
    expect(rows[1].value).toBeNull();
  });
  it('sums rain per month, normal = sum of the daily-rate p50, null when nothing observed', () => {
    const pts: SeriesPoint[] = [
      { date: '2026-10-30', value: 2, p10: 0, p50: 1, p90: 2 },
      { date: '2026-10-31', value: null, p10: 0, p50: 1, p90: 2 },
      { date: '2026-11-01', value: null, p10: null, p50: null, p90: null },
    ];
    const m = monthlyTotals(pts);
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ month: '2026-10-01', value: 2, normal: 2, band: [0, 4], daysObserved: 1, days: 2, partial: true });
    expect(m[1]).toMatchObject({ month: '2026-11-01', value: null, normal: null, band: null });
  });
  it('handles the fixture precip series', () => {
    const m = monthlyTotals(assessment.series.precip.points);
    expect(m.length).toBeGreaterThan(0);
  });
});

describe('risk display', () => {
  it('formats driver values of every type', () => {
    expect(driverValue(true, null)).toBe('Yes');
    expect(driverValue(null, '°C')).toBe('Not available');
    expect(driverValue(-3.1, '°C')).toBe('−3.1 °C');
    expect(driverValue(-0.6, 'z')).toBe('−0.6 sd');
    expect(driverValue(64, '% of normal')).toBe('64 % of normal');
    expect(driverValue(11, 'years')).toBe('11 years');
  });
  it('detects a tier raised by a credit rule', () => {
    expect(tierRaised(assessment.risk)).toBe(false);
    expect(tierRaised({ ...assessment.risk, scoreTier: 'normal', tier: 'watch' })).toBe(true);
  });
});

describe('water ladder', () => {
  it('builds 5 rungs in order with honest tones', () => {
    const r = waterRungs(assessment.water);
    expect(r.map((x) => x.step)).toEqual([1, 2, 3, 4, 5]);
    expect(r[0]).toMatchObject({ key: 'irrigated', tone: 'ok', status: 'Yes' });
    expect(r[1].status).toBe('17 mm in 7 days');
    expect(r[2]).toMatchObject({ tone: 'alert', status: 'Scarcity decree active' });
    expect(r[2].facts[0].value).toContain('until Jul 10, 2027');
    expect(r[3]).toMatchObject({ tone: 'watch', status: 'Mild stress' });
    expect(r[3].facts[2].value).toBe('No clear Landsat pass');
    expect(r[4]).toMatchObject({ tone: 'ok' });
    for (const rung of r) expect(rung.provenance.source).toBeTruthy();
  });
  it('marks unknowns as unknown, never as fine', () => {
    const w = structuredClone(assessment.water);
    w.irrigated.value = 'unknown';
    w.stress.level = 'unknown';
    w.stress.ndmiZ = null;
    w.demand.need7dMm = null;
    w.supply.decreeActive = false;
    w.supply.snowmeltPctOfNormal = null;
    const r = waterRungs(w);
    expect(r[0].tone).toBe('unknown');
    expect(r[1].tone).toBe('unknown');
    expect(r[2].tone).toBe('info');
    expect(r[3].tone).toBe('unknown');
    expect(r[3].facts[0].value).toBe('–');
  });
});

describe('peers', () => {
  it('has a reading for every contract value and clamps the z scale', () => {
    for (const k of ['zone_wide', 'farm_specific', 'normal', 'insufficient_peers'] as const) expect(PEER_READING[k].title).toBeTruthy();
    expect(zPosition(-10)).toBe(0);
    expect(zPosition(10)).toBe(1);
    expect(zPosition(-0.5)).toBeCloseTo(0.5, 6);
  });
});

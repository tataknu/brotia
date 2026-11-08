import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import type { ClimateEvent, FarmAssessment, Portfolio, PortfolioAssessment } from '@/domain/types';
import {
  actionCounts,
  actionRows,
  cropRows,
  dueLabel,
  eventActive,
  installmentInfo,
  kpis,
  scaleMax,
  sortEvents,
  waterSlotsOpen,
  waterSummary,
} from './dashboardModel';

const a = loadFixture<PortfolioAssessment>('assessment-portfolio.json');
const portfolio = loadFixture<Portfolio>('portfolio-sample.json');
const farm = loadFixture<FarmAssessment>('assessment-farm-cl-ovalle-table-grape.json');
const events = loadFixture<ClimateEvent[]>('events.json');

describe('kpis', () => {
  it('reads exposure and tiers from the assessment', () => {
    const k = kpis(a);
    expect(k.total).toBe(240000);
    expect(k.stressed).toBe(120000);
    expect(k.stressedShare).toBe(0.5);
    expect(k.high).toBe(0);
    expect(k.farms).toBe(2);
    expect(k.farmsByTier).toEqual({ normal: 1, watch: 1, high: 0 });
    expect(k.actions).toBe(1);
    expect(kpis({ ...a, totalExposure: 0 }).stressedShare).toBeNull();
  });
});

describe('exposure rows', () => {
  it('builds crop rows sorted by exposure with stressed + unstressed = total', () => {
    const rows = cropRows(a);
    expect(rows.map((r) => r.key)).toEqual(['table_grape', 'cherry']); // equal totals → stressed first
    for (const r of rows) expect(r.stressed + r.unstressed).toBe(r.total);
    expect(rows[0].label).toBe('Table grape');
    expect(scaleMax(rows)).toBe(120000);
    expect(scaleMax([])).toBe(1);
  });
});

describe('next installment', () => {
  it('describes the next installment', () => {
    const i = installmentInfo(a.ranked[0].nextInstallment, a.asOf)!;
    expect(i).toEqual({ dueDate: '2026-11-30', amount: 30000, days: 23, soon: true });
    expect(installmentInfo(a.ranked[1].nextInstallment, a.asOf)!.soon).toBe(false);
    expect(installmentInfo(null, a.asOf)).toBeNull();
    expect([dueLabel(0), dueLabel(1), dueLabel(23), dueLabel(-1), dueLabel(-4)]).toEqual(['today', 'tomorrow', 'in 23 days', 'yesterday', '4 days ago']);
  });
});

describe('water summary', () => {
  it('flags the Ovalle decree as a supply risk', () => {
    const s = waterSummary(farm.water);
    expect(s.decree).toBe(true);
    expect(['watch', 'stress']).toContain(s.level);
    expect(s.details.some((d) => d.includes('decree'))).toBe(true);
  });
  it('maps abandonment and unknown', () => {
    const w = farm.water;
    expect(waterSummary({ ...w, abandonment: { ...w.abandonment, flag: true, confidence: 'high' } }).level).toBe('stress');
    const calm = { ...w, supply: { ...w.supply, decreeActive: false, snowmeltPctOfNormal: null }, stress: { ...w.stress, level: 'unknown' as const }, abandonment: { ...w.abandonment, flag: false } };
    expect(waterSummary(calm).level).toBe('unknown');
    expect(waterSummary({ ...calm, stress: { ...calm.stress, level: 'none' } }).level).toBe('ok');
    expect(waterSummary({ ...calm, stress: { ...calm.stress, level: 'severe' } }).level).toBe('stress');
  });
});

describe('events', () => {
  it('sorts by exposure or recency', () => {
    const withExp = events.map((e) => (e.id === 'gwis:11749494' ? { ...e, affectedExposure: 50000 } : e));
    expect(sortEvents(withExp, 'exposure')[0].id).toBe('gwis:11749494');
    expect(sortEvents(withExp, 'recent').map((e) => e.start)).toEqual([...events.map((e) => e.start)].sort().reverse());
  });
  it('knows active events', () => {
    expect(eventActive({ start: '2026-07-09', end: '2027-07-10' }, '2026-11-07')).toBe(true);
    expect(eventActive({ start: '2026-01-16', end: null }, '2026-11-07')).toBe(true);
    expect(eventActive({ start: '2023-02-08', end: '2023-02-08' }, '2026-11-07')).toBe(false);
  });
});

describe('credit actions', () => {
  it('joins farm names and orders by seriousness', () => {
    const rows = actionRows(a, portfolio);
    expect(rows[0]).toMatchObject({ farmId: 'cl-ovalle-table-grape', farmName: 'Ovalle table grapes', action: 'watch', exposure: 120000 });
    const more = actionRows(
      { ...a, creditActions: [...a.creditActions, { farmId: 'cl-requinoa-cherry', ruleId: 'cr-burned-area', action: 'restructure_review', message: 'm' }] },
      portfolio,
    );
    expect(more.map((r) => r.action)).toEqual(['restructure_review', 'watch']);
    expect(actionCounts(more)).toEqual({ restructure_review: 1, watch: 1 });
  });
});

describe('water lookup gate', () => {
  it('lets two unsettled rows run at once, top first', () => {
    const order = ['a', 'b', 'c', 'd'];
    const open = (settled: string[]) => order.filter((id) => waterSlotsOpen(order, new Set(settled), id, 2));
    expect(open([])).toEqual(['a', 'b']);
    expect(open(['a'])).toEqual(['a', 'b', 'c']);
    expect(open(['b'])).toEqual(['a', 'b', 'c']);
    expect(open(['a', 'b', 'c'])).toEqual(order);
    expect(waterSlotsOpen(order, new Set(), 'zz', 2)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { Crop, CropTemplate, Portfolio } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { changeLabel, flattenLeaves, leafLabel, loanTotals, overrideEntries, reviewIssues, valueText, zoneSummary } from './reviewLogic';

const sample = () => loadFixture<Portfolio>('portfolio-sample.json');
const byCrop = () => Object.fromEntries(loadFixture<CropTemplate[]>('crops.json').map((t) => [t.crop, t])) as Partial<Record<Crop, CropTemplate>>;

describe('review logic', () => {
  it('totals loans and finds the next installments', () => {
    const t = loanTotals(sample(), '2026-11-07');
    expect(t.farmsWithLoan).toBe(2);
    expect(t.lent).toBeGreaterThan(0);
    expect(t.outstanding).toBeLessThanOrEqual(t.lent);
    expect(t.upcoming.every((u) => u.installment.dueDate > '2026-11-07')).toBe(true);
  });
  it('lists every override above the templates (zone, farm, farm credit rule, portfolio rule)', () => {
    const o = overrideEntries(sample(), byCrop());
    expect(o.map((x) => [x.level, x.label, valueText(x.value, x.path)])).toEqual([
      ['zone', 'Table grape, Harvest: damaging rain in 72 hours', '5'],
      ['farm', 'Bloom: frost damage starts (about 10 % loss)', '−2'],
      ['farm', 'Credit rule cr-risk-high-before-installment: days before an installment', '90'],
      ['portfolio', 'Credit rule “Very high score”', 'on'],
    ]);
  });
  it('labels the sample audit entries', () => {
    const s = sample();
    expect(s.audit.map((c) => changeLabel(s, c, byCrop()))).toEqual([
      'Table grape, Harvest: damaging rain in 72 hours',
      'Bloom: frost damage starts (about 10 % loss)',
      'Credit rule cr-risk-high-before-installment: days before an installment',
    ]);
    expect(changeLabel(s, { scope: { level: 'farm', id: 'cl-requinoa-cherry' }, path: 'covered' }, byCrop())).toBe('Covers or nets');
    expect(valueText(null)).toBe('inherited');
    expect(valueText(true, 'covered')).toBe('covered');
    expect(leafLabel('weights.c')).toBe('Geography amplifier (c)');
    expect(leafLabel('stages.bloom.sensitivity.frost', byCrop().cherry)).toBe('Bloom: sensitivity to frost');
  });
  it('flags missing loans as errors and undeclared covers as warnings', () => {
    const s = sample();
    const noLoans = { ...s, farms: s.farms.map((f) => ({ ...f, loan: null })) };
    const issues = reviewIssues(noLoans, byCrop());
    expect(issues.find((i) => i.level === 'error')?.text).toMatch(/2 farms have no loan/);
    expect(issues.find((i) => i.level === 'warning')?.text).toMatch(/Ovalle table grapes/);
    expect(reviewIssues(s, byCrop()).some((i) => i.level === 'error')).toBe(false);
    expect(reviewIssues(s, byCrop(), { country: { name: 'Peru', dataTier: 'standard' } }).some((i) => /standard data tier/.test(i.text))).toBe(true);
  });
  it('summarises zones and flattens leaves', () => {
    expect(zoneSummary(sample()).map((z) => [z.id, z.farms.length, z.overrides])).toEqual([
      ['auto-cl-requinoa-cherry', 1, 0],
      ['auto-cl-ovalle-table-grape', 1, 1],
    ]);
    expect(flattenLeaves({ a: { b: 1, c: null }, d: [1] })).toEqual([
      { path: 'a.b', value: 1 },
      { path: 'd', value: [1] },
    ]);
  });
});

describe('auditActorText (ST-4)', () => {
  it('attributes applied agent proposals to both', async () => {
    const { auditActorText } = await import('./reviewLogic');
    expect(auditActorText({ actor: { kind: 'user', name: 'Credit analyst' }, recommendationId: 'rec-1', status: 'applied' })).toBe(
      'Proposed by Farming agent · applied by Credit analyst',
    );
    expect(auditActorText({ actor: { kind: 'user', name: 'Credit analyst' }, recommendationId: null, status: 'applied' })).toBe('Credit analyst');
  });
});

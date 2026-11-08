import { describe, expect, it } from 'vitest';
import type { CropTemplate, Portfolio } from '@/domain/types';
import { loadFixture } from '@/shared/testing/fixtures';
import { commitChange, makeChange } from '@/domain/rules';
import {
  coerceConditionValue,
  creditChange,
  cropsByPresence,
  describeCondition,
  describeRule,
  isPortfolioRule,
  leafChange,
  leafView,
  newPortfolioRule,
  portfolioCreditRules,
  templateCreditRules,
  thresholdPath,
  zoneCrops,
} from './rulesModel';

const crops = () => loadFixture<CropTemplate[]>('crops.json');
const sample = () => loadFixture<Portfolio>('portfolio-sample.json');
const user = { kind: 'user' as const, name: 'Credit analyst' };
const cherryT = () => crops().find((t) => t.crop === 'cherry')!;
const grapeT = () => crops().find((t) => t.crop === 'table_grape')!;

describe('rule paths per scope (CONTRACT §E.2)', () => {
  const s = sample();
  const leaf = thresholdPath('bloom', 'frostCriticalC');
  it('builds crop, zone and farm paths', () => {
    expect(leafChange(s, { level: 'crop', crop: 'cherry' }, leaf)).toEqual({ scope: { level: 'crop', id: 'cherry' }, path: 'rules.stages.bloom.frostCriticalC' });
    expect(leafChange(s, { level: 'zone', zoneId: 'auto-cl-requinoa-cherry', crop: 'cherry' }, leaf)).toEqual({
      scope: { level: 'zone', id: 'auto-cl-requinoa-cherry' },
      path: 'overrides.cherry.rules.stages.bloom.frostCriticalC',
    });
    expect(leafChange(s, { level: 'farm', farmId: 'cl-requinoa-cherry' }, leaf)).toEqual({
      scope: { level: 'farm', id: 'cl-requinoa-cherry' },
      path: 'overrides.rules.stages.bloom.frostCriticalC',
    });
    expect(creditChange(s, 'portfolio', '', 'cr-abandonment', 'enabled')).toEqual({ scope: { level: 'portfolio', id: s.id }, path: 'creditRules.cr-abandonment.enabled' });
    expect(creditChange(s, 'farm', 'f1', 'cr-abandonment', 'when.value')).toEqual({ scope: { level: 'farm', id: 'f1' }, path: 'creditRuleOverrides.cr-abandonment.when.value' });
  });
  it('shows Custom and the inherited value at each layer (sample audit: −2.4 → −2.0 at the farm)', () => {
    const farmView = leafView(s, cherryT(), { level: 'farm', farmId: 'cl-requinoa-cherry' }, leaf);
    expect(farmView).toMatchObject({ value: -2.0, layer: 'farm', custom: true, inherited: { value: -2.4, layer: 'template' } });
    const zoneView = leafView(s, cherryT(), { level: 'zone', zoneId: 'auto-cl-requinoa-cherry', crop: 'cherry' }, leaf);
    expect(zoneView).toMatchObject({ value: -2.4, layer: 'template', custom: false });
    const grapeZone = leafView(s, grapeT(), { level: 'zone', zoneId: 'auto-cl-ovalle-table-grape', crop: 'table_grape' }, thresholdPath('harvest', 'harvestRainMm72h'));
    expect(grapeZone).toMatchObject({ value: 5, layer: 'zone', custom: true, inherited: { value: 8, layer: 'template' } });
  });
  it('an edit through the audit helpers sets the value, records old → new, and reset restores the inherited value', () => {
    const target = { level: 'crop' as const, crop: 'cherry' as const };
    const { scope, path } = leafChange(s, target, thresholdPath('harvest', 'harvestRainMm72h'));
    const c1 = makeChange(s, crops(), { scope, path, newValue: 15, reason: 'Rainier valley', actor: user });
    const s1 = commitChange(s, c1, crops());
    expect(c1.oldValue).toBe(20);
    expect(s1.cropOverrides.cherry).toEqual({ rules: { stages: { harvest: { harvestRainMm72h: 15 } } } });
    expect(leafView(s1, cherryT(), target, path)).toMatchObject({ value: 15, custom: true });
    // Farms of the crop inherit it (farm view shows the crop layer).
    expect(leafView(s1, cherryT(), { level: 'farm', farmId: 'cl-requinoa-cherry' }, path)).toMatchObject({ value: 15, layer: 'crop', custom: false });
    const c2 = makeChange(s1, crops(), { scope, path, newValue: null, reason: '', actor: user });
    const s2 = commitChange(s1, c2, crops());
    expect(c2.oldValue).toBe(15);
    expect(s2.cropOverrides.cherry).toBeUndefined();
    expect(s2.audit.slice(-2).map((c) => c.id)).toEqual([c1.id, c2.id]);
  });
});

describe('credit rules', () => {
  it('unions the template rules by id and layers portfolio rules', () => {
    expect(templateCreditRules(crops()).map((r) => r.id)).toEqual(['cr-risk-high-before-installment', 'cr-abandonment', 'cr-decree-low-snowmelt', 'cr-burned-area']);
    const s = sample();
    const eff = portfolioCreditRules(s, crops());
    expect(eff.map((r) => [r.id, r.source])).toEqual([
      ['cr-risk-high-before-installment', 'template'],
      ['cr-abandonment', 'template'],
      ['cr-decree-low-snowmelt', 'template'],
      ['cr-burned-area', 'template'],
      ['pf-score-80', 'portfolio'],
    ]);
    expect(isPortfolioRule(s, 'pf-score-80')).toBe(true);
    expect(isPortfolioRule(s, 'cr-abandonment')).toBe(false);
  });
  it('a portfolio-level edit of a template rule seeds it and reset removes it', () => {
    const s = sample();
    const { scope, path } = creditChange(s, 'portfolio', '', 'cr-abandonment', 'enabled');
    const c = makeChange(s, crops(), { scope, path, newValue: false, reason: '', actor: user });
    expect(c.oldValue).toBe(true);
    const s1 = commitChange(s, c, crops());
    expect(portfolioCreditRules(s1, crops()).find((r) => r.id === 'cr-abandonment')).toMatchObject({ enabled: false, source: 'portfolio' });
    const reset = creditChange(s1, 'portfolio', '', 'cr-abandonment', null);
    const s2 = commitChange(s1, makeChange(s1, crops(), { ...reset, newValue: null, reason: '', actor: user }), crops());
    expect(portfolioCreditRules(s2, crops()).find((r) => r.id === 'cr-abandonment')).toMatchObject({ enabled: true, source: 'template' });
  });
  it('adds a new portfolio rule with a free id', () => {
    const r = newPortfolioRule(['pf-rule-1']);
    expect(r.id).toBe('pf-rule-2');
    expect(r.when).toMatchObject({ metric: 'risk.score', op: 'gte', value: 80 });
  });
  it('describes conditions in plain language and coerces values', () => {
    const rules = templateCreditRules(crops());
    expect(describeCondition(rules[0].when)).toBe('Risk tier ≥ high stress within 60 days before an installment');
    expect(describeRule(rules[2])).toBe('Water-scarcity decree active and Snowmelt forecast < 70 % of normal');
    expect(describeCondition(rules[1].when)).toBe('Abandonment signal');
    expect(coerceConditionValue('number', '75')).toBe(75);
    expect(coerceConditionValue('number', '')).toBeNull();
    expect(coerceConditionValue('boolean', 'false')).toBe(false);
    expect(coerceConditionValue('tier', 'watch')).toBe('watch');
    expect(coerceConditionValue('tier', 'bogus')).toBeNull();
  });
});

describe('targets', () => {
  it('lists crops with farms first and zone crops from the zone farms', () => {
    const s = sample();
    expect(cropsByPresence(s).slice(0, 2)).toEqual(['cherry', 'table_grape']);
    expect(zoneCrops(s, 'auto-cl-ovalle-table-grape')).toEqual(['table_grape']);
    expect(zoneCrops(s, 'no-such-zone')).toHaveLength(6);
  });
});

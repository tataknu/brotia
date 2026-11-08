import { describe, expect, it } from 'vitest';
import { loadFixture } from '@/shared/testing/fixtures';
import { CropTemplateListSchema, PortfolioSchema } from './schemas';
import {
  activeZones,
  applyChange,
  assignZoneId,
  checkStageTiling,
  commitChange,
  currentStage,
  effectiveCreditRulesForFarm,
  effectiveRulesForFarm,
  effectiveRulesForZone,
  effectiveValueAt,
  findTemplate,
  getAtPath,
  makeChange,
  makeProposalDecision,
  makeRevert,
  makeSharedZone,
  proposalState,
  resolveFarmLeaf,
  setAtPath,
  syncZones,
} from './rules';
import { ZONE_RADIUS_M } from './constants';
import type { AgentRecommendation, Farm, Portfolio } from './types';

const templates = CropTemplateListSchema.parse(loadFixture('crops.json'));
const sample = (): Portfolio => PortfolioSchema.parse(loadFixture('portfolio-sample.json'));
const user = { kind: 'user' as const, name: 'Tester' };
const NOW = new Date('2026-11-07T16:07:00Z');

const cherryFarm = (p: Portfolio) => p.farms.find((f) => f.id === 'cl-requinoa-cherry')!;
const grapeFarm = (p: Portfolio) => p.farms.find((f) => f.id === 'cl-ovalle-table-grape')!;

describe('path helpers', () => {
  it('setAtPath creates objects and deletes with pruning, keeping top-level keys', () => {
    const farm = { overrides: {} as Record<string, unknown> };
    const a = setAtPath(farm, 'overrides.rules.stages.bloom.frostCriticalC', -2);
    expect(getAtPath(a, 'overrides.rules.stages.bloom.frostCriticalC')).toBe(-2);
    expect(farm.overrides).toEqual({}); // immutable
    const b = setAtPath(a, 'overrides.rules.stages.bloom.frostCriticalC', null);
    expect(b.overrides).toEqual({});
  });
  it('indexes arrays by id', () => {
    const p = { creditRules: [{ id: 'x', when: { value: 1 } }] };
    expect(getAtPath(p, 'creditRules.x.when.value')).toBe(1);
    const q = setAtPath(p, 'creditRules.x.when.value', 2);
    expect(getAtPath(q, 'creditRules.x.when.value')).toBe(2);
    const r = setAtPath(q, 'creditRules.y', { id: 'y' });
    expect(r.creditRules.map((c) => c.id)).toEqual(['x', 'y']);
    const s = setAtPath(r, 'creditRules.x', null);
    expect(s.creditRules.map((c) => c.id)).toEqual(['y']);
  });
});

describe('layering (CONTRACT §E.2), checked against the sample audit', () => {
  const p = sample();
  it('farm override wins over the template (frostCriticalC −2.4 → −2.0)', () => {
    const t = findTemplate(templates, 'cherry')!;
    expect(t.rules.stages.bloom.frostCriticalC).toBe(-2.4);
    const eff = effectiveRulesForFarm(p, t, cherryFarm(p));
    expect(eff.rules.stages.bloom.frostCriticalC).toBe(-2.0);
    // Other leaves of the same stage stay inherited (per-leaf merge).
    expect(eff.rules.stages.bloom.frostSevereC).toBe(t.rules.stages.bloom.frostSevereC);
    expect(resolveFarmLeaf(p, t, cherryFarm(p), 'rules.stages.bloom.frostCriticalC').layer).toBe('farm');
    expect(resolveFarmLeaf(p, t, cherryFarm(p), 'rules.stages.bloom.heatC').layer).toBe('template');
  });
  it('zone override wins over the template (harvestRainMm72h 8 → 5)', () => {
    const t = findTemplate(templates, 'table_grape')!;
    expect(t.rules.stages.harvest.harvestRainMm72h).toBe(8);
    expect(effectiveRulesForFarm(p, t, grapeFarm(p)).rules.stages.harvest.harvestRainMm72h).toBe(5);
    expect(effectiveRulesForZone(p, t, 'auto-cl-ovalle-table-grape').rules.stages.harvest.harvestRainMm72h).toBe(5);
    expect(resolveFarmLeaf(p, t, grapeFarm(p), 'rules.stages.harvest.harvestRainMm72h').layer).toBe('zone');
  });
  it('order is farm > zone > portfolio crop > template', () => {
    const t = findTemplate(templates, 'table_grape')!;
    let q: Portfolio = { ...p, cropOverrides: { table_grape: { rules: { stages: { harvest: { harvestRainMm72h: 6, kc: 0.5 } } } } } };
    let eff = effectiveRulesForFarm(q, t, grapeFarm(q));
    expect(eff.rules.stages.harvest.harvestRainMm72h).toBe(5); // zone beats crop
    expect(eff.rules.stages.harvest.kc).toBe(0.5); // crop beats template
    q = { ...q, farms: q.farms.map((f) => (f.id === 'cl-ovalle-table-grape' ? { ...f, overrides: { rules: { stages: { harvest: { harvestRainMm72h: 3 } } } } } : f)) };
    eff = effectiveRulesForFarm(q, t, grapeFarm(q));
    expect(eff.rules.stages.harvest.harvestRainMm72h).toBe(3);
  });
  it('stage windows, sensitivities and weights merge per leaf', () => {
    const t = findTemplate(templates, 'cherry')!;
    const q: Portfolio = {
      ...p,
      farms: p.farms.map((f) =>
        f.id === 'cl-requinoa-cherry' ? { ...f, overrides: { stages: { bloom: { start: '08-25', sensitivity: { frost: 0.5 } } }, weights: { c: 0.5 } } } : f,
      ),
    };
    const eff = effectiveRulesForFarm(q, t, cherryFarm(q));
    const bloom = eff.stages.find((s) => s.key === 'bloom')!;
    const tBloom = t.stages.find((s) => s.key === 'bloom')!;
    expect(bloom.start).toBe('08-25');
    expect(bloom.end).toBe(tBloom.end);
    expect(bloom.sensitivity.frost).toBe(0.5);
    expect(bloom.sensitivity.heat).toBe(tBloom.sensitivity.heat);
    expect(eff.weights).toEqual({ ...t.weights, c: 0.5 });
    expect(t.stages.find((s) => s.key === 'bloom')!.start).toBe(tBloom.start); // template untouched
  });
  it('credit rules: farm override merges one when-field (60 → 90 days)', () => {
    const rules = effectiveCreditRulesForFarm(p, findTemplate(templates, 'cherry'), cherryFarm(p));
    const r = rules.find((x) => x.id === 'cr-risk-high-before-installment')!;
    expect(r.when.withinDaysBeforeInstallment).toBe(90);
    expect(r.when.metric).toBe('risk.tier');
    expect(r.farmOverridden).toEqual(['when.withinDaysBeforeInstallment']);
    // Portfolio rule appended after the four template rules.
    expect(rules.map((x) => x.id)).toEqual(['cr-risk-high-before-installment', 'cr-abandonment', 'cr-decree-low-snowmelt', 'cr-burned-area', 'pf-score-80']);
  });
  it('a portfolio rule with a template id replaces it', () => {
    const tRule = templates[0].creditRules.find((r) => r.id === 'cr-abandonment')!;
    const q: Portfolio = { ...p, creditRules: [{ ...tRule, then: 'high' }] };
    const r = effectiveCreditRulesForFarm(q, templates[0], cherryFarm(q)).find((x) => x.id === 'cr-abandonment')!;
    expect(r.then).toBe('high');
    expect(r.source).toBe('portfolio');
  });
});

describe('stages (CONTRACT §E.3)', () => {
  it('every template tiles the year without gaps or overlaps', () => {
    for (const t of templates) expect(checkStageTiling(t.stages), t.crop).toEqual({ gaps: [], overlaps: [] });
  });
  it('finds the current stage, including windows that wrap the year end', () => {
    const cherry = findTemplate(templates, 'cherry')!;
    expect(currentStage(cherry.stages, '2026-09-20')!.stage.key).toBe('bloom');
    expect(currentStage(cherry.stages, '2026-12-25')!.stage.key).toBe('harvest');
    expect(currentStage(cherry.stages, '2027-01-10')!.stage.key).toBe('harvest');
  });
  it('29 Feb counts as 28 Feb', () => {
    const cherry = findTemplate(templates, 'cherry')!;
    expect(currentStage(cherry.stages, '2028-02-29')!.stage.key).toBe(currentStage(cherry.stages, '2027-02-28')!.stage.key);
  });
  it('on a gap uses the stage with the latest start before the date; on overlap the first in order', () => {
    const stages = [
      { key: 'a', label: 'A', labelEs: 'A', start: '01-01', end: '03-31', sensitivity: {} as never },
      { key: 'b', label: 'B', labelEs: 'B', start: '03-15', end: '06-30', sensitivity: {} as never },
      { key: 'c', label: 'C', labelEs: 'C', start: '09-01', end: '12-31', sensitivity: {} as never },
    ];
    expect(currentStage(stages, '2026-03-20')).toMatchObject({ overlap: true, gap: false, stage: { key: 'a' } });
    expect(currentStage(stages, '2026-07-15')).toMatchObject({ gap: true, stage: { key: 'b' } });
  });
});

describe('zones (CONTRACT §E.4)', () => {
  const p = sample();
  const farm = cherryFarm(p);
  it('defaults to the auto zone', () => {
    expect(assignZoneId(farm.id, farm.centroid, p.zones)).toBe('auto-cl-requinoa-cherry');
  });
  it('a shared zone containing the centroid wins; nearest centre wins; tie → smallest id', () => {
    const [lng, lat] = farm.centroid;
    const near = makeSharedZone('z-near', 'Near', [lng + 0.01, lat]); // ~0.9 km
    const far = makeSharedZone('z-far', 'Far', [lng + 0.03, lat]); // ~2.8 km
    const out = makeSharedZone('z-out', 'Out', [lng + 0.1, lat]); // ~9 km: outside
    expect(near.radiusM).toBe(ZONE_RADIUS_M);
    expect(assignZoneId(farm.id, farm.centroid, [...p.zones, far, near, out])).toBe('z-near');
    expect(assignZoneId(farm.id, farm.centroid, [...p.zones, out])).toBe('auto-cl-requinoa-cherry');
    const twinB = makeSharedZone('b-twin', 'B', [lng, lat]);
    const twinA = makeSharedZone('a-twin', 'A', [lng, lat]);
    expect(assignZoneId(farm.id, farm.centroid, [twinB, twinA])).toBe('a-twin');
  });
  it('syncZones creates missing auto zones, drops orphans, re-centres moved farms and sets zoneId', () => {
    const extra: Farm = { ...farm, id: 'new-farm', name: 'New farm', centroid: [-71.0, -34.5], zoneId: '' };
    let q: Portfolio = { ...p, farms: [...p.farms.filter((f) => f.id !== 'cl-ovalle-table-grape'), extra] };
    q = syncZones(q);
    expect(q.zones.map((z) => z.id).sort()).toEqual(['auto-cl-requinoa-cherry', 'auto-new-farm']);
    expect(q.farms.find((f) => f.id === 'new-farm')!.zoneId).toBe('auto-new-farm');
    expect(q.zones.find((z) => z.id === 'auto-new-farm')!.center).toEqual([-71.0, -34.5]);
    // Shared zone covering the cherry farm.
    q = syncZones({ ...q, zones: [...q.zones, makeSharedZone('valley', 'Valley', farm.centroid)] });
    expect(q.farms.find((f) => f.id === farm.id)!.zoneId).toBe('valley');
    expect(q.zones.some((z) => z.id === 'auto-cl-requinoa-cherry')).toBe(true); // kept (holds overrides)
    expect(activeZones(q).map((z) => z.id).sort()).toEqual(['auto-new-farm', 'valley']);
    expect(syncZones(q)).toBe(q); // idempotent, same reference
  });
});

describe('audit trail (CONTRACT §E.2)', () => {
  it('reproduces the sample audit oldValues', () => {
    const p = sample();
    for (const c of p.audit) {
      // Effective value before the change = the layer without this change's leaf.
      const before = applyChange(p, { ...c, newValue: null }, templates);
      expect(effectiveValueAt(before, templates, c.scope, c.path), c.id).toEqual(c.oldValue);
      expect(effectiveValueAt(p, templates, c.scope, c.path), c.id).toEqual(c.newValue);
    }
  });

  it('applies a zone change through commitChange and records it', () => {
    const p = sample();
    const ch = makeChange(
      p,
      templates,
      { scope: { level: 'zone', id: 'auto-cl-requinoa-cherry' }, path: 'overrides.cherry.rules.stages.harvest.harvestRainMm72h', newValue: 6, reason: 'test', actor: user },
      { now: NOW },
    );
    expect(ch.oldValue).toBe(findTemplate(templates, 'cherry')!.rules.stages.harvest.harvestRainMm72h);
    expect(ch.at).toBe('2026-11-07T16:07:00Z');
    const q = commitChange(p, ch, templates);
    expect(q.audit).toHaveLength(p.audit.length + 1);
    expect(effectiveRulesForFarm(q, findTemplate(templates, 'cherry')!, cherryFarm(q)).rules.stages.harvest.harvestRainMm72h).toBe(6);
  });

  it('reset (newValue null) removes the override and prunes empty parents', () => {
    const p = sample();
    const ch = makeChange(p, templates, { scope: { level: 'farm', id: 'cl-requinoa-cherry' }, path: 'overrides.rules.stages.bloom.frostCriticalC', newValue: null, reason: 'reset', actor: user });
    const q = commitChange(p, ch, templates);
    expect(cherryFarm(q).overrides).toEqual({});
    expect(effectiveValueAt(q, templates, ch.scope, ch.path)).toBe(-2.4);
  });

  it('crop-level changes live in portfolio.cropOverrides and empty patches are removed', () => {
    const p = sample();
    const scope = { level: 'crop' as const, id: 'cherry' };
    const a = commitChange(p, makeChange(p, templates, { scope, path: 'weights.c', newValue: 0.4, reason: 'x', actor: user }), templates);
    expect(a.cropOverrides.cherry).toEqual({ weights: { c: 0.4 } });
    const b = commitChange(a, makeChange(a, templates, { scope, path: 'weights.c', newValue: null, reason: 'x', actor: user }), templates);
    expect(b.cropOverrides.cherry).toBeUndefined();
  });

  it('portfolio credit rules: whole-rule add, then leaf edit; leaf edit of a template rule seeds it', () => {
    const p = sample();
    const scope = { level: 'portfolio' as const, id: p.id };
    const rule = { ...p.creditRules[0], id: 'pf-new', name: 'New' };
    let q = commitChange(p, makeChange(p, templates, { scope, path: 'creditRules.pf-new', newValue: rule, reason: 'x', actor: user }), templates);
    expect(q.creditRules.map((r) => r.id)).toEqual(['pf-score-80', 'pf-new']);
    q = commitChange(q, makeChange(q, templates, { scope, path: 'creditRules.pf-new.when.value', newValue: 90, reason: 'x', actor: user }), templates);
    expect(q.creditRules[1].when.value).toBe(90);
    const ch = makeChange(q, templates, { scope, path: 'creditRules.cr-abandonment.enabled', newValue: false, reason: 'x', actor: user });
    expect(ch.oldValue).toBe(true);
    q = commitChange(q, ch, templates);
    expect(q.creditRules.find((r) => r.id === 'cr-abandonment')!.enabled).toBe(false);
  });

  it('revert of a first edit on an inherited leaf resets to inherited (newValue null)', () => {
    const p = sample();
    const scope = { level: 'farm' as const, id: 'cl-requinoa-cherry' };
    const ch = makeChange(p, templates, { scope, path: 'overrides.rules.stages.bloom.heatC', newValue: 30, reason: 'x', actor: user });
    const q = commitChange(p, ch, templates);
    const rev = makeRevert(q, templates, ch.id, user)!;
    expect(rev.newValue).toBeNull();
    expect(rev.oldValue).toBe(30);
    const r = commitChange(q, rev, templates);
    expect(getAtPath(cherryFarm(r), 'overrides.rules.stages.bloom.heatC')).toBeUndefined();
  });

  it('revert of a second edit restores the first edit', () => {
    const p = sample();
    const scope = { level: 'farm' as const, id: 'cl-requinoa-cherry' };
    const path = 'overrides.rules.stages.bloom.frostCriticalC';
    // The sample already set −2.0 (chg-0002). Edit again to −1.5, then revert.
    const ch = makeChange(p, templates, { scope, path, newValue: -1.5, reason: 'x', actor: user });
    const q = commitChange(p, ch, templates);
    const rev = makeRevert(q, templates, ch.id, user)!;
    expect(rev.newValue).toBe(-2.0);
    // Reverting the sample's own chg-0002 resets to the template.
    expect(makeRevert(p, templates, 'chg-0002', user)!.newValue).toBeNull();
  });

  it('agent proposals: applied copy is attributed to the user and tracked by recommendationId', () => {
    const p = sample();
    const rec = loadFixture<AgentRecommendation>('agent-recommendation.json');
    const prop = rec.proposals[0];
    expect(proposalState(p, rec, prop)).toBe('proposed');
    const applied = makeProposalDecision(p, templates, rec, prop, 'applied', user, { now: NOW });
    expect(applied).toMatchObject({ status: 'applied', actor: user, recommendationId: rec.id, path: prop.path, newValue: prop.newValue });
    const q = commitChange(p, applied, templates);
    expect(proposalState(q, rec, prop)).toBe('applied');
    expect(getAtPath(q.zones.find((z) => z.id === prop.scope.id), prop.path)).toEqual(prop.newValue);
    const dismissed = makeProposalDecision(p, templates, rec, rec.proposals[1], 'dismissed', user);
    const r = commitChange(p, dismissed, templates);
    expect(proposalState(r, rec, rec.proposals[1])).toBe('dismissed');
    expect(r.zones).toEqual(p.zones); // dismissed changes are not applied
  });
});
